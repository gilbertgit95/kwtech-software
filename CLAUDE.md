# kwtech-software — working guide

This file is for developers and for Claude Code alike. Claude Code loads it
automatically at the start of every session, so everything here is context it
already has when you ask it to build something. Keep it short, keep it true, and
link to the longer documents rather than copying them.

| Read | For |
|---|---|
| [README.md](README.md) | overview, commands, the dev database |
| [docs/SETUP.md](docs/SETUP.md) | a new computer, from `git clone` to signed in; database tasks; troubleshooting |
| [docs/PLAN.md](docs/PLAN.md) | the plan. §9 module rules, §10 layout, §12 open decisions, §13 dated decision log |
| [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md) | why it is built this way. Part 7 is the principles that recur |
| [packages/module-kit/README.md](packages/module-kit/README.md) | the module contract: descriptors, routes, nav, features, limits, defaults, scope |
| `packages/module-*/README.md` | each feature module's own contract and options |
| [packages/web-ui/README.md](packages/web-ui/README.md) | themes, tokens, layout components |
| [apps/web-server/src/seed/README.md](apps/web-server/src/seed/README.md) | seeders, sync versus seed, the snapshot |
| [docs/STANDARDS.md](docs/STANDARDS.md) | the coding standards: what is in `.claude/rules/`, and the known inconsistencies |
| [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) | what may import what, and the ports modules use instead. Enforced by `pnpm check:boundaries` |

`docs/PLAN.md` is over 9,000 lines. Search it (`grep -n "§12.40" docs/PLAN.md`)
rather than reading it whole.

## What this is

A Turborepo + pnpm monorepo. Node >= 22, pnpm >= 11.

```
apps/web-server/            NestJS API: GraphQL (code-first) + WebSocket + some REST   :8080
apps/web-app/               Next.js (app router) frontend                              :8081
packages/module-kit/        the contract every module implements, and its composition
packages/module-auth/       sign-in, sessions, MFA, password reset
packages/module-permissions/ organizations, workspaces, roles, features, plans, limits
packages/module-chat/       conversations and messages
packages/module-queuing-window/ walk-in queue: windows, lines, a live TV board
packages/module-notification/ system notifications: bell, toasts, a paginated inbox
packages/web-ui/            React + Tailwind 4 components and themes
```

Postgres via Prisma 7. The schema is owned by `apps/web-server`, and the modules
each ship a fragment of it.

## Commands

```bash
pnpm dev                 # dev database + every package watcher + both apps
pnpm dev:api | dev:web   # one side only
pnpm typecheck
pnpm test                # jest in packages and web-server
pnpm lint                # biome, then the package boundary check; pnpm check:fix writes the fixes
pnpm --filter @kwtech/web-app test:e2e     # playwright, see apps/web-app/e2e/README.md

pnpm --filter @kwtech/web-server db:migrate    # compose module fragments + prisma migrate dev
pnpm --filter @kwtech/web-server db:generate   # compose + generate the client
pnpm --filter @kwtech/web-server db:sync       # reference data (features, roles, defaults)
pnpm --filter @kwtech/web-server db:seed       # sync + first user, plans, demo user
pnpm db:restore [--force]                      # load seed-data/snapshot.json
pnpm env:show | env:use <name> | env:new <name> | env:check   # env profiles in envs/ (local by default)
pnpm db:up | db:down                           # the kwtech-postgres Docker container
```

Before calling work done, run `pnpm typecheck`, `pnpm test` and `pnpm lint`.
When the change can be seen, run the app too: several bugs in this repo
(duplicate Nest instances, GraphQL schema errors at boot) passed `tsc` and only
failed at runtime.

## Coding standards

The coding standards are in `.claude/rules/`. `00-principles.md` loads in every
session, and each topic file (TypeScript, modules, backend, database, frontend,
testing) loads when you touch files its `paths:` match. Follow them without
being asked. Where the code does something two ways, the newest module wins
(`module-queuing-window`, then `module-chat`). Don't copy anything marked
**Legacy**. See [docs/STANDARDS.md](docs/STANDARDS.md).

## The one architectural idea: a feature is a `module-*` package

A module is a **whole feature, vertically**: Prisma models, domain logic, GraphQL
resolvers, the Nest module and the React pages. The apps only compose modules and
supply what a module cannot know. The rules (PLAN §9):

