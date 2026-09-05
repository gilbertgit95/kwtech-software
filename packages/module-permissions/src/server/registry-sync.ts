import type { RoleDefinition } from '../domain/roles.js';
import { assertRoleDefinable } from '../domain/writes.js';
import type { FeatureKey, FeatureSpec } from '../types.js';

/**
 * Writing the module's REFERENCE DATA into the database it was given.
 *
 * ## Why this is the module's code and not the app's
 *
 * It lived in `apps/web-server/src/seed` and had no app-specific content in it:
 * `FEATURE_REGISTRY` in, `perm_feature` out. Two things made that the wrong
 * home.
 *
 * The invariant was split. The module's READ path filters `deprecatedAt: null`;
 * the write that SETS `deprecatedAt` was in the app, with nothing making the two
 * agree. Change how this module represents a retired key — a status column, a
 * different name — and the app keeps writing the old field, with no compile
 * error, and deprecation silently stops working. That is the failure
 * apps/web-server/src/prisma/satisfies-modules.ts exists to prevent everywhere
 * else.
 *
 * And it does not vary. Every app adopting this module must run exactly this
 * algorithm, so a second app would have copied it — which is the duplication the
 * module pattern exists to remove.
 *
 * ## What is NOT here
 *
 * WHICH roles exist and what they are called. `super-admin` and `client` are
 * product decisions, and a second app composing this module would want
 * different ones; they stay in the app and arrive as arguments.
 *
 * Resolving a person to a user id, too. That is `auth_user`, which belongs to
 * `@kwtech/module-auth` — and these two modules do not import each other
 * (PLAN §9). So `grantAppRole` takes a `userId` that the APP looked up, which
 * is the same seam as `resolvePrincipal` on the server and `session-query` on
 * the web.
 *
 * ## Not a seed
 *
 * `perm_role_feature` carries a foreign key to `perm_feature`, so until
 * `syncFeatureRegistry` has run, a newly added key CANNOT BE GRANTED TO ANYONE.
 * That makes this reference-data migration rather than sample data: it belongs
 * on every deploy, right after `migrate deploy`, not in a one-off seed someone
 * remembers. See the app's `db:sync` script.
 *
 * Every function here is idempotent, for the same reason: something that runs on
 * every deploy must converge rather than accumulate.
 */

/**
 * The narrow client these writes need — a THIRD structural interface alongside
 * `PermissionsPrismaClient` and `PermissionsWriteClient`.
 *
 * Separate rather than folded into the write client, because it is a different
 * capability with a different lifetime: the write client serves live requests
 * and is injected into a running service, while this is used once by a script
 * at deploy time. An app that administers grants elsewhere should be able to
 * run the registry sync without ever binding a request-time write client, and
 * the reverse.
 *
 * Structural, like the others, so this package still opens no connection and
 * still depends on no db package.
 */
