import 'reflect-metadata';
import { PRINCIPAL_KEY } from '../src/server/auth.decorators.js';
import type { AuthAdminTargetCheck } from '../src/server/auth.tokens.js';
import type { AuthAdminService } from '../src/server/auth-admin.service.js';
import { UsersAdminResolver } from '../src/server/graphql/users-admin.resolver.js';

/**
 * ⚠ EVERY ACCOUNT WRITE ASKS WHETHER THE ACTOR MAY CHANGE THAT ACCOUNT (#175).
 * The key (`users:update`) is checked by the app's guard; this pins the second
 * question, which the guard cannot ask: whether the target holds rights the
 * actor does not. Each write is listed, so a new one that skips it fails here.
 */
const user = {
  id: 'target',
  email: 'a@example.com',
  username: null,
  displayName: null,
  status: 'active',
  createdAt: new Date(0),
  lastLoginAt: null,
};

function resolver(check?: AuthAdminTargetCheck) {
  const touched: string[] = [];
  const admin = {
    getUser: async () => user,
    updateProfile: async () => {
      touched.push('updateProfile');
      return user;
    },
    setStatus: async () => {
      touched.push('setStatus');
      return { user, sessionsRevoked: 0 };
    },
    sendPasswordReset: async () => {
      touched.push('sendPasswordReset');
      return { sent: true };
    },
    revokeSessions: async () => {
      touched.push('revokeSessions');
      return { revoked: 0 };
    },
    removeTwoFactor: async () => {
      touched.push('removeTwoFactor');
      return { removed: 1 };
    },
  } as unknown as AuthAdminService;
  return { touched, users: new UsersAdminResolver(admin, check) };
}

const ctx = { req: { [PRINCIPAL_KEY]: { userId: 'support' } } };

const WRITES: [string, (users: UsersAdminResolver) => Promise<unknown>][] = [
  ['adminUpdateUserProfile', (users) => users.adminUpdateUserProfile(ctx, 'target', 'New name')],
  ['adminSetUserStatus', (users) => users.adminSetUserStatus(ctx, 'target', true)],
  ['adminSendPasswordReset', (users) => users.adminSendPasswordReset(ctx, 'target')],
  ['adminRevokeUserSessions', (users) => users.adminRevokeUserSessions(ctx, 'target')],
  ['adminRemoveUserTwoFactor', (users) => users.adminRemoveUserTwoFactor(ctx, 'target')],
];

describe.each(WRITES)('%s', (_name, write) => {
  it('refuses, and changes nothing, when the target holds rights the actor lacks', async () => {
    const asked: string[][] = [];
    const { users, touched } = resolver(async (actorId, targetId) => {
      asked.push([actorId, targetId]);
      return false;
    });
    await expect(write(users)).rejects.toMatchObject({ response: { reason: 'not_permitted' } });
    expect(asked).toEqual([['support', 'target']]);
    expect(touched).toEqual([]);
  });

  it('refuses when the app bound no check, rather than allowing everything', async () => {
    const { users, touched } = resolver(undefined);
    await expect(write(users)).rejects.toMatchObject({ response: { reason: 'not_configured' } });
    expect(touched).toEqual([]);
  });

  it('goes ahead when the check allows it', async () => {
    const { users, touched } = resolver(async () => true);
    await write(users);
    expect(touched).toHaveLength(1);
  });
});