1. **Layout, by subpath export.**
   - `src/index.ts` → `@kwtech/module-x`: the pure core. Types, feature keys,
     domain decisions and GraphQL operation strings. **It imports no framework.**
   - `src/domain/`: pure logic, and where most unit tests go.
   - `src/server/` → `/server`: the Nest module, services, repository, resolvers,
     and DI tokens and ports.
   - `src/react/` → `/react`: pages, components, hooks, and the `WebModuleDescriptor`.
   - `prisma/<name>.prisma` → `/prisma`: the schema fragment.
2. **`/react` never imports `/server`**, so server code stays out of the browser
   bundle. Framework packages are optional `peerDependencies`.
3. **Prefix everything the module owns.** For example `Queue*` models and
   `queue_*` tables, and `queue:*` feature keys.
4. **A module never opens a database connection.** It declares a structural
   client interface and a DI token (`QUEUE_PRISMA`), and the app provides it in
   `apps/web-server/src/prisma/module-clients.ts`.
   `apps/web-server/src/prisma/satisfies-modules.ts` checks that it fits at
   compile time.
5. **A module does not own identity and does not import other modules.** From
   `@kwtech/*` it imports only `@kwtech/module-kit` and, for its React layer,
   `@kwtech/web-ui`. Anything it needs from auth or permissions (who is the actor, is
   this person staff) arrives as a port the app implements. See `src/queue/*` and
   `src/chat/*` in web-server.
6. **Apps configure and modules publish a contract.** Options go through
   `xServerModule({...})` / `xWebModule({...})`. A module may read a documented
   env var, but it never defaults a secret.
7. **Fail closed.** Missing context denies, and an empty gate renders its
   fallback. Whenever access is denied, say why.
8. **Import public entrypoints only.** Never deep-import another package's `src/`.
   Apps depend on packages, never the reverse.

`module-queuing-window` is the most recent and most complete example. Copy its
shape.

## Adding or extending a feature — the checklist

Put it in an existing module if it belongs to that feature. Create a new module
only when it is a feature of its own (PLAN §9 rule 8).

**In the module**
- [ ] Domain logic in `src/domain/`, pure, with jest tests in `test/`. Test
      services against a fake client (`test/fake-client.ts`), not a database.
- [ ] Feature keys and their registry in `src/feature-keys.ts`, exported from
      the root. Each entry has `key`, `module`, `level`
      (`app` | `organization` | `workspace`), `label`, `description`, and
      `bindings` for every GraphQL operation it guards.
- [ ] Limits (how many), if any, in the same file (`*_LIMIT_REGISTRY`).
- [ ] Models in `prisma/<name>.prisma`, prefixed.
- [ ] Resolvers: **every** resolver below app level declares its scope with
      `SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))`. Without
      it the guard resolves at app level and the module's keys grant nothing,
      with no error. Public surfaces use `PUBLIC_SURFACE_METADATA` with a
      non-empty reason. Surfaces where someone guesses a secret also carry
      `CREDENTIAL_SURFACE_METADATA`. All three come from `@kwtech/module-kit`.
- [ ] GraphQL documents the client sends go in `src/operations.ts` (the root,
      not `/react`). `apps/web-server/test/module-operations.test.ts` validates
      them against the served schema.
- [ ] UI: pages in `src/react/pages/`, and routes and nav entries declared in
      the `WebModuleDescriptor` (`src/react/module.tsx`), each with its required
      `feature`. **A sub-app** (the queue, and every app after it) always lives
      under a workspace: its routes under
      `/organizations/:organizationId/workspaces/:workspaceId/…`, its rows keyed
      by `workspaceId`, its keys workspace level, and its nav entry in the
      `'Apps'` group (placed with `navGroups: [{ group: 'Apps', order: 35 }]`,
      spelling pinned in a test, as `module-queuing-window` does). Hide
      controls inside a page with `useHoldsFeature` from
      `@kwtech/module-kit/react`. That only hides them: the API authorises again.
- [ ] A **tool** people use from anywhere (like chat) goes in the app header,
      not the drawer: declare `headerTools` on the descriptor (see
      `packages/module-kit/README.md`, "Header tools"). One way in, not both.
