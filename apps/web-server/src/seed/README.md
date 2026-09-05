# Seeders

Every seeder this app runs is listed once, in [`seeders/index.ts`](./seeders/index.ts).
Adding one is a file plus a line in that array — nothing else changes, and in
particular `package.json` never names an individual seeder.

## The two phases

| Phase | When | What belongs in it |
|---|---|---|
| `sync` | **every deploy** | reference data the code owns and the database mirrors |
| `seed` | once per environment, on request | the first account, demo tenants, test fixtures |

The distinction is not cosmetic. `perm_role_feature` carries a foreign key to
`perm_feature`, so until `permissions:features` has run, **a newly added feature
key cannot be granted to anyone**. That makes it a migration of reference data,
not sample data — it has to happen on every deploy rather than when somebody
remembers.

`seed` implies `sync`: seed data references reference data, so running it alone
against a fresh database would fail on a foreign key.

## Commands

```bash
pnpm db:sync          # sync seeders only — this is what a deploy runs
pnpm db:seed          # sync, then the once-per-environment seeders
pnpm db:seed:list     # what exists, without touching the database
node dist/seed/run.js --phase=seed --only=demo:tenant
```

`prisma.config.ts` registers `pnpm db:seed` as the migration seed command, so
`prisma migrate reset` re-seeds on its own.

## Writing one

```ts
// seeders/demo-tenant.ts
import type { Seeder } from '../types.js';

export const demoTenantSeeder: Seeder = {
  name: 'demo:tenant',
  phase: 'seed',
  description: 'A worked-example organization with two workspaces.',
  async run({ prisma, log }) {
    const org = await prisma.permOrganization.upsert({
      where: { slug: 'demo' },
      create: { slug: 'demo', name: 'Demo Co' },
      update: { name: 'Demo Co' },
      select: { id: true },
    });
    log(`organization ${org.id}`);
  },
};
```

Then add it to `SEEDERS`, after anything it depends on:

```ts
export const SEEDERS: readonly Seeder[] = [
  permissionsRegistrySeeder,
  appRolesSeeder,
  firstUserSeeder,
  superAdminGrantSeeder,
  demoTenantSeeder, // ←
];
```

### Rules

**It must be idempotent.** Running it twice must do the same thing as running it
once — upsert, do not create. This is what replaces a transaction around the
whole run: one spanning every seeder would be exactly the long-lived interactive
transaction Prisma times out on, and it would not help across separate
invocations anyway. Convergence does: a run that fails halfway is fixed by
running it again, which is also what the next deploy does.

**Order is real.** Seeders run top to bottom within their phase. There is no
`dependsOn` field on purpose — an explicit graph for a handful of entries with
one real edge is machinery to maintain in place of a list to read. Put yours
after what it needs.

**Open your own transaction** if several of your writes must land together.
`permissions:app-roles` does this per role.

**Fail loudly.** A seeder that cannot do its job should throw. The runner stops,
names the seeder, and exits non-zero — which is what you want in a deploy.

## What lives here and what lives in a module

The split is deliberate:

| | Where | Why |
|---|---|---|
| `syncFeatureRegistry`, `upsertAppRole`, `grantAppRole` | `@kwtech/module-permissions/server` | mechanical, identical for every app, and must agree with the module's own read path — which filters `deprecatedAt: null` |
| `APP_ROLES` (`super-admin`, `client`) | [`../app-roles.ts`](../app-roles.ts) | product decisions; a second app would want different ones |
| resolving an email to a user id | [`seeders/super-admin-grant.ts`](./seeders/super-admin-grant.ts) | `auth_user` is `module-auth`'s and `perm_user_role` is `module-permissions`'; the two never import each other, so the app is the seam |
| ordering, env, logging | this folder | composition is the app's job |

If you find yourself writing logic a *second* app adopting the same module would
also need, it probably belongs in the module rather than here.
