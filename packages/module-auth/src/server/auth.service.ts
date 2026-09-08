import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ACCESS_TOKEN_TTL,
  checkPassword,
  isExpired,
  isLockedOut,
  isPlausibleEmail,
  isPlausibleRecoveryCode,
  isPlausibleTotpCode,
  isPlausibleUsername,
  looksLikeEmail,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  nextLockoutState,
  normaliseEmail,
  normaliseMfaCode,
  normaliseUsername,
  PASSWORD_RESET_TTL,
  RECOVERY_CODE_BYTES,
  RECOVERY_CODE_COUNT,
} from '../domain/policy.js';
import type {
  AuthFailureReason,
  AuthResult,
  MfaEnrolment,
  MfaFactorSummary,
  MfaRecoveryCodes,
  Principal,
  SessionUser,
  TokenScope,
} from '../types.js';
import { AUTH_OPTIONS, type ResolvedAuthModuleOptions } from './auth.options.js';
import {
  AUTH_PRISMA,
  type AuthMfaFactorRow,
  type AuthPrismaClient,
  type AuthUserRow,
  SESSION_SUMMARY_SELECT,
} from './auth.repository.js';
import { hashPassword, verifyPassword } from './password.js';
import { SESSION_REVOCATION_STORE, type SessionRevocationStore } from './revocation.js';
import { open, readSecretKey, seal } from './secret-box.js';
import { type IssuedWsTicket, TokenService } from './token.service.js';
import { generateTotpSecret, otpauthUri, toBase32, verifyTotp } from './totp.js';

/**
 * Every authentication decision in the module.
 *
 * The house rule this file follows throughout: **a caller learns whether it
 * succeeded and nothing else.** Wrong password, unknown address, locked
 * account, suspended account and expired session all produce the same 401 with
 * the same message — and, see signIn(), the same amount of work, so the response
 * time does not answer the question the status code refuses to.
 *
 * That rule is why `AuthFailureReason` exists but never reaches a response: an
 * operator needs to tell those cases apart, and the person holding the form
 * must not.
 */

/** One message, one status, for every failure on the credential path. */
const REFUSAL = 'Invalid email or password';