- [ ] **Telling a person something happened** (a job finished, a session
      stopped, something needs attention)? Don't build a banner, badge or
      toast of your own: declare a port in the module (`X_NOTIFIER`), call it
      after the commit, and have the app bind it to `module-notification`'s
      `NotificationSender` (`sendSafely`), declaring the source in
      `apps/web-server/src/notifications/sources.ts`. Recipe:
      `packages/module-notification/README.md`, "Notifying people from another
      module". Person-to-person messages are chat, not notifications.
- [ ] Use `@kwtech/web-ui` components and theme tokens rather than raw colours.

**In the apps (only for a new module, or a new port or option)**
- [ ] Add the dependency to `apps/web-server/package.json` and
      `apps/web-app/package.json`. The schema compose script and
      `next.config.ts` read those lists, so there is nothing else to register.
- [ ] `apps/web-server/src/app.module.ts`: add the descriptor to
      `SERVER_MODULES` with its providers (prisma clients, ports, pubsub).
- [ ] `apps/web-server/src/prisma/module-clients.ts` and `satisfies-modules.ts`:
      bind and check the client.
- [ ] `apps/web-server/src/seed/registry.ts`: add to `MODULE_DECLARATIONS`.
      This is how the features reach `perm_feature`. For modules that cannot
      use `@RequireFeature`, the bindings **are** the guard.
- [ ] `apps/web-server/src/seed/app-roles.ts` (and `plans.ts` for organization
      keys): grant the new keys to the roles and plans that should hold them.
      Read the module's presets (for example `QUEUE_ROLE_PRESETS`) rather than
      restating them.
- [ ] `apps/web-app/src/modules.ts`: add to `WEB_MODULES`. Pages render through
      the catch-all `app/(modules)/[...slug]/page.tsx`, so you don't add a
      page file.

**Then**
- [ ] `pnpm --filter @kwtech/web-server db:migrate` for schema changes, and commit
      the migration.
- [ ] `pnpm --filter @kwtech/web-server db:sync` so new feature keys exist
      before anything grants them.
- [ ] Update that module's README. For a real decision, add a dated entry to
      PLAN §13 (the decision log): what was decided, why, and what was not done.

Composition throws on duplicate route paths or duplicate feature keys. That is
deliberate.

## Permissions, briefly

Access = **grants** (roles a user holds at app, organization or workspace level)
**filtered by entitlements** (the organization's plan and subscription). Grants
add up. There is no deny rule and no precedence. App-level roles
(`super-admin`) bypass the plan filter. Scope comes from the URL:
`/organizations/:organizationId/workspaces/:workspaceId/...`. For GraphQL,
which has no path, it comes from the resolver's declared scope and its
`organizationId`/`workspaceId` arguments. Features answer *may I*, and limits
answer *how many*. The details are in DESIGN-NOTES Part 4 and
`packages/module-permissions/README.md`.

## Conventions

- **Biome only**: no ESLint or Prettier. The pre-commit hook formats staged files.
- **Conventional commits**, checked by commitlint:
  `feat(module-queuing-window): …`, `fix(web-server): …`,
  `test(web-app): …`. The scope is the package directory name.
- ESM throughout. Relative imports in packages end in `.js`.
- Shared dependency versions go in the pnpm `catalog:` in `pnpm-workspace.yaml`.
  Nest, `@nestjs/graphql` and `graphql` **must** come from the catalog: a
  second copy breaks `instanceof` checks and the GraphQL metadata registry at
  runtime.
- Comments explain **why** and name the failure they prevent. The existing code
  comments heavily and precisely, so match that. `turbo.json` and `biome.jsonc`
  are JSONC, so comment them too.
- Never edit generated files: `apps/web-server/src/generated/`,
  `apps/web-server/prisma/_modules/`, `apps/web-app/next-env.d.ts`.
- Seeders are idempotent (upsert, never create blindly) and never delete
  reference rows; they deprecate them instead.
- `apps/web-server/seed-data/snapshot.json` is public. Never put real customer
  data or credentials in the dev database.
- Secrets live in env profiles, `envs/<name>/*.env` (gitignored), which
  `pnpm env:use` links to `.env.local` in each app (`apps/web-server/.env.local`,
  `apps/web-app/.env.local`).
  Document a new variable in the matching `.env.example` with an EMPTY value if
  it is secret (a pre-commit check enforces it), and validate it in that app's
  `src/config/env.ts`. Never read or print a profile's secrets unless asked.
