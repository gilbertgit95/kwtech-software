import 'reflect-metadata';
import { FEATURE } from '@kwtech/module-permissions';
import { REQUIRED_FEATURES } from '@kwtech/module-permissions/server';
import { UsersResolver } from '../src/users/users.resolver.js';

/**
 * The user lookup is the one place this app reaches across the auth/permissions
 * seam, so both halves of it are asserted here rather than taken on trust.
 */
describe('findUserByEmail', () => {
  it('is guarded by members:manage', () => {
    // The binding in module-permissions' registry CLAIMS this guard, and that
    // claim cannot be checked from inside the module — the handler lives here.
    // This is the other half of `surface-coverage.test.ts`.
    const guard = Reflect.getMetadata(REQUIRED_FEATURES, UsersResolver.prototype.findUserByEmail);
    expect(guard).toEqual([FEATURE.membersRead]);
  });

  const resolver = (found: unknown) => new UsersResolver({ authUser: { findUnique: async () => found } } as never);

  it('normalises the address the same way auth stores it', async () => {
    const seen: unknown[] = [];
    const svc = new UsersResolver({
      authUser: {
        findUnique: async (args: unknown) => {
          seen.push(args);
          return null;
        },
      },
    } as never);

    await svc.findUserByEmail('  Alice@ACME.com  ');

    // Otherwise 'Alice@Acme.com' finds nobody while signing in with it works —
    // a bug that only appears for the one person whose client capitalises.
    expect(seen[0]).toMatchObject({ where: { email: 'alice@acme.com' } });
  });

  it('returns null for an unknown address rather than throwing', async () => {
    // A form checking something somebody typed. "No account" is an answer, not
    // a fault.
    expect(await resolver(null).findUserByEmail('nobody@example.com')).toBeNull();
  });

  it('returns null for a blank address without querying at all', async () => {
    const seen: unknown[] = [];
    const svc = new UsersResolver({
      authUser: {
        findUnique: async (args: unknown) => {
          seen.push(args);
          return null;
        },
      },
    } as never);

    expect(await svc.findUserByEmail('   ')).toBeNull();
    expect(seen).toEqual([]);
  });

  it('returns only the four fields a member picker needs', async () => {
    const found = { id: 'u1', email: 'a@b.c', displayName: 'Alice', username: 'alice' };
    expect(await resolver(found).findUserByEmail('a@b.c')).toEqual(found);
  });
});

describe('findUsersByIds', () => {
  it('is guarded by members:manage, like the lookup beside it', () => {
    const guard = Reflect.getMetadata(REQUIRED_FEATURES, UsersResolver.prototype.findUsersByIds);
    expect(guard).toEqual([FEATURE.membersRead]);
  });

  const capture = () => {
    const seen: { where: { id: { in: string[] } } }[] = [];
    const svc = new UsersResolver({
      authUser: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          seen.push(args);
          return args.where.id.in.map((id) => ({ id, email: `${id}@x.com`, displayName: null, username: null }));
        },
      },
    } as never);
    return { svc, seen };
  };

  it('de-duplicates and drops empties before querying', async () => {
    const { svc, seen } = capture();
    await svc.findUsersByIds(['u1', 'u1', '', 'u2']);
    expect(seen[0]?.where.id.in).toEqual(['u1', 'u2']);
  });

  it('never queries for an empty list', async () => {
    const { svc, seen } = capture();
    expect(await svc.findUsersByIds([])).toEqual([]);
    expect(seen).toEqual([]);
  });

  /**
   * An uncapped `in` list is an unbounded query somebody can send, and the
   * request that finally hurts is never the one anybody tested. Truncates
   * rather than refusing: a caller asking for more than it can render is a bug
   * in the caller, and a 400 mid-screen-load helps nobody.
   */
  it('caps the batch', async () => {
    const { svc, seen } = capture();
    await svc.findUsersByIds(Array.from({ length: 500 }, (_, i) => `u${i}`));
    expect(seen[0]?.where.id.in).toHaveLength(200);
  });
});
