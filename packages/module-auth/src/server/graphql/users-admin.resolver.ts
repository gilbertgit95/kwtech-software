import { UnauthorizedException } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AUTH_FEATURE } from '../../features.js';
import type { Principal } from '../../types.js';
import { PRINCIPAL_KEY } from '../auth.decorators.js';
import type { AuthAdminSessionRow, AuthAdminUserRow, AuthUserFilter } from '../auth.repository.js';
import { AuthAdminService } from '../auth-admin.service.js';
import { RequireAuthFeature } from '../require-feature.decorator.js';
import {
  AdminUserDetailType,
  AdminUserPageType,
  AdminUserSessionType,
  AdminUserType,
  AdminUserWriteResultType,
} from './users-admin.types.js';

/**
 * User administration, on the graph.
 *
 * ## Every handler declares a key, and none of them enforces one
 *
 * `@RequireAuthFeature` writes metadata; `FeatureGuard` — a global guard the
 * APP installs, from `@kwtech/module-permissions` — reads it and refuses. This
 * module never learns how a grant is resolved, and the permissions module never
 * learns that a user is a thing. The metadata key they agree on is the one
 * constant in `@kwtech/module-kit`.
 *
 * ⚠ Consequence worth stating plainly: an app that composes this module and
 * installs no feature guard gets these mutations UNGUARDED, because a
 * declaration nothing reads is not a check. The same is true of every
 * `@RequireFeature` in the permissions module; it is a property of declarative
 * guarding rather than of this file.
 *
 * ## Why the keys are this fine-grained
 *
 * Nine of them, split by risk — see features.ts, which explains why
 * `users:password_reset` and `users:two_factor_remove` in particular are two
 * keys and not one. The important consequence for this file is that no handler
 * declares more than the one right it needs: `adminUsers` requires reading and
 * nothing else, so a role built for auditors can hold it alone.
 *
 * ## The actor's own id
 *
 * Read off the request, the way `AuthResolver` reads it, and passed down to the
 * two operations that refuse to act on the caller's own account. That check is
 * in the SERVICE rather than here, because it is an invariant of the operation
 * rather than of the transport — a CLI calling `deleteUser` must not be able to
 * skip it by not being a resolver.
 */
@Resolver()
export class UsersAdminResolver {
  constructor(private readonly admin: AuthAdminService) {}

  // ── reading ───────────────────────────────────────────────────────────────

  @RequireAuthFeature(AUTH_FEATURE.usersRead)
  @Query(() => AdminUserPageType, { name: 'adminUsers' })
  async adminUsers(
    @Args('search', { type: () => String, nullable: true }) search?: string | null,
    @Args('status', { type: () => String, nullable: true }) status?: string | null,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number | null,
    @Args('take', { type: () => Int, nullable: true }) take?: number | null,
  ): Promise<AdminUserPageType> {
    /*
     * An unrecognised `status` is dropped rather than refused. It can only come
     * from a caller building a query by hand — the screen sends one of two
     * values — and "show everything" is the answer that leaves them looking at
     * data rather than at an error about a filter they did not mean to send.
     */
    const filter: AuthUserFilter & { skip?: number; take?: number } = {
      ...(search ? { search } : {}),
      ...(status === 'active' || status === 'suspended' ? { status: status as 'active' | 'suspended' } : {}),
      ...(typeof skip === 'number' ? { skip } : {}),
      ...(typeof take === 'number' ? { take } : {}),
    };

    const { rows, total } = await this.admin.listUsers(filter);
    return { rows: rows.map(toAdminUser), total };
  }

  @RequireAuthFeature(AUTH_FEATURE.usersRead)
  @Query(() => AdminUserDetailType, { name: 'adminUser' })
  async adminUser(@Args('userId') userId: string): Promise<AdminUserDetailType> {
    const { user, hasTwoFactor, activeSessions } = await this.admin.getUserDetail(userId);
    return { ...toAdminUser(user), hasTwoFactor, activeSessions };
  }

  /**
   * A SECOND key on top of reading the account, because this is a device and
   * location history — the most personal thing in these tables. Somebody who
   * may look at the account list has not thereby been given everybody's
   * whereabouts.
   */
  @RequireAuthFeature(AUTH_FEATURE.usersSessionsRead)
  @Query(() => [AdminUserSessionType], { name: 'adminUserSessions' })
  async adminUserSessions(@Args('userId') userId: string): Promise<AdminUserSessionType[]> {
    const sessions = await this.admin.listSessions(userId);
    return sessions.map(toAdminSession);
  }

  // ── writing ───────────────────────────────────────────────────────────────

  @RequireAuthFeature(AUTH_FEATURE.usersCreate)
  @Mutation(() => AdminUserType, { name: 'adminCreateUser' })
  async adminCreateUser(
    @Args('email') email: string,
    @Args('password') password: string,
    @Args('displayName', { type: () => String, nullable: true }) displayName?: string | null,
  ): Promise<AdminUserType> {
    const created = await this.admin.createUser({ email, password, displayName: displayName ?? null });
    // Read back rather than composed from the create's return, so the row the
    // screen renders is the row the database holds — `createdAt` and `status`
    // come from column defaults this module deliberately does not set.
    return toAdminUser(await this.admin.getUser(created.id));
  }