export interface PermissionsRegistryClient {
  permFeature: {
    upsert(args: {
      where: { key: string };
      create: {
        key: string;
        module: string;
        label: string;
        description: string;
        isPrivileged: boolean;
        deprecatedAt: Date | null;
      };
      update: {
        module: string;
        label: string;
        description: string;
        isPrivileged: boolean;
        deprecatedAt: Date | null;
      };
    }): Promise<unknown>;
    findMany(args: {
      where: { key: { notIn: string[] }; deprecatedAt: null };
      select: { key: true };
    }): Promise<{ key: string }[]>;
    updateMany(args: { where: { key: { in: string[] } }; data: { deprecatedAt: Date } }): Promise<unknown>;
  };
  permRole: {
    findMany(args: { where: { key: string; organizationId: null }; select: { id: true } }): Promise<{ id: string }[]>;
    findFirst(args: {
      where: { key: string; organizationId: null; level: 'app' };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    /*
     * `level: 'app'`, the LITERAL, not `RoleLevel` and not `string`.
     *
     * PermRoleLevel is an enum in the schema, so a wider type here stops a
     * generated Prisma client satisfying this interface at all — the same trap
     * documented on `permSubscription.status` in permissions.repository.ts, and
     * it caught this file on the first typecheck. The narrowing costs nothing:
     * these two functions only ever write app-level system roles, which is what
     * `AppRoleDefinition.level` already says.
     */
    create(args: {
      data: { key: string; label: string; level: 'app'; organizationId: null; isSystem: boolean; icon: string | null };
      select: { id: true };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: { label: string; level: 'app'; isSystem: boolean; icon: string | null };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  permRoleFeature: {
    deleteMany(args: { where: { roleId: string; featureKey: { notIn: string[] } } }): Promise<unknown>;
    upsert(args: {
      where: { roleId_featureKey: { roleId: string; featureKey: string } };
      create: { roleId: string; featureKey: string };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
  permRoleLimit: {
    deleteMany(args: { where: { roleId: string; limitKey: { notIn: string[] } } }): Promise<unknown>;
    upsert(args: {
      where: { roleId_limitKey: { roleId: string; limitKey: string } };
      create: { roleId: string; limitKey: string; value: number };
      update: { value: number };
    }): Promise<unknown>;
  };
  permUserRole: {
    findUnique(args: {
      where: { userId_roleId: { userId: string; roleId: string } };
      select: { userId: true };
    }): Promise<{ userId: string } | null>;
    create(args: { data: { userId: string; roleId: string } }): Promise<unknown>;
  };
}

/** The definition of an app-level system role, as an app supplies it. */
export interface AppRoleDefinition extends RoleDefinition {
  level: 'app';
  /** Caps this role sets. See domain/limits.ts. */
  limits: Readonly<Record<string, number>>;
}

export interface FeatureSyncResult {
  upserted: number;
  /** Keys that were live and are no longer in the registry. */
  deprecated: string[];
}

/**
 * Mirrors the registry into `perm_feature` and retires what is gone.
 *
 * It NEVER deletes. Grants and the audit trail have to stay readable: a
 * `perm_role_feature` row pointing at a removed key would fail its foreign key,
 * and an audit entry saying "granted <deleted>" answers nothing. Deprecation is
 * enforced on the read side instead — every feature query filters
 * `deprecatedAt: null` — so a deprecated key stops granting immediately while
 * the history it appears in survives.
 *
 * Re-listing a key that was previously removed brings it back to life, which is
 * why `deprecatedAt: null` is written on every upsert rather than only on
 * create.
 */
export async function syncFeatureRegistry(
  client: PermissionsRegistryClient,
  registry: readonly FeatureSpec[],
): Promise<FeatureSyncResult> {
  for (const spec of registry) {
    const row = {
      module: spec.module,
      label: spec.label,
      description: spec.description,
      isPrivileged: spec.isPrivileged ?? false,
      deprecatedAt: null,
    };
    await client.permFeature.upsert({ where: { key: spec.key }, create: { key: spec.key, ...row }, update: row });
  }

  const live = registry.map((spec) => spec.key);
  const stale = await client.permFeature.findMany({
    where: { key: { notIn: live }, deprecatedAt: null },
    select: { key: true },
  });
  if (stale.length > 0) {
    await client.permFeature.updateMany({
      where: { key: { in: stale.map((feature) => feature.key) } },
      data: { deprecatedAt: new Date() },
    });
  }

  return { upserted: registry.length, deprecated: stale.map((feature) => feature.key) };
}

/**
 * Upserts one app-level system role and re-syncs what it grants.
 *
 * Features and limits are REPLACED rather than merged, so the definition the app
 * passes is the whole truth about the role: a key removed from it is actually
 * revoked on the next run instead of lingering because nothing deleted it.
 *
 * `assertRoleDefinable` runs first, every time. Defining a role is the moment
 * that rule is meant to be enforced, and a seed script is exactly the caller
 * that would otherwise bypass it.
 *
 * The caller supplies the transaction — see `runInTransaction` on the client it
 * passes — because whether these writes share one with the app's own seed steps
 * is the app's call, not this module's.
 */
export async function upsertAppRole(
  client: PermissionsRegistryClient,
  definition: AppRoleDefinition,
  registry: readonly FeatureSpec[],
): Promise<{ key: string; id: string; features: number }> {
  assertRoleDefinable(definition, registry);

  /**
   * Found and created by hand rather than upserted, because
   * `@@unique([organizationId, key])` cannot be used here.
   *
   * organizationId is null for an app-level role — it belongs to no
   * organization — and Postgres treats NULLs as DISTINCT in a unique index. So
   * `perm_role_organizationId_key_key` does not actually stop two rows keyed
   * ('super-admin', NULL), and Prisma will not accept null in a compound-unique
   * `where` for the same reason. See docs/PLAN.md §12 — the partial unique index
   * that would close this needs raw SQL the migration pipeline has no home for.
   *
   * Until it does, this is the guard: refuse loudly on a duplicate rather than
   * silently re-syncing one of two roles with the same key, which would leave a
   * super admin whose grants depend on which row won.
   */
  const found = await client.permRole.findMany({
    where: { key: definition.key, organizationId: null },
    select: { id: true },
  });
  if (found.length > 1) {
    throw new Error(
      `${found.length} app-level roles already share the key '${definition.key}' ` +
        `(${found.map((role) => role.id).join(', ')}). Delete all but one before syncing.`,
    );
  }

  const existing = found[0];
  /*
   * `?? null`, never `?? undefined`. Features and limits are REPLACED by this
   * function rather than merged, and the icon follows the same rule: the
   * definition the app passes is the whole truth about the role, so an icon
   * REMOVED from the definition is cleared on the next sync. Leaving it
   * undefined would make Prisma skip the column, so a retired icon would
   * linger on the row with nothing in the checkout still naming it.
   */
  const icon = definition.icon ?? null;
  const role = existing
    ? await client.permRole.update({
        where: { id: existing.id },
        data: { label: definition.label, level: definition.level, isSystem: true, icon },
        select: { id: true },
      })
    : await client.permRole.create({
        data: {
          key: definition.key,
          label: definition.label,
          level: definition.level,
          organizationId: null,
          isSystem: true,
          icon,
        },
        select: { id: true },
      });

  await client.permRoleFeature.deleteMany({
    where: { roleId: role.id, featureKey: { notIn: [...definition.features] } },
  });
  for (const featureKey of definition.features) {
    await client.permRoleFeature.upsert({
      where: { roleId_featureKey: { roleId: role.id, featureKey } },
      create: { roleId: role.id, featureKey },
      update: {},
    });
  }

  const limitKeys = Object.keys(definition.limits);
  await client.permRoleLimit.deleteMany({ where: { roleId: role.id, limitKey: { notIn: limitKeys } } });
  for (const [limitKey, value] of Object.entries(definition.limits)) {
    await client.permRoleLimit.upsert({
      where: { roleId_limitKey: { roleId: role.id, limitKey } },
      create: { roleId: role.id, limitKey, value },
      update: { value },
    });
  }

  return { key: definition.key, id: role.id, features: definition.features.length };
}

/**
 * Grants an app-level role to a user who already exists.
 *
 * Straight onto `perm_user_role`, with no membership and no organization in the
 * picture — that table exists precisely because an app-level role has neither.
 *
 * Takes a `userId`, NOT an email. Resolving a person to an id means reading
 * `auth_user`, which belongs to `@kwtech/module-auth`; this module does not
 * import that one and must not learn to. The app does the lookup and passes the
 * result, which is the same seam as `resolvePrincipal`.
 *
 * Refuses when the role is unknown rather than creating it: a grant that
 * conjured the role it was granting would be a way to mint platform staff by
 * typo.
 */
export async function grantAppRole(
  client: PermissionsRegistryClient,
  input: { userId: string; roleKey: string },
): Promise<{ userId: string; roleId: string; created: boolean }> {
  const role = await client.permRole.findFirst({
    where: { key: input.roleKey, organizationId: null, level: 'app' },
    select: { id: true },
  });
  if (!role) throw new Error(`No app-level role '${input.roleKey}'. Sync the app roles first.`);

  const existing = await client.permUserRole.findUnique({
    where: { userId_roleId: { userId: input.userId, roleId: role.id } },
    select: { userId: true },
  });
  if (!existing) await client.permUserRole.create({ data: { userId: input.userId, roleId: role.id } });

  return { userId: input.userId, roleId: role.id, created: existing === null };
}

/** Every key in a registry, for a role that is meant to hold all of them. */
export function registryFeatureKeys(registry: readonly FeatureSpec[]): FeatureKey[] {
  return registry.map((spec) => spec.key);
}
