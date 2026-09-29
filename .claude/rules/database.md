---
paths:
  - "**/*.prisma"
  - "apps/web-server/prisma/**"
  - "apps/web-server/src/prisma/**"
  - "apps/web-server/src/seed/**"
  - "apps/web-server/seed-data/**"
---

# Standards: database, migrations, seeders

## Schema fragments

- **Each module owns `packages/module-x/prisma/x.prisma`.**
  `apps/web-server/scripts/compose-schema.mjs` copies the fragments into the
  gitignored `apps/web-server/prisma/_modules/`, driven by the `@kwtech/module-*`
  dependencies in package.json. `schema.prisma` holds only the generator and the
  datasource. Never edit `_modules/` or `src/generated/`.
- **Models are PascalCase and prefixed** (`QueueTicket`, `PermRole`), mapped
  `@@map("queue_ticket")`: snake_case and singular. Columns stay camelCase, with
  no field `@map`.
- **Ids:** `id String @id @default(cuid())`. Join and one-per rows use a composite
  `@@id` or a natural key.
- **Timestamps:** `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
  Soft state uses `archivedAt DateTime?`. Archive; don't delete what people
  or audit trails reference.
- **Tenancy:** each tenant row carries denormalised `organizationId` /
  `workspaceId`, with `@@index([organizationId])`.
- **Race-sensitive invariants are `@@unique` constraints**, never a
  check-then-insert. The service turns `P2002` into a refusal.
- **Relations exist only inside a module** (`onDelete: Cascade` as appropriate).
  Ids from another module (`userId`, `workspaceId` held by chat or queue) are
  bare strings with NO foreign key, so modules can live in different databases.
- **Enums are prefixed, with snake_case values:** `enum QueueTicketStatus { called done no_show }`.

## Migrations

- Run `pnpm --filter @kwtech/web-server db:migrate` (compose, then `prisma migrate
  dev`) with a snake_case name, and commit `prisma/migrations/<ts>_<name>/`.
  Never edit an applied migration; write a new one.
- Deploys run `db:deploy`, then `db:sync`.
- Adding a NOT NULL column to a table with rows needs a default or a backfill in
  the same migration.

## Seeders (`apps/web-server/src/seed/`)

- **Contract:** `Seeder { name, phase, description, run({ prisma, log }) }`. Add the
  file and one line in `seeders/index.ts`, placed after what it depends on. There
  is no `dependsOn`.
- **Phases:**
  - `sync`: reference data the code owns, run on EVERY deploy (feature registry,
    app roles, defaults).
  - `seed`: once per environment (plans, first user, demo user).
- **Idempotent, always:** upsert or find-then-write, never a blind create. Running
  twice equals running once.
- **Never delete reference rows; deprecate them** (`deprecatedAt`).
- **One `$transaction` per seeder at most, never around the whole run.**
- **Missing optional env:** `log('skipped — set X')`. Missing required env: throw
  and name the variable.
- **Reuse module algorithms and presets** (`upsertSystemRole`, `QUEUE_ROLE_PRESETS`).
  Product decisions (which role holds what) live in `seed/app-roles.ts` and
  `seed/plans.ts`.

## Combined workspace roles (one person, several sub-apps)

A workspace member holds ONE workspace role (`@@unique([workspaceMemberId])`,
PLAN §12.32). So someone who is a POS cashier AND a queue supervisor in the same
workspace needs one role carrying both presets' keys. Per-app role slots would
remove the need, but they are an open decision (PLAN §12.85), not built.

- **Declare a combined role in `seed/app-roles.ts` as a UNION of module presets**,
  read by key the way `chat-user` is read. Never restate the keys, and never
  build one on the Roles screen: a screen clone is a copy that drifts the day
  a module's preset gains a key, and nothing notices.
- **A missing preset throws**, naming the module and the key, as the `chat-user`
  lookup does. A renamed preset must fail the sync rather than silently grant
  less.
- **At most one preset per module** in a combination. `pos-cashier` +
  `pos-manager` is not a job; the higher one alone is.
- **Only workspace-level presets combine into a workspace role.** The level check
  in `validateRoleDraft` still applies.
- **The organization's plan must entitle every module in the combination**
  (`seed/plans.ts`), or the holder gets `not_entitled` for that app. Check it
  when adding one.
- **Include each app's read key** (`queue:read`, `pos:read`, ...), or the app
  does not appear on the workspace's Apps page.
- No combined role exists yet, and neither does a helper for building one.
  The first one to be added brings the helper with it, in `app-roles.ts`.

When a module's `X_ROLE_PRESETS` changes (a key added, a preset renamed or
removed), check the combined roles that use it, and run `db:sync`.

## Dev data snapshot

- `pnpm db:snapshot` writes `seed-data/snapshot.json`, and `pnpm db:restore
  [--force]` loads it into an empty, migrated database, then runs the seeders.
- **The repository is public.** The snapshot excludes credentials, sessions and
  tokens (`EXCLUDED_TABLES` / `SCRUBBED_COLUMNS` in `src/seed/snapshot.ts`). A
  new table holding a secret MUST be added there in the same change that creates
  it.
