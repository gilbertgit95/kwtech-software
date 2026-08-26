import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AuthResult, MfaEnrolment, MfaFactorSummary, MfaRecoveryCodes, Principal, SessionUser } from '../types.js';
import { AllowScopes, CurrentPrincipal, Public } from './auth.decorators.js';
import { AuthService, type RequestContext } from './auth.service.js';

/**
 * /auth/* — the credential intake.
 *
 * Listed in AuthModule's `controllers`, so an app that imports the module has
 * these routes, their Swagger entries and therefore their generated frontend
 * types with no wiring of its own (PLAN §9).
 *
 * NOTHING here sets or reads a cookie. The API is a pure bearer-token service,
 * which is what leaves it with no CSRF surface at all and lets a future mobile
 * app or external service use the identical mechanism. The browser session
 * cookie is the NEXT app's concern, set by its own route handler from the
 * tokens these endpoints return — see apps/web-app.
 *
 * ⚠️ **Rate limiting is the app's job.** Per-account lockout lives in
 * AuthService; it stops a named account being brute-forced but not a botnet
 * spreading guesses across many. Neither is sufficient alone; both together
 * are. The module cannot do it itself — a throttler needs a store, and choosing
 * one for every consumer is exactly what PLAN §9 rule 6 forbids — but it can
 * say WHICH endpoints need it, and does: see CREDENTIAL_ENDPOINTS below.
 */
/**
 * The handlers where a caller is GUESSING a secret, named for the app's
 * throttler.
 *
 * Exported as data because the alternative — the app matching URL strings — is
 * a second list that silently stops covering an endpoint the day this module
 * adds one. A `@Throttle()` decorator here would be simpler still, but it would
 * make @nestjs/throttler a dependency of every consumer of this package,
 * including the ones that never mount an HTTP server.
 *
 * `verify-mfa` belongs on this list as much as `signin` does: six digits is
 * 10⁶, which is a brute-force budget an unthrottled endpoint hands over in
 * minutes. `refresh` does NOT — its credential is 256 bits of CSPRNG output,
 * and throttling it would rate-limit ordinary signed-in users.
 */
