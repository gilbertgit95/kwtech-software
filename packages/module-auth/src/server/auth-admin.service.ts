import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { isPlausibleUsername, normaliseEmail, normaliseUsername } from '../domain/policy.js';
import {
  AUTH_PRISMA,
  type AuthAdminSessionRow,
  type AuthAdminUserRow,
  type AuthPrismaClient,
  type AuthUserFilter,
  SESSION_SUMMARY_SELECT,
} from './auth.repository.js';
import { AuthService, type RequestContext } from './auth.service.js';
import { SESSION_REVOCATION_STORE, type SessionRevocationStore } from './revocation.js';

/**
 * Administering OTHER people's accounts — the `users:*` half of this module.
 *
 * ## Why it is a second service and not more of `AuthService`
 *
 * `AuthService` answers for the person making the request: sign me in, change
 * MY password, list MY factors. Every method there takes a `Principal` or a
 * credential, and that uniformity is load-bearing — it is why "does this act on
 * the caller's own account" is answerable by looking at a signature.
 *
 * Everything here acts on an account named by ID, by somebody who is not its
 * owner. Mixing the two in one class would put `removeMfaFactor(principal, id)`
 * next to `removeTwoFactor(userId)` and make that distinction a matter of
 * reading the argument list carefully. Separating them means the dangerous set
 * is a file you can review in one sitting.
 *
 * It DELEGATES rather than reimplements wherever the act already exists —
 * account creation and the reset token both go through `AuthService`, so there
 * is exactly one place that hashes a password and one that mints a reset.
 *
 * ## Nothing here checks a permission
 *
 * Not one method asks whether the caller may do this. That is the resolver's
 * job, through `@RequireFeature`, and this module may not import the guard that
 * enforces it (PLAN §9). The split is deliberate rather than incidental: these
 * methods are the OPERATIONS, callable by a seed script or a CLI that has no
 * request and no session, and a service that refused without a permission
 * context would be unusable there.
 *
 * What it does check is the invariant no permission can cover — see
 * `assertNotSelf`.
 */
@Injectable()
export class AuthAdminService {
  constructor(
    private readonly auth: AuthService,
    @Optional() @Inject(AUTH_PRISMA) private readonly prisma?: AuthPrismaClient,
    @Optional()
    @Inject(SESSION_REVOCATION_STORE)
    private readonly revoked?: SessionRevocationStore,
  ) {}

  private client(): AuthPrismaClient {
    if (!this.prisma) throw new Error('AuthModule.forRoot requires a Prisma client to administer accounts');
    return this.prisma;
  }

  /**
   * The guard that no feature key can express: an administrator may not aim
   * these at themselves.
   *
   * Suspending or deleting your own account is a lockout with the same shape as
   * the invitation bug this codebase already fixed once — a single click, no
   * warning, and the person who could undo it is the person who just lost
   * access. `users:suspend` legitimately means "may suspend accounts"; it does
   * not mean "may suspend the one holding the key", and no grant can make that
   * a good idea.
   *
   * It is NOT applied to the recoverable operations. Ending your own sessions
   * signs you out, which is a thing people deliberately do; resetting your own
   * password sends you an email. Only the two that cannot be walked back are
   * refused.
   */
  private assertNotSelf(actorUserId: string, targetUserId: string, act: string): void {
    if (actorUserId === targetUserId) {
      throw new BadRequestException({ message: `You cannot ${act} your own account` });
    }
  }

