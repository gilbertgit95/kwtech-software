import { composeContext } from '../src/domain/grants.js';
import type { LimitSpec } from '../src/domain/limits.js';
import { LIMIT_CONTRIBUTIONS, LIMIT_REGISTRY } from '../src/domain/limits.js';
import type { PermissionsPrismaClient } from '../src/server/permissions.repository.js';
import { PermissionsService } from '../src/server/permissions.service.js';

/**
 * Caps contributed by a module this one may not import.
 *
 * Every test here is about a failure that produces NO error in production: a
 * declared-looking cap that never denies. The registry is the only thing
 * standing between an operator's number and silence.
 */

/** Stands in for `module-chat`'s contribution, which does not exist yet. */
const CHAT_GROUPS: LimitSpec = {
  key: 'chat:group_chats',
  module: 'chat',
  label: 'Group chats',
  description: 'How many group conversations this user may create.',
  source: 'role',
  countedOver: 'user',
  required: false,
  defaultValue: 20,
};

const COMPOSED: readonly LimitSpec[] = [...LIMIT_REGISTRY, CHAT_GROUPS];

/** The methods under test decide; none of them reaches the database. */
const decidingService = (limitRegistry?: readonly LimitSpec[]) =>
  new PermissionsService({} as PermissionsPrismaClient, limitRegistry ? { limitRegistry } : undefined);

describe('a contributed cap in the composed registry', () => {
  const roleWithCap = [
    {
      roleKey: 'chat-power-user',
      level: 'app' as const,
      features: [],
      workspaceId: null,
      limits: { 'chat:group_chats': 50 },
    },
  ];

  it('resolves from the holder’s app-level role', () => {
    const ctx = composeContext({
      subjectId: 'u1',
      organizationId: null,
      roles: roleWithCap,
      limitRegistry: COMPOSED,
    });

    expect(ctx.limits['chat:group_chats']).toBe(50);
  });

  it('falls to the contribution’s default for a role that says nothing', () => {
    const ctx = composeContext({
      subjectId: 'u1',
      organizationId: null,
      roles: [{ roleKey: 'normal-user', level: 'app', features: [], workspaceId: null }],
      limitRegistry: COMPOSED,
    });

    expect(ctx.limits['chat:group_chats']).toBe(20);
  });

  it('⚠ DROPS the same row when the registry does not declare the key', () => {
    // The failure this whole path exists to prevent: the number is in
    // `perm_role_limit`, the role editor shows it, and nothing enforces it.
    const ctx = composeContext({ subjectId: 'u1', organizationId: null, roles: roleWithCap });

    expect(ctx.limits['chat:group_chats']).toBeUndefined();
  });
});

describe('checkCapacity', () => {
  it('refuses a declared key it cannot count, rather than answering zero', async () => {
    // Falling through its perm_* chain would make `current` 0 and every check
    // pass — a cap that is visible, configured, and never denies.
    await expect(decidingService(COMPOSED).checkCapacity({ limits: {} } as never, 'chat:group_chats')).rejects.toThrow(
      /cannot be counted here/,
    );
  });

  it('still refuses a key nobody declared', async () => {
    await expect(decidingService().checkCapacity({ limits: {} } as never, 'nothing:declared')).rejects.toThrow(
      /Unknown limit/,
    );
  });
});

describe('checkDeclaredLimit', () => {
  const ctx = { limits: { 'chat:group_chats': 2 } } as never;

  it('allows under the cap and denies at it', () => {
    expect(decidingService(COMPOSED).checkDeclaredLimit(ctx, 'chat:group_chats', 1)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(decidingService(COMPOSED).checkDeclaredLimit(ctx, 'chat:group_chats', 2)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('refuses an undeclared key instead of answering "no limit"', () => {
    expect(() => decidingService().checkDeclaredLimit(ctx, 'chat:group_chats', 1)).toThrow(/Unknown limit/);
  });
});

describe('checkLimitForActor', () => {
  /** Somebody holding no app-level role at all — a new account. */
  const noRoles = { permUserRole: { findMany: async () => [] } } as unknown as PermissionsPrismaClient;

  it('⚠ gives the FLOOR to an actor with no context, never "unrestricted"', async () => {
    const svc = new PermissionsService(noRoles, { limitRegistry: COMPOSED });

    await expect(svc.checkLimitForActor({ actorId: 'u-new', key: 'chat:group_chats', current: 20 })).resolves.toEqual({
      allowed: false,
      limit: 20,
      current: 20,
      remaining: 0,
    });
  });
});

describe('LIMIT_CONTRIBUTIONS', () => {
  it('attributes every one of this module’s own caps', () => {
    expect(LIMIT_CONTRIBUTIONS).toHaveLength(LIMIT_REGISTRY.length);
    expect(LIMIT_CONTRIBUTIONS.every((limit) => limit.module === 'permissions')).toBe(true);
  });
});