export const CREDENTIAL_ENDPOINTS = [
  'signIn',
  'verifyMfa',
  'forgotPassword',
  'resetPassword',
  // Takes the CURRENT password, so it is a guessing surface even though the
  // caller already holds a session — a stolen cookie plus an unthrottled
  // endpoint is a password oracle.
  'changePassword',
] as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public('the caller has no token yet — this is where they get one')
  @Post('signin')
  @HttpCode(200)
  signIn(@Body() body: { identifier: string; password: string }, @Req() request: unknown): Promise<AuthResult> {
    return this.auth.signIn(body, contextOf(request));
  }

  /**
   * Public because the access token it replaces has, by definition, expired.
   * The refresh token in the body is the credential.
   */
  @Public('the access token being replaced has expired')
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: { refreshToken: string }, @Req() request: unknown): Promise<AuthResult> {
    return this.auth.refresh(body.refreshToken, contextOf(request));
  }

  @Post('signout')
  @HttpCode(200)
  signOut(@CurrentPrincipal() principal: Principal) {
    return this.auth.signOut(principal);
  }

  /**
   * Always 202, whether or not the address exists. See
   * AuthService.requestPasswordReset — a form that says "no account with that
   * email" is an enumeration oracle that needs no password guessing at all.
   */
  @Public('by definition the caller cannot sign in')
  @Post('forgot-password')
  @HttpCode(202)
  forgotPassword(@Body() body: { email: string }, @Req() request: unknown) {
    return this.auth.requestPasswordReset(body, contextOf(request));
  }

  @Public('the reset token in the body is the credential')
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() body: { token: string; password: string }, @Req() request: unknown) {
    return this.auth.resetPassword(body, contextOf(request));
  }

  /**
   * Changes the password, given the current one.
   *
   * REST, not a GraphQL mutation, and for the same reason sign-in is: it takes a
   * secret the caller must GUESS if they do not already know it. One GraphQL
   * operation may repeat a field under different aliases, so
   * `mutation { a: changePassword(current:"1"…) b: changePassword(current:"2"…) }`
   * is fifty attempts in a single request the per-IP throttler counts once.
   *
   * Also revokes every OTHER session — see AuthService.changePassword.
   */
  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body() body: { currentPassword: string; newPassword: string },
  ): Promise<{ changed: true }> {
    return this.auth.changePassword(principal, body);
  }

  /**
   * Revokes every session, this one included.
   *
   * REST because the browser's cookies have to be cleared alongside it, and only
   * the Next route handler can do that — the same reason /auth/signout is not a
   * mutation.
   */
  @Post('signout-all')
  @HttpCode(200)
  signOutEverywhere(@CurrentPrincipal() principal: Principal): Promise<{ revoked: number }> {
    return this.auth.signOutEverywhere(principal);
  }

  // ── second factor ─────────────────────────────────────────────────────────

  /**
   * Completes a sign-in that owes a second factor.
   *
   * `@AllowScopes('mfa')` and NOT `@Public`: the caller must present the
   * half-admitted token from /auth/signin, which is what ties the code to the
   * session that asked for it. A public endpoint taking a user id and a code
   * would be a way to brute-force six digits against any account, with no
   * password needed.
   *
   * It is also the ONLY endpoint that accepts an `mfa` token — every other
   * handler defaults to `full`, so the guard refuses this token everywhere
   * else without anybody annotating anything.
   *
   * ⚠️ Six digits is 10⁶, and this is where that gets brute-forced. The
   * per-account lockout in AuthService covers a named target; the app must put
   * its tighter throttler bucket in front of this route as well as /signin.
   */
  @AllowScopes('mfa')
  @Post('verify-mfa')
  @HttpCode(200)
  verifyMfa(
    @CurrentPrincipal() principal: Principal,
    @Body() body: { code: string },
    @Req() request: unknown,
  ): Promise<AuthResult> {
    return this.auth.verifyMfa(principal, body, contextOf(request));
  }

  /** What the caller has enrolled. Never a secret — no endpoint returns one twice. */
  @Get('mfa/factors')
  listMfaFactors(@CurrentPrincipal() principal: Principal): Promise<MfaFactorSummary[]> {
    return this.auth.listMfaFactors(principal);
  }

  /**
   * Starts enrolment. Returns the secret and the `otpauth://` URI ONCE.
   *
   * The password in the body is not redundant with the session: enrolling a
   * factor changes how the account is secured, and a stolen cookie must not be
   * enough to add an authenticator the real owner does not hold.
   */
  @Post('mfa/enrol')
  @HttpCode(200)
  enrolMfa(
    @CurrentPrincipal() principal: Principal,
    @Body() body: { password: string; label: string },
  ): Promise<MfaEnrolment> {
    return this.auth.enrolMfa(principal, body);
  }

  /**
   * Proves the factor works and activates it. Returns the recovery codes once.
   *
   * Also signs the user out everywhere else — see AuthService.confirmMfa for
   * why that is the honest outcome rather than a surprise.
   */
  @Post('mfa/confirm')
  @HttpCode(200)
  confirmMfa(
    @CurrentPrincipal() principal: Principal,
    @Body() body: { factorId: string; code: string },
  ): Promise<MfaRecoveryCodes> {
    return this.auth.confirmMfa(principal, body);
  }

  /** A fresh set of recovery codes. The only way to see codes again. */
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  regenerateRecoveryCodes(
    @CurrentPrincipal() principal: Principal,
    @Body() body: { password: string },
  ): Promise<MfaRecoveryCodes> {
    return this.auth.regenerateRecoveryCodes(principal, body);
  }

  /**
   * Removes a factor. Password required, exactly as enrolment is — stripping
   * the second factor is as much a change to the account's security as adding
   * one, and is the move an attacker on a stolen session would make first.
   *
   * The factor id travels in the BODY rather than the path, because the body is
   * where the password has to be and splitting one operation's inputs across
   * two places invites a handler that validates only one of them.
   */
  @Delete('mfa/factors')
  @HttpCode(200)
  removeMfaFactor(
    @CurrentPrincipal() principal: Principal,
    @Body() body: { factorId: string; password: string },
  ): Promise<{ removed: boolean }> {
    return this.auth.removeMfaFactor(principal, body);
  }

  /**
   * The caller's own record — name, email, username.
   *
   * Separate from /me because this one READS THE DATABASE. Keeping them apart
   * lets a guard-level check stay free while a page that wants to greet someone
   * by name pays for it, and only when it asks.
   */
  @Get('profile')
  profile(@CurrentPrincipal() principal: Principal): Promise<SessionUser | null> {
    return this.auth.profile(principal);
  }

  /**
   * Who the caller is, per their token. No database read — this is the claims
   * already verified by the guard, which is what makes it cheap enough for the
   * frontend to call on every page load.
   */
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): { userId: string; scope: string; expiresAt: number } {
    return { userId: principal.userId, scope: principal.scope, expiresAt: principal.expiresAt };
  }
}

/** Best-effort client attribution, for the session row and the failure log. */
function contextOf(request: unknown): RequestContext {
  const req = request as { ip?: string; headers?: Record<string, unknown> } | undefined;
  const forwarded = req?.headers?.['x-forwarded-for'];
  const ipAddress = (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ?? req?.ip ?? null;
  const userAgent = typeof req?.headers?.['user-agent'] === 'string' ? (req.headers['user-agent'] as string) : null;
  return { ipAddress, userAgent };
}

export type { SessionUser };
