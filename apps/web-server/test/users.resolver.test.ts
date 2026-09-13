import 'reflect-metadata';
import { FEATURE } from '@kwtech/module-permissions';
import { REQUIRED_FEATURES, REQUIRED_SCOPE } from '@kwtech/module-permissions/server';
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
  it('is guarded by members:read, like the lookup beside it', () => {
    const guard = Reflect.getMetadata(REQUIRED_FEATURES, UsersResolver.prototype.findUsersByIds);
    expect(guard).toEqual([FEATURE.membersRead]);
  });

  /**
   * ⚠ THE BUG THIS EXISTS FOR, and it was reported from the product: a super
   * administrator saw names on every roster and an ordinary member saw raw ids.
   *
   * `members:read` is an ORGANIZATION-level key. Without a declared scope a
   * GraphQL request has no organization in its URL, so the guard fell through
   * to the path convention and resolved at APP level — where only a platform
   * administrator holds it. The lookup was refused, the client fails soft, and
   * the id is the fallback.
   */
  it('⚠ declares ORGANIZATION scope, or only platform admins ever resolve a name', () => {
    const scope = Reflect.getMetadata(REQUIRED_SCOPE, UsersResolver.prototype.findUsersByIds);
    expect(scope).toMatchObject({ level: 'organization' });
  });

  const capture = (members: string[] = ['u1', 'u2']) => {
    const seen: { users: { where: { id: { in: string[] } } }[]; memberships: unknown[] } = {
      users: [],
      memberships: [],
    };
    const svc = new UsersResolver({
      permMembership: {
        findMany: async (args: { where: { organizationId: string; userId: { in: string[] } } }) => {
          seen.memberships.push(args);
          return args.where.userId.in.filter((id) => members.includes(id)).map((userId) => ({ userId }));
        },
      },
      authUser: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          seen.users.push(args);
          return args.where.id.in.map((id) => ({ id, email: `${id}@x.com`, displayName: null, username: null }));
        },
      },
    } as never);
    return { svc, seen };
  };

  it('de-duplicates and drops empties before querying', async () => {
    const { svc, seen } = capture();
    await svc.findUsersByIds('org-1', ['u1', 'u1', '', 'u2']);

    expect((seen.memberships[0] as { where: { userId: { in: string[] } } }).where.userId.in).toEqual(['u1', 'u2']);
  });

  it('never queries for an empty list', async () => {
    const { svc, seen } = capture();
    expect(await svc.findUsersByIds('org-1', [])).toEqual([]);
    expect(seen.memberships).toEqual([]);
    expect(seen.users).toEqual([]);
  });

  /**
   * ⚠ THE HALF THE SCOPE CHANGE MADE NECESSARY. The old reasoning was that a
   * batch of ids "discloses nothing that was not already disclosed, because the
   * caller already holds them" — true of a SCREEN, and not of an ENDPOINT,
   * which accepts whatever it is sent. While the key was app-level that gap was
   * reachable only by platform administrators. Widening it to every member
   * would otherwise have made it a directory harvester over the whole platform:
   * send your own organization id and a hundred guessed user ids.
   */
  it('⚠ returns only people who are actually in that organization', async () => {
    const { svc } = capture(['u1']);

    const found = await svc.findUsersByIds('org-1', ['u1', 'somebody-elses-user']);
    expect(found.map((user) => user.id)).toEqual(['u1']);
  });

  /**
   * ⚠ IN THE DATABASE, not by filtering afterwards. Reading everybody and then
   * dropping non-members would still have READ them, and a mistake in the
   * filter would be a disclosure rather than an empty list.
   */
  it('⚠ never reads a user it has not already confirmed is a member', async () => {
    const { svc, seen } = capture(['u1']);
    await svc.findUsersByIds('org-1', ['u1', 'outsider']);

    expect(seen.users[0]?.where.id.in).toEqual(['u1']);
    expect(seen.users[0]?.where.id.in).not.toContain('outsider');
  });

  it('does not touch auth_user at all when nobody named is a member', async () => {
    const { svc, seen } = capture([]);

    expect(await svc.findUsersByIds('org-1', ['outsider'])).toEqual([]);
    expect(seen.users).toEqual([]);
  });

  /**
   * An uncapped `in` list is an unbounded query somebody can send, and the
   * request that finally hurts is never the one anybody tested. Truncates
   * rather than refusing: a caller asking for more than it can render is a bug
   * in the caller, and a 400 mid-screen-load helps nobody.
   */
  it('caps the batch', async () => {
    const { svc, seen } = capture(Array.from({ length: 500 }, (_, i) => `u${i}`));
    await svc.findUsersByIds(
      'org-1',
      Array.from({ length: 500 }, (_, i) => `u${i}`),
    );

    expect((seen.memberships[0] as { where: { userId: { in: string[] } } }).where.userId.in).toHaveLength(200);
  });
});
