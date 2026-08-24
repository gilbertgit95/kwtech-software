import { BadRequestException, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import {
  checkPassword,
  isExpired,
  isLockedOut,
  isPlausibleEmail,
  isPlausibleUsername,
  looksLikeEmail,
  nextLockoutState,
  normaliseEmail,
  normaliseUsername,
  PASSWORD_RESET_TTL,
} from '../domain/policy.js';
import type { AuthFailureReason, AuthResult, Principal, SessionUser, TokenScope } from '../types.js';
import { AUTH_OPTIONS, type AuthModuleOptions } from './auth.options.js';
import { AUTH_PRISMA, type AuthPrismaClient, type AuthUserRow } from './auth.repository.js';
import { hashPassword, verifyPassword } from './password.js';
import { TokenService } from './token.service.js';

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
    @Inject(AUTH_OPTIONS) private readonly options: AuthModuleOptions,
    private readonly tokens: TokenService,
    @Optional() @Inject(AUTH_PRISMA) private readonly prisma?: AuthPrismaClient,
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

    return this.startSession(user, context, 'full');
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

    const access = this.tokens.issueAccess({ userId: session.userId, sessionId: session.id, scope: 'full' });
    return {
      user: toSessionUser(session.user),
      accessToken: access.accessToken,
      expiresAt: access.expiresAt,
      refreshToken: next.token,
      scope: 'full',
      mustChangePassword: false,
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
    return { revoked: count > 0 };
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
  async requestPasswordReset(input: { email: string }, context: RequestContext): Promise<{ accepted: true }> {
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

    return { reset: true };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async startSession(user: AuthUserRow, context: RequestContext, scope: TokenScope): Promise<AuthResult> {
    const db = this.client();
    const now = this.now();
    const refresh = this.tokens.issueRefresh();

    const session = await db.$transaction(async (tx) => {
      await tx.authUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
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
    };
  }

  private burnPasswordTime(password: string): Promise<boolean> {
    this.dummyHash ??= hashPassword(`absent-account-${process.pid}-${Date.now()}`);
    return this.dummyHash.then((hash) => verifyPassword(password, hash));
  }

  /**
   * One exception for every reason. The reason goes to the operator hook; the
   * caller gets a constant.
   */
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