  @RequireAuthFeature(AUTH_FEATURE.usersProfileWrite)
  @Mutation(() => AdminUserType, { name: 'adminUpdateUserProfile' })
  async adminUpdateUserProfile(
    @Args('userId') userId: string,
    @Args('displayName', { type: () => String, nullable: true }) displayName?: string | null,
    @Args('username', { type: () => String, nullable: true }) username?: string | null,
  ): Promise<AdminUserType> {
    /*
     * `undefined` and `null` mean different things and both arrive as null over
     * GraphQL, so the fields are forwarded only when the argument was actually
     * provided — otherwise "did not touch the display name" and "cleared the
     * display name" would be the same request.
     */
    const input = {
      ...(displayName !== undefined && displayName !== null ? { displayName } : {}),
      ...(username !== undefined && username !== null ? { username } : {}),
    };
    return toAdminUser(await this.admin.updateProfile(userId, input));
  }

  @RequireAuthFeature(AUTH_FEATURE.usersSuspend)
  @Mutation(() => AdminUserWriteResultType, { name: 'adminSetUserStatus' })
  async adminSetUserStatus(
    @Context() gqlContext: { req?: Record<string, unknown> },
    @Args('userId') userId: string,
    @Args('suspended') suspended: boolean,
  ): Promise<AdminUserWriteResultType> {
    const actor = requirePrincipal(gqlContext);
    const { user, sessionsRevoked } = await this.admin.setStatus(
      actor.userId,
      userId,
      suspended ? 'suspended' : 'active',
    );
    return { changed: true, sessionsRevoked, user: toAdminUser(user) };
  }

  @RequireAuthFeature(AUTH_FEATURE.usersPasswordReset)
  @Mutation(() => AdminUserWriteResultType, { name: 'adminSendPasswordReset' })
  async adminSendPasswordReset(
    @Context() gqlContext: { req?: Record<string, unknown> },
    @Args('userId') userId: string,
  ): Promise<AdminUserWriteResultType> {
    const request = gqlContext.req as { ip?: string } | undefined;
    await this.admin.sendPasswordReset(userId, { ipAddress: request?.ip ?? null, userAgent: null });
    // No sessions ended: the reset does that when it is CONSUMED, which is the
    // moment the password actually changes. Ending them now would sign somebody
    // out over an email they may never open.
    return { changed: true, sessionsRevoked: 0, user: toAdminUser(await this.admin.getUser(userId)) };
  }

  @RequireAuthFeature(AUTH_FEATURE.usersSessionsRevoke)
  @Mutation(() => AdminUserWriteResultType, { name: 'adminRevokeUserSessions' })
  async adminRevokeUserSessions(@Args('userId') userId: string): Promise<AdminUserWriteResultType> {
    const { revoked } = await this.admin.revokeSessions(userId);
    return { changed: revoked > 0, sessionsRevoked: revoked, user: toAdminUser(await this.admin.getUser(userId)) };
  }

  @RequireAuthFeature(AUTH_FEATURE.usersTwoFactorRemove)
  @Mutation(() => AdminUserWriteResultType, { name: 'adminRemoveUserTwoFactor' })
  async adminRemoveUserTwoFactor(@Args('userId') userId: string): Promise<AdminUserWriteResultType> {
    const { removed } = await this.admin.removeTwoFactor(userId);
    return { changed: removed > 0, sessionsRevoked: 0, user: toAdminUser(await this.admin.getUser(userId)) };
  }

  /**
   * ⚠ Permanent, and it leaves this module's tables clean and the permissions
   * module's dangling — `perm_membership` has no foreign key here by design.
   * An app that offers this should remove those rows first; see PLAN §12 open
   * decision 38, and `AuthAdminService.deleteUser`.
   */
  @RequireAuthFeature(AUTH_FEATURE.usersDelete)
  @Mutation(() => AdminUserWriteResultType, { name: 'adminDeleteUser' })
  async adminDeleteUser(
    @Context() gqlContext: { req?: Record<string, unknown> },
    @Args('userId') userId: string,
  ): Promise<AdminUserWriteResultType> {
    const actor = requirePrincipal(gqlContext);
    await this.admin.deleteUser(actor.userId, userId);
    // `user: null` — there is nothing to return, and returning the row as it
    // was a moment ago would show a screen an account that no longer exists.
    return { changed: true, sessionsRevoked: 0, user: null };
  }
}

function toAdminUser(row: AuthAdminUserRow): AdminUserType {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

function toAdminSession(row: AuthAdminSessionRow): AdminUserSessionType {
  return {
    id: row.id,
    issuedAt: row.issuedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    mfaSatisfied: row.mfaSatisfiedAt !== null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

/**
 * The acting administrator.
 *
 * Thrown rather than defaulted: the two operations that need it refuse to act
 * on the caller's own account, and an unknown caller would make that check pass
 * vacuously. `JwtAuthGuard` has already run, so reaching this with no principal
 * means the app wired the guard away.
 */
function requirePrincipal(gqlContext: { req?: Record<string, unknown> }): Principal {
  const principal = gqlContext.req?.[PRINCIPAL_KEY] as Principal | undefined;
  if (!principal) throw new UnauthorizedException({ message: 'Not signed in' });
  return principal;
}
