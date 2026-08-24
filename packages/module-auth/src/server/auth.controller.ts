import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AuthResult, Principal, SessionUser } from '../types.js';
import { CurrentPrincipal, Public } from './auth.decorators.js';
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
 * spreading guesses across many. The app must put @nestjs/throttler in front of
 * signin and forgot-password. Neither is sufficient alone; both together are.
 */
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
