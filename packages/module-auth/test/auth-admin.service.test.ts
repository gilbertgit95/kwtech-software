import type { AuthAdminSessionRow, AuthAdminUserRow, AuthPrismaClient } from '../src/server/auth.repository.js';
import type { AuthService } from '../src/server/auth.service.js';
import { AuthAdminService, userFilterWhere } from '../src/server/auth-admin.service.js';

/**
 * The administration surface, against a literal object rather than a database —
 * the payoff of the structural client.
 *
 * These tests are mostly about the things that must happen ALONGSIDE the
 * obvious write: suspension ending sessions, removal taking the recovery codes
 * with it, and the two operations that refuse to act on the caller.
 */

const NOW = new Date('2026-09-08T10:00:00.000Z');

function user(overrides: Partial<AuthAdminUserRow> = {}): AuthAdminUserRow {
  return {
    id: 'u1',
    email: 'someone@example.com',
    username: null,
    displayName: 'Someone',
    status: 'active',
    failedLoginCount: 0,
    lockedUntil: null,
    mfaRequiredAt: null,
    createdAt: NOW,
    lastLoginAt: null,
    ...overrides,
  };
}

interface Harness {
  admin: AuthAdminService;
  writes: {
    userUpdates: { where: { id: string }; data: Record<string, unknown> }[];
    userDeletes: string[];
    sessionUpdates: unknown[];
    factorDeletes: unknown[];
    recoveryDeletes: unknown[];
    revokedBefore: string[];
    resetsRequested: string[];
    userQueries: { take?: number; skip?: number }[];
  };
}

function harness(state: { users?: AuthAdminUserRow[]; sessions?: number; factors?: number } = {}): Harness {
  const users = state.users ?? [user()];
  const writes: Harness['writes'] = {
    userUpdates: [],
    userDeletes: [],
    sessionUpdates: [],
    factorDeletes: [],
    recoveryDeletes: [],
    revokedBefore: [],
    resetsRequested: [],
    userQueries: [],
  };

  const sessionRows: AuthAdminSessionRow[] = Array.from({ length: state.sessions ?? 0 }, (_, i) => ({
    id: `s${i}`,
    issuedAt: NOW,
    lastUsedAt: NOW,
    expiresAt: NOW,
    revokedAt: null,
    mfaSatisfiedAt: null,
    ipAddress: '203.0.113.9',
    userAgent: 'jest',
  }));

  const prisma = {
    authUser: {
      findMany: async (args: { where: Record<string, unknown>; take?: number; skip?: number }) => {
        writes.userQueries.push({
          ...(args.take !== undefined ? { take: args.take } : {}),
          ...(args.skip !== undefined ? { skip: args.skip } : {}),
        });
        const id = args.where.id as string | undefined;
        return id ? users.filter((u) => u.id === id) : users;
      },
      count: async () => users.length,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        writes.userUpdates.push(args);
        const row = users.find((u) => u.id === args.where.id);
        if (row && typeof args.data.status === 'string') row.status = args.data.status as 'active' | 'suspended';
        return row as AuthAdminUserRow;
      },
      delete: async (args: { where: { id: string } }) => {
        writes.userDeletes.push(args.where.id);
        return users[0] as AuthAdminUserRow;
      },
    },
    authSession: {
      findMany: async (args: { select?: Record<string, unknown> }) =>
        (args.select && 'ipAddress' in args.select ? sessionRows : sessionRows.map((s) => ({ id: s.id }))) as never,
      updateMany: async (args: unknown) => {
        writes.sessionUpdates.push(args);
        return { count: sessionRows.length };
      },
    },
    authMfaFactor: {
      findMany: async () => Array.from({ length: state.factors ?? 0 }, () => ({ id: 'f1' })) as never,
      deleteMany: async (args: unknown) => {
        writes.factorDeletes.push(args);
        return { count: state.factors ?? 0 };
      },
    },
    authRecoveryCode: {
      deleteMany: async (args: unknown) => {
        writes.recoveryDeletes.push(args);
        return { count: 0 };
      },
    },
  } as unknown as AuthPrismaClient;

  const auth = {
    createAccount: async (input: { email: string }) => ({ id: 'new', email: input.email, displayName: null }),
    requestPasswordReset: async (input: { email: string }) => {
      writes.resetsRequested.push(input.email);
      return { accepted: true as const };
    },
  } as unknown as AuthService;

  const revoked = {
    revokeUserBefore: async (userId: string) => {
      writes.revokedBefore.push(userId);
    },
    isRevoked: async () => false,
  };

  return { admin: new AuthAdminService(auth, prisma, revoked as never), writes };
}