/**
 * Shape checks, in the service rather than in a transport-level pipe.
 *
 * Two reasons. The module must not choose the app's validation library —
 * PLAN §12.6 is still open between a zod pipe and class-validator, and a module
 * that picked one would decide it for every consumer. And a pipe only guards
 * HTTP: the same service is reachable from a CLI, a worker and a test, where a
 * missing password would otherwise reach scrypt as `undefined`.
 *
 * Deliberately NOT a 400 for a bad address on the sign-in path: "that is not a
 * valid email" and "that email has no account" are answers to different
 * questions, and the first one narrows the guessing for the second.
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  if (value.length > 512) throw new BadRequestException(`${field} is too long`);
  return value;
}

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  /**
   * A real scrypt hash of something nobody knows, verified against when the
   * address does not exist.
   *
   * Without it, "no such user" returns in a millisecond while "wrong password"
   * takes the ~100ms scrypt costs — and that difference is a working
   * account-enumeration oracle no matter what the response body says. Computed
   * once, lazily, because hashing at module load would slow every boot
   * including the test suite's.
   */
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(AUTH_OPTIONS) private readonly options: ResolvedAuthModuleOptions,
    private readonly tokens: TokenService,
    @Optional() @Inject(AUTH_PRISMA) private readonly prisma?: AuthPrismaClient,
    @Optional()
    @Inject(SESSION_REVOCATION_STORE)
    private readonly revoked?: SessionRevocationStore,
  ) {}

  // ── sign in ───────────────────────────────────────────────────────────────

  /**
   * `identifier` is an email OR a username. One field, because that is what the
   * form has, and unambiguous because a username may not contain '@'.
   */
  async signIn(input: { identifier: string; password: string }, context: RequestContext): Promise<AuthResult> {
    const db = this.client();
    const raw = requireString(input.identifier, 'identifier');
    const password = requireString(input.password, 'password');
    const now = this.now();

    const isEmail = looksLikeEmail(raw);
    const identifier = isEmail ? normaliseEmail(raw) : normaliseUsername(raw);

    // A malformed identifier cannot match a row, and saying so would tell an
    // attacker which of their guesses are even worth trying. Burn the hashing
    // time and refuse exactly like any other unknown account.
    const plausible = isEmail ? isPlausibleEmail(identifier) : isPlausibleUsername(identifier);
    if (!plausible) {
      await this.burnPasswordTime(password);
      throw this.refuse('unknown_email', { email: identifier, ip: context.ipAddress });
    }

    const user = await db.authUser.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
    const credential = user
      ? await db.authCredential.findFirst({
          where: { userId: user.id, type: 'password' },
          select: { id: true, secret: true },
        })
      : null;

    // Always spend the hashing time, even when there is nothing to compare
    // against, and judge the account's state only afterwards. Returning early
    // on a missing user would reintroduce the timing oracle the dummy hash
    // exists to close.
    const passwordOk = credential
      ? await verifyPassword(password, credential.secret)
      : await this.burnPasswordTime(password);

    if (!user) throw this.refuse('unknown_email', { email: identifier, ip: context.ipAddress });
    if (!credential) throw this.refuse('no_password_credential', { userId: user.id, ip: context.ipAddress });

    // Checked BEFORE the password result is acted on: a locked account must
    // fail even on the RIGHT password, or the lockout becomes an oracle that
    // confirms a correct guess.
    if (isLockedOut(user.lockedUntil, now)) {
      throw this.refuse('account_locked', { userId: user.id, ip: context.ipAddress });
    }

    if (!passwordOk) {
      const next = nextLockoutState(user.failedLoginCount, now);
      await db.authUser.update({ where: { id: user.id }, data: next });
      throw this.refuse('wrong_password', { userId: user.id, ip: context.ipAddress });
    }

    if (user.status !== 'active') {
      throw this.refuse('account_suspended', { userId: user.id, ip: context.ipAddress });
    }

    /*
     * The password was right. Whether that is ENOUGH is a separate question,
     * and the session is created either way — a half-admitted user needs a
     * session row to hang `mfaSatisfiedAt` off, and an `mfa`-scoped token is
     * refused everywhere except /auth/verify-mfa, so issuing one grants
     * nothing.
     *
     * Note what is NOT enforced here: `user.mfaRequiredAt`. Being required to
     * enrol and having enrolled are different facts (see prisma/auth.prisma),
     * and a user who is required but has not enrolled cannot satisfy a
     * challenge — holding them at one would lock them out of their own account
     * with no way forward. Enforcing the policy needs a scope that admits the
     * ENROLMENT endpoints and nothing else, and inventing a fourth TokenScope
     * quietly is exactly the change this module refuses to make by accident.
     * Until then the column records the policy and sign-in reads only the rows.
     */
    return this.startSession(user, context, (await this.mfaOwed(user.id)) ? 'mfa' : 'full');
  }

  /**
   * Creates an account and signs it in. NOT an endpoint, and that is the point.
   *
   * ## Why this is a method and not a route
   *
   * There is no public sign-up in this system. Exposing one is a product
   * decision with a spam problem attached, and this module deliberately does
   * not make it: nothing in `auth.controller.ts` or `auth.resolver.ts` reaches
   * this. It exists so an app can compose account creation with something that
   * already establishes the address is real — today, an organization invitation
   * whose token was delivered to that mailbox.
   *
   * The caller is responsible for that proof. This method checks that the
   * address is well formed, free, and that the password passes policy; it
   * cannot check WHY the account should exist, and pretending otherwise by
   * asking for a "reason" argument would be theatre.
   *
   * ## An existing address is refused plainly
   *
   * `signIn` goes to some trouble not to reveal which addresses have accounts.
   * Here it is unavoidable and correct: whoever calls this is creating an
   * account at a specific address, and "that address already has one, sign in
   * instead" is the only useful thing to say. That is another reason it is not
   * a route — as an open endpoint it would be an enumeration oracle.
   *
   * ## No email verification, because the caller already did it
   *
   * A `verifiedAt` column would be the honest place to record this, and the
   * schema has none. The composition is what carries the proof: an invitation
   * token arrives at an address and comes back, which is the same evidence a
   * verification email collects.
   *
   * ## It does NOT sign anybody in
   *
   * It returns the row, not an `AuthResult`. Issuing a session here would put
   * token minting on a path that is not `/auth/signin` — and the reason every
   * credential exchange stays on the REST controller (see AuthResolver) is that
   * the throttler buckets by path and the cookies are written by one reviewed
   * adapter. The caller signs the new account in the ordinary way, with the
   * password it was just given, and every protection on that path applies.
   */
  async createAccount(input: {
    email: string;
    displayName?: string | null;
    password: string;
  }): Promise<{ id: string; email: string; displayName: string | null }> {
    const db = this.client();

    const email = normaliseEmail(requireString(input.email, 'email'));
    if (!isPlausibleEmail(email)) {
      throw new BadRequestException({ message: 'That does not look like an email address' });
    }

    const complaint = checkPassword(requireString(input.password, 'password'));
    if (!complaint.ok) {
      // Told precisely, like `resetPassword` does: it is about the value they
      // just chose, not about whether an account exists.
      throw new UnauthorizedException({
        message: complaint.reason === 'too_short' ? 'Password is too short' : 'Password is too easily guessed',
        reason: 'weak_password' satisfies AuthFailureReason,
      });
    }

    const existing = await db.authUser.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({ message: 'An account already exists for that address' });
    }

    const secret = await hashPassword(input.password);
    const displayName = input.displayName?.trim() || null;

    const user = await db.$transaction(async (tx) => {
      /*
       * Both rows or neither. A user with no credential cannot sign in and
       * cannot be repaired by trying again — the address is taken, so the
       * second attempt fails on the uniqueness check — which is the worst
       * possible outcome for somebody who just typed a password.
       *
       * The unique index on `email` is what makes the race safe: two
       * simultaneous accepts of the same invitation, or one arriving beside a
       * seeded account, lose here rather than producing a duplicate.
       */
      const created = await tx.authUser.create({ data: { email, displayName } });
      await tx.authCredential.create({ data: { userId: created.id, type: 'password', secret } });
      return created;
    });

    return { id: user.id, email: user.email, displayName: user.displayName };
  }

  // ── refresh ───────────────────────────────────────────────────────────────

  /**
   * Rotation, not reuse: the presented token is spent and a new one issued.
   *
   * The update is CONDITIONAL on the old hash, so two concurrent refreshes
   * cannot both succeed — the loser gets a 401 and signs out, rather than the
   * two of them interleaving into a session neither owns. That condition is the
   * whole mechanism; a plain update by id would let both through.
   */
  async refresh(refreshToken: string, context: RequestContext): Promise<AuthResult> {
    const db = this.client();
    const presented = this.tokens.hashOpaque(requireString(refreshToken, 'refreshToken'));
    const now = this.now();

    const session = await db.authSession.findUnique({
      where: { refreshTokenHash: presented },
      include: { user: true },
    });

    if (!session) throw this.refuse('session_unknown', { ip: context.ipAddress });
    if (session.revokedAt !== null) throw this.refuse('session_revoked', { userId: session.userId });
    if (isExpired(session.expiresAt, now)) throw this.refuse('session_expired', { userId: session.userId });
    if (session.user.status !== 'active') throw this.refuse('account_suspended', { userId: session.userId });

    const next = this.tokens.issueRefresh();
    const rotated = await db.authSession.updateMany({
      where: { id: session.id, refreshTokenHash: presented, revokedAt: null },
      data: { refreshTokenHash: next.tokenHash, expiresAt: next.expiresAt, lastUsedAt: now },
    });
    // Someone else rotated it between the read and the write. Both callers
    // holding the same token is indistinguishable from a stolen one, so
    // neither is trusted.
    if (rotated.count === 0) throw this.refuse('session_revoked', { userId: session.userId });

    /*
     * THE SCOPE IS RE-DERIVED, never carried over from the token being replaced.
     *
     * This is the check that makes the `mfa` scope worth anything. A user who
     * signs in, is handed a half-admitted session and then simply calls
     * /auth/refresh must not be upgraded to `full` for having waited fifteen
     * minutes — and they would be, if this line said 'full' the way it used to.
     * The session row is the authority on whether the second factor was ever
     * satisfied, and it is read here rather than trusted from a claim.
     *
     * The extra query only runs for a session that has NOT satisfied MFA, so an
     * ordinary refresh pays nothing for it.
     */
    const needsMfa = session.mfaSatisfiedAt === null && (await this.mfaOwed(session.userId));
    const scope: TokenScope = needsMfa ? 'mfa' : 'full';

    const access = this.tokens.issueAccess({ userId: session.userId, sessionId: session.id, scope });
    return {
      user: toSessionUser(session.user),
      accessToken: access.accessToken,
      expiresAt: access.expiresAt,
      refreshToken: next.token,
      scope,
      mustChangePassword: false,
      mfaRequired: needsMfa,
    };
  }

  // ── sign out ──────────────────────────────────────────────────────────────

  /** Revokes one session. Idempotent: signing out twice is not an error. */
  async signOut(principal: Principal): Promise<{ revoked: boolean }> {
    const db = this.client();
    const { count } = await db.authSession.updateMany({
      where: { id: principal.sessionId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
    // Denylisted as well as marked, so the access token already in the caller's
    // hand stops working now rather than at its next refresh.
    await this.revoked?.revokeSessions([principal.sessionId], this.accessTokenLifetime());
    return { revoked: count > 0 };
  }

  /**
   * The signed-in user's own record.
   *
   * A DATABASE READ, unlike /auth/me — which is why it is a separate call
   * rather than a wider one. `Principal` is deliberately thin (see types.ts):
   * it carries what a guard needs to decide, and a guard does not need a
   * display name. Baking one into the token would mean a week-old session
   * greeting someone by a name they changed on Tuesday.
   */
  async profile(principal: Principal): Promise<SessionUser | null> {
    const user = await this.client().authUser.findUnique({ where: { id: principal.userId } });
    // Deleted or suspended since the token was issued. The token stays
    // cryptographically valid until it expires, so this is the check that
    // notices.
    if (user?.status !== 'active') return null;
    return toSessionUser(user);
  }

  // ── forgot password ───────────────────────────────────────────────────────

  /**
   * Always reports the same thing, whether or not the address exists.
   *
   * A form that says "no account with that email" is an account-enumeration
   * oracle that needs no password guessing at all — and it is the one most
   * often shipped, because it reads as helpful. The honest UI copy is "if that
   * address has an account, a link is on its way", which is true either way.
   */
  async requestPasswordReset(
    input: { email: string },
    context: RequestContext,
    options: { reason?: 'reset' | 'invitation' } = {},
  ): Promise<{ accepted: true }> {
    if (!this.options.sendPasswordResetEmail) {
      // A configuration error, not an auth failure: minting a token nobody can
      // receive would look like it worked and lock the user out quietly.
      throw new Error('AuthModule.forRoot requires sendPasswordResetEmail to offer password reset');
    }

    const db = this.client();
    const email = normaliseEmail(requireString(input.email, 'email'));
    const user = isPlausibleEmail(email) ? await db.authUser.findUnique({ where: { email } }) : null;

    if (user?.status !== 'active') {
      this.options.onAuthFailure?.({ reason: 'unknown_email', email, ip: context.ipAddress });
      return { accepted: true };
    }

    const reset = this.tokens.issueOpaque(this.options.passwordResetTtl ?? PASSWORD_RESET_TTL);

    // Outstanding requests are invalidated first, so a person who clicks
    // "forgot password" three times has one live link rather than three.
    await db.authPasswordReset.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: this.now() },
    });
    await db.authPasswordReset.create({
      data: { userId: user.id, tokenHash: reset.tokenHash, expiresAt: reset.expiresAt, requestedIp: context.ipAddress },
      select: { id: true },
    });

    // The RAW token leaves the module exactly here and is never stored in this
    // form. If delivery fails, the token is unrecoverable and the user asks
    // again — which is the correct failure direction.
    await this.options.sendPasswordResetEmail({
      user: toSessionUser(user),
      token: reset.token,
      expiresAt: reset.expiresAt,
      // Carried so the app can send a welcome rather than a reset. See the hook.
      ...(options.reason ? { reason: options.reason } : {}),
    });

    return { accepted: true };
  }

  // ── reset password ────────────────────────────────────────────────────────

  /**
   * Consumes a reset token and sets a new password.
   *
   * Three things happen together, in one transaction, and all three matter:
   * the token is marked consumed (single use), the credential is replaced, and
   * **every existing session is revoked**. That last one is the point people
   * skip: someone resetting a password because it was stolen is not helped by a
   * reset that leaves the thief signed in.
   */
  async resetPassword(input: { token: string; password: string }, context: RequestContext): Promise<{ reset: true }> {
    const db = this.client();
    const now = this.now();

    const token = requireString(input.token, 'token');
    const complaint = checkPassword(requireString(input.password, 'password'));
    if (!complaint.ok) {
      // A password rule is the one thing on this path the caller SHOULD be told
      // precisely: it is about the value they just chose, not about whether an
      // account exists.
      throw new UnauthorizedException({
        message: complaint.reason === 'too_short' ? 'Password is too short' : 'Password is too easily guessed',
        reason: 'weak_password' satisfies AuthFailureReason,
      });
    }

    const record = await db.authPasswordReset.findUnique({
      where: { tokenHash: this.tokens.hashOpaque(token) },
      include: { user: true },
    });

    if (!record) throw this.refuse('reset_token_unknown', { ip: context.ipAddress });
    if (record.consumedAt !== null) throw this.refuse('reset_token_consumed', { userId: record.userId });
    if (isExpired(record.expiresAt, now)) throw this.refuse('reset_token_expired', { userId: record.userId });

    const secret = await hashPassword(input.password);

    await db.$transaction(async (tx) => {
      // Conditional on still being unconsumed, so two clicks on the same link
      // cannot both set a password — the second finds nothing to consume.
      const consumed = await tx.authPasswordReset.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) throw this.refuse('reset_token_consumed', { userId: record.userId });

      await tx.authCredential.upsert({
        where: { userId_type: { userId: record.userId, type: 'password' } },
        create: { userId: record.userId, type: 'password', secret },
        update: { secret },
      });

      // The lockout is cleared with the password: the person proved control of
      // the address, and leaving them locked out punishes the victim of the
      // brute force rather than its author.
      await tx.authUser.update({ where: { id: record.userId }, data: { failedLoginCount: 0, lockedUntil: null } });

      await tx.authSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
    });

    // Someone resetting a password because it was stolen is not helped by a
    // reset that leaves the thief's ACCESS TOKEN working for another few
    // minutes. No session is spared here — the caller has none.
    await this.revoked?.revokeUserBefore(record.userId, Math.floor(now.getTime() / 1000), this.accessTokenLifetime());

    return { reset: true };
  }

  // ── the account's own settings ────────────────────────────────────────────

  /**
   * Changes the human-facing fields of the caller's own account.
   *
   * NO PASSWORD REQUIRED, unlike the credential and factor endpoints. Renaming
   * yourself is not a change to how the account is secured — an attacker holding
   * a session gains nothing by editing a display name, and demanding a password
   * for it would train people to type their password into any form that asks.
   *
   * **Email is deliberately absent.** Changing the address a password reset is
   * delivered to is an account-takeover primitive if it takes effect before the
   * new address is proved: take a session, change the email, request a reset,
   * receive it. Doing it properly means a confirmation sent to the NEW address
   * and the old one left working until it is clicked — a flow, not a field, and
   * one this method must not quietly pretend to offer.
   */
  async updateProfile(
    principal: Principal,
    input: { displayName?: string | null; username?: string },
  ): Promise<SessionUser> {
    const db = this.client();
    const user = await this.requireActiveUser(principal.userId);

    const data: { displayName?: string | null; username?: string } = {};

    if (input.displayName !== undefined) {
      if (input.displayName === null) data.displayName = null;
      else {
        const trimmed = requireString(input.displayName, 'displayName').trim();
        if (trimmed.length > 120) throw new BadRequestException('Display name is too long');
        // Empty means "remove it", not a name of zero characters.
        data.displayName = trimmed.length > 0 ? trimmed : null;
      }
    }

    if (input.username !== undefined) {
      const username = normaliseUsername(requireString(input.username, 'username'));
      if (!isPlausibleUsername(username)) {
        // Told precisely, unlike a sign-in failure: this is about a value the
        // caller just chose, not about whether some account exists.
        throw new BadRequestException(
          `Username must be ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters, letters, numbers, dots, ` +
            'hyphens or underscores, and may not contain "@"',
        );
      }
      data.username = username;
    }

    if (Object.keys(data).length === 0) return toSessionUser(user);

    try {
      return toSessionUser(await db.authUser.update({ where: { id: user.id }, data }));
    } catch (error) {
      // `username` is @unique. Racing two claims, or picking one already taken,
      // surfaces as a constraint violation — a 409, not a 500, and the only
      // enumeration this leaks is one the sign-up form leaks anyway.
      if (isUniqueViolation(error)) throw new ConflictException('That username is already taken');
      throw error;
    }
  }

  /**
   * Changes the password, given the current one.
   *
   * Three things happen together, and the third is the one people skip: the
   * current password is proved, the credential is replaced, and **every OTHER
   * session is revoked**. Someone changing their password because they think it
   * was stolen is not helped by a change that leaves the thief signed in.
   *
   * This session survives on purpose — being signed out of the tab you just used
   * to change your password reads as a failure, and it is the one session that
   * has definitely just proved the old credential.
   */
  async changePassword(
    principal: Principal,
    input: { currentPassword: string; newPassword: string },
  ): Promise<{ changed: true }> {
    const db = this.client();
    const now = this.now();

    const user = await this.requireActiveUser(principal.userId);
    await this.requirePassword(user.id, input.currentPassword);

    const complaint = checkPassword(requireString(input.newPassword, 'newPassword'));
    if (!complaint.ok) {
      throw new BadRequestException(
        complaint.reason === 'too_short'
          ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
          : 'That password is too easily guessed',
      );
    }

    const secret = await hashPassword(input.newPassword);

    await db.$transaction(async (tx) => {
      await tx.authCredential.upsert({
        where: { userId_type: { userId: user.id, type: 'password' } },
        create: { userId: user.id, type: 'password', secret },
        update: { secret },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { id: principal.sessionId } },
        data: { revokedAt: now },
      });
    });

    /*
     * By SESSION ID, not by user — this is the one revocation that spares a
     * session, and a user-level cut-off would take this one out too. So the ids
     * are read and denylisted individually.
     */
    await this.denylistOtherSessions(user.id, principal.sessionId);

    return { changed: true };
  }

  /**
   * Revokes every session, INCLUDING this one.
   *
   * "Sign out everywhere" that spared the current device would be answering a
   * different question from the one the button asks — and the person clicking it
   * usually suspects a device they no longer hold. Signing this one out too is
   * the honest reading, and the caller signs back in.
   *
   * ⚠️ Revocation bites at the next REFRESH, not immediately: access tokens are
   * verified from their signature with no database read, so a stolen one stays
   * usable until it expires. That window is AUTH_ACCESS_TOKEN_TTL — fifteen
   * minutes by default. It is the cost of keeping authentication off the hot
   * path, and the number to lower if this button needs to bite faster.
   */
  async signOutEverywhere(principal: Principal): Promise<{ revoked: number }> {
    const now = this.now();
    const { count } = await this.client().authSession.updateMany({
      where: { userId: principal.userId, revokedAt: null },
      data: { revokedAt: now },
    });

    /*
     * ONE entry for the whole account, not one per session.
     *
     * Every token issued at or before this instant is refused, which covers
     * sessions this query did not name — including any token minted moments ago
     * and still in flight. A signed-in device stops working on its NEXT REQUEST,
     * not at its next refresh: that is what makes the button immediate.
     */
    await this.revoked?.revokeUserBefore(
      principal.userId,
      Math.floor(now.getTime() / 1000),
      this.accessTokenLifetime(),
    );
    return { revoked: count };
  }

  // ── second factor: the sign-in challenge ──────────────────────────────────

  /**
   * Completes a half-admitted sign-in.
   *
   * Reached with an `mfa`-scoped token, which the guard refuses at every other
   * endpoint — so the caller has proved the password and nothing more. Success
   * marks the SESSION as satisfied and hands back a `full` one.
   *
   * The refresh token is ROTATED here, not reused. The half-admitted session
   * was already handed a refresh token; leaving it valid would mean the
   * credential that could only ever buy an `mfa` token is now the credential
   * for a `full` one. Rotating retires it at the moment the session changes
   * what it is worth.
   *
   * Accepts a TOTP code or a recovery code in the same field. One field because
   * that is what the form has, and unambiguous because the two have different
   * shapes — and because telling the user which of the two they got wrong tells
   * an attacker which one they are closer to.
   */
  async verifyMfa(principal: Principal, input: { code: string }, context: RequestContext): Promise<AuthResult> {
    const db = this.client();
    const now = this.now();
    const code = normaliseMfaCode(requireString(input.code, 'code'));

    const session = await db.authSession.findUnique({ where: { id: principal.sessionId }, include: { user: true } });
    if (!session) throw this.refuse('session_unknown', { userId: principal.userId, ip: context.ipAddress });
    if (session.revokedAt !== null) throw this.refuse('session_revoked', { userId: session.userId });
    if (isExpired(session.expiresAt, now)) throw this.refuse('session_expired', { userId: session.userId });
    if (session.user.status !== 'active') throw this.refuse('account_suspended', { userId: session.userId });

    const user = session.user;

    // Same rule as the password path: a locked account fails even on the RIGHT
    // code, or the lockout becomes an oracle that confirms a correct guess.
    if (isLockedOut(user.lockedUntil, now)) {
      throw this.refuse('account_locked', { userId: user.id, ip: context.ipAddress });
    }

    const factors = await db.authMfaFactor.findMany({
      where: { userId: user.id, type: 'totp', confirmedAt: { not: null } },
    });
    if (factors.length === 0) {
      // Every factor was revoked between sign-in and now. There is nothing this
      // caller can present, so the honest answer is to make them start again.
      throw this.refuse('mfa_no_factor', { userId: user.id, ip: context.ipAddress });
    }

    const satisfied = isPlausibleRecoveryCode(code)
      ? await this.spendRecoveryCode(user.id, code, now)
      : await this.spendTotpCode(factors, code, now, user.id);

    if (!satisfied) {
      // MFA failures count towards the SAME lockout as password failures.
      // Separate counters would mean an attacker who holds the password gets a
      // fresh budget of guesses at the second factor, which is the budget that
      // matters once six digits is all that stands in the way.
      await db.authUser.update({ where: { id: user.id }, data: nextLockoutState(user.failedLoginCount, now) });
      throw this.refuse('mfa_code_invalid', { userId: user.id, ip: context.ipAddress });
    }

    const next = this.tokens.issueRefresh();
    const upgraded = await db.authSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: {
        mfaSatisfiedAt: now,
        refreshTokenHash: next.tokenHash,
        expiresAt: next.expiresAt,
        lastUsedAt: now,
      },
    });
    // Revoked between the read above and this write — signed out from another
    // device, most likely. The code was genuine and is now spent; the session
    // it was for is gone, so the caller starts over.
    if (upgraded.count === 0) throw this.refuse('session_revoked', { userId: user.id });

    await db.authUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });

    const access = this.tokens.issueAccess({ userId: user.id, sessionId: session.id, scope: 'full' });
    return {
      user: toSessionUser(user),
      accessToken: access.accessToken,
      expiresAt: access.expiresAt,
      refreshToken: next.token,
      scope: 'full',
      mustChangePassword: false,
      mfaRequired: false,
    };
  }

  // ── second factor: enrolment ──────────────────────────────────────────────

  /** What the caller has enrolled. Never the secret — there is no endpoint for that. */
  async listMfaFactors(principal: Principal): Promise<MfaFactorSummary[]> {
    const factors = await this.client().authMfaFactor.findMany({
      where: { userId: principal.userId },
      orderBy: { createdAt: 'asc' },
    });
    return factors.map((factor) => ({
      id: factor.id,
      type: factor.type,
      label: factor.label,
      confirmedAt: factor.confirmedAt?.toISOString() ?? null,
      lastUsedAt: factor.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Begins enrolment: mints a secret, stores it encrypted, returns it once.
   *
   * **The current password is required**, even though the caller already holds
   * a `full` session. Adding a second factor is a change to how the account is
   * secured, and an attacker sitting on a stolen session cookie must not be
   * able to enrol their own authenticator — which would lock the real owner out
   * with a factor the attacker controls. The same reasoning governs removal.
   *
   * The factor is created UNCONFIRMED and grants nothing until confirmMfa()
   * proves it works. That is the column that stops a mis-scanned QR code
   * becoming a support ticket.
   */
  async enrolMfa(principal: Principal, input: { password: string; label: string }): Promise<MfaEnrolment> {
    const db = this.client();
    const key = this.mfaKey();
    const label = requireString(input.label, 'label').trim();
    if (label.length > 64) throw new BadRequestException('label is too long');

    const user = await this.requireActiveUser(principal.userId);
    await this.requirePassword(user.id, input.password);

    // An abandoned enrolment is rubbish, not history: someone who started and
    // closed the tab left an unconfirmed row that grants nothing, blocks
    // nothing, and would otherwise collide with @@unique([userId, label]) the
    // next time they try the same name.
    await db.authMfaFactor.deleteMany({ where: { userId: user.id, confirmedAt: null } });

    const secret = generateTotpSecret();
    const created = await db.authMfaFactor.create({
      data: { userId: user.id, type: 'totp', label, secret: seal(secret, key) },
      select: { id: true },
    });

    return {
      factorId: created.id,
      secret,
      uri: otpauthUri({
        secretBase32: secret,
        // The username if there is one, else the address: it is what the user
        // will read in a list of a dozen entries.
        account: user.username ?? user.email,
        issuer: this.options.mfaIssuerLabel,
      }),
    };
  }

  /**
   * Proves the factor works, activates it, and returns the recovery codes.
   *
   * Three things happen together and all three matter: the factor becomes
   * confirmed, a fresh set of recovery codes replaces any previous set, and
   * **every other session is revoked**.
   *
   * That last one is what keeps refresh() honest. Sessions opened before this
   * moment have `mfaSatisfiedAt: null` and would, on their next refresh, be
   * correctly re-derived as owing a factor — leaving the user challenged on
   * devices they were already signed in on, minutes after enrolling, with no
   * explanation. Revoking them makes "you have been signed out everywhere else"
   * the honest and expected outcome instead.
   */
  async confirmMfa(principal: Principal, input: { factorId: string; code: string }): Promise<MfaRecoveryCodes> {
    const db = this.client();
    const key = this.mfaKey();
    const now = this.now();
    const factorId = requireString(input.factorId, 'factorId');
    const code = normaliseMfaCode(requireString(input.code, 'code'));

    const user = await this.requireActiveUser(principal.userId);

    const factor = await db.authMfaFactor.findFirst({
      where: { userId: user.id, id: factorId, type: 'totp', confirmedAt: null },
    });
    // Scoped by userId in the query itself, so a factor id belonging to someone
    // else is simply not found rather than checked-and-refused.
    if (!factor) throw new BadRequestException('No enrolment is in progress for that factor');

    const secret = open(factor.secret, key);
    if (!secret) {
      // The key rotated between enrolling and confirming, or the row is corrupt.
      // Not a credential failure and not the user's fault.
      throw new BadRequestException('That enrolment can no longer be read. Start again.');
    }

    const verdict = verifyTotp({ secretBase32: secret, code, now, lastUsedStep: null });
    if (!verdict.ok || verdict.step === null) {
      throw this.refuse(verdict.replayed ? 'mfa_code_replayed' : 'mfa_code_invalid', { userId: user.id });
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => toBase32(randomBytes(RECOVERY_CODE_BYTES)));
    // Hashed before the transaction opens: scrypt ten times over is seconds of
    // CPU, and holding a database transaction open across it would pin a
    // connection for the whole of it.
    const hashes = await Promise.all(codes.map((value) => hashPassword(value)));

    await db.$transaction(async (tx) => {
      const confirmed = await tx.authMfaFactor.updateMany({
        where: { id: factor.id, userId: user.id, confirmedAt: null },
        data: { confirmedAt: now, lastUsedAt: now, lastUsedStep: BigInt(verdict.step as number) },
      });
      // Confirmed by a concurrent request. Generating a second set of recovery
      // codes for the same factor would invalidate the set the other caller has
      // just shown the user.
      if (confirmed.count === 0) throw new BadRequestException('That factor is already confirmed');

      await tx.authRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.authRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) });

      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { id: principal.sessionId } },
        data: { revokedAt: now },
      });
      // This session did just prove the factor, so it is satisfied — otherwise
      // the user would be challenged on the very device they enrolled from.
      await tx.authSession.updateMany({
        where: { id: principal.sessionId, revokedAt: null },
        data: { mfaSatisfiedAt: now },
      });
    });

    await this.denylistOtherSessions(user.id, principal.sessionId);

    return { codes };
  }

  /**
   * Removes a factor. Password required, for the same reason enrolment is.
   *
   * When the last confirmed factor goes, the recovery codes go with it: they
   * are the way back in past a second factor, and leaving them behind would
   * mean a set of long-lived credentials outliving the thing they recover.
   */
  async removeMfaFactor(
    principal: Principal,
    input: { factorId: string; password: string },
  ): Promise<{ removed: boolean }> {
    const db = this.client();
    const factorId = requireString(input.factorId, 'factorId');

    const user = await this.requireActiveUser(principal.userId);
    await this.requirePassword(user.id, input.password);

    const { count } = await db.authMfaFactor.deleteMany({ where: { id: factorId, userId: user.id } });
    if (count === 0) return { removed: false };

    if (!(await this.mfaOwed(user.id))) {
      await db.authRecoveryCode.deleteMany({ where: { userId: user.id } });
    }
    return { removed: true };
  }

  /**
   * A fresh set of recovery codes, invalidating the old one.
   *
   * The only way to see codes again — there is deliberately no "show me my
   * codes" endpoint, because the stored values are hashes and an endpoint that
   * could answer would mean they were not.
   */
  async regenerateRecoveryCodes(principal: Principal, input: { password: string }): Promise<MfaRecoveryCodes> {
    const db = this.client();
    const user = await this.requireActiveUser(principal.userId);
    await this.requirePassword(user.id, input.password);

    if (!(await this.mfaOwed(user.id))) {
      throw new BadRequestException('Recovery codes exist to recover a second factor. Enrol one first.');
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => toBase32(randomBytes(RECOVERY_CODE_BYTES)));
    const hashes = await Promise.all(codes.map((value) => hashPassword(value)));

    await db.$transaction(async (tx) => {
      await tx.authRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.authRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) });
    });

    return { codes };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async startSession(user: AuthUserRow, context: RequestContext, scope: TokenScope): Promise<AuthResult> {
    const db = this.client();
    const now = this.now();
    const refresh = this.tokens.issueRefresh();

    const session = await db.$transaction(async (tx) => {
      await tx.authUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          // `lastLoginAt` only once the sign-in is actually finished. A session
          // still owing a second factor has not logged anyone in, and stamping
          // it here would make "when did they last sign in" answer yes to every
          // abandoned challenge — including an attacker's, who by then holds
          // the password. That is a signal worth keeping accurate.
          ...(scope === 'full' ? { lastLoginAt: now } : {}),
        },
      });
      return tx.authSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: refresh.tokenHash,
          expiresAt: refresh.expiresAt,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        select: { id: true },
      });
    });

    const access = this.tokens.issueAccess({ userId: user.id, sessionId: session.id, scope });
    return {
      user: toSessionUser(user),
      accessToken: access.accessToken,
      expiresAt: access.expiresAt,
      refreshToken: refresh.token,
      scope,
      mustChangePassword: scope === 'pwd_change',
      mfaRequired: scope === 'mfa',
    };
  }

  /**
   * Whether this user must present a second factor — i.e. holds at least one
   * CONFIRMED one.
   *
   * Derived, never stored. A boolean column on AuthUser summarising these rows
   * would be a second source of truth that drifts from them the first time a
   * factor is deleted by a path that forgets to update it — and the direction
   * it would drift in is "MFA is off".
   *
   * Backed by @@index([userId, confirmedAt]), so it is an index probe.
   */
  /**
   * How long a denylist entry has to survive: exactly as long as an access token
   * can. After that the token is refused on its own expiry and the entry is
   * dead weight — which is what keeps the store a handful of keys rather than a
   * growing table.
   */
  private accessTokenLifetime(): number {
    return this.options.accessTokenTtl ?? ACCESS_TOKEN_TTL;
  }

  /**
   * Denylists every live session of a user EXCEPT one.
   *
   * Reads the ids first, because a user-level cut-off cannot express "all but
   * this one" — it compares against a token's `iat`, and the spared session's
   * token was issued before the revocation too.
   */
  private async denylistOtherSessions(userId: string, keepSessionId: string): Promise<void> {
    if (!this.revoked) return;
    const sessions = await this.client().authSession.findMany({
      // The shared projection — see SESSION_SUMMARY_SELECT. Only `id` is used
      // here; the port has one session read because Prisma has one method.
      where: { userId, revokedAt: { not: null } },
      select: SESSION_SUMMARY_SELECT,
    });
    const ids = sessions.map((session) => session.id).filter((id) => id !== keepSessionId);
    if (ids.length > 0) await this.revoked.revokeSessions(ids, this.accessTokenLifetime());
  }

  private async mfaOwed(userId: string): Promise<boolean> {
    const factor = await this.client().authMfaFactor.findFirst({
      // `type` is pinned, not incidental: a confirmed factor this module cannot
      // verify would make the account owe a second factor that no endpoint can
      // satisfy — a lockout, delivered by a feature nobody has finished. When
      // webauthn is implemented, this query and the challenge widen together.
      where: { userId, type: 'totp', confirmedAt: { not: null } },
    });
    return factor !== null;
  }

  /**
   * Checks a TOTP code against every confirmed factor, and spends the step it
   * matched.
   *
   * The step advance is a CONDITIONAL update — `lastUsedStep` must still be
   * below the matched step — so two requests carrying the same code race in the
   * database and exactly one wins. Checking the row read above and writing
   * unconditionally would let both through, which is precisely the replay the
   * column exists to stop.
   *
   * Every factor is tried; the loop does not stop at the first that fails, so
   * the work does not depend on the order someone enrolled their devices in.
   */
  private async spendTotpCode(factors: AuthMfaFactorRow[], code: string, now: Date, userId: string): Promise<boolean> {
    if (!isPlausibleTotpCode(code)) return false;
    const key = this.mfaKey();

    for (const factor of factors) {
      const secret = open(factor.secret, key);
      // An undecryptable factor — a rotated key, most likely. Skip it rather
      // than fail the request: another factor may still work, and a recovery
      // code certainly will.
      if (!secret) continue;

      const verdict = verifyTotp({
        secretBase32: secret,
        code,
        now,
        lastUsedStep: factor.lastUsedStep === null ? null : Number(factor.lastUsedStep),
      });
      if (verdict.replayed) {
        this.options.onAuthFailure?.({ reason: 'mfa_code_replayed', userId });
        continue;
      }
      if (!verdict.ok || verdict.step === null) continue;

      const step = BigInt(verdict.step);
      const { count } = await this.client().authMfaFactor.updateMany({
        where: {
          id: factor.id,
          userId,
          OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
        },
        data: { lastUsedAt: now, lastUsedStep: step },
      });
      // Lost the race — another request spent this exact step first. That is a
      // replay by definition, whoever sent it.
      if (count === 0) {
        this.options.onAuthFailure?.({ reason: 'mfa_code_replayed', userId });
        continue;
      }
      return true;
    }
    return false;
  }

  /**
   * Checks a recovery code and spends it.
   *
   * Every unused code is hashed with scrypt and a per-row salt, so there is no
   * hash to look up — the candidates have to be verified one at a time. Ten
   * scrypt runs is roughly a second, which is slow for a request and exactly
   * right for this one: recovery is rare, and the cost is a rate limit that
   * needs no configuration.
   *
   * Marking it used is conditional on it still being unused, so the same code
   * presented twice concurrently is spent once.
   */
  private async spendRecoveryCode(userId: string, code: string, now: Date): Promise<boolean> {
    const db = this.client();
    const candidates = await db.authRecoveryCode.findMany({ where: { userId, usedAt: null } });

    for (const candidate of candidates) {
      if (!(await verifyPassword(code, candidate.codeHash))) continue;

      const { count } = await db.authRecoveryCode.updateMany({
        where: { id: candidate.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) {
        this.options.onAuthFailure?.({ reason: 'recovery_code_used', userId });
        return false;
      }
      return true;
    }

    this.options.onAuthFailure?.({ reason: 'recovery_code_unknown', userId });
    return false;
  }

  /**
   * The key TOTP secrets are encrypted with, or a configuration error.
   *
   * Thrown as a plain Error, not an UnauthorizedException: a missing key is the
   * operator's mistake, and reporting it as an auth failure would hide it in
   * the one log line the whole module is designed to make uninformative. Same
   * shape as the `sendPasswordResetEmail` refusal — the feature is off rather
   * than half-on, and a factor is never stored in the clear as a fallback.
   */
  private mfaKey(): Buffer {
    const configured = this.options.mfaSecretKey;
    if (!configured) {
      throw new Error(
        'AuthModule.forRoot requires mfaSecretKey (or AUTH_MFA_SECRET_KEY) to offer two-factor authentication. ' +
          'A TOTP secret is symmetric, so it cannot be hashed and must not be stored in the clear.',
      );
    }
    return readSecretKey(configured);
  }

  /** The caller's user row, refusing anything that is not an active account. */
  private async requireActiveUser(userId: string): Promise<AuthUserRow> {
    const user = await this.client().authUser.findUnique({ where: { id: userId } });
    if (user?.status !== 'active') throw this.refuse('account_suspended', { userId });
    return user;
  }

  /**
   * Re-authentication for a change to how the account is secured.
   *
   * A valid session is not enough to enrol or remove a factor: a stolen cookie
   * would otherwise be enough to add an authenticator the real owner does not
   * hold, or to strip the one they do. This is the check that keeps a session
   * compromise from becoming an account takeover.
   */
  private async requirePassword(userId: string, password: unknown): Promise<void> {
    const supplied = requireString(password, 'password');
    const credential = await this.client().authCredential.findFirst({
      where: { userId, type: 'password' },
      select: { id: true, secret: true },
    });

    if (!credential) {
      // No password to re-authenticate with — a federated-only account. The
      // step-up needs a different proof, and pretending otherwise would let the
      // check pass vacuously.
      throw this.refuse('no_password_credential', { userId });
    }
    if (!(await verifyPassword(supplied, credential.secret))) {
      throw this.refuse('wrong_password', { userId });
    }
  }

  private burnPasswordTime(password: string): Promise<boolean> {
    this.dummyHash ??= hashPassword(`absent-account-${process.pid}-${Date.now()}`);
    return this.dummyHash.then((hash) => verifyPassword(password, hash));
  }

  /**
   * One exception for every reason. The reason goes to the operator hook; the
   * caller gets a constant.
   */
  /**
   * Mints a short-lived ticket the browser may use to open a WebSocket.
   *
   * The session is re-read and checked for revocation FIRST, which the ticket's
   * own signature cannot do: an access token is verified statelessly, so a
   * session revoked five minutes ago still presents a perfectly valid bearer
   * until it expires. That is an accepted trade for a request that lasts
   * milliseconds; it is not an acceptable one for a socket that may stay open
   * until the token's expiry, because "sign out everywhere" would leave a live
   * stream running behind it.
   *
   * So this is the one credential path that costs a database read, and the
   * reason is the connection's lifetime rather than its privilege.
   */
  async issueWsTicket(principal: Principal): Promise<IssuedWsTicket> {
    const db = this.client();

    // `findUnique` with the id, not a filtered `findFirst`: the narrow client
    // interface exposes only the reads this module actually needs, and adding a
    // method to it would be widening the contract every host has to satisfy for
    // a check that is one comparison in code.
    const session = await db.authSession.findUnique({
      where: { id: principal.sessionId },
      include: { user: true },
    });
    if (!session || session.revokedAt !== null || session.userId !== principal.userId) {
      throw this.refuse('session_revoked', { userId: principal.userId });
    }

    return this.tokens.issueWsTicket(principal);
  }

  private refuse(
    reason: AuthFailureReason,
    detail: { email?: string; userId?: string; ip?: string | null } = {},
  ): UnauthorizedException {
    this.options.onAuthFailure?.({ reason, ...detail });
    return new UnauthorizedException(REFUSAL);
  }

  private client(): AuthPrismaClient {
    if (!this.prisma) {
      throw new Error('AuthService needs a client. Bind AUTH_PRISMA via prismaProvider in AuthModule.forRoot.');
    }
    return this.prisma;
  }

  /** Overridable in tests; expiry logic should not make a clock untestable. */
  protected now(): Date {
    return new Date();
  }
}

function toSessionUser(user: AuthUserRow): SessionUser {
  return { id: user.id, email: user.email, username: user.username, displayName: user.displayName };
}

/**
 * A Prisma unique-constraint violation, recognised WITHOUT importing Prisma.
 *
 * The module never depends on @prisma/client — that is what lets two apps on two
 * databases share it — so the error is matched structurally on the `P2002` code
 * every Prisma client sets. A false negative here is a 500 instead of a 409,
 * which is ugly but not wrong; a false positive is impossible, because nothing
 * else uses that code.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