  /*
   * `findMany` with `take: 1` rather than `findUnique`, because the admin row
   * carries `createdAt` and `lastLoginAt` and the port's `findUnique` returns
   * the narrower sign-in shape. One row either way; this is the projection the
   * screen needs.
   */
  private async requireUser(userId: string): Promise<AuthAdminUserRow> {
    const rows = await this.client().authUser.findMany({ where: { id: userId }, take: 1 });
    const user = rows[0];
    if (!user) throw new NotFoundException({ message: 'No such account' });
    return user;
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /**
   * The account list, filtered and paged.
   *
   * `total` is returned beside the rows because a pager that only knows the
   * current page cannot say how many there are, and the alternative — fetching
   * one more row than asked for to detect a next page — cannot say it either.
   *
   * The cap on `take` is not about this screen. It is about the endpoint: an
   * uncapped page size is an unbounded query somebody can send, and the request
   * that finally hurts is never the one anybody tested. Same reasoning, same
   * number, as the app's `findUsersByIds`.
   */
  async listUsers(
    filter: AuthUserFilter & { skip?: number; take?: number } = {},
  ): Promise<{ rows: AuthAdminUserRow[]; total: number }> {
    const db = this.client();
    const where = userFilterWhere(filter);
    const take = Math.min(Math.max(filter.take ?? DEFAULT_PAGE, 1), MAX_PAGE);
    const skip = Math.max(filter.skip ?? 0, 0);

    /*
     * The count uses the SAME `where`, built once above. Two call sites
     * building the predicate separately is how a list ends up reporting a total
     * that does not match anything it can show — and it drifts the moment a
     * filter is added to one and not the other.
     */
    const [rows, total] = await Promise.all([
      db.authUser.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      db.authUser.count({ where }),
    ]);

    return { rows, total };
  }

  /** One account, or a 404. */
  async getUser(userId: string): Promise<AuthAdminUserRow> {
    return this.requireUser(userId);
  }

  /**
   * One account plus the two facts a detail screen needs and a list must not
   * pay for: whether it holds a confirmed factor, and how many live sessions.
   *
   * Two extra reads, deliberately kept off `listUsers` — see `AdminUserDetail`.
   * Confirmed factors only: an abandoned half-enrolment protects nothing and
   * showing it as two-step verification would be wrong in the direction that
   * matters.
   */
  async getUserDetail(
    userId: string,
  ): Promise<{ user: AuthAdminUserRow; hasTwoFactor: boolean; activeSessions: number }> {
    const db = this.client();
    const user = await this.requireUser(userId);

    const [factors, sessions] = await Promise.all([
      db.authMfaFactor.findMany({ where: { userId, type: 'totp', confirmedAt: { not: null } } }),
      db.authSession.findMany({ where: { userId, revokedAt: null }, select: SESSION_SUMMARY_SELECT }),
    ]);

    return { user, hasTwoFactor: factors.length > 0, activeSessions: sessions.length };
  }

  /**
   * Where an account is signed in.
   *
   * LIVE sessions only. A revoked or expired row is a history nobody asked for
   * on a screen whose question is "who is signed in right now", and the honest
   * place for session history is an audit log rather than a list that quietly
   * mixes the two.
   */
  async listSessions(userId: string): Promise<AuthAdminSessionRow[]> {
    await this.requireUser(userId);
    return this.client().authSession.findMany({
      where: { userId, revokedAt: null },
      select: SESSION_SUMMARY_SELECT,
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  // ── writing ───────────────────────────────────────────────────────────────

  /**
   * Creates an account without an invitation.
   *
   * Straight through to `AuthService.createAccount`, which is the only thing in
   * this codebase that hashes a password into a new credential. The password is
   * supplied by the administrator and the account is expected to change it —
   * there is no "must change on first sign-in" flag yet, and inventing one here
   * would be a column pretending to be enforcement.
   */
  async createUser(input: { email: string; displayName?: string | null; password: string }) {
    return this.auth.createAccount(input);
  }

  /**
   * Renames an account: display name, username, or both.
   *
   * Email is absent and that is not an oversight. It is the account's
   * identifier — invitations are addressed to it, `findUserByEmail` resolves
   * members by it, and a reset is delivered to it. Changing it silently
   * re-points all three, and doing that safely means a verification round trip
   * to the new address, which is a feature and not a field.
   */
  async updateProfile(userId: string, input: { displayName?: string | null; username?: string | null }) {
    const db = this.client();
    await this.requireUser(userId);

    const data: { displayName?: string | null; username?: string } = {};
    if (input.displayName !== undefined) data.displayName = input.displayName?.trim() || null;

    if (input.username !== undefined && input.username !== null) {
      const username = normaliseUsername(input.username);
      // The same rule the settings page applies to your own — a username set by
      // an administrator must not be one you could never have chosen yourself.
      if (!isPlausibleUsername(username)) {
        throw new BadRequestException({ message: 'That username cannot be used' });
      }
      data.username = username;
    }

    if (Object.keys(data).length === 0) return this.requireUser(userId);

    try {
      await db.authUser.update({ where: { id: userId }, data });
    } catch {
      /*
       * `username` is `@unique`, so the clash surfaces here as a driver error.
       * Reported as a conflict about the username rather than passed through:
       * the raw message names a constraint, which tells an administrator
       * nothing they can act on.
       */
      throw new ConflictException({ message: 'That username is already taken' });
    }
    return this.requireUser(userId);
  }

  /**
   * Suspends an account, or lifts a suspension.
   *
   * ## Suspension has to END the sessions, not just close the door
   *
   * `signIn` refuses a suspended account, but every session it already holds
   * keeps working: the access token verifies from its signature with no
   * database read, and refresh would hand it a new one. Without the revocation
   * below, "suspend" would mean "cannot sign in AGAIN" — up to a week of
   * continued access for somebody just locked out, which is not what anybody
   * pressing the button believes it does.
   *
   * So this does what `signOutEverywhere` does, for somebody else: revoke the
   * rows, and post one denylist entry for the whole account so tokens already
   * in flight stop at their next request rather than at their next refresh.
   *
   * Reactivating deliberately does NOT restore anything. The sessions are gone;
   * the person signs in again.
   */
  async setStatus(
    actorUserId: string,
    userId: string,
    status: 'active' | 'suspended',
  ): Promise<{ user: AuthAdminUserRow; sessionsRevoked: number }> {
    this.assertNotSelf(actorUserId, userId, 'suspend');
    const db = this.client();
    await this.requireUser(userId);

    await db.authUser.update({ where: { id: userId }, data: { status } });
    const sessionsRevoked = status === 'suspended' ? await this.endSessions(userId) : 0;

    return { user: await this.requireUser(userId), sessionsRevoked };
  }

  /**
   * Sends a password reset to the account's own address.
   *
   * ⚠ There is deliberately no method that SETS a password for somebody else.
   * An administrator who could would hold that person's credential, and every
   * "was that you or support?" question afterwards would be unanswerable. The
   * link goes to the mailbox, which is the one place the account's owner
   * controls — and the reset path already revokes every session when it is
   * consumed, so a stolen-password case is closed by the same act.
   *
   * Routed through `AuthService.requestPasswordReset`, which is the only thing
   * that mints a reset token, so an administrator's reset and a self-service
   * one are the same token with the same lifetime and the same single use.
   *
   * A suspended account is refused rather than silently accepted. The
   * self-service path answers identically for every address because it must not
   * leak whether one exists; here the caller is a named administrator looking
   * at the account, so an honest "this account is suspended" costs nothing and
   * saves them waiting for an email that was never sent.
   */
  async sendPasswordReset(userId: string, context: RequestContext): Promise<{ sent: true }> {
    const user = await this.requireUser(userId);
    if (user.status !== 'active') {
      throw new BadRequestException({ message: 'That account is suspended, so a reset would not reach anybody' });
    }
    await this.auth.requestPasswordReset({ email: user.email }, context);
    return { sent: true };
  }

  /** Signs an account out of everything, without touching what it may do. */
  async revokeSessions(userId: string): Promise<{ revoked: number }> {
    await this.requireUser(userId);
    return { revoked: await this.endSessions(userId) };
  }

  /**
   * Takes every second factor off an account, and the recovery codes with them.
   *
   * The codes MUST go too. They are the way past the factor, so leaving them
   * behind would mean an account that looks unprotected in the UI and still
   * refuses anybody who does not hold a code — the worst of both, and
   * impossible to diagnose from the screen.
   *
   * ⚠ Half of the takeover pair this module's `features.ts` names: with
   * `users:password_reset`, holding this is a complete path into any account.
   * It is a separate key for that reason, and it still cannot simply be
   * withheld from everyone — somebody losing a phone and their recovery codes
   * is the ordinary case it exists for.
   *
   * `mfaRequiredAt` is left alone. It is the POLICY that this account must hold
   * a factor, not a record that it does; clearing it here would quietly exempt
   * somebody from a requirement while helping them back in.
   */
  async removeTwoFactor(userId: string): Promise<{ removed: number }> {
    const db = this.client();
    await this.requireUser(userId);

    const { count } = await db.authMfaFactor.deleteMany({ where: { userId } });
    await db.authRecoveryCode.deleteMany({ where: { userId } });
    return { removed: count };
  }

  /**
   * Deletes an account permanently.
   *
   * ⚠ Suspension is the reversible answer and is the right one nearly always.
   * This exists for erasure, where keeping the row is itself the problem.
   *
   * Credentials, sessions, factors, recovery codes and reset tokens go with it
   * by cascade — every one of those has a foreign key to `auth_user`.
   * `perm_membership` and `perm_user_role` do NOT, by design (PLAN §12.12), so
   * they are left pointing at nobody and it is the APP's job to remove them
   * first. This method does not pretend otherwise, and the resolver in front of
   * it says so.
   */
  async deleteUser(actorUserId: string, userId: string): Promise<{ deleted: true; email: string }> {
    this.assertNotSelf(actorUserId, userId, 'delete');
    const user = await this.requireUser(userId);

    // Revoked BEFORE the row goes, so a token in flight is refused by the
    // denylist rather than by a user lookup that now returns nothing. The
    // difference is a 401 versus an unhandled null on the hot path.
    await this.endSessions(userId);
    await this.client().authUser.delete({ where: { id: userId } });
    return { deleted: true, email: user.email };
  }

  /**
   * Revoke the rows, then post ONE denylist entry for the account.
   *
   * Lifted from `AuthService.signOutEverywhere` — same two steps, same reason
   * the second is not per-session: every token issued at or before this instant
   * is refused, including one minted moments ago and still in flight, so access
   * stops at the next REQUEST rather than at the next refresh.
   */
  private async endSessions(userId: string): Promise<number> {
    const now = new Date();
    const { count } = await this.client().authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.revoked?.revokeUserBefore(userId, Math.floor(now.getTime() / 1000), ACCESS_TOKEN_GRACE_SECONDS);
    return count;
  }
}

/** The default page, and the most any caller may ask for. See `listUsers`. */
const DEFAULT_PAGE = 25;
const MAX_PAGE = 200;

/**
 * How long a denylist entry has to outlive the tokens it refuses.
 *
 * `AuthService` derives this from its own configured access-token lifetime.
 * This service has no options injected, and reaching for them to duplicate one
 * number would be a second source for it — so it uses the outside edge instead.
 * Keeping an entry longer than necessary costs a row; keeping it too short
 * un-revokes a session, which is the failure that matters.
 */
const ACCESS_TOKEN_GRACE_SECONDS = 60 * 60;

/**
 * The account-list predicate, built in ONE place so the page and its count
 * cannot disagree.
 *
 * `mode: 'insensitive'` on every branch: an administrator typing a name should
 * not have to match the capitalisation somebody used when they signed up.
 */
export function userFilterWhere(filter: AuthUserFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;

  const search = filter.search?.trim();
  if (search) {
    /*
     * An email typed in full is normalised before it is matched, so searching
     * for the address exactly as the invitation showed it finds the account.
     * The other two branches are matched raw — a display name is free text and
     * lower-casing it would break a search for a name containing an initial.
     */
    const term = search.includes('@') ? normaliseEmail(search) : search;
    where.OR = [
      { email: { contains: term, mode: 'insensitive' } },
      { displayName: { contains: search, mode: 'insensitive' } },
      { username: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}