describe('listing', () => {
  it('caps the page size no matter what is asked for', async () => {
    const { admin, writes } = harness();
    // 5000 would be an unbounded query somebody can send, and the request that
    // finally hurts is never the one anybody tested.
    await admin.listUsers({ take: 5000 });
    expect(writes.userQueries[0]?.take).toBe(200);
  });

  it('refuses a negative page as a zero offset rather than an error', async () => {
    const { admin, writes } = harness();
    await admin.listUsers({ skip: -10, take: 0 });
    expect(writes.userQueries[0]).toMatchObject({ skip: 0, take: 1 });
  });

  it('counts with the same predicate it pages with', () => {
    const filter = { search: 'someone@example.com', status: 'active' as const };
    // One function builds it, so the list and its total cannot disagree.
    expect(userFilterWhere(filter)).toEqual(userFilterWhere({ ...filter }));
  });

  it('normalises an address before matching it, and leaves a name alone', () => {
    const byEmail = userFilterWhere({ search: '  Someone@Example.COM ' });
    expect(JSON.stringify(byEmail)).toContain('someone@example.com');

    const byName = userFilterWhere({ search: 'McDonald' });
    // Not lower-cased: a display name is free text, and folding the case would
    // break a search for a name carrying an initial.
    expect(JSON.stringify(byName)).toContain('McDonald');
  });
});

describe('suspension', () => {
  it('ends every session, because refusing sign-in is only half of it', async () => {
    const { admin, writes } = harness({ sessions: 3 });
    const result = await admin.setStatus('admin', 'u1', 'suspended');

    expect(result.sessionsRevoked).toBe(3);
    expect(writes.sessionUpdates).toHaveLength(1);
    // One denylist entry for the whole account: a token already in flight has
    // to stop at its next REQUEST, not at its next refresh.
    expect(writes.revokedBefore).toEqual(['u1']);
  });

  it('does not restore sessions when the suspension is lifted', async () => {
    const { admin, writes } = harness({ users: [user({ status: 'suspended' })], sessions: 2 });
    const result = await admin.setStatus('admin', 'u1', 'active');

    expect(result.sessionsRevoked).toBe(0);
    expect(writes.sessionUpdates).toHaveLength(0);
  });

  it('refuses to suspend the account doing the suspending', async () => {
    const { admin, writes } = harness();
    await expect(admin.setStatus('u1', 'u1', 'suspended')).rejects.toThrow(/your own account/i);
    expect(writes.userUpdates).toHaveLength(0);
  });
});

describe('credentials', () => {
  it('sends a reset through the one path that mints reset tokens', async () => {
    const { admin, writes } = harness();
    await admin.sendPasswordReset('u1', { ipAddress: null, userAgent: null });
    expect(writes.resetsRequested).toEqual(['someone@example.com']);
  });

  it('refuses a reset for a suspended account instead of sending nothing', async () => {
    const { admin, writes } = harness({ users: [user({ status: 'suspended' })] });
    // The self-service path is deliberately vague for everyone; here the caller
    // is a named administrator looking at the account, so say what happened.
    await expect(admin.sendPasswordReset('u1', { ipAddress: null, userAgent: null })).rejects.toThrow(/suspended/i);
    expect(writes.resetsRequested).toHaveLength(0);
  });

  it('takes the recovery codes with the second factor', async () => {
    const { admin, writes } = harness({ factors: 1 });
    const result = await admin.removeTwoFactor('u1');

    expect(result.removed).toBe(1);
    // Leaving the codes would mean an account that reads as unprotected and
    // still refuses anybody without one.
    expect(writes.recoveryDeletes).toHaveLength(1);
  });
});

describe('there is no deletion', () => {
  it('exposes no delete at all — suspension is the off switch', () => {
    const { admin } = harness();
    /*
     * Asserted on the SHAPE rather than on a behaviour, because the property is
     * that the operation does not exist. Every membership, invitation and
     * accepted-by record points at the account, and `perm_membership.userId`
     * has no foreign key to `auth_user` — so a delete would leave rows pointing
     * at nobody. The same call `roles:disable` and `plans:archive` make.
     */
    expect((admin as unknown as Record<string, unknown>).deleteUser).toBeUndefined();
  });

  it('suspends instead, and the account survives to be restored', async () => {
    const { admin, writes } = harness({ sessions: 2 });
    await admin.setStatus('admin', 'u1', 'suspended');
    const lifted = await admin.setStatus('admin', 'u1', 'active');

    expect(lifted.user.status).toBe('active');
    // The row was updated twice and never removed.
    expect(writes.userUpdates).toHaveLength(2);
    expect(writes.userDeletes).toHaveLength(0);
  });

  it('is a 404 for an account that is not there', async () => {
    const { admin } = harness({ users: [] });
    await expect(admin.setStatus('admin', 'ghost', 'suspended')).rejects.toThrow(/No such account/i);
  });
});
