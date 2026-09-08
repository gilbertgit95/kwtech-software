# kwtech-software — Monorepo Plan

**Living document.** Single source of truth for how this repo is put together.
Updated at every step: decisions move out of §11 (Open) into the section they
affect, and every change gets a line in §12 (Decision log).

Open review: **[PERMISSIONS-REVIEW.md](PERMISSIONS-REVIEW.md)** — three critical
tenant-isolation holes and the missing write path. Read before building on the
permissions module.

Companion: **[DESIGN-NOTES.md](DESIGN-NOTES.md)** — the reasoning behind these
decisions, the alternatives rejected, and the things that turned out wrong after
being built. This file is the *what*; that one is the *why*.

Reference repo: **`../masterdb-mgt-tool`** — the newest of the Sensorbee repos and
the template for toolchain, conventions and versions here. `../coseller-mono` is
consulted only where masterdb has not built something yet (notably GraphQL, §6).

Last updated: 2026-09-07

---

## 1. Scope

**Initial build — four workspaces.**

| Workspace | Package | What it is | Host |
|---|---|---|---|
| `apps/web-server` | `@kwtech/web-server` | NestJS — GraphQL + subscriptions + REST | container host (§5) |
| `apps/web-app` | `@kwtech/web-app` | Next.js — the web frontend | Vercel |
| `packages/module-kit` | `@kwtech/module-kit` | The module contract every app composes (§9) | — |
| `packages/web-ui` | `@kwtech/web-ui` | React + Tailwind 4 + AG Grid Community | — |
| `packages/module-permissions` | `@kwtech/module-permissions` | The permissions feature, whole — schema, logic, GraphQL, server, React (§9) | — |
| `packages/module-auth` | `@kwtech/module-auth` | The authentication feature, whole — identity tables, credentials, tokens, REST, React (§9) | — |

**Planned, not built yet:** `packages/db` (Prisma — see the note below),
`apps/admin`, `apps/worker`, `apps/cli`, `packages/mobile-ui`.

⚠️ **A Prisma home is missing from that list and Phase 1 blocks on it.**
`web-server` cannot reach Postgres without somewhere for the schema and
generated client. But see §9: apps may sit on **different databases**, so the
question is not "add `packages/db`" but "one schema per database" — a db package
per database, or each server app owning its own. §12.2.

Business logic lives in packages — never inside a Next.js app — so that the
second server app, the worker and the CLI can all reach it.


## 2. Toolchain — follows masterdb-mgt-tool

| Concern | Choice | Note |
|---|---|---|
| Package manager | **pnpm 11.18.0** (`packageManager` field) | `engine-strict=true` in `.npmrc` |
| Node | **>= 22** | |
| Task runner | **Turbo 2.10.8** | `turbo.json` is JSONC — comment the non-obvious |
| Lint + format | **Biome 2.5.6** — one tool, no ESLint, no Prettier | `biome.jsonc` at root; every package's `lint` is `biome check .` |
| TypeScript | catalog **7.0.2**; `tsconfig.base.json` at root | no `typescript-config` package — packages extend the base file directly |
| Git hooks | **lefthook 2.1.10** + **commitlint 21** (conventional commits) | |
| Dev ports | 8080 API, 8081 web — freed by `scripts/dev-ports.mjs` before `turbo run dev` | turbo isolates each task in its own process group, so an unclean stop orphans them still-listening; §13 |
| Versions | pnpm **`catalog:`** for `typescript` and `@types/node` | |

Two pnpm 11 mechanisms inherited deliberately:

- **`allowBuilds`** — install scripts run only for allowlisted packages
  (`prisma`, `@prisma/engines`, `lefthook`). Do not add entries without a reason.
- **`minimumReleaseAge`** — supply-chain quarantine on freshly published
  packages. When a package must be let through early, pin the exclusion to the
  exact version, never the bare name.

**Install works.** pnpm 11.18.0 on Node 24.12.0, resolved via corepack; §12.1
is closed. Two things that bit on the first real install, worth knowing before
the next one:

- **`minimumReleaseAge` rejected the committed lockfile**, not a dependency —
  `picomatch@4.0.7` had been published inside the quarantine window when the
  lock was written. The fix is a fresh resolution (delete `pnpm-lock.yaml`,
  reinstall), which picks the older, policy-clean version. Pinning an exclusion
  would have been the wrong lever: nothing needed *that* version.
- **`pnpm install` needs `CI=true`** in a non-TTY shell when the modules
  directory must be purged, or it aborts rather than prompt.

## 3. Stack — DECIDED

Versions anchored to what masterdb-mgt-tool ships today.

### Backend — `apps/web-server`

| Concern | Choice | Note |
|---|---|---|
| Framework | NestJS **11.1.29** (pinned exact, as masterdb does) | |
| HTTP adapter | `@nestjs/platform-express` 11 | |
| GraphQL | `@nestjs/graphql` 13 + `@nestjs/apollo` 13 + `@apollo/server` 5 | **code-first**; new ground for these repos — see §6 |
| Subscriptions | `graphql-ws` 6 + `graphql-subscriptions` | see §5, §7 |
| REST | Nest controllers + `@nestjs/swagger` | emits `openapi.json` (§6) |
| Validation | **zod 4** via a validation pipe | masterdb's choice — see §11.4 for the tension with code-first GraphQL |
| ORM | **Prisma 7.9.1** + `@prisma/adapter-pg` + `pg` | driver adapter, no Rust engine (§4) |
| Database | PostgreSQL | pooled connection required (§5) |
| Auth | `jsonwebtoken` + Nest guards | masterdb skips passport entirely |
| Rate limiting | `@nestjs/throttler` | |
| Tests | Jest 30 + `@swc/jest` + `supertest` | swc, not ts-jest |
| TypeScript | **6.0.3**, not the catalog's 7.0.2 | masterdb pins its backend down; see §11.5 |

### Frontend — `apps/web-app`, `apps/admin`

| Concern | Choice | Note |
|---|---|---|
| Framework | **Next.js 16.3.1** + React **19.2.8** | App Router |
| Styling | **Tailwind 4.3.3** + `@tailwindcss/postcss` + `tw-animate-css` | v4 CSS-first config (`@theme` in `globals.css`), no `tailwind.config.js` |
| Components | Radix primitives + `cva` + `clsx` + `tailwind-merge` + `lucide-react` + `sonner` + `next-themes` | shadcn-style, hand-owned |
| GraphQL client | **`@apollo/client` 4.2.12** | v4 — API differs from the v3 in coseller-mono |
| Subscriptions | `graphql-ws` 6.2.1, split link alongside the HTTP link | |
| GraphQL types | `@graphql-codegen/cli` 7 + `typescript` 6 + `typescript-operations` 6 + `typescript-react-apollo` 5 | generated hooks |
| REST client | `openapi-typescript` + `openapi-fetch` | §4 |
| Grids | **`ag-grid-community` + `ag-grid-react` 36.1.0** | Community only — §8 |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` | |
| Auth | `next-auth` **5.0.0-beta.32** (Auth.js) | masterdb runs the v5 beta; §11.6 |

### Packages

`@kwtech/db` (Prisma schema + generated client — the only DB access point),
`@kwtech/core` (framework-free business logic), `@kwtech/web-ui` (components,
Tailwind theme, AG Grid wrapper), `@kwtech/api-types` (generated OpenAPI types +
`openapi-fetch` client).

Note masterdb has **no** `eslint-config`/`typescript-config`/`env` packages —
Biome and `tsconfig.base.json` replace the first two, and env parsing lives in
each app. Follow that; do not reintroduce config packages.

## 4. Prisma 7 — what changes

- The client is generated as **TypeScript source** (into `src/generated/`), with
  no Rust query engine to download. Consequence: `src/generated/**` **must** be
  listed in turbo's `build.outputs`, or a cache restore yields a package that
  cannot compile. Already wired in `turbo.json`.
- Connections go through a **driver adapter** (`@prisma/adapter-pg` over `pg`),
  which is also what makes the pooling story in §5 workable.
- `prisma.config.ts` resolves `env('DATABASE_URL')` eagerly, so `prisma generate`
  needs the variable present even though it opens no connection — hence
  `passThroughEnv: ["DATABASE_URL"]` on `build` rather than `env`.

## 5. Deploy topology — Vercel does not fit the backend

**NestJS cannot run on Vercel as specified.** Vercel runs serverless functions:
no always-on process, no persistent connections. `graphql-ws` subscriptions
therefore cannot work there, and the failure is silent — connections simply never
establish.

Locally: the API is **:8080** and the web app **:8081** — clear of the other
Sensorbee repos on one machine (coseller-mono holds 3000/3001, masterdb
3002/3003), so everything can run at once. `pnpm dev` starts both plus every
package in watch mode.

```
Vercel                    Container host (Railway / Fly / Render / ECS)
  apps/web-app              apps/web-server  ← HTTP + WebSocket, always on
  apps/worker      ← queue consumers, cron
        │                          │
        └──── GraphQL / WS / REST ─┘
                     │
              Postgres (pooled)  +  Redis (§7)
```

Consequences to design for:

- **Cross-origin auth.** Frontends and API on different hosts: cookies need
  `SameSite=None; Secure`, or use bearer tokens. Applies to the WS handshake too.
- **`NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL`** are inlined at build time on
  Vercel — changing hosts means a redeploy. They are declared in the `build.env`
  of both Next apps so turbo hashes them.
- **Postgres must tolerate connection churn** — Neon, Supabase, or PgBouncer in
  front of RDS. §11.3.
- `apps/worker` is nearly free once `apps/web-server` has a host: same image, different
  entrypoint.

## 6. Contracts and codegen

Two generated contracts, both flowing backend → frontend. Neither is
hand-written; neither is edited by hand.

```
Nest GraphQL resolvers  ──code-first──▶  schema.graphql  ──graphql-codegen──▶  typed hooks
Nest REST controllers   ──@nestjs/swagger──▶  openapi.json  ──openapi-typescript──▶  API types
```

Wired into `turbo.json` so the graph enforces ordering: `@kwtech/web-server#schema:generate`
produces both artifacts; each frontend's `codegen` depends on it; `build` and
`typecheck` depend on codegen.

**REST client — recommended:** `openapi-typescript` + `openapi-fetch`, generated
from the Swagger document. Types derive from the Nest DTOs, so a backend change
breaks the frontend build instead of failing at runtime; `openapi-fetch` is a thin
typed wrapper over `fetch` that works in Server Components. **Add
`@tanstack/react-query` only when REST data actually needs caching or refetching**
— alongside GraphQL, REST usually settles into uploads, exports and webhooks,
where a second cache layer is dead weight. (`orval`/`kubb` generate React Query
hooks from OpenAPI if that changes. Not axios on the client — bundle weight, and
it discards the type inference that is the whole point.)

⚠️ **This is new ground.** masterdb's backend is REST-only today: it has no
`@nestjs/graphql`, no `schema.graphql`, and its frontend `scripts/codegen.mjs`
exists purely to *skip* codegen until a schema appears. The GraphQL server
patterns must come from `coseller-mono` (Nest 11 + `@nestjs/graphql` 13 +
`@apollo/server` 5, proven there) and be paired with **Apollo Client 4** on the
frontend, which coseller has not run. Budget real time for that seam in Phase 3.

## 7. Realtime

- Subscriptions ride `graphql-ws` over one WebSocket, sharing auth with HTTP via
  a connection-init token check in the Nest WS context.
- `graphql-subscriptions`' in-memory `PubSub` serves **one** API instance only.
  The moment `apps/web-server` scales past one replica, swap in Redis-backed pub/sub
  (`graphql-redis-subscriptions`) — resolver code does not change. Plan the Redis
  dependency now, adopt it at scale.
- Prefer subscriptions over a second raw socket.io gateway. One transport is
  cheaper than two.

## 8. AG Grid Community — what you give up

masterdb already runs **Community 36.1.0**, so it is the model here (unlike
coseller-mono, which is Enterprise — grid code copied from *that* repo will not
run). Enterprise-only, therefore off the table:

- Server-Side Row Model, row grouping, pivoting, aggregation
- Master/detail, tree data, range selection, clipboard
- Set filter, columns tool panel, context menu, Excel export (CSV export is Community)

Practical consequences:

- Large datasets use the **Infinite Row Model** (Community) over cursor or offset
  pagination from GraphQL — not the Server-Side Row Model.
- Register modules explicitly and once, in a `'use client'` module:
  `ModuleRegistry.registerModules([AllCommunityModule])`.
- v33+ uses the **Theming API** (JS theme objects), not the old CSS files. Build
  one shared theme in `@kwtech/web-ui` mapped to the Tailwind v4 `@theme` tokens so
  web and admin match.
- Wrap it: apps import `<DataGrid>` from `@kwtech/web-ui`, never `ag-grid-react`
  directly. That keeps an Enterprise upgrade — or a swap to TanStack Table — to
  one file.

## 9. Modular features — the `module-*` pattern

A `module-*` package is a **whole feature, vertically**: its data model, its
domain logic, its GraphQL surface, its server wiring and its React components.
A consuming app declares the dependency and wires two lines. It does not define
the feature's types, reimplement its logic, query its tables, or rebuild its
components — they already exist, once.

`@kwtech/module-permissions` is the first instance and the template.

```
packages/module-permissions/
  prisma/permissions.prisma   @kwtech/module-permissions/prisma   schema fragment
  src/index.ts                @kwtech/module-permissions          pure. zero dependencies.
  src/domain/                  ↳ entities, processes, decisions
  src/server/                 @kwtech/module-permissions/server   Nest module, guard,
                                   service, GraphQL object types + resolver
  src/react/                  @kwtech/module-permissions/react    provider, hooks, components
  src/graphql/                @kwtech/module-permissions/graphql  client operation documents
```

### Rules

1. **The pure layer imports nothing.** Types, registry and decisions depend on no
   framework — which is what lets a server app, a worker, the CLI, a React
   component and a test share one vocabulary.
2. **Framework dependencies are optional `peerDependencies`.** A server app that
   imports the core and `/server` never installs React; a browser bundle never
   pulls Nest.
3. **`/react` may import the core, never `/server`.** That one rule is what keeps
   server code out of the client bundle.
4. **The module owns its models and prefixes them.** `Perm*` classes, `perm_*`
   tables, so a fragment drops into any app's schema without colliding.
5. **The module must not own identity.** `PermSubjectRole` references a subject
   by id with no foreign key — the users it grants against may live in a table,
   or a service, it has never heard of.
6. **Apps configure; modules publish a contract.** `forRoot({ resolveSubjectId })`
   — say where the caller's id lives and the module does the rest. A module may
   document environment variables it will read (`API_URL`, `AUTH_JWT_SECRET`)
   and default to them: that is a contract an app opts into, not a guess, and it
   is what keeps adoption to two lines. It may never default a **secret** — no
   value, only a documented source and a boot failure without one. §13.
7. **Fail closed.** Absent context denies; a `<FeatureGate>` with no keys renders
   its fallback, because an empty gate that renders looks guarded in review while
   guarding nothing.
8. **A module earns a package when a second app needs it.** Before that it lives
   in the app that uses it. Extracting on speculation is how package directories
   fill with abstractions nobody wanted.

### Database independence

**A module never opens a connection.** No `@prisma/client` dependency, no
`DATABASE_URL`, no client of its own. `PermissionsService` depends on
`PermissionsPrismaClient` — a *structural* interface — and the host injects
whatever satisfies it:

```ts
{ provide: PERMISSIONS_PRISMA, useExisting: PrismaService }
```

Consequences, all of them wanted:

- **Two apps consuming the same module can sit on two different databases**, and
  neither knows about the other's. The connection is app-owned, always.
- The implementation need not be Prisma at all — anything matching the shape
  works, so the service is testable against a literal object with no database.
- Structural typing also breaks what would otherwise be a cycle: an app's db
  package composes the module's schema fragment, so a package-level import in the
  other direction would close the loop. **Modules never import a db package.**

What each consuming app owes the module: **its database must have the module's
tables.** Composition is a build step that copies `packages/module-*/prisma/*.prisma`
into that app's Prisma schema folder — a file-level dependency, not a package
one. An app on its own database composes and migrates its own copy.

⚠️ This revises the earlier single-`packages/db` assumption: with apps on
different databases there is **one schema per database**, not one per repo.
Either a db package per database, or each server app owning its schema and
client. Decide at §12.2 — but the module is unaffected either way, which is the
point.

### Registration is composition, not wiring — `@kwtech/module-kit`

A module declares what it publishes; the app lists its modules once; everything
else derives. `@kwtech/module-kit` owns that contract so it is written once
rather than per module — the tenth module is the same one-line edit as the second.

```ts
// apps/web-server/src/modules.ts
export const SERVER_MODULES = [permissionsServerModule({ … }), usersServerModule({ … })];
// apps/web-app/src/modules.ts
export const WEB_MODULES = [permissionsWebModule, usersWebModule];
```

**Server — automatic, and natively so.** Nest registers a module's `controllers`
and resolver `providers` on import; `module-kit` only removes the per-module
boilerplate. From that one list an app gets REST routes (and therefore
`openapi.json` entries, and therefore generated frontend REST types), resolvers
joined into the code-first schema, guards and services injectable, and
`composeFeatures()` for the seed task. `PermissionsModule.forRoot({ expose })`
turns either transport off — a worker importing the module for its service alone
wants neither.

**Web — partly.** Next.js discovers routes from the filesystem under `app/` and
has no plugin API; a package cannot inject a route. Everything *except the file*
can still live in the module — component, path, title, required feature, nav
entry — declared as data in `WebModuleDescriptor`. Navigation and middleware
protection then genuinely are automatic, and derive from the same declaration,
which is what stops a menu linking somewhere the guard refuses.

Three ways to get pages rendered, differing only in how the file arrives:

| | How | Cost |
|---|---|---|
| **A. Catch-all** | one `app/(modules)/[[...slug]]/page.tsx` resolving `matchRoute()` | zero per-route work; loses per-route `metadata`, `generateStaticParams`, segment config, nested layouts |
| **B. Thin re-export** | `export { RolesPage as default } from '…/react'` per route | full Next static analysis; one hand-written line per route |
| **C. Generated stubs** | a `routes:sync` script writes B from the composed routes | B's fidelity, A's ergonomics; a generation step and generated files |

Start at **A**, move to **C** when routes multiply or need per-route metadata.
The module and every helper are identical across all three, so switching is
mechanical and never a module rewrite. §12.11.

**Composition fails loudly.** Duplicate route paths and duplicate feature keys
throw at composition time, not at first request — two modules quietly owning one
path is the failure the kit exists to catch.

### One real constraint: GraphQL hooks generate app-side

The module's resolvers are part of the schema the server emits, so generating
typed hooks *inside* the module would need the schema the module helps produce —
a build cycle. So the module ships `.graphql` documents and presentational
components, and apps widen their codegen `documents` glob:

```yaml
documents:
  - 'src/**/*.{tsx,graphql}'
  - '../../packages/module-*/src/graphql/*.graphql'
```

If typed hooks must live inside a module, split it in two —
`module-permissions` (server + domain) and `module-permissions-web` (React +
generated hooks). The DAG then resolves cleanly:
`module-permissions#build → web-server#schema:generate → module-permissions-web#codegen → web-app#build`.


## 10. Repo layout

```
apps/
  web-server/     NestJS — GraphQL + WS + REST          ← initial
  web-app/        Next.js — web frontend                ← initial
  admin/  worker/  cli/                                    later
packages/
  web-ui/               React + Tailwind 4 + AG Grid wrapper   ← initial
  module-kit/           the module contract + composition (§9)  ← initial
  module-permissions/   the permissions feature, whole (§9)    ← initial
  db/                   Prisma schema + client (one per database, §9)  Phase 1
  mobile-ui/                                                      later
biome.jsonc         lint + format, whole repo
tsconfig.base.json  compiler options every package extends
turbo.json          task graph (JSONC — comments expected)
lefthook.yml        pre-commit biome, commit-msg commitlint
```

**Rules.** Apps depend on packages, never the reverse. Only `@kwtech/db` imports
the Prisma client. A package's pure layer imports no framework (§9). Import
public entrypoints and declared subpaths, never deep paths into another
package's `src/`. Shared versions go in the pnpm `catalog:`.

### Naming

Three prefixes, three meanings:

| Prefix | Means | Examples |
|---|---|---|
| `web-` / `mobile-` | **platform-bound** — nothing survives a platform change | `web-app`, `web-server`, `web-ui`, later `mobile-ui` |
| `module-` | **a whole feature, vertically** — schema, logic, GraphQL, server, React (§9) | `module-permissions` |
| (none) | shared plumbing with no feature of its own | `db`, `module-kit` |

`module-` resolves the problem the earlier `web-permissions` name had: a
permissions core is not web-specific, and prefixing it `web-` meant a future
mobile app either imported a package whose name lied or forked the registry. A
`module-*` package is platform-neutral at its core and grows platform adapters
behind subpaths — `/server`, `/react`, later `/native` — so mobile is an added
adapter, never a second copy of the feature.


## 11. Build order

- **Phase 0 — done.** Turborepo + pnpm scaffold on masterdb's toolchain (Biome,
  `tsconfig.base.json`, lefthook, commitlint, catalog). `@kwtech/web-ui` and
  `@kwtech/module-permissions` scaffolded: registry, checks, Nest adapter, React adapter.
- **Phase 1 — Prisma home. DONE, except the migration.** §12.2 closed the other
  way: **`apps/web-server` owns its schema and client**, not `packages/db`.
  `scripts/compose-schema.mjs` copies each module's fragment into
  `prisma/_modules/`, `prisma.config.ts` holds the URL (Prisma 7 moved it out of
  the schema), and `prisma generate` produces the TS client. The first
  `migrate dev` still needs a Postgres to run against — nothing here has been
  applied to a database yet.
- **Phase 2 — `apps/web-server` skeleton. DONE.** Hand-written rather than
  `nest new` (the CLI's generator adds nothing the plan had not already
  decided). PrismaService, health check, Swagger, global JwtAuthGuard +
  ThrottlerGuard + FeatureGuard, both modules wired. Boots, maps every route
  from both modules with no wiring in the app, and answers 200/401/400
  correctly — verified with curl, not assumed.
- **Phase 3 — GraphQL layer.** `@nestjs/graphql` code-first, one resolver,
  `schema.graphql` emitted, codegen wired into turbo, Apollo Client 4 consuming
  it. **Highest-risk phase: no existing repo runs this pairing.**
- **Phase 4 — `apps/web-app` vertical slice. PARTLY DONE.** Next 16 app with
  Tailwind 4 via `@kwtech/web-ui/styles.css`, the module catch-all route
  (§12.11 strategy A) and the three auth pages rendering. NOT Auth.js — §12.8
  closed the other way (below). **The app shell now exists** — main header,
  collapsible side drawer, account dropdown, Light/Dark/System toggle — with
  navigation composed from `WEB_MODULES` and filtered by the viewer's grants,
  and `PermissionsProvider` mounted from a server-resolved context. A real
  feature end to end is still to come.
- **Phase 5 — first grid.** `<DataGrid>` in `@kwtech/web-ui`, Infinite Row Model
  over a paginated GraphQL query, shared theme.
- **Phase 6 — permissions for real.** ~~Grants persisted~~ (done: the write path
  exists and is tested), seed task upserting the registry — which is what finally
  calls `auditRegistry()`, `assertRegistered()` and `assertPlanLimits()` —
  `<FeatureGate>` on a live control, ~~navigation filtered by the same keys~~
  (done: the side drawer filters on `composeNav(WEB_MODULES, granted)`, fed by
  `GET /permissions/me`). Still open: the seed task, `middleware.ts`, and the
  role editor's body.
- **Phase 7+ — later scope.** `apps/admin` (extract into `web-ui` driven by what
  the two apps genuinely share), realtime subscriptions, `worker`, `cli`,
  then CI/Docker/remote cache.

Phases 3 and 6 carry the risk. The rest is largely transcription from masterdb.


## 12. Open decisions

| # | Decision | Blocks | Notes |
|---|---|---|---|
| 1 | ~~Upgrade local pnpm to 11~~ **Closed** | — | pnpm 11.18.0 in place; install, typecheck, build and lint all green |
| 2 | ~~Where Prisma lives~~ **Closed** | — | **`apps/web-server` owns its schema and client.** Module fragments compose into it; extract `packages/db` only when a second app needs the same database |
| 3 | `module-permissions`: where the principal comes from | Phase 2 | the module resolves grants itself; the app supplies only `resolveSubjectId` (§9 rule 6) |
| 4 | Container host for `web-server` | Phase 2 deploy | Railway / Fly / Render |
| 5 | Postgres host — must be pooled (§5) | Phase 1 | Neon / Supabase / RDS+PgBouncer |
| 6 | Validation: zod pipe (masterdb) vs `class-validator` (coseller) | Phase 2 | code-first GraphQL needs decorators for *types* either way; zod can still own *validation*. Decide once, not per-module |
| 7 | TypeScript version for `web-server` | Phase 2 | masterdb pins its backend to 6.0.3 while the catalog is 7.0.2 — confirm the reason (decorator metadata) before deviating |
| 8 | ~~`next-auth` 5 beta vs server-issued JWT~~ **Closed** | — | **NestJS-issued JWT.** One issuer and one verification path for REST, GraphQL and the WS handshake; Auth.js would have left the API verifying a session it did not mint |
| 10 | Job platform for `worker`; CI + remote cache | Phase 7+ | coseller uses Inngest |
| 11 | Next route strategy: catch-all vs generated stubs (§9) | Phase 4 | start catch-all; the module is identical either way |
| 12 | ~~Does `module-permissions` own user identity?~~ **Closed: no** | — | Identity lives in **`@kwtech/module-auth`**. `perm_*` still holds `userId` as a bare string with no FK to `auth_user`; the two meet only in the app's `resolvePrincipal` |
| 13 | Where the active organization and workspace come from on a request | Phase 2 | header, subdomain or session — `resolvePrincipal` reads it; the module does not guess |
| 14 | ~~Confirm app-level roles should bypass plan entitlement~~ **Closed: yes** | — | Confirmed 2026-08-30 while seeding `super-admin`. Staff must be able to help a lapsed organization, so this is the one path that ignores billing state. Verified end to end: a super admin resolves all 9 features inside an organization he is not a member of and which has no subscription at all |
| 15 | Should surfaces declare themselves **public**, rather than being public by omission? | Phase 6 | enforcement is opt-in, so an endpoint that should be guarded looks identical to one deliberately open. A `@Public('reason')` marker plus a coverage report would close it, at the cost of annotating every surface |
| 16 | ~~Does `PermWorkspaceMember` earn its place?~~ **Closed** | — | yes: workspaces have members, and workspace roles hang off that membership |
| 17 | A fourth `TokenScope` (`mfa_enrol`) so `AuthUser.mfaRequiredAt` can be enforced | when 2FA is made mandatory | the column is written today and read by nothing. Enforcing it means admitting a half-admitted user to the ENROLMENT endpoints only; without that scope, "required but not enrolled" is a lockout with no way forward |
| 19 | A home for raw-SQL schema extras (partial unique indexes, CHECKs) | before a second app-level role is created by hand | `@@unique([organizationId, key])` on `PermRole` does NOT enforce uniqueness for the rows that matter most: `organizationId` is null for app-level roles and shared presets, and Postgres treats NULLs as **distinct** in a unique index, so two `super-admin` rows can coexist. Closing it needs `CREATE UNIQUE INDEX ... ON perm_role (key) WHERE "organizationId" IS NULL`, which Prisma cannot express — and a hand-written migration would then read as drift on the next `migrate dev`. `upsertAppRole()` in the module refuses loudly on a duplicate as a stopgap |
| 23 | ~~Should the account features gate the settings pages?~~ **Closed: no** | — | **A surface gets a key only when it needs AUTHORISATION, not merely a session.** `/settings/*` needs a session, which `JwtAuthGuard` already requires; the three `account:*` keys were removed and deprecated. See the decision log |
| 21 | Should the feature form be able to declare BINDINGS? | before anyone relies on the create screens | `draftToSpec` emits `bindings: []`, so every feature authored through the UI is "Not enforced anywhere" by construction — the audit flags it and the Features grid says so in its own column. That is honest today, because a binding names a controller handler or a route that does not exist until someone writes it. The alternative is letting the form declare a surface that is not there yet, which is worse: the audit would report coverage for an endpoint nobody wrote. Resolve alongside decision 22 |
| 22 | Should the DATABASE become the source and the registry a cache? | before the create screens write anything | `syncFeatureRegistry` deprecates any `perm_feature` row absent from `FEATURE_REGISTRY`, so a UI-created feature is switched off by the next deploy and `assertRegistered` refuses it meanwhile. Reversing it makes the screens write for real and costs the typed `FEATURE.adminAccess` constants, the build-time `assertRegistered`, and the property that a checkout fully describes what can be granted |
| 20 | Should `ConnectivityMonitor` move to `web-ui` when `apps/admin` appears? | when a second web app exists | it is small and app-shaped today — it names `/api/health` and calls `router.refresh()`, both app decisions. A second app duplicating twenty lines is the cheaper mistake than a shared component that has to take both as options before anyone needs it |
| 24 | ~~Are subscription writes billing-owned, and out of the module?~~ **Closed: reversed** | — | **Reversed 2026-09-06.** They were kept out on the grounds that a billing provider owns `perm_subscription` and the idempotency questions were unanswered; the plan and subscription screens needed them, and the questions are now answered rather than deferred (see the decision log). A provider integrating later must RECONCILE against these rows — read, then supersede what disagrees — rather than assume it is the only writer |
| 25 | Where does a billing provider's webhook write, and who wins a conflict? | before a payment provider is connected | `PermissionsWriteService` now owns the write path and keys idempotency on the live (organization, workspace, plan) row. A provider that writes the same table needs either a `source` column and a precedence rule, or a reconciliation job that treats the provider as authoritative and supersedes admin rows. Precedence is the part teams get wrong, so decide it before the first webhook, not after |
| 26 | ~~Should plans be SEEDED, like app roles are?~~ **Closed: yes, on request** | — | **Reversed 2026-09-07.** They were left unseeded on the grounds that which products a platform sells is an operator decision. They are now seeded as a STARTING catalogue — `free`, `starter`, `pro`, `enterprise` — with `createPlanIfAbsent`, which creates what is missing and never rewrites what is there. Phase 'seed', not 'sync': the operator decision is preserved by the seed getting out of the way, not by there being no seed. Original entry: | app roles are seeded because the SHAPE is fixed and the definitions are product decisions living app-side. Plans are the same shape of thing, and deliberately not seeded today: which products a platform sells is an operator decision, and a seeded `free` plan would be this repo deciding it. The screens create them instead. Revisit if a fresh environment needs a plan before anyone can subscribe anybody |
| 27 | Scope role writes to the actor's organization, and put `roles:create/update/disable` back at organization level | with §12.13 | `createRole` writes `organizationId: null` — a SHARED PRESET every tenant sees — and `listRoles` reads that same null scope, so a role write is a platform operation. The three write keys were raised to APP level on 2026-09-07 to say so. Reversing it needs the active organization on the request (§12.13), which is exactly why `role-draft.ts` cannot offer an organization picker today. Do both together or neither |
| 28 | Redis-backed pub/sub, before `web-server` scales past one replica | before a second replica | `graphql-subscriptions`' in-memory `PubSub` is bound in app.module.ts. An event published on replica A never reaches a socket held by replica B, and the failure is SILENT — half the users simply stop updating. The module depends on the structural `PermissionsPubSub`, so the swap to `graphql-redis-subscriptions` is one provider and no resolver change (§7) |
| 29 | Rate-limiting subscription volume on an open socket | when realtime carries real traffic | `CredentialThrottlerGuard` skips WebSocket operations — it writes rate-limit headers onto a response a socket does not have, and per-request IP limiting is not the question a socket asks. Bounded today only by the handshake needing a live-session ticket and the connection closing at token expiry. Belongs in `graphql-ws`' `onSubscribe`, which can see the connection |
| 30 | ~~A per-workspace member screen, for WORKSPACE-level role grants~~ **Closed** | — | **2026-09-07.** Each workspace on the organization detail screen expands to its members and their workspace roles, and an Add-member dialog picks from organization members not already in it, with an optional workspace role beside it. `assignWorkspaceRole` and `revokeWorkspaceRole` now have a UI. Original entry: | `assignWorkspaceRole` and `revokeWorkspaceRole` are exposed and guarded and reachable only through the API. The organization detail screen already toggles workspace MEMBERSHIP per member; adding a second role picker to that same row is how a screen becomes unreadable, so the grants belong on a workspace's own screen |
| 31 | ~~An invite flow for an address with no account~~ **Closed** | — | **2026-09-07.** `PermInvitation` + `inviteMember`/`revokeInvitation`/`acceptInvitation`, a seven-day single-use token stored as a SHA-256 hash, an app-supplied `sendInvitationEmail` hook, and `/invitations/accept` — which creates the account when there is none. `PermMembershipStatus.invited` is still unwritten and now never will be: an invitation is addressed to an EMAIL, and a membership carries a userId there may not be one of. See the decision log |
| 34 | A composite foreign key tying a workspace membership to ONE organization | with §12.19 (raw-SQL schema extras) | `PermWorkspaceMember` references a MEMBERSHIP and a WORKSPACE independently, so nothing in the schema stops a membership in org A being linked to a workspace in org B. A cross-tenant row was inserted against a live database and surfaced in `accessibleWorkspaceIds`. The read path now filters it (C3's defence, one table over) and the write path always checked it — but the row is still writable. Closing it needs `organizationId` denormalised onto the row plus compound uniques on both parents, which is the same raw-SQL-extras question as §12.19 |
| 33 | ~~How does somebody reach a workspace they were not added to?~~ **Closed: they do not** | — | **2026-09-07.** Workspace membership is REQUIRED; `workspaces:access_all` is removed from the registry. Platform support is the single exemption, because a support engineer holds no membership anywhere. See the decision log |
| 32 | ~~Should the one-role rule extend to APP level?~~ **Closed: yes** | — | **Workspace level: closed 2026-09-07.** `@@unique([workspaceMemberId])` matches the organization rule. **App level: closed 2026-09-08 — one role, enforced by the WRITE PATH rather than by the schema.** `assignAppRole` replaces, and `acceptInvitation` grants only to somebody holding none, so no path produces a second app-level grant. The primary key is `(userId, roleId)`, which still permits a collection, so this is upheld by code where the other two levels are upheld by a constraint — a `@@unique([userId])` can follow when there is a migration to carry it. Decided in the direction that matches the other two: a person is one thing at app level, and `super-admin` + `normal-user` at once would be incoherent |
| 35 | The seat cap is not checked when an invitation is ACCEPTED | when a plan's seat cap is enforced commercially | `assertCapacity` reads the ACTOR's resolved limits, and on the accept path there is no actor — the person joining holds nothing. So an invitation sent when there was room can be accepted after there is not, and the organization ends up one seat over. The honest fix is to check at invite time AND again on accept, and the second needs a limit lookup that does not go through a `PermissionContext` |
| 36 | Sign-up exists only through an invitation | when self-service registration is a product decision | `AuthService.createAccount` is a METHOD with no route: the only thing that calls it is `signUpFromInvitation`, which supplies the address from the invitation rather than from the form. There is no public registration page and adding one is a product decision with a spam problem attached — not something to arrive at by leaving an endpoint exposed. Note what an open endpoint would also be: `createAccount` says plainly that an address is taken, which is an enumeration oracle anywhere but behind a token |
| 37 | ~~An app-level role can be GRANTED to nobody: `perm_user_role` has no write path~~ **Closed** | — | **2026-09-08.** `assignAppRole` behind a new `roles:grant_app` key, plus `inviteUser`, which carries the chosen role on the invitation and applies it at acceptance. Both refuse a role carrying features the granter does not hold, so neither can be used to mint somebody more powerful than yourself. Original entry: | `assignRole` writes `perm_membership_role` and takes an `organizationId`; nothing writes `perm_user_role` at all, so the two app-level grants in the live database were inserted by hand. `roles:manage_app` guards WRITING an app-level role, not granting one — a different act, and currently an unguarded impossibility rather than a hole. The user detail screen is the first surface that wants it, and the key is permissions-side (`roles:*`), not `users:*`: it grants a role, it does not change an account |
| 38 | Deleting an account orphans its permission rows | if an erasure path is ever built | `perm_membership.userId` has no FK to `auth_user` by design (§12.12), so `DELETE FROM auth_user` leaves memberships and role grants pointing at nobody — verified by hand three times on 2026-09-08 removing test accounts, each needing an explicit membership and `perm_user_role` delete first. `findUsersByIds` and `listAppRolesForUsers` both tolerate the orphan by returning fewer rows than asked for. **No longer urgent: `users:delete` was removed the same day and the product has no delete at all** — an account is suspended, which keeps every row and is reversible. This stays open because the hazard returns the moment somebody builds an erasure path for a legal request, and because deleting by hand in a console hits it today. The composed delete belongs in the APP, the only layer allowed to touch both modules' tables |
| 39 | Nothing in `apps/web-app` opens the realtime socket | when a module is built on it | The API half is complete and running — `graphql-ws` subscriptions on the same URL as HTTP, a ticket verified at `onConnect`, `planChanged` published, `NEXT_PUBLIC_WS_URL` set in both env files — and the app never calls `createRealtimeConnection`, so `PlansPage` receives no `realtime` prop and nothing listens. **Decided 2026-09-08: leave it.** `module-auth` and `module-permissions` stay on HTTP; realtime arrives as its OWN module, which is what the seam was built for — `onConnect` shapes the socket into the same `{ req }` an HTTP request produces, so `FeatureGuard` and `resolvePrincipal` are transport-blind and a new module's subscriptions are guarded like its queries. When it lands: the APP owns the one connection and passes it in (a `createRealtimeConnection` per module means a socket per module per tab), the `graphql-ws` import sits behind a subpath, the ticket path is an option rather than a hardcoded reference to module-auth's URL, and the subscription gets its own `graphql_subscription` binding. §12.28 and §12.29 become live the day it does |
| 40 | Billing is unbuilt: nothing charges, and `currentPeriodEnd` is informational | when a payment provider is chosen | **Not to be built before the provider is.** Stripe, Paddle and manual invoicing imply genuinely different tables — Paddle is a merchant of record and handles tax, Stripe is not and does not — and guessing that shape is how a schema ends up fighting the integration. What IS decidable now, and was, on 2026-09-08: billing gets its OWN module, referencing `organizationId` and `planKey` as bare values with no foreign key, exactly as `perm_membership.userId` references an account. Roughly `BillingCustomer` (organization ↔ provider customer), `BillingPrice` (planKey → amount, currency, interval), `BillingInvoice`/`BillingPayment`. **Price does NOT go on `PermPlan`:** a plan is a bundle of entitlements and its price is commercial — currency, regional pricing, per-seat vs flat, promotions — so merging them makes every price change a permissions migration, puts "what Pro entitles" and "what Pro costs" in one row two teams edit, and makes a grandfathered customer paying last year's price for today's entitlements inexpressible. **No FK into `perm_subscription` either:** §12.24 already settled that a provider RECONCILES against those rows rather than owning them, so the seam is a webhook landing in the APP, which reads its billing rows and calls `PermissionsWriteService.updateSubscription` — the composition `resolve-principal` and the invitation resolvers already use. ⚠ Until it exists, a lapsed subscription KEEPS ENTITLING: `currentPeriodEnd` is written and rendered and never compared to `now`, because `status` decides entitlement so a clock cannot revoke a tenant with no row saying why. Nothing writes that status on a lapse — there is no scheduler in `web-server` — so the renewal date on the organization screens promises an enforcement that does not exist, and saying so on those screens is a cheap fix available before the module is |
| 18 | WebAuthn as a second factor type | Phase 7+ | `AuthMfaFactorType.webauthn` exists and every query pins `type: 'totp'`, so adding it is a code change and not a migration. It stores a public key, so it needs none of `secret-box.ts` |

Decisions 1, 2, 3 and 5 gate the next step.


## 13. Decision log

- **2026-09-08** — **The user screens say where somebody belongs, not only what
  they may do.**

  The account pages could report the PLATFORM role and nothing about which
  customers a person is inside — usually the first question about an account.
  Neither existing read answers it: `listOrganizations` returns every tenant and
  `organizationDetail` goes tenant-to-members. `listOrganizationsForUsers` goes
  the other way, batched by id, active memberships only.

  **The names go on the detail page; the grid gets the count.** A count alone
  only prompts "which ones", and answering that needs the detail page anyway —
  so the panel names each organization and the role held in it, and the column
  exists mainly for its ZERO. That zero is drawn as "Platform only" rather than
  as `0`, because a bare digit reads as missing data where the state is a real
  and now-common one: a platform invitation names no tenant at all.

  **Guarded by `organizations:read`, not `users:read`.** It discloses tenant
  membership — who is inside which customer — which is the fact the organization
  screens are already guarded on. Somebody who may administer accounts has not
  thereby been told which companies each person works for.

  ⚠ The consequence is that "no organizations" and "not allowed to know" are
  indistinguishable in the browser, because the client fails soft to an empty
  list like every other convention-named call. The panel therefore states the
  common case plainly and does not assert the other.

- **2026-09-08** — **An invitation can be refused, without an account and
  without signing in.**

  The accept page offered exactly one answer. Somebody who did not want to join
  could only ignore the link and leave the invitation live until it expired,
  which also leaves the sender unable to tell "they said no" from "they never
  looked".

  `declineInvitation` takes the token and nothing else. **`@Public`**, and that
  is the decision worth stating: requiring an account in order to refuse an
  invitation to create one would be absurd, and the mutation writes nothing
  about anybody — it closes the offer. It concedes nothing the accept path had
  not already conceded, because whoever holds the token can consume the
  invitation either way.

  The resolver is in the APP for the usual reason: `@Public` is module-auth's
  decorator and `PermissionsWriteService` is module-permissions', so a handler
  that is both unauthenticated and writes an invitation row can live nowhere
  else. It joins `invitationPreview` and `signUpFromInvitation` in that file, and
  the app's allowlist test — which pins every `@Public` handler this app owns —
  failed until it was added deliberately, which is what that test is for.

  **`declined` is its own status, not another `revoked`.** One is the sender
  withdrawing, the other the recipient refusing; they are different answers to
  why somebody never joined, and a members screen showing one for both would be
  quietly wrong about a person. `declinedAt` sits beside `acceptedAt` and
  `revokedAt` for the same reason — a shared "closedAt" cannot say which
  happened. Enum value plus nullable column, additive migration.

  **The control is quiet on purpose.** A text link under whatever the page is
  proposing, on every branch that makes an offer — including the one where the
  reader has no account, which is where it matters most. Declining is a
  legitimate answer and must be findable; it is not the answer the page is for,
  and a second prominent button beside Join would present the two as equals. It
  confirms first, because there is no un-decline.

- **2026-09-08** — **An invitation may GIVE an app-level role. It may never
  change one.**

  Asked for directly, and it closes the demotion hazard at the write path
  instead of at the screen. Acceptance used to replace whenever the invitation
  named a role, on the reasoning that replacing is what the inviter asked for.
  That reasoning holds for `assignAppRole` on the Users page, where the
  administrator is looking at the account and the role it currently holds. It
  does not hold for an invitation: the inviter is looking at an ADDRESS, may not
  know it belongs to anybody, and the platform invite form defaults to the
  LEAST-privileged role — so an invitation sent to an existing super admin would
  have demoted them the moment they followed the link, silently, with one click.

  So `acceptInvitation` now grants an app-level role only to somebody holding
  none, whether the role came from the invitation or from `defaultAppRoleKey`.
  The organization role is untouched by this and still replaces, which is
  correct: that decision is made on a screen showing the member list.

  **"Holds none" rather than "the account is new".** The literal rule is that
  only a user who did not exist yet gets a role from an invitation, and this
  module cannot evaluate it — it may not read `auth_user`, so it cannot tell
  whether an id is a second old. It can see what that id HOLDS, and a brand-new
  account holds nothing by construction, so the two sets coincide. Where they
  differ — an old account that never had an app role — filling the hole is the
  same act the baseline performs and the same one that stops somebody landing on
  a settings page they cannot use.

  The alternative was a flag from the app saying "I just created this", which
  the module would have to trust. This version is enforced with data the module
  owns.

  It also upgrades yesterday's advisory: the invite forms refuse an address that
  already has an account, but that check reads `auth_user` and is the app's. The
  guarantee is now in the write path, so calling the mutation directly cannot
  demote anybody either.

- **2026-09-08** — **`graphql-ws` moves behind its own subpath, because an
  optional peer a barrel imports is not optional.**

  Found by asking whether the packages declare peer dependencies. They do,
  extensively, and every app satisfies exactly the peers for the entrypoints it
  uses — except one. `graphql-ws` is an optional peer of `module-permissions`,
  and `plans-page.tsx` imported `PLAN_CHANGED` from the module that opens the
  socket. A string. That one value put `graphql-ws` on the require graph of the
  `/react` barrel, which `apps/web-app` imports in three places while declaring
  no such dependency.

  It worked only by accident of the workspace: the module resolves it from its
  own `node_modules`, where it sits as a DEVDEPENDENCY. Published to a registry,
  devDependencies are not installed and the unmet optional peer would fail to
  resolve — for a feature the consumer may never use.

  **The contract splits from the client.** `react/realtime-contract.ts` holds
  the option and connection shapes, the ticket path and the subscription
  documents, and is exported from `/react`;
  `@kwtech/module-permissions/react/realtime` holds
  `createRealtimeConnection`, the only code in the package that imports the
  library. A page can name a document and TYPE a connection it was handed
  without installing a WebSocket client.

  Verified by walking the built require graph: 48 files reachable from the
  `/react` barrel, none importing `graphql-ws`; the subpath reaches two more,
  one of which does.

  Nothing in `apps/web-app` uses realtime at all today — every data request in
  the app is an HTTP POST to `/api/auth/graphql` — so the app needed no new
  dependency and the alternative fix, declaring `graphql-ws` there, would have
  made every consumer carry a socket client to render a roles table.

- **2026-09-08** — **Inviting somebody who already exists is refused, and the
  platform invite drops its organization fields.**

  Asked as a question — what happens if we invite an existing user? — and the
  answer was worse than it looked. Acceptance REPLACES at both levels: an
  invitation naming an organization role replaces the member's, and one naming
  an app-level role replaces theirs. So inviting an existing super admin from
  the platform screen, with its least-privileged default selected, would have
  demoted them to `normal-user` the moment they followed the link. Same shape as
  the bug that demoted an owner this morning, one level up, arriving by a
  different door.

  **The fix is at invite time, not at acceptance.** Replacing is what the
  inviter asked for; the problem was that the inviter could not see what they
  were asking. So both screens now refuse rather than warn:

  - the members form refuses an address already in that organization, or already
    holding a live invitation to it — checked against `people`, the
    `findUsersByIds` join the roster already renders, so it costs no request
  - the platform form refuses an address that already has an account, resolved
    through `findUserByEmail` on a 300ms debounce, and says to edit their role
    from the Users page instead

  A failed lookup is UNKNOWN rather than "no account": a check that cannot run
  must not stop somebody inviting.

  ⚠ Both are ADVISORY and will stay that way. Resolving an address to a userId
  means reading `auth_user`, which `module-permissions` may not (§12.12), so the
  write path cannot enforce either. The demotion is therefore still reachable by
  calling the mutation directly, and is documented where the write happens.

  It also corrected a comment that had become false. `InviteSection` said a
  lookup was unnecessary because inviting somebody already in "wastes an email
  and nothing else" — true when it was written, untrue once acceptance began
  replacing the role.

  **The platform invite no longer takes an organization.** It briefly did, with
  an organization-role picker beside it. Adding somebody to a tenant belongs on
  that tenant's screen, beside its member list, its roles and its pending
  invitations; a dropdown on the platform screen was a second way to do one
  thing, in a place with none of that context. `inviteUser` the mutation lost
  both arguments; `inviteUser` the write still carries them, because
  `inviteMember` delegates to it.

- **2026-09-08** — **Every new account gets a baseline app-level role, because
  the model has no default-on.**

  Reported from a real test: an account created by an organization invitation
  held no app-level role and seemed fine. It was not — it held literally
  NOTHING. The seeded organization roles carry no features either, so that
  account could sign in, hold its membership and change its password (the one
  unkeyed write), and could not set its own display name or enrol a second
  factor: `account:profile_write` and `account:two_factor_enrol` come from an
  app-level role and nowhere else. Nobody noticed because nobody opened
  `/settings/profile`.

  **The cause is the shape of the model, not a missing grant.** Permissions are
  purely additive — you hold what your roles grant — so "everyone may edit their
  own profile unless withheld" is not expressible. `module-auth`'s features.ts
  says the `account:*` keys exist so a genuinely restricted account can be
  EXPRESSED, which only works if the unrestricted case is the norm. Without a
  baseline the effect is inverted and every account starts restricted.

  **So a baseline role IS the default mechanism.** `defaultAppRoleKey` is a
  module option; `acceptInvitation` applies it when the invitation named no app
  role. Configuration rather than an argument, because "which role is the
  baseline" is a property of the deployment — and because the APP seeds the
  roles, so the app is the only layer that can name `normal-user` without a
  module hardcoding another's seed key.

  **It fills a hole and never overwrites an answer.** An invitation naming a
  role wins outright, and somebody who already holds an app-level role keeps it
  — so a super admin accepting an organization invitation is not quietly
  demoted to the baseline. That is the same class of bug as the invitation
  mismatch fixed this morning, and it is refused by a check rather than by
  ordering.

  **A missing or disabled default is not an error.** The acceptance still
  succeeds: refusing to let somebody join because a baseline role was renamed
  would be the worse failure, and they arrive in the state that existed before
  the option did.

  The one account already in that state — the same one the report came from —
  was granted `normal-user` by hand, guarded so it could not overwrite an
  existing app role.

- **2026-09-08** — **An account is created by the person who owns it. Everything
  else invites.**

  The New user button typed somebody else's password into a form. It is gone,
  and with it `users:create`, `AuthAdminService.createUser`,
  `Mutation.adminCreateUser` and `/admin/users/new`. The button now links to
  `/admin/invitations/new`, which writes ONE `PermInvitation` row; the account
  appears when the invited person follows the link and chooses a password only
  they know. The form asks for no display name either — they type their own.

  **Why the screen is in `module-permissions` and not in the app.** The
  question was raised as "will this mix the two modules", and the honest answer
  turned out to be that it mixes nothing: inviting touches no auth table at all.
  Every field is permissions' own — the invitation row, the roles, the
  organizations — and the account is created on ACCEPTANCE, by the app
  composition that already existed. The earlier plan to put the screen in the
  app was answering a problem that the "same flow as the org invite" shape had
  already removed. The Users list links to it by PATH, which is a string rather
  than an import — the same kind of crossing as a shared nav group.

  **`PermInvitation.organizationId` is nullable and `appRoleId` is new.** An
  invitation is an offer, and not every offer is to a tenant. A second table
  would have duplicated the token, the expiry, the revocation, the email and the
  accept page for a row differing by one column. Migration additive; the
  existing row needed no backfill.

  **The app-level role rides on the invitation**, which is how a role is chosen
  for somebody who does not exist yet: decided when the row is written, applied
  when `acceptInvitation` finally has a userId — milliseconds after
  `signUpFromInvitation` creates it. Exactly what `roleId` already did for the
  organization role, one level up.

  **Required, and defaulted to the LEAST.** Required because an invitation
  granting no app role produces somebody who signs in and cannot edit their own
  profile: `account:profile_write` comes from an app-level role and nothing
  else. Defaulted to the fewest features because a picker whose default is the
  most powerful role is one somebody accepts by accident — today that is
  `normal-user` at three, which is also exactly the role that makes the account
  usable. The two goals agreed, which is not always how this goes.

  **The guards follow the FIELDS, not the method.** `inviteUser` checks
  `members:manage` when an organization is named and `roles:grant_app` when an
  app role is, and refuses an invitation offering neither. A static key could
  only have been the union, which would mean a tenant administrator needed
  platform rights to invite a colleague. `inviteMember` is unchanged and now
  delegates to it.

  **The escalation rule is the point, not the key.** `roles:grant_app` says you
  may hand out app-level roles; without a second rule it would be the whole
  ladder, since anybody holding it could invite an address they own as
  `super-admin` and hold everything by proxy. So both grant paths refuse a role
  carrying features the granter does not hold — `role-draft.ts`'s no-escalation
  rule, stated for handing a role out rather than composing one. It makes
  neither path able to increase the total power in the system.

  **`sendInvitationEmail` is handed a NULL organization** rather than a
  placeholder, and the app composes whole sentences from it. "You have been
  invited to join —" is the kind of email that gets reported as phishing, and
  only the app knows what its own product is called.

  Also this turn: an app-role column on the users grid and a picker on the edit
  view, both fed by operations `module-auth` does not define and names by
  convention, failing soft; and `user-draft.ts` lost its create mode, because
  there is no longer a form that creates an account.

- **2026-09-08** — **`users:*` collapses from nine keys to four, an account is
  never deleted, and editing gets its own route.**

  Same day as the nine, and reversing part of it deliberately rather than
  quietly. Three instructions, one shape: make it like the roles, do not delete
  a user — disable it, and read/create/update is the vocabulary.

  **`users:read`, `users:create`, `users:update`, `users:disable`** — exactly
  `roles:*` and `plans:*`. Gone: `users:profile_write`, `users:password_reset`,
  `users:sessions_read`, `users:sessions_revoke`, `users:two_factor_remove`
  (all now `users:update`), `users:suspend` (now `users:disable`), and
  `users:delete` (nothing). `db:sync` marked all seven deprecated rather than
  deleting them, which is what the registry is built to do — grants and the
  audit trail stay readable.

  **What this trades away, stated plainly because the nine-key entry argued the
  opposite this morning.** Sending a password reset and removing a second factor
  are now one key. Either alone is survivable — a reset does not get past a
  factor, removing a factor does not get past an unknown password — so
  `users:update` is a path into any account on the platform. The argument for
  splitting them still holds in the abstract; it lost to a vocabulary an
  administrator can hold in their head, which is the same trade the admin app
  makes everywhere else. Reversing it is one key and a binding, and
  `surface-coverage.test.ts` asserts the current arrangement so the day somebody
  splits them is a deliberate one.

  `users:sessions_read` went the same way. A device and location history is the
  most personal thing in these tables, but a surface where "read" means "read
  some of it" is not a vocabulary anybody can use.

  **No deletion at all — not a soft delete, not an app-composed one.**
  Suspension IS the off switch, and `AuthUserStatus` already had the column.
  Everything the previous entry said about the composed delete (§12 open
  decision 38) is moot: there is no delete to compose. The open decision stays,
  because the orphan risk it describes is still real for anybody removing an
  account by hand — as this session did to a test account before any of this
  existed.

  **Editing moved to `/admin/users/:userId/edit`**, sharing `UserForm` with the
  create screen and validating through `validateUserDraft` in `domain/` — the
  same function `AuthAdminService.updateProfile` calls. That is the `RoleForm` /
  `role-draft.ts` arrangement, and it exists for the reason that one does: a
  form validating separately drifts, and the drift surfaces as a save that
  passed every check on screen and is refused by the API in different words.

  The profile form had been a panel on the detail page, hidden from anyone
  without the write key — which made that page two things at once and gave it a
  shape that changed depending on what the reader held. The detail page now only
  shows and acts; the edit route only edits.

- **2026-09-08** — **User administration is built, in `module-auth`, and the
  feature-metadata contract moved to `module-kit` to allow it.**

  The keys were declared earlier the same day (entry below). Building the
  surface behind them ran into the one thing that decision had not settled: a
  handler in `module-auth` cannot say which right it needs, because
  `@RequireFeature` lives in `module-permissions` and the two modules may not
  import each other.

  **What moved: the metadata KEYS, and nothing else.** `REQUIRED_FEATURES` and
  `REQUIRED_FEATURES_MODE` are now in `@kwtech/module-kit`, the package both
  modules already depend on. Each module wraps them in its own one-line
  decorator — `RequireFeature` there, `RequireAuthFeature` here. The guard, and
  the resolution of who holds what, did not move: declaring a requirement is a
  contract, deciding whether it is met is permissions' job. That is the split
  `FeatureContribution` (kit) and `FeatureSpec` (permissions) already make.

  The alternative was to copy the string `'kwtech:required-features'` into
  `module-auth`, and it fails in the worst direction: a drift makes the guard
  find no declared features and let the request THROUGH. The other alternative —
  hosting the resolvers in the app, as `users.resolver.ts` does — is right for
  genuinely joint work and wrong for a whole feature, which would have left the
  service, the client, the pages and the tables here and only the declaration of
  who may call them over there.

  ⚠ Consequence, stated in the resolver: an app that composes `module-auth` and
  installs no `FeatureGuard` gets these mutations unguarded. That was already
  true of every `@RequireFeature` in permissions — it is a property of
  declarative guarding — but this is the first module that could be adopted
  without the enforcer.

  **The port grew, and the app's `satisfies-modules.ts` check earned its
  keep twice.** `AuthPrismaClient` gained the reads and writes administration
  needs. Two mistakes were caught by that check rather than by a runtime null:
  an OVERLOADED `authSession.findMany` (two projections) is not assignable from
  Prisma's single generic method, so both callers now share one
  `SESSION_SUMMARY_SELECT` — the denylist reads six columns it ignores, which is
  the price of the port describing what Prisma actually offers; and
  `lastUsedAt` was typed `Date` where the column is nullable.

  **`AuthAdminService` is separate from `AuthService`**, because every method
  there takes a Principal and acts on the caller, and every method here names
  another account by id. Mixing them would put `removeMfaFactor(principal, id)`
  beside `removeTwoFactor(userId)` and make the distinction a matter of reading
  argument lists. It checks no permission — that is the resolver's job — but it
  does check the one invariant no key can express: an administrator may not
  suspend or delete their OWN account. Not applied to the recoverable
  operations; ending your own sessions is a thing people do deliberately.

  **Suspension revokes.** `signIn` refusing a suspended account is half of it:
  the access token verifies from its signature with no database read, so without
  the denylist entry "suspend" would have meant "cannot sign in AGAIN" for up to
  a week. Same two steps as `signOutEverywhere`, for somebody else.

  **There is no admin path that SETS a password.** Only a reset, to the
  account's own address, through `AuthService.requestPasswordReset` so there is
  one place that mints reset tokens. An administrator who could type a password
  into somebody's account would hold their credential, and every "was that you
  or support?" question afterwards would be unanswerable.

  **The pages ask about permissions through `@kwtech/module-kit/react`.**
  `useHoldsFeature` already existed for exactly this and named `module-auth` in
  its own doc comment as the case it was written for. Each control on the detail
  page gates on its own key, so the nine-way split is real in the UI and not
  only in the registry. `PermissionsProvider` mounts the provider, so an app
  composing both gets one source of the list.

  **`users:delete` still leaves permission rows dangling** (§12 open decision
  38). The page says so in the danger zone rather than implying a clean delete.

  Verified: 897 tests pass, the workspace typechecks, `db:sync` upserted the
  nine keys and `super-admin` picked them up by derivation, and a real boot
  regenerated `schema.graphql` with all ten operations.

- **2026-09-08** — **User administration goes in `module-auth`, and its rights
  are nine keys rather than one.**

  The question asked was whether it belongs to `module-permissions`, since it is
  admin surface and app level. It does not, and the module had already written
  the answer down: `features.ts` classified its surfaces three ways and left the
  third row — "sign-in AND authorisation" — empty, describing in advance what
  would fill it as "an administrator resetting another person's password, or
  ending their sessions". That is this.

  **The boundary argument is §12.12's, unchanged.** This reads and writes
  `auth_user`, `auth_session`, `auth_credential` and `auth_mfa_factor`. Auth
  became its own module to keep identity data out of permissions, and an admin
  CRUD over those tables living there would reverse that decision quietly.

  **"App-level admin right" does not mean "declared in module-permissions",**
  which is the assumption worth killing explicitly. A module declares its own
  grantable rights through `module-kit`'s `FeatureContribution`, and
  `seed/registry.ts` composes the lists — `{ key: 'auth', features:
  AUTH_FEATURE_REGISTRY }` beside the permissions one. So permissions ENFORCES
  these keys without learning they exist: they arrive as data, and the role
  editor offers them because they are in the registry, not because it knows what
  a user is. `AUTH_FEATURE_REGISTRY` has worked this way since it was written;
  this is the first time it carries anything but self-service keys.

  **Nine keys, split by risk**, the way `roles:*` and `plans:*` are and for the
  reason they give: read, create, update and retire are different risks, and one
  `users:manage` means the platform cannot have somebody who reviews accounts
  without also being able to empty one. `users:read`, `users:create`,
  `users:profile_write`, `users:suspend`, `users:password_reset`,
  `users:sessions_read`, `users:sessions_revoke`, `users:two_factor_remove`,
  `users:delete`. Split NOW because a key is cheap to add and expensive to
  split: narrowing one after roles have been granted from it silently takes
  rights away from every holder.

  **`users:password_reset` + `users:two_factor_remove` is account takeover**,
  and they are two keys precisely so a role can hold the recoverable half alone.
  Either by itself is survivable — a reset does not get past a second factor,
  and removing a factor does not get past an unknown password. Together they are
  a complete path into any account, visible only as two admin actions. Both are
  `isPrivileged`. Removal still cannot simply be withheld from everyone: losing
  a phone and the recovery codes with it is the ordinary case it exists for.

  **`users:read` is the enumeration `findUserByEmail` refuses to be**, and that
  is deliberate rather than a contradiction. That query answers one question
  about one address at a time so a tenant administrator holding `members:manage`
  cannot harvest the platform's user list. This key IS that harvest, granted at
  app level to the back office. Same judgement, opposite answer, different
  holder.

  **Reads are keyed here and unkeyed in `account:*`.** The rule inverts because
  the data is somebody else's: withholding `account:profile_write` costs you a
  greyed-out button on your own page, while withholding `users:read` costs you a
  page you have no business seeing. A key that hides your own settings is a
  lockout; a key that hides every account on the platform is the point.

  **No bindings yet, on purpose.** The registry's own rule is that a binding is
  declared in the commit that adds the guard — one naming a surface nobody wrote
  reads as coverage in the role editor while guarding nothing. `auditRegistry()`
  lists all nine as awaiting one, beside `platform:support_access` and
  `roles:manage_app`.

  **Two gaps this surfaced, now §12 open decisions 37 and 38:** nothing can
  grant an app-level role (`perm_user_role` has no write path — the live grants
  were inserted by hand), and deleting an account orphans its permission rows,
  so the delete has to be composed in the app. Neither blocks the screens.

  `account:password_write` is still NOT declared. `features.ts` deferred it
  until admin-side reset tooling existed, on the grounds that keying
  change-password without it could leave somebody unable to fix a compromised
  password. `users:password_reset` is that tooling — so the condition is met and
  the decision is now merely open, rather than blocked.

- **2026-09-08** — **A wrong session on an invitation link is signed out
  automatically, not asked about.**

  Supersedes the entry below, from the day before. That one made the mismatch
  LOUD: a warning naming both addresses, and two deliberate buttons — sign out
  and return as the invited address, or join as who you are, having been told
  the invitation is used up. It was correct and it was still the wrong shape.
  It stops somebody in the middle of following a link to explain a distinction
  between two of their own addresses that they did not have in mind, and the
  cheaper of the two buttons is the one that does the damage.

  So the page now resolves it by itself. A mismatch triggers a `POST` to
  `/api/auth/signout` on mount, carrying `next=` back to the link: to
  `/auth/signin?next=…` when the invited address has an account, straight to
  this page's password form when it does not. The reader sees one screen saying
  whose session is ending, then lands where they can actually get in.

  **The guarantee got stronger, not weaker.** Yesterday's rule was "the wrong
  account cannot take the invitation without being told"; today's is "the wrong
  account cannot take it at all", because by the time there is anything to press
  the wrong session is gone. The bug that started this — an owner demoted from
  `organization-owner` to `organization-admin` by pressing Join on somebody
  else's invitation — is now unreachable rather than signposted.

  **What is given up, deliberately.** Accepting as a DIFFERENT account than the
  one invited. The old entry defended that case and the defence still holds in
  the abstract — an invitation is addressed to a MAILBOX, and a work address
  forwarding to a personal one is ordinary. It is dropped anyway: it was worth
  one button on a screen nobody wanted to read, and the remedy is to send the
  invitation to the address that will hold the account. `acceptedByUserId`
  stays — it records who accepted, and outliving this flow is the point of
  storing it rather than inferring it.

  **The sign-out is attempted ONCE**, marked by `?switched=1` on the return
  link. A sign-out that does not take — a cookie that will not clear, an API
  that will not revoke — would otherwise bounce the browser between two pages
  forever. The second arrival stops and offers the button by hand. This is the
  only reason the page still has a mismatch screen at all.

  `POST` and not a navigation, for the reason the previous entry gives: signing
  out revokes server-side as well as clearing the cookie, and a GET that changed
  state would be followed by every prefetcher in the browser. The
  `safeSignOutDestination` allowlist is unchanged and now matters more, since
  the redirect happens without anybody clicking it.

- **2026-09-07** — **Following an invitation while signed in as somebody else no
  longer joins the wrong account silently.** *(Superseded 2026-09-08 by the
  entry above: the mismatch is now resolved by an automatic sign-out rather than
  by asking. The account of the bug, and the reasoning about `next=`, stand.)*

  Reported from real use, and it had already done damage: the owner of a live
  organization opened an invitation addressed to another address while signed in
  as themselves, pressed Join, and their OWN membership took the invitation —
  which, because acceptance replaces the organization role, demoted them from
  `organization-owner` to the `organization-admin` the invitation offered. The
  role was restored and the test invitation removed.

  The page had one Join button for anybody with a session and mentioned the
  invited address in a passing sentence. It did not compare the two, because it
  was never given the viewer's address to compare — only whether there was a
  session at all.

  **The rule it was built on is still right.** An invitation is addressed to a
  MAILBOX, and whoever reads it may legitimately hold a different account — a
  work address forwarding to a personal one is ordinary, and `acceptedByUserId`
  exists precisely to record that. So a mismatch is not refused. It is made
  loud, and it takes a deliberate click either way: sign out and return as the
  invited address, or join as who you are, having been told that this uses up
  the invitation and the invited person will need a new one.

  **Signing out can now say where to land.** `POST /api/auth/signout?next=…`,
  so "sign out, sign in as them, come back to this link" is one control rather
  than three steps the user has to know about. The parameter is attacker-supplied
  on an endpoint anyone can reach, so it is accepted only as a PATH on this
  origin — an absolute URL, a protocol-relative one, a backslash some browsers
  normalise, or a control character all fall back to the default. Falling back
  rather than refusing: by then the session is already gone, and failing a
  sign-out over a malformed query parameter leaves somebody signed in who asked
  not to be.

  What made this worth writing down: the silent version passed every test it
  had. The behaviour was correct against its own documented rule, and only
  wrong against what somebody would expect while looking at it.

- **2026-09-07** — **An organization can be renamed, and renaming one is its own
  right.**

  An organization could be created and never edited: no `updateOrganization`, no
  write key for it, and `PermOrganization` has no `archivedAt` either. Members,
  invitations and workspaces were all editable around a tenant whose own name was
  write-once.

  **A name is a LABEL, not an identity.** It is typed once, by somebody who may
  mistype it, and then the company rebrands or is acquired. The key is editable
  with it, which a role's key and a plan's are not — and that is not
  inconsistency: those are referenced BY key (a plan key is the primary key every
  subscription points at), while an organization is addressed by `id` everywhere
  in this codebase and its key exists for humans. The same argument
  `updateWorkspace` makes, one level up.

  **`organizations:manage`, separate from `organizations:read`.** Support staff
  look at tenants constantly and rename one almost never; a single key for both
  would hand every support engineer the ability to rename a customer. App level,
  like the read key, because the only screen reaching it today is the platform's
  organization list. When §12.13 lands the active-organization scope, a tenant's
  own owner renaming their own organization is a SECOND key, not a re-levelling
  of this one — "rename any tenant" and "rename mine" are different rights.

  **Guarded, unlike `createOrganization` beside it**, and the asymmetry is the
  model: creating one is bounded by the `user:organizations` LIMIT because there
  is no organization yet to grant the right, while renaming an existing one is
  a right something can grant.

  The uniqueness of `key` is left to the index rather than pre-checked. A
  pre-check is a race — two renames to the same key can both pass it — and the
  constraint is the thing that is actually true. The write is `updateMany` over
  a unique id for the reason `updateWorkspace` is: a missing row comes back as
  `count: 0` and becomes a sentence, instead of Prisma's record-not-found
  surfacing as a 500 on a stale link.

  Verified against the running database: renamed the live tenant and put it
  back, and confirmed a blank name and an unknown id are both refused with a
  message rather than a stack trace.

- **2026-09-07** — **People are INVITED, by email, and an invitation can create
  the account it is waiting for.**

  Closes §12.31. "Add member" is gone from the organization screen; there is an
  address field, an optional organization role, and an invitation list below the
  members showing state, who sent it, and who accepted.

  **An invitation is addressed to an EMAIL, which is why `PermInvitation` is its
  own table** rather than `PermMembership.status = 'invited'` — the value that
  has sat in the enum unwritten since it was defined. A membership carries a
  userId; the entire point is that there may not be one. Writing a placeholder
  account to hold the row would put a fake person in every members list, every
  count, and every seat cap.

  **Expiry is DERIVED, never stored.** `invitationState()` computes it from
  `expiresAt`, so the list, the accept path and any future reminder job cannot
  disagree — a row that reads "Waiting" in a table and is refused on use is the
  disagreement that makes somebody distrust the whole screen. The column holds
  three values; the state has four.

  **The token never reaches a browser.** It is minted, hashed, stored as the
  hash, and handed to the host's `sendInvitationEmail` hook — the same
  arrangement `sendPasswordResetEmail` has, and for the same reason: the module
  has no email transport and knows nothing of the frontend route a link points
  at. `inviteMember` REFUSES when no hook is wired, before writing anything: an
  invitation nobody can be told about looks like success and blocks the address
  from being invited again. A delivery failure is reported instead
  (`delivered: false`) and the row kept, because losing a real invitation to a
  mail outage is worse than an administrator seeing that the email did not go.

  **`acceptInvitation` takes no actor and checks no feature.** The person
  accepting holds nothing in the organization — that IS the invitation — so the
  token is the authorisation. It is unbound in the registry, with a comment
  saying so, and a test asserts the resolver carries no `@RequireFeature`.
  `acceptedByUserId` records who actually accepted, which need not be who was
  invited: an address is a mailbox, and that is recorded rather than prevented.

  **An invitation can create an account, and that is the only way to create
  one.** `AuthService.createAccount` is a method with no route; `signUpFromInvitation`
  in the APP composes it with `acceptInvitation`, because creating an
  `auth_user` and a `perm_membership` in one gesture is exactly what no module
  may do (§9). The address comes from the invitation, never the form. It does
  not sign anybody in — the page then posts to `/auth/signin` like any other
  sign-in, so token minting, the credential throttler and the cookie adapter
  stay on the one path built for them.

  **One refusal for every dead token** — unknown, revoked, accepted, expired.
  The difference is precisely what somebody probing tokens wants, and the person
  holding a stale link has to ask the sender either way.

  Two supporting changes elsewhere. `graphql` in module-auth's Next proxy gained
  `optionalSession`: the graph now carries `@Public` fields, and refusing a
  signed-out request there would be a proxy overruling the guards. And
  `requireOrganization` selects `key` and `name` as well as `id`, because the
  email has to say which organization somebody is being asked to join.

  Verified against the running database end to end: invited an address with no
  account, followed the logged link, previewed it with no session, signed up,
  signed in with the new account, and found the membership created, the
  invitation `accepted` with the acceptor recorded, and the token spent.

- **2026-09-07** — **A workspace gets its own page, and `updateWorkspace` —
  the mutation `workspaces:manage` had been promising since it was written.**

  The organization screen's workspaces are now a GRID: name, key, members, how
  many of those hold a workspace role, and status. Double-click opens
  `/admin/organizations/:organizationId/workspaces/:workspaceId`.

  They had been expandable rows with member management inline, which put three
  different jobs — renaming, adding people, granting roles — inside a row of a
  list whose purpose is comparing workspaces against each other. A list is for
  finding the one you want; a page is for working on it.

  **`workspaces:manage` has described itself as "Create, rename and archive"
  since the day it was written, and rename was the third of those with nothing
  behind it.** `updateWorkspace` is that. A workspace's KEY is changeable, which
  a role's and a plan's are not, and the difference is not inconsistency: those
  are referenced BY key — a plan key is the primary key every subscription
  points at — while a workspace is addressed by `id` everywhere and its key
  exists for humans reading a URL.

  It uses `updateMany` rather than `update`, scoped by `organizationId` as well
  as `id`. `update` takes a unique `where`, which is the id alone, and a unique
  `where` cannot carry a tenant check — so nothing would stop one tenant
  renaming another's workspace. Verified: a rename under the wrong organization
  id is refused as `not_found`.

  **⚠ The route is under `/admin`, deliberately.** The bare
  `/organizations/:orgId/workspaces/:workspaceId` is the convention `scope.ts`
  parses, and a route there resolves at WORKSPACE level — the tenant-facing area
  §12.13 still defers. These are platform-staff screens and resolve at app
  level; putting them on the tenant path would quietly change what the guard
  reads.

  **One query, not two.** The workspace page loads
  `permissionOrganizationDetail` and picks its workspace out. That looks
  wasteful and is not: the add-member picker needs every ORGANIZATION member,
  since only they can be added, so the page needs both lists whatever it does —
  and one query means the two cannot disagree about who is in what.

  `Person` and `personLabel` moved to their own file, now that two screens
  render membership rows. Two copies of the fallback chain would eventually
  disagree about what to show when there is no account behind an id.

- **2026-09-07** — **One WORKSPACE role per member too. The rule now holds at
  both tenant levels; app level is the last collection.**

  Extends the organization rule down a level, and enforced the same way:
  `@@unique([workspaceMemberId])` on `PermWorkspaceMemberRole`, so
  `assignWorkspaceRole` REPLACES and returns `replaced`. The composite primary
  key stays alongside it — the key stops the same role twice, the unique stops
  two different ones.

  The workspace role control became a select, matching the organization one.
  It had been chips-with-a-remove precisely because workspace roles were a
  collection; the same argument that made that right now makes it wrong, and a
  control offering a second role would be offering what the database refuses.

  "No workspace role" stays a real option: membership is what lets somebody
  REACH a workspace, a role is what they may DO once there, and somebody with
  none still acts through their organization role.

  ⚠ A test asserting the opposite — "does not apply to workspace roles" — was
  inverted rather than deleted. It had been written the day the organization
  rule landed, and the pair of them is the record of the decision moving.

  Verified against the running database: assigning over an existing workspace
  role reported `replaced: true` and left one row, re-assigning the same
  reported `changed: false`, and a hand-written `INSERT` of a second was refused
  by `perm_workspace_member_role_workspaceMemberId_key`.

- **2026-09-07** — **Adding somebody to a workspace is a dialog: who, then
  optionally what they do there.**

  Closes §12.30. Each workspace on the organization detail screen now expands to
  its members and their WORKSPACE roles, and "Add member" opens a picker.

  **The candidate list is organization members NOT already in the workspace**,
  and both halves are load-bearing. Only organization members, because a
  workspace membership hangs off an organization membership — anyone else is
  impossible to express rather than merely refused. And not-already-in, because
  offering somebody who is already a member is offering a no-op: the write
  returns `changed: false` and the reader wonders what happened.

  **The role is optional, and that is the model.** Being IN a workspace and
  holding a role in it are different things: membership is what lets somebody
  reach it, a role is what they may do once there. Somebody added with no
  workspace role still acts through whatever their ORGANIZATION role grants,
  which is the common case.

  **Two writes, in a forced order.** `assignWorkspaceRole` refuses somebody who
  is not in the workspace — the grant hangs off the membership row, so there is
  nowhere to put it first. Share, then grant. If the grant fails the share
  stands, which is the right way round: they are in the workspace with no role,
  rather than in neither state.

  **Workspace roles stay a COLLECTION**, shown as chips with a remove on each,
  where the organization role is a single select. The one-role rule is
  organization level only (§12.32) — stacking two workspace roles is far less
  confusing than stacking two organization ones.

  The per-member workspace chips are GONE. Adding somebody now happens from the
  workspace, where the role choice belongs and where you can see who is already
  in it; the member row lists their workspaces read-only. Two places to do one
  thing is two places for them to behave differently.

- **2026-09-07** — **A workspace member can only be an organization member —
  already true structurally — and probing it found a real cross-tenant leak.**

  The rule was asked for and turned out to be enforced by the schema already:
  `PermWorkspaceMember` keys off `membershipId`, not `userId`, so being in a
  workspace requires a membership row to hang it from. "You cannot be in a
  workspace of an organization you do not belong to" is impossible to express
  rather than merely refused.

  **What was NOT enforced: that the membership and the workspace belong to the
  SAME organization.** The row references each independently. Verified by
  inserting one against the live database:

  - the cross-tenant row inserted cleanly — the schema permits it;
  - it surfaced in `accessibleWorkspaceIds`;
  - `canAccessWorkspace` returned **true** for another tenant's workspace;
  - `loadContext` scoped AT that workspace still returned null, so the guard
    held.

  So no request was ever served — but `useCanAccessWorkspace` exposes
  `canAccessWorkspace` to React, and a UI would have linked somewhere the API
  turns away. That is the "link outliving the permission" mismatch one shared
  key exists to prevent, arriving through the back door.

  **Fixed in the READ, where C3's defence already lives**: the membership's
  workspace include now filters `{ workspace: { organizationId, archivedAt:
  null } }`. The same filter closed a second leak found at the same time —
  ARCHIVED workspaces were listed as accessible, promising something
  `loadContext` refuses one call later. Both halves re-verified as false after
  the change, and the regression test asserts the QUERY rather than the result,
  because a fake cannot reproduce a foreign key the schema does not have.

  The row is still writable, which the read path only defends against. Closing
  it properly needs a composite foreign key — §12.34, and the same raw-SQL
  question as §12.19.

- **2026-09-07** — **Workspace membership is REQUIRED. `workspaces:access_all`
  is removed, and with it the last feature that bypassed billing.**

  Asked for as a simplification — "so that the condition will not complicate" —
  and it removes more complication than it looks like.

  There were TWO routes into a workspace: being a member of it, or holding a
  role granting `workspaces:access_all`. Two routes means two things to check,
  two things to revoke, and two answers to "why can they see this". Now there is
  one: somebody added them.

  **It also closed a real incoherence, which testing surfaced rather than
  reasoning.** `composeContext` computed workspace access from `granted` — role
  grants — while every other decision reads `effective`, which is grants ∩ plan.
  So `workspaces:access_all` was the single feature that bypassed subscription
  entitlement. Demonstrated against the database on an organization with no
  subscription: the member could ENTER every workspace and do NOTHING in any of
  them. Deleting the key removes the exception instead of papering over it.

  **Platform support remains the one exemption, and has to.** A support engineer
  holds no membership anywhere — entering an organization they do not belong to
  is the entire content of the right. Requiring membership of them would mean
  adding staff to a customer's workspaces to help with them: it changes the
  customer's member list, counts against their seat cap, and somebody has to
  remember to remove it. It is the same exemption app-level grants already have
  from the entitlement filter, with the same blast radius —
  `platform:support_access` is app level, so no tenant administrator can mint a
  role carrying it.

  An organization role still applies INSIDE the workspaces its holder belongs
  to, which is what `composeContext` has always done. It simply no longer widens
  which those are.

  **Deprecation now covers PLANS too.** Retiring the key exposed an asymmetry:
  role-feature reads filtered `deprecatedAt`, plan-feature reads did not. So a
  retired key stayed in `entitled`, and — worse — stayed visible to the plan
  editor, which would then refuse to save the plan because
  `validatePlanDraft` rejects an unregistered key. Both read paths now filter,
  and the rows are KEPT rather than deleted, exactly as deprecated role features
  are: `pro` and `enterprise` still carry the row, and no longer sell it.

- **2026-09-07** — **A member holds ONE organization role. Combining rights
  means defining a role that carries both.**

  Asked for directly, and it is a real change to a model that was explicitly
  additive: `composeContext` unions features from every role a person holds, and
  `PermMembershipRole`'s composite key allowed as many as you liked.

  **Enforced by the DATABASE, not by the write path.**
  `@@unique([membershipId])` on `PermMembershipRole` — which lands exactly where
  intended because that table holds ONLY organization-level roles (`assignRole`
  asserts `level: 'organization'`; workspace grants live on
  `PermWorkspaceMemberRole`). The composite primary key stays and is not
  redundant with it: the key stops the same role twice, the unique stops two
  different ones. Removing either brings back a different bug.

  **`assignRole` therefore REPLACES.** Adding without clearing would hit the
  constraint on the second grant, turning an ordinary re-role into an error
  somebody works around by revoking first — two calls where the interface offers
  one, and a window in between where the person holds nothing. It clears and
  inserts in one transaction, and still reports `granted: false` when the role
  was already held.

  It also returns **`replaced`**, and the screens say so: granting a role
  silently removes the previous one, and somebody who did not know the rule
  would otherwise discover it as a missing permission weeks later. The members
  grid became a single select, with the rule stated once at the top — a dropdown
  that simply lacks a second slot does not explain itself, and the answer
  (define a role carrying both, cloning an existing one as a start) is the part
  a reader needs.

  **No precedence was introduced**, which is what makes this safe: the model's
  rule was "level filters, never overrides, and there is no deny". One role is
  simply a union of one. Nothing had to learn an ordering.

  ⚠ ORGANIZATION LEVEL ONLY. Workspace and app-level roles are still
  collections — §12.32, decided on their own evidence rather than by symmetry.

  Verified against the running database: assigning over an existing role
  reported `replaced: true` and left one row; re-assigning the same reported
  `changed: false`; and a hand-written `INSERT` of a second role was refused by
  `perm_membership_role_membershipId_key`.

- **2026-09-07** — **The organization screens: ten built-and-unreachable write
  methods get a door, and the auth/permissions seam gets its third call site —
  in the app, where it belongs.**

  `PermissionsWriteService` had `createOrganization`, `addMember`,
  `removeMember`, `assignRole`, `revokeRole`, `createWorkspace`,
  `archiveWorkspace`, `shareWorkspace`, `unshareWorkspace`,
  `assignWorkspaceRole` and `revokeWorkspaceRole` — every one with its actor
  check, capacity check and cross-tenant refusal, and every one reachable by
  nothing. Eleven mutations now expose them. **Three unbound keys retired**:
  `members:manage`, `workspaces:manage` and `workspaces:share` had been claims
  in the registry with no surface behind them; the pinned list is down from six
  to three.

  **`organizations:read`, at APP level.** Listing every tenant is a platform
  question, so the key is app level even though `members:manage` beside it is
  organization level. The consequence is deliberate and is the whole reason
  they are two keys: support can read a tenant and change nothing in it. It also
  means these screens are for PLATFORM STAFF — a tenant administrator sees
  nothing under `/admin/*`, because that path resolves at app level and their
  organization role never participates. Tenant self-service needs §12.13.

  `permissionOrganizations` MOVED from `billing:manage` to `organizations:read`.
  The old key was always wrong — the query lists every tenant — but the
  consequence is a real coupling worth stating: the subscription form now needs
  both keys.

  **The user lookup lives in the APP, and can live nowhere else.** Turning an
  email into the `userId` that `addMember` takes reads `auth_user`, which
  `module-auth` owns, and must be guarded by `members:manage`, which
  `module-permissions` owns. Neither module may import the other, so neither can
  host it. `apps/web-server/src/users/users.resolver.ts` composes them — the
  same arrangement as `resolvePrincipal`, and it does not widen the seam: the
  modules still know nothing of each other.

  A BATCH twin, `findUsersByIds`, does the reverse for the members grid — which
  holds ids and needs names. It is acceptable as a batch precisely because it is
  by id: the caller already holds those ids, from a query that was itself
  guarded, so it discloses nothing new. Capped at 200 and de-duplicated, because
  an uncapped `in` list is an unbounded query somebody can send.

  ⚠ Both are named by the module's CLIENT by convention, the way
  `DEFAULT_GRAPHQL_PATH` names a route module-auth mounts — the module does not
  define them and cannot. So `findUsersByIds` is the one call in
  `permissions-client.ts` that FAILS SOFT: an app adopting the module without
  defining it gets a members screen showing raw ids rather than an error page
  instead of the members screen. Every other call throws, because every other
  call is the thing the screen is for.

  It is EXACT-MATCH ONLY, one address at a time. A prefix search over
  `auth_user` is a customer-list harvester for anyone holding `members:manage`.
  ⚠ It still discloses whether an address is registered — an accepted trade,
  not an oversight, and the alternative is the invite flow at §12.31.

  **A bad `organizationId` now refuses cleanly.** Found by calling the API with
  an empty id and getting a Prisma foreign-key violation, naming a constraint,
  through a stack trace. `addMember` and `createWorkspace` join
  `startSubscription` in reading the organization first, so the answer is
  `not_found` with a sentence rather than a message written for whoever wrote
  the ORM. The constraint is still what makes it impossible; this is what makes
  it explicable.

- **2026-09-07** — **Plans get an icon, and the shared icon set grows from 13
  names to 96.**

  `PermPlan.icon` mirrors `PermRole.icon` exactly — a NAME, never a component,
  nullable, and an unknown name falls back to a dot rather than throwing. The
  same reasons hold: this package is imported by the NestJS server, so it may
  not name a `LucideIcon`, and a second frontend draws the same plan in its own
  set. Pure presentation, carrying no commercial meaning:
  `assertPlanFeatureLevels` ignores it and nothing branches on it, because a
  plan is exactly the features and caps it holds.

  **`apps/web-app`'s `ICONS` map now serves three vocabularies** — `nav.icon`,
  `PermRole.icon`, `PermPlan.icon` — which is why it is one map and not three.
  Names are kebab-case and STABLE: they are stored in the database, so renaming
  one silently turns every row holding it into a fallback dot. Every name was
  checked against `lucide-react`'s actual exports before being added rather than
  assumed — a missing export is a build error, but a wrong-but-existing name is
  a silently wrong drawing.

  The seeded ladder reads as one: `sprout` → `rocket` → `zap` → `gem`, ordered
  so a reader can tell the tiers apart without being told which is which.
  `sprout` is shared with the `normal-user` role deliberately — both mean
  "starting from nothing", one about a person and one about a plan.

  ⚠ `createPlanIfAbsent` does not update existing rows, so adding an icon to
  `seed/plans.ts` does NOT give it to a plan an environment already has. That is
  the same trade the seeder documents, and the fix is the icon picker on the
  edit screen — or a one-line `UPDATE`, which is what the existing four got.

- **2026-09-07** — **A starting plan catalogue is seeded — and it CREATES
  rather than upserts, which is the whole decision.**

  Reverses §12.26, which had said plans should not be seeded because which
  products a platform sells is an operator decision. The generic ladder was
  asked for: `free`, `starter`, `pro`, `enterprise`.

  **`createPlanIfAbsent`, not `upsertSystemPlan`, and the asymmetry with roles
  is the point.** `upsertSystemRole` REPLACES features and limits on every
  `db:sync`, and the admin screens refuse to edit a system role, because a
  role's meaning is code — a role granting `roles:read` has to keep granting it
  or the guards lie. A plan is the other kind of thing: what it sells is a
  product decision that changes without a deploy, and adjusting `pro` through
  the screens is the ordinary use of what was just built. Re-asserting the
  definitions every release would silently undo an operator's work — the same
  revert trap the feature screens are built around, pointed at the people the
  feature was for.

  So the seed hands over a catalogue and gets out of the way. It runs in phase
  **'seed'** rather than 'sync', is idempotent by creating nothing twice, and
  `PermPlan` still has no `isSystem` column: a seeded plan is an ordinary,
  editable row from the moment it exists. The cost, stated where the definitions
  live: editing `seed/plans.ts` does NOT change an environment that already has
  the rows. The file is a starting point, not a specification.

  **Every tier sells the billing keys, including free.** `billing:manage`,
  `plans:read` and `subscriptions:read` are organization-level, so they pass
  through the entitlement filter like anything else — a free plan that omitted
  them would produce a customer who cannot open the screen that would let them
  upgrade. Locked out of paying you, by the free tier. Any new tier must carry
  them too.

  **Enterprise is DERIVED from the composed registry**, the same call
  `super-admin` makes: a frozen list would leave the tier named "Enterprise"
  while quietly ceasing to include everything. Its caps are large finite numbers
  rather than unlimited, because `resolveLimits` takes a number or falls back to
  the floor — there is no unlimited to express.

  ⚠ **Pro and Enterprise currently sell the SAME nine features** and differ only
  in caps. Not a mistake: the registry has exactly nine organization- and
  workspace-level keys today and they are all administrative, so there is
  nothing product-shaped to withhold from Pro. Manufacturing a difference would
  mean crippling Pro arbitrarily. The tiers differentiate on features as real
  features get registered; until then, caps are the product.

- **2026-09-07** — **`graphql-ws` wired end to end, ahead of the features that
  will need it — and three silent bugs found by testing it rather than
  shipping it.**

  Asked for deliberately up front: realtime features are coming, and retrofitting
  a transport through an authorization model is worse than building it once.
  §7's design — "sharing auth with HTTP via a connection-init token check in the
  Nest WS context" — is now real rather than planned.

  **The credential is a sixty-second TICKET, not the session.** A browser opening
  a WebSocket cannot send an httpOnly cookie cross-origin and cannot read it to
  send itself, so it asks the same-origin proxy (`/api/auth/ws-ticket`) and
  presents the result in `connectionParams`. The ticket is a distinct token
  **type** (`typ: 'ws'`), NOT a fourth `TokenScope` — which is the security
  argument: `verifyAccess` refuses anything whose `typ` is not `'user'` as its
  first check, so a ticket authenticates no HTTP request whatever a future
  `@AllowScopes` says. A scope would have made that a matter of every guard
  remembering to exclude it, and `resolvePrincipal` — the one seam — would have
  had to learn a new word. The ticket is EXCHANGED at the handshake for an
  ordinary `full` principal; `ws` never travels further. Minting costs a
  database read (the only credential path that does), because a socket may live
  fifteen minutes and "sign out everywhere" must not leave a stream running.

  **The socket closes when its authorization expires.** `Principal.expiresAt`
  has said "The WebSocket layer closes on it" since the type was written; it now
  does. This is the property that makes subscriptions safe to add at all: a
  query re-authorizes on every request, a subscription authorizes ONCE and then
  streams, so without a cap a disabled role or a lapsed plan would keep
  delivering until the socket happened to drop. The staleness window is now
  `AUTH_ACCESS_TOKEN_TTL` — the same bound an HTTP caller already lives with.

  **Three bugs, all silent, all found by an end-to-end test:**

  1. ⚠ **The principal was being sent to the browser.** `onConnect`'s object
     return is not the context — `graphql-ws` sends it to the client as the
     `connection_ack` payload. Returning the connection published userId and
     sessionId to the page, which is exactly the disclosure the httpOnly design
     exists to prevent, and nothing failed: the socket worked. It is now stashed
     on `extra` under a Symbol, with a regression test.
  2. **Every subscription was denied.** Nest passes the driver's TOP-LEVEL
     `context` to `useServer`, so a socket resolved against an HTTP-shaped
     `{ req, res }` handler and found no principal. One `context` function now
     serves both, branching on `extra`, which only the socket carries.
  3. **The throttler crashed every subscription.** `ThrottlerGuard` writes
     rate-limit headers onto a response a socket does not have. It now skips
     WebSocket operations — see §12.29 for what that leaves uncovered.

  **`JwtAuthGuard` now accepts a principal the TRANSPORT established.** Not a
  bypass: nothing outside the process can set it (Express's request object is
  not reachable from a header or a body), and the scope rule and the revocation
  lookup still run on it — so a socket opened by a session that was later signed
  out is refused on its next operation.

  **One real subscription, not a demo.** `planChanged` is guarded by
  `plans:read`, the same key as `permissionPlans`, and declared as the
  registry's first `graphql_subscription` binding — a surface `types.ts` has
  carried since it was written, waiting for one. It fixes something real: two
  administrators no longer see different truths until one reloads. The payload
  is the KEY only, and the page re-reads through the guarded query, so there is
  ONE authorization path rather than a second one on the socket.

  **`resolve` is required and its absence is silent.** `graphql-subscriptions`
  assumes a payload is already keyed by the field name; without a resolver the
  client gets `data: null` with no error anywhere. That cost a debugging round.

- **2026-09-07** — **`roles:create`, `roles:update` and `roles:disable` raised
  to APP level. `roles:read` stays organization level.**

  Found by reading the plan feature tree: those three were being offered as
  things a PLAN could sell, which prompted the question of whether they were at
  the right level at all. They were not, and the reason is not about taste.

  **The write path only produces shared presets.** `createRole` writes
  `organizationId: null` — which the schema defines as "a preset shared by every
  organization" — and `listRoles()` reads that same null scope for everyone. So
  creating, changing or disabling a role touches a row every tenant can see, and
  `assertRoleAssignable` lets any organization grant it. An organization-level
  key guarding that would let one tenant's administrator edit a role every other
  tenant relies on. `roles:disable` is the sharpest case: disabling a shared
  preset stops it granting for all tenants at once.

  Two things bounded it and one did not: seeded presets are `isSystem` and
  `requireWritableRole` refuses them, and the no-escalation rule limits which
  features a role may carry — but a NON-system preset created by one tenant was
  fully editable by another.

  **Read stays at organization level.** Reading the preset catalogue tells you
  nothing about any tenant's data — the same argument `features:read` makes —
  and a tenant administrator needs it to assign roles.

  **`roles:manage_app` still earns its place**, with a narrower job: it now
  splits platform staff who may define organization and workspace presets from
  those who may mint an APP-level role. Without it, anyone able to create a role
  at all could mint a second super admin.

  **Consequences, all intended.** The three drop out of the plan picker (9
  sellable features, down from 12) — you should not sell "create roles" as a
  product feature while it is a platform operation. An organization-level role
  can no longer carry them, which `assertRoleFeatureLevels` enforces; the seeded
  organization presets are empty, so nothing regressed. `super-admin` keeps them
  because it derives the whole registry. `level` is registry-only, so no
  migration and no `perm_feature` change.

  **PROVISIONAL, with a precise reversal condition — §12.27.** When role writes
  are scoped to the actor's organization these become genuinely tenant-local and
  belong back at organization level. That needs the active organization on the
  request (§12.13), which is the same thing blocking `role-draft.ts` from
  offering an organization picker. Do both together or neither.

- **2026-09-06** — **Plans and subscriptions, built as the entitlement twin of
  roles and features — and a decision reversed to do it.**

  **What a "subscription" turned out to be, twice.** The request was to build
  subscriptions "just like roles and features — a collection of features, but
  organization- and workspace-level ones". The model already splits that in two:
  `PermPlan` is the named collection of features, `PermSubscription` attaches
  one to a tenant. So both were built rather than collapsing them — `/admin/plans`
  is the exact mirror of `/admin/roles`, and `/admin/subscriptions` is who is on
  what. Collapsing them would have meant one screen answering "what do we sell"
  and "who bought it" with one row shape, and no way to change a customer's plan
  without rewriting the history of what they had been entitled to.

  **⚠ REVERSED: subscription writes were explicitly out of this module.** The
  standing decision was that billing owns `perm_subscription` and that guessing
  at idempotency "would put a wrong answer in the one table a permission check
  must not have to doubt". That is now reversed, and the deferred questions are
  answered instead of dropped:

  - *who writes* — an administrator holding `billing:manage`, through the
    screens. A billing provider integrating later must RECONCILE against these
    rows, not assume it is the only writer. §12.25 is the open half of that.
  - *idempotency* — the live row for one (organization, workspace, plan) is
    unique: a second `startSubscription` while the first has no `endedAt` is
    REFUSED, not returned as a no-op. That differs from `assignRole`, which is
    idempotent because re-granting leaves the world as asked; a subscription
    carries a status and a period the caller did not send, so silently
    succeeding would report "subscribed" while the dates stayed stale.
  - *payment fails* — `status` moves to `past_due` and the row stays.
    Entitlement stops at once because `loadContext` reads only `active`, and
    recovering is a status change rather than a re-subscription.

  **A plan may only sell organization- and workspace-level features, and that is
  a rule rather than a convention.** App-level grants are unioned in AFTER the
  entitlement filter (§14, `composeContext`), so an app-level key inside a plan
  is never consulted: it would read as a sold feature in the catalogue and
  entitle nobody. `assertPlanFeatureLevels` refuses it loudly instead of
  filtering it out.

  **No no-escalation rule on plans, deliberately — the one place the twin is not
  symmetric.** A role GRANTS, so putting a right into one you do not hold turns a
  single "create roles" key into every key, and `validateRoleDraft` refuses it.
  A plan ENTITLES: it lifts the subscription filter off a feature and nothing
  more, and whoever uses it still needs a role that grants it — a role still
  bound by the escalation rule. So the plan editor offers the whole catalogue,
  which is what somebody defining products needs. `plans:create`/`plans:update`
  are app level and privileged, which is where the real constraint on who
  defines products lives.

  **Five new keys, split by risk the same way roles were.** `plans:read` is
  ORGANIZATION level while `plans:create`, `plans:update` and `plans:archive`
  are APP level — the same asymmetry `features:read` already has, and for the
  same reason: an administrator inside one tenant must see what they could
  subscribe to, while defining what the platform sells is a platform act. A
  tenant admin who could edit a plan could sell themselves anything.
  `subscriptions:read` is separate from `billing:manage` so support can answer
  "why can they not do this" without being able to change anybody's
  entitlement; `billing:manage` keeps all three writes, because starting,
  amending and ending are not jobs people hold separately and three keys always
  granted together are one key with extra rows.

  **`PermPlan.archivedAt`, and it is NOT `isPublic`.** The two were nearly
  conflated and mean opposite things: `isPublic` stops OFFERING a plan while
  honouring it for everyone already on it (a bespoke or grandfathered tier),
  `archivedAt` stops HONOURING it — every live subscriber loses those features
  on their next request. The read path enforces the second (`plan: { archivedAt:
  null }` in the entitlement query, filtered in the QUERY for the reason
  `disabledAt` and `deprecatedAt` are), and `startSubscription` refuses an
  archived plan. There is no delete: every subscription ever written points at
  the plan row.

  **The target and the plan are immutable on a subscription**, exactly as key
  and level are on a role, and for the same reason: every entitlement decision
  the row ever produced read all three. Changing plan is End then New, which
  leaves two rows and a timestamp that reconstruct the change; a mutated row
  cannot. There is no un-end either — bringing a customer back is a new
  subscription, which is what makes the gap visible rather than erased.

  **One `findMany` signature, not two, and the reason is worth recording.**
  `permSubscription` is read by both the entitlement pipeline and the admin
  list, which want different `where` clauses and different rows. Declaring it as
  an OVERLOADED interface member compiles inside the module and then fails the
  app's `satisfies-modules.ts` assertion: Prisma's generated `findMany` is a
  single generic method, and TypeScript will not match it against a
  two-signature target — it collapses the delegate to `never`. So there is one
  signature with optional `where` fields and one row type, and `listSubscriptions`
  joins the organization and workspace NAMES from a second query rather than
  widening the include on the request path. That assertion file did its job
  twice in this change: it also caught the three unbound plan delegates.

  **`Date.parse('2026-02-31')` is not NaN.** JavaScript rolls the overflow
  forward to the 3rd of March, so the obvious renewal-date check passes and
  records the wrong month. `subscription-draft.ts` round-trips the parsed date
  back to a string and compares, in BOTH the validator and the writer — a value
  the form refused must not be silently accepted with a different date by
  anything calling the write service directly.

- **2026-09-05** — **Roles became writable, there is no delete, and the
  registry audit found two contradictions on the way.**

  **Five keys where there was one.** `roles:manage` is deprecated; `roles:read`,
  `roles:create`, `roles:update` and `roles:disable` split it by risk, the same
  way `features:author` was split. All four are ORGANIZATION level, because
  defining roles inside your own tenant is the ordinary administrative act —
  unlike inventing a FEATURE, which is platform-wide and therefore app level.

  **`roles:manage_app` guards the level, not the features.** The escalation the
  existing rule does not close: `assertRoleFeatureLevels` stops an organization
  role collecting app-level features, but nothing stopped an organization
  administrator MINTING an app-level role — which applies in every organization
  and skips the subscription filter. So the dangerous half is the role's own
  level, and that is what the fifth key guards.

  **NO DELETE, by request and on the evidence.** Every grant ever made points at
  the role row, so deleting one either cascades that history away — destroying
  the answer to "what could this person do last March" — or fails on a foreign
  key at the worst moment. `PermRole.disabledAt` follows `PermFeature.
  deprecatedAt`, `AuthSession.revokedAt` and `PermWorkspace.archivedAt`: set a
  timestamp, never DELETE.

  A disabled role must GRANT NOTHING, and that is enforced in the READ path, not
  at the write: `loadContext` filters `disabledAt: null` at all three levels,
  the write service's own re-derivation does too, and `requireRole` refuses to
  ASSIGN a disabled role — otherwise the grant row would exist, grant nothing,
  and look identical in a members list to one that works. Making the structural
  client require the filter is what forced all five write-path call sites to
  decide rather than inherit the old behaviour.

  **The admin list deliberately shows disabled roles**, where every grant path
  hides them. A list that hid them would make the switch look like a delete and
  leave nobody able to find the role to turn it back on.

  **No escalation: you may not put a right into a role that you do not hold.**
  Not asked for and taken as the safe default, because without it one coarse
  "create roles" key is indirectly every key in the system — compose a role
  granting everything, assign it to yourself, and the model has been walked
  around rather than broken. Cloning is the fastest route to it, so clone runs
  through the same rule rather than trusting its source.

  **Clone FILTERS rather than refusing.** A super admin's features cloned into
  an organization role would fail validation wholesale, leaving the person to
  un-tick them one at a time. Dropping what cannot apply and SAYING SO — with
  the reason per key — leaves a working role and an accurate list. Replace and
  Add are named for what happens to the features ALREADY THERE, like the feature
  import's dialog, because that is the half at risk. Nothing is written: the
  preview is staged into the form and saved through `updateRole`, so a clone
  cannot reach a rule a manual edit obeys.

  **Key and level are immutable after creation.** Both are read by grants that
  already exist: changing a level silently re-interprets every grant made from
  the role — an organization role becoming a workspace one stops applying
  organization-wide, with no event anywhere saying so.

  **System roles are refused.** `db:sync` REPLACES what they grant on every run,
  so an edit through the API would look saved and be reverted on the next
  deploy — the trap the feature screens are built around.

  **The duplicate-key check lives in application code** because the database
  cannot do it for the rows that matter most (§12.19): `@@unique([organizationId,
  key])` does not constrain app-level roles or shared presets, since
  organizationId is null there and Postgres treats NULLs as distinct.

  **Four shared presets, and they needed no organization.** `organization-admin`,
  `organization-user`, `workspace-admin` and `workspace-user` are seeded with
  `organizationId: null`, which the schema defines as "a preset shared by every
  organization" rather than one tenant's definition — which is what makes them
  seedable when `perm_organization` is still empty. `upsertAppRole` became
  `upsertSystemRole`, taking any level. Their features are LISTED rather than
  derived: deriving "every organization-level key" would silently widen an admin
  preset the moment a key is added.

  `workspace-admin` holds exactly one feature, and that is honest rather than
  unfinished: `workspaces:share` is currently the only workspace-level key —
  `workspaces:access_all` and `workspaces:manage` are organization-level,
  because seeing or creating every workspace is a decision the organization
  makes, not one a workspace makes about itself.

  ## Two contradictions the audit caught

  `/admin/roles` ended up claimed by BOTH `admin:access` and `roles:read`, and
  `auditRegistry.contested` refused it — correctly: two keys naming one route
  means the interface cannot say which right gates the page. The route moved to
  `roles:read`, and `admin:access` is now a baseline "may open the admin app"
  with NO bindings, which the audit reports as unbound and which is true.

  The surface-coverage suite then refused four bindings naming guards that did
  not exist yet — which is what it is for. The `ui_route` bindings for the
  create and edit SCREENS were removed rather than left aspirational, because
  naming a route nobody has written makes the audit report coverage for absent
  code. They return with the screens.

  ## Not built: the screens

  The server side is complete and verified; the roles ADMIN UI is not. The
  module's React layer has no data-fetching seam at all — every existing page
  reads a compiled constant or context — and roles are the first screen needing
  live data. Introducing one means deciding how `module-permissions/react`
  reaches the API without naming `module-auth`'s route handler, which is a §9
  question and not a detail to settle in passing.

- **2026-09-05** — **The settings pages got the Back link the admin sub pages
  already had, and it exposed that "sub page" means two different things.**
  `SettingsPage` gained `backTo`, matching `AdminPage`.

  **Only ONE of the three is a real child.** `/settings/two-factor` is unlisted
  in the navigation and reached only from Security, so "back" has one true
  answer. `/settings/profile` and `/settings/security` are PEERS — both sit in
  the Account nav group, neither is inside the other — so there was no parent to
  name. They point at the app's home instead, which is the honest answer to "how
  do I get out of settings" rather than an invented hierarchy.

  *Rejected: a bare browser-history Back.* It lands somewhere different for
  every reader, so it cannot be labelled — and the whole value of "Back to
  Security" over "Back" is that it says where you will land without your having
  to remember how you arrived. It is also wrong for anyone who opened a deep
  link, which is exactly how a password-reset or 2FA URL gets used.

  **`backTo` is a prop with a default, not a constant**, like `twoFactorHref`
  beside it: an app mounting these under a different prefix would otherwise get
  a link to a 404. The module ships the zero-configuration answer and lets the
  app disagree.

  **Forwarded through all three states of `ProfileRouteInner`**, not just the
  loaded one. Otherwise the link pops in after the fetch and shifts the heading
  down, and the ERROR state — the one where somebody most needs a way off the
  page — would have been the single state without it.

  **A second copy of `BackLink`, deliberately.** The two modules may not import
  each other (§9), and neither shared home is right: `@kwtech/module-kit` is the
  contract the NestJS server imports, so a styled component does not belong in
  it, and `@kwtech/web-ui` would hand `module-auth` a UI-package dependency it
  does not otherwise have — the edge already flagged as a cost when
  `module-permissions` took it for a data grid. Twenty lines of markup is the
  cheaper duplicate, and the same call this package already makes by inlining
  SVGs rather than starting an icon dependency. Revisit at a third copy.

  **A gap this did NOT close, and it is worth knowing.** `AdminPage` gives its
  denial screen a back link on the stated grounds that "someone refused a page
  needs a way off it more than anyone" — but the catch-all's ROUTE check fires
  first and renders `FeatureDenied` without one, because `ModuleRoute` has no
  parent to name. So a sub page you are refused still strands you. Closing it
  means putting `backTo` on the route descriptor, which is a wider change than
  this one.

  Verified in the running app: `/settings/profile` and `/settings/security`
  render `Back to Dashboard` → `/`, and `/settings/two-factor` renders
  `Back to Security` → `/settings/security`.

- **2026-09-05** — **The role badge renders, and the context grew the one field
  it had no way to answer from.** `PermissionContext.appRoles` carries `{ key,
  label, icon }` for every APP-level role the caller holds, through GraphQL to
  the navbar.

  **It had to be a new field, not a derivation.** The context exposed feature
  keys and no role identity at all, so nothing downstream could name the role a
  grant came from — `grantedAtAppLevel` says what staff may do and never which
  role said so. The badge is the first thing to ask WHO rather than WHAT.

  It belongs on the context for the same reason `granted` and `entitled` do:
  the shape already carries the inputs that produced the answer, so a screen can
  explain itself rather than only obey. This is the one input with a
  human-readable name attached, and the shell already fetches the context — a
  second query for three strings would be a round trip to say something the
  first request was already answering.

  **App level only, and that is the substance rather than a scoping detail.** An
  app-level role hangs off no membership, so it is the same wherever the caller
  is — which is what makes it safe to draw beside a username that is also always
  the same. An organization role is true only inside one organization and would
  start lying the moment somebody switched, in the corner of the screen least
  likely to be re-read. Tested directly: organization and workspace roles are
  excluded from `appRoles` even when held.

  **The badge carries no authority, and a test says so.** A crown is a label; a
  role's rights are the list of features it carries. `appRoles` is built from
  the input roles rather than from the `applies` loop, so nothing about a badge
  can ever depend on the resolution pipeline's control flow — and a test grants
  an app role called "Super admin" wearing a crown with an empty feature list
  and asserts `effective`, `granted` and `grantedAtAppLevel` all stay empty.
  That is the same objection that sank the `platform:super_admin` wildcard,
  applied to a picture.

  **Sorted by key and de-duplicated**, because row order out of a database is
  not a promise and a badge that swaps places between two renders of one session
  reads as a bug in the session. `label` falls back to the key, so a caller
  assembling grants by hand — a test, a fixture — need not invent a display name
  to ask a permission question.

  **Icon only, no label, after two rounds of feedback.** The name is attached
  rather than dropped: `role="img"` plus `aria-label` names it for a screen
  reader and an SVG `<title>` gives a mouse the same string on hover. Deleting
  it would leave an unlabelled graphic for AT and a glyph everyone else has to
  guess at — a crown reads as rank, but a briefcase and a sprout do not announce
  themselves.

  Every badge is styled identically — no gold crown, no green sprout. Styling
  one as more important would be a second account of authority that no check
  reads and nothing keeps true. The icon distinguishes the roles; the styling
  must not imply a rank the data does not carry.

  Unlike the username, the icon does NOT hide on a narrow viewport: it costs
  about sixteen pixels, so the rare case of holding two cannot push the control
  out of shape, and nothing is rendered at all for the majority holding none.

  **Verified in the running app**, not asserted: signed in through the Next
  route handler and found `lucide-sprout` in the rendered header between the
  username and the chevron, carrying `aria-label="Normal user"` and its
  `<title>`; `myPermissions.appRoles` answers over the live API; and the
  generated `schema.graphql` gained `PermissionRole` and the `appRoles` field.

- **2026-09-05** — **A role carries a badge ICON, stored as a name.**
  `PermRole.icon` is a nullable string, and the three app-level roles now seed
  one: `crown` for super-admin, `briefcase` for client, `sprout` for normal-user.

  **A name, never a component or an SVG**, which is the same call `nav.icon`
  already made and made for the same reason: this package is imported by the
  NestJS server, so naming a `LucideIcon` here would put React into a package
  with no business having it. The app's `iconFor` maps the name to a component,
  which is also what lets a second frontend draw the identical row in its own
  set. Both vocabularies now resolve through that ONE map rather than through a
  second one that could drift.

  **An unknown name falls back rather than throwing**, and the distinction from
  the tag vocabulary is deliberate. `FEATURE_TAG` is closed and `validateDraft`
  refuses anything outside it, because a tag is a FILTER and a near-miss splits
  one pile into two. An icon is a drawing: a role predating this column has
  none, and an icon retired from the app's set would otherwise turn every screen
  listing that role into a blank page. A generic glyph is strictly better than
  that, so the fallback is the behaviour and not a lapse.

  **It carries NO authority, and nothing may ever branch on it.** A crown is a
  label; a role's rights are the list of features it carries and nothing else.
  Reading rank off an icon would be a second, unenforceable account of what
  someone may do — the same objection that sank the `platform:super_admin`
  wildcard, and it applies to a picture just as well as to a key.

  **`?? null`, not `?? undefined`.** `upsertAppRole` REPLACES features and
  limits rather than merging them, so the definition the app passes is the whole
  truth about the role, and the icon had to follow: undefined would make Prisma
  skip the column and leave a retired icon on a row nothing in the checkout
  still names. Verified rather than assumed — an icon tampered with directly in
  the database is restored by the next `db:sync`, which exercises the UPDATE
  path rather than only the create.

  **On the icon chosen for normal-user.** A flower was suggested; a sprout does
  the same gentle job while meaning something the flower does not. The role's
  defining property is that it holds nothing — it is the ground floor — and a
  sprout puts it at the bottom of an obvious scale beside a crown, where a
  flower is decoration a reader would have to be told the meaning of. One word
  to change, since nothing but the drawing moves.

  **Deliberately NOT built here:** the navbar badge that renders this, the
  reusable searchable icon picker, and `appRoles` on `PermissionContext` to
  carry role identity to the frontend. The context exposes feature-key lists and
  no role identity at all, so the badge needs a field added through the
  repository, `composeContext`, the GraphQL type and `session-query` — a
  separate change. The column and its values land first so that work has
  something true to read.

- **2026-09-05** — **The usage docs had fallen behind; audited and closed.**
  `PLAN.md` §13 was kept current at every step, but the package READMEs — the
  "how do I use this" docs — were not. An audit of 26 shipped things against the
  four READMEs found **16 undocumented**, including whole features: tags,
  filtering, pagination, dynamic route segments, `useHoldsFeature`, `MultiSelect`,
  `useDebouncedValue`, the five `features:*` keys, and the admin screens.

  A decision log records WHY something was done for whoever is deciding whether
  to change it. A README tells the next person HOW to use it. Keeping only the
  first is how a package accumulates capability nobody discovers — and the
  discovery cost lands on whoever adopts it, who is exactly the person the module
  pattern exists to help.

  Now documented: module-kit's dynamic `:param` routes and the cross-module
  feature-access contract; module-auth's own feature registry, the
  session-versus-authorisation rule and the server descriptor's boot-time secret
  assertion; web-ui's grid pagination, selection and editing gotchas, the
  multi-select and the debounce hook; module-permissions' admin screens, the
  risk-based `features:*` split, tags, filtering, paging, binding enforcement and
  the full `/react` export table.

  Verified rather than asserted: every symbol named in a code example was
  checked to exist in the built package — 28 across five entry points, none
  missing. The same audit that caught the gap was re-run to confirm it closed.

- **2026-09-05** — **Two module-consumption defects fixed; two proposed
  refactors rejected after checking them.**

  **`composeFeatures` was dead code, and the app had a second copy of it.**
  Defined and tested in module-kit, never called — while `seed/registry.ts`
  hand-rolled the same duplicate-key rule. Now the seeder composes through it,
  so "two modules may not define one key" has one implementation.

  **`authServerModule` dropped its own features.** `permissionsServerModule`
  passed `features: FEATURE_REGISTRY`; the auth one passed nothing. Latent
  rather than broken — the seeder reads the registries directly — but the day
  anything composed from `SERVER_MODULES`, auth's keys would have been silently
  absent. The list is legitimately empty-ish today; empty and PRESENT is the
  honest shape, because a missing field cannot be told from an oversight.

  **The seeder still does NOT compose from `SERVER_MODULES`, and that is
  deliberate:** building those descriptors calls `AuthModule.forRoot()`, which
  asserts `AUTH_JWT_SECRET` at construction. A seed task wanting only a list of
  keys would fail on a secret it never uses. Confirmed by trying it.

  Narrowing `FeatureContribution` to `FeatureSpec` is now CHECKED rather than
  cast. The two differ exactly where module-kit stayed loose — `level` optional,
  `surface` a plain string — and a cast would have written a row nothing can
  grant, or a binding naming a surface that does not exist. `FEATURE_SURFACES`
  and `isFeatureSurface` were added for it. All three checks verified to fire.

  **One denial screen, not two.** `AdminDenied` and the app's `RouteDenied` had
  the same four sentences copied between them; the copy in the app was the one
  nobody would think to update. Both now render `FeatureDenied` from the module.

  ## Rejected, after checking

  **Moving `ConnectivityMonitor` and `StatusBarHost` into web-ui** — proposed
  first and withdrawn. Both import from `next/navigation` (`useRouter`,
  `usePathname`), and web-ui has no Next dependency and should not gain one for
  two components. They are Next-coupled app glue and belong in the app. Extract
  when a second app exists and it is clear what actually varies.

  **Composing `WebModuleDescriptor.Provider`** — the field is declared and
  nothing reads it, but exactly one provider exists. Building the composition
  machinery for a single consumer is the same speculative move. The field should
  probably be DELETED: an extension point that is declared, documented and
  silently does nothing is worse than none, because someone will set it and
  wonder why their context never mounts.

- **2026-09-05** — **Feature filtering lives at the QUERY, and the page calls
  the same function.** `filterFeatures` is a pure domain function over a list;
  both `Query.permissionFeatures` and `GET /permissions/features` apply it
  server-side, and the Features page applies the identical one.

  A pure function is the only shape both can share. Put the rules in SQL and the
  page cannot reuse them; put them in the page and the endpoint answers a
  different question from the screen. The page still reads a compiled constant,
  so there is no WHERE clause to push into today — but the SEMANTICS are the
  query's, not a second implementation, and the day this becomes a table the
  page swaps a constant for a fetch with every rule already matching.

  **Filter first, then page.** The other order pages the whole registry and then
  narrows what came back, so `total` counts rows the caller never asked about
  and page two is missing rows page one filtered out.

  **Two rules within a facet, and one of them is arithmetic rather than
  preference.** `modules` and `levels` are ANY-of: a feature has exactly one of
  each, so requiring all would always match nothing. `tags` are ALL-of: a
  feature has many, so intersecting is meaningful and each one narrows. Facets
  always AND with each other. Both are tested, because the distinction is
  invisible until someone picks two modules and gets an empty grid.

  Facets are built from the DATA — a module or level nobody uses never becomes
  an empty option. Two boolean filters came with it: `isPrivileged` (where
  `false` is a real filter, not the absence of one — `!filter.isPrivileged`
  would have got that wrong) and `unboundOnly`, which answers the most useful
  audit question the list has: which keys read as coverage in a role editor
  while guarding nothing?

  **The search is debounced at 250ms**, and the input stays bound to the RAW
  value while only the filter waits. Binding the field to the debounced value is
  the classic version of this bug — characters appear a beat after they are
  typed. Debounce rather than throttle: throttling emits during the burst, which
  is exactly the prefixes nobody wanted, and out-of-order responses would leave
  the grid showing results for "featur".

  **Module, Level and Tags are dropdowns showing a count**, not rows of chips.
  Chips were better while the vocabulary was short — everything visible, every
  grouping discoverable — and stop being better as it grows: twenty tags wrap
  into a block that pushes the grid off screen. `Tags (2)` costs one click and
  takes constant space. The count is the load-bearing half; a collapsed facet
  that does not say it is active is how someone spends a minute wondering why a
  list is short. It is in the accessible name too, for the same reason.

  Level is a dropdown as well, though three values would still fit: one facet
  rendered differently from its neighbours reads as an accident, and a fourth
  level would force the change anyway.

  `MultiSelect` went into `@kwtech/web-ui` rather than the page — the next
  filter bar needs it. Its one non-obvious line is `event.preventDefault()` on
  select: Radix dismisses on select by default, which for a multi-select means
  one click per re-open — technically working and unusable for its whole purpose.

- **2026-09-05** — **Bounded reads: the feature endpoints paginate, the grid
  paginates, and a duplicate `@nestjs/graphql` was found doing it.**

  Page sizes 10 / 50 / 100, default **100**, and — the part that matters —
  `MAX_PAGE_SIZE` **equals** the default, so `limit` can only ever narrow. A
  default alone protects the caller who does not ask; a CAP protects the server
  from the one who asks for everything, and `?limit=100000` on an endpoint with
  only a default is the same unbounded query with extra steps. The cap equals
  the largest page the UI offers, so nothing can ask the API for more than a
  person could have asked for through the interface.

  Out-of-range values are CLAMPED, not refused: a caller asking for 5000 wants
  "as many as I can have", and a 400 turns a reasonable request into an error
  somebody has to handle. The response echoes the limit actually applied, so
  nothing has to infer it from a short page. Fractions and NaN fall back rather
  than truncating — `limit=1.5` is a client bug, and answering 1 would make a
  broken client look like a working one.

  Both endpoints return the same `Page<T>` shape — `items`, `total`, `limit`,
  `offset`, `hasMore` — because a paginated list the caller cannot count is one
  they cannot render controls for. `hasMore` is computed from the TOTAL, so a
  final page that happens to be exactly `limit` long does not claim more.
  `DataGrid` paginates by default at 100, since a grid handed ten thousand rows
  builds ten thousand rows of DOM, and the list that grows past the point of
  pain always does so in production.

  **The find:** the `@ArgsType()` class for the paging arguments would not boot —
  `CannotDetermineInputTypeError: Cannot determine a GraphQL input type for
  "limit"`. Two copies of `@nestjs/graphql` were installed, because
  `module-permissions` declared it but NOT `graphql`, so pnpm resolved it
  against a different peer (16) from the app's (17) — and a differing peer set
  means a separate instance. Two instances means two `TypeMetadataStorage`
  registries: the module registered the args class in one, the app's schema
  builder read the other.

  Object types had survived the same split BY ACCIDENT — `@Query(() => Type)`
  hands the class over directly, so the builder never consults the registry.
  Args types are looked up by class, in whichever registry the reader owns, so
  they were the first thing to expose it.

  `@nestjs/graphql`, `@nestjs/apollo` and `graphql` are now CATALOGUED, for
  exactly the reason `@nestjs/common` already is: "a SECOND copy is not a
  duplicate — it is a bug." All three packages resolve one instance and the
  server boots.

  Worth recording how it was found: `pnpm build` and `pnpm typecheck` were both
  GREEN throughout. The schema is built at runtime from decorator metadata, so
  nothing static could see it — only starting the app did.

- **2026-09-05** — **Features carry TAGS, and the features grid filters on
  them.** `tags?: readonly string[]` on `FeatureContribution`, so any module can
  tag its own keys.

  A feature already had three groupings — module, level, and the namespace in
  its key — and every one of them is a HIERARCHY: a key belongs to exactly one.
  Tags earn their place because the useful groupings are not hierarchical.
  `admin` spans `features:*`, `roles:*`, `members:*` and `billing:*`, and no
  single tree says that without duplicating something. Concretely: `admin` now
  collects 9 keys and `admin` + `access-control` narrows to 6, neither of which
  the key prefix could express.

  **The vocabulary is closed.** `FEATURE_TAG` declares the eight tags and
  `validateDraft` refuses anything else. Free text acquires `admin`, `Admin` and
  `administration` within a month, and a filter meant to collapse a long list
  into a few piles then produces three piles meaning one thing. Adding a tag is
  a one-line edit, which is the deliberate act it should be. Input is normalised
  — lower-cased, spaces to hyphens, de-duplicated, sorted — so `Access Control`
  and `access-control` are one tag.

  **Tags are presentation only, and that is enforced rather than trusted.**
  `feature-tags.test.ts` asserts that holding a tag name as if it were a key
  grants nothing, and that holding one key does not extend to its tag-mates.
  "Everyone with the admin tag" would be the wildcard grant this log already
  rejected for `platform:super_admin` — a role row has to describe what its
  holder can do, and a tag is a label somebody can edit.

  **Registry-only, no migration.** `perm_feature` mirrors neither `level` nor
  `bindings` already, so tags follow the same precedent — the grid reads the
  compiled registry, and the database stays the mirror of what can be GRANTED
  rather than of how it is filed.

  Filtering intersects rather than unions: each chip should narrow, and "admin +
  billing" growing the list on the second click is not what anyone means by a
  filter. It runs before the grid rather than through AG Grid's filter model, so
  it composes with the quick-search box instead of competing with it. The Clear
  link and the "6 of 17" count appear only while filtering — a permanent "17 of
  17" is noise that trains the eye to skip the line.

  Tags are editable in all three entry points — the manual form, the spreadsheet
  column, and the staging grid — so a feature created through the UI can be
  filed like every other. 333 tests.

- **2026-09-05** — **Own-account WRITE keys, so a restricted role can exist
  later.** Three keys, granted to every seeded role so nothing changed today:
  `account:profile_write`, `account:two_factor_enrol`,
  `account:two_factor_remove`. The role that withholds them is not created yet;
  the mechanism is.

  **Reads are never keyed, writes are.** Every settings route stays unkeyed, so
  the pages remain reachable and a withheld key costs a disabled control rather
  than a locked door. Denying the read makes the app look broken; denying the
  write is the actual requirement. The profile page says *"Your profile is
  managed for you"* in place of the save button, so it reads as policy rather
  than a bug.

  **Enrol and remove are separate keys.** Withholding REMOVAL is how a policy
  makes 2FA mandatory. Withholding enrolment stops someone protecting their own
  account, which weakens security rather than enforcing it — one key could not
  express the difference.

  **Password change is deliberately not keyed**, and this is the substantive
  judgement. Keying it would be either leaky or dangerous with nothing in
  between: `/auth/forgot-password` is unkeyed and always reachable, so blocking
  the settings page stops nothing — and closing that hole too would leave
  someone with a compromised password unable to fix it, with **no admin-side
  reset to fall back on** (`platform:impersonate` has no implementation). The
  key arrives with that tooling. If the real intent is "these credentials are
  centrally managed", that belongs on the ACCOUNT — an externally-managed-
  identity flag — not on a role, because it follows the account rather than
  whichever role it happens to hold.

  **A gap this exposed and closed:** `module-auth` could gate a ROUTE through
  its descriptor but could not gate a BUTTON inside its own page — `FeatureGate`
  lives in `module-permissions` and no module may import it. So
  `@kwtech/module-kit/react` gained `FeatureAccessProvider` / `useHoldsFeature`,
  the same split the status channel already uses: the contract where everyone
  may depend on it, the answer supplied by whoever resolves permissions.
  `PermissionsProvider` mounts it internally, so there is one source of the list
  and the app needed no change at all.

  It defaults to an empty list, so a missing provider HIDES controls rather than
  revealing them — verified: rendering `ProfilePage` with no provider shows the
  policy note and no save button.

  Verified end to end: the registry now enforces
  `POST /auth/mfa/enrol` and `/mfa/confirm` on `two_factor_enrol`,
  `DELETE /auth/mfa/factors` on `two_factor_remove`, and
  `Mutation.updateProfile` on `profile_write`, while `change-password`,
  `forgot-password` and `signin` stay open to any session. 17 keys synced,
  super-admin 17, client and normal-user 3 each.

- **2026-09-05** — **A surface gets a feature key only when it needs
  AUTHORISATION, not merely a session.** The three `account:*` keys added
  earlier the same day were removed and deprecated; `/settings/profile`,
  `/settings/security` and `/settings/two-factor` carry no key again, which is
  where `module-auth` started.

  The rule that settles it, now written down in `module-auth/src/features.ts`:

  | needs | example | key? |
  |---|---|---|
  | neither sign-in nor authorisation | `/auth/signin`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify` | no |
  | sign-in only | `/settings/*`, `Mutation.updateProfile`, `Query.mfaFactors` | **no** |
  | sign-in AND authorisation | `/admin/*`, `Query.permissionFeatures` | yes |

  The middle row is the one that was got wrong. Requiring a key there does not
  add safety — `JwtAuthGuard` already refuses anyone without a session, and
  change-password additionally requires the CURRENT password, which is a
  stronger check than any key. What it adds is a way to lock someone out of
  their own account: a role omitting `account:security` leaves a person unable
  to change a password they believe is compromised.

  `AUTH_FEATURE_REGISTRY` is kept as an EMPTY exported array rather than
  deleted, so the app's composed registry keeps naming the module and the seam
  stays proven. The first real key arrives with the first surface acting on
  SOMEBODY ELSE'S account — an administrator resetting another person's
  password — which is a right worth granting and worth withholding.

  Everything built to get here stays and was worth it: `FeatureContribution`
  now carries `level` and `bindings`, so a module CAN declare a complete
  feature; and `seed/registry.ts` composes every module's registry, so the next
  one to declare a key does not need the seeder changed. Verified: `db:sync`
  deprecated all three keys rather than deleting them, the roles are back to
  14 / 0 / 0, and nothing that needs only a session is gated.

- **2026-09-05** — **`module-auth` can now declare features, and does — which
  required `FeatureContribution` to grow up.** Asked for features covering the
  existing surfaces (profile, security) assigned to both roles.

  The blocker was structural: `FeatureContribution` in `@kwtech/module-kit` had
  only key/module/label/description/isPrivileged. A module could name a right
  and say nothing about how far it reached or where it was enforced, so
  `module-auth` **could not declare a complete feature at all** — `level` and
  `bindings` lived in `module-permissions`' own `FeatureSpec`, and the two
  modules must not import each other.

  `level` and `bindings` moved onto `FeatureContribution`, both optional. That
  is the same argument the interface already made for itself: every module
  declares rights, only one enforces them — and a right is not fully declared
  without saying how far it reaches. `FeatureSpec` still narrows `level` to
  required, so nothing changed for the enforcer. `FeatureLevel` is duplicated in
  module-kit rather than imported, because the dependency runs the other way and
  three string literals cost less than inverting it.

  **The seeder was reading one module's registry.** `syncFeatureRegistry` took
  `FEATURE_REGISTRY` from `module-permissions` alone, which quietly meant
  "permissions is the only module allowed to declare rights". Nothing was
  missing while auth had none to declare; the moment it did, its keys would have
  been absent from `perm_feature` and therefore ungrantable. A new
  `seed/registry.ts` composes both — in the app, because neither module may
  import the other — and refuses duplicate keys and missing levels with the
  offending key named.

  Three keys: `account:profile`, `account:security`, `account:two_factor`, all
  app level, since they are about the person rather than any organization.
  Granted to **super-admin, client and normal-user** alike.

  **What is deliberately NOT gated:** the credential endpoints. Sign-in,
  refresh, forgot-password, reset-password and the 2FA challenge are reached
  BEFORE a session exists or in order to recover one; a key on any of them is a
  right you need an account to hold and an account you cannot reach without it.
  `POST /auth/change-password` and `/auth/signout-all` are also unbound — both
  already require the current password, a stronger check than a key, and binding
  them would let an administrator remove someone's ability to secure their own
  account.

  Verified: `perm_feature` holds 17 keys across two modules, super-admin has all
  17, client and normal-user have exactly the three account keys; the real demo
  account resolves `effective` to those three and still gets **403** on
  `/permissions/features`; and the settings routes are reachable for both roles.

  **Worth knowing:** the auth settings pages do NOT gate themselves — no
  `FeatureGate`, no `AdminPage` — so the catch-all's route check is the only
  thing protecting them. That check was added earlier the same day; without it
  these keys would have been decoration.

- **2026-09-05** — **A `normal-user` role and a demo account, as the control
  case for access checking.** `normal-user` is app level and holds NOTHING, and
  must stay that way: adding anything — even `admin:access` "just to see the
  dashboard" — would make every denial it exists to demonstrate ambiguous.

  It deliberately overlaps `client`, which also grants nothing. Kept apart
  because they answer different questions: `client` says "this account is a
  customer, not staff", a fact about billing and support; `normal-user` says
  "this account is here to verify that gating works". Merging them would turn a
  test fixture into a business classification. Drop it once there are real
  organization-level roles to test against.

  The account comes from `SEED_DEMO_USER_*` through a new `demo:user` seeder,
  not from a one-off script: `prisma migrate reset` drops everything, and a test
  account recreated by hand is one nobody recreates. It reuses the same
  `seedUser` the first-operator seeder uses, so both accounts are made by the
  same rules. Skipped entirely when the variables are unset, so a demo account
  cannot appear on production because someone ran the seed task.

  **Credentials live in `apps/web-server/.env`, which is gitignored.**
  `.env.example` documents the variable NAMES with empty values. (The
  pre-existing `SEED_USER_PASSWORD` in `.env.example` is still a real-looking
  password in a committed file and should be blanked the same way.)

  **Verified end to end against the running API and the real account:**
  sign-in succeeds; `myPermissions` returns `granted: []`, `grantedAtAppLevel:
  []`, `effective: []`; `GET /permissions/features` returns **403** and
  `Query.permissionFeatures` returns *"Requires all of: features:read"* with no
  data; the drawer shows no Administration group; all seven `/admin/*` pages
  refuse; and `/settings/profile` and `/settings/security` still render, since
  managing your own account is not a grantable right.

  **One inconsistency found:** `GET /permissions/me` returns an empty body for
  this user while GraphQL `myPermissions` returns the full context. The REST
  handler reads the context the guard stashes, and the guard only loads one when
  a feature is required — so an unguarded handler sees nothing. Harmless today
  (the frontend uses GraphQL) but the two endpoints answer the same question
  differently, which is the shape of a future bug.

- **2026-09-05** — **Registry BINDINGS now enforce themselves on the backend.**
  `FeatureGuard` consults the registry for any handler that declares no
  `@RequireFeature`, so `features:read` declaring
  `graphql_operation: 'Query.permissionFeatures'` guards that query by the
  declaration existing. The decorator still wins where present — it is more
  specific (several keys, `anyOf`) and it is what a reader sees on the handler.

  The alternative was to keep checking bindings in CI and leave enforcement
  manual. Rejected: a claim and its enforcement in two places is the arrangement
  that already produced the bug — `features:read` named the GraphQL query while
  the query had no guard, so the UI hid the page and the API served the data.
  Now there is nothing to drift.

  **Enforcement stays opt-in** for surfaces nobody declared: a handler with
  neither a decorator nor a binding passes through untouched, which is §4.7 and
  why sign-in and health checks need no annotation. This narrows the gap between
  "declared" and "enforced"; it does not close the one between "unguarded" and
  "deliberately public" (§12.15).

  Two implementation notes worth keeping. The guard reads the transport
  STRUCTURALLY — `getArgs()[3]` for GraphQL's `info` — rather than importing
  `@nestjs/graphql`, which is an optional peer here and would otherwise become a
  GraphQL dependency for REST-only consumers. And it binds to the SCHEMA name
  (`Query.permissionFeatures`), not the resolver method (`features`), so the
  registry does not name an implementation detail.

  The index is split into exact and parameterised entries because the guard now
  runs a lookup on nearly every request: an exact hit is one `Map.get`, and a
  miss scans only parameterised bindings, of which there are currently none.
  `enforceBindings: false` turns the whole fallback off for an app that guards
  its surfaces another way.

  **Level semantics confirmed unchanged:** checks resolve against `effective`,
  which unions app, organization and workspace grants. App-level-only was raised
  and rejected — it would have emptied the organization tier, since
  `admin:access`, `features:read`, `members:manage` and `billing:manage` are all
  organization-level.

- **2026-09-05** — **Feature checking was UI-only in places the code claimed it
  was not. Three gaps closed.**

  **1. `Query.permissionFeatures` was unguarded.** It returned the whole
  grantable vocabulary to any authenticated caller, while the UI hid
  `/admin/features` from anyone without `features:read`. The interface said one
  thing and the API said another, which is the arrangement where the API wins.
  It now carries `@RequireFeature(FEATURE.featuresRead)`, and
  `GET /permissions/features` moved from `admin:access` to the same key — two
  keys for one question is two places for them to drift. `myPermissions` and
  `GET /permissions/me` stay deliberately unguarded: asking what you hold is not
  a privilege.

  **2. `ModuleRoute.feature` claimed middleware read it. It did not.** The
  comment promised the key was read by "the navigation filter AND the app's
  middleware, so a route cannot be linked-to-but-unprotected" — but middleware
  renews a session and explicitly does not decide who may see what. So a module
  route whose component did not gate ITSELF was reachable by anyone signed in,
  with the descriptor saying otherwise. Nothing was exposed today (every
  permissions page self-gates); the next module to contribute a route would have
  been.

  **3. The catch-all now enforces `route.feature` before calling the
  component**, which makes the promise true for every module at once rather than
  asking each page to remember. Pages keep their own `FeatureGate` — a backstop,
  not a replacement, and defence in depth is cheap when both layers read the
  same key.

  Two states are deliberately NOT denials, and both were bugs waiting to be
  reintroduced: an unreachable API renders the outage panel (refusing there
  reports an outage as the reader's own fault), and no session redirects to
  sign-in. Verified end to end against a stopped API — outage panel with a
  cookie, 307 to sign-in without one. `getSessionSnapshot` is `cache()`-wrapped,
  so the catch-all's call and AppShell's are one request per render.

  **A new test suite asserts bindings match guards.** The registry's
  `rest_endpoint` and `graphql_operation` bindings are claims about where a key
  is enforced, and nothing checked them — which is how the GraphQL binding came
  to name an unguarded query. `surface-coverage.test.ts` reads the same
  decorator metadata the guard reads, so a binding and its guard cannot drift
  apart silently again.

  **Still open and worth stating:** enforcement remains opt-in (§4.7), and 8 of
  14 keys have no API binding and no server guard — `roles:manage`,
  `members:manage`, `billing:manage` and the workspace keys gate UI only. They
  are honest about it now (no binding claims otherwise), but a key that guards
  nothing on the server is a key an API caller ignores.

- **2026-09-05** — **`features:author` split into `create`, `import` and
  `update`, so a role can hold some and not others.** The registry now carries
  five keys for the feature screens: `features:read` (organization) plus
  `create`, `import`, `update` and `delete` (all app level, all privileged).

  They are three different risks, not three spellings of one:

  - **create** adds a key nobody holds yet. It grants nothing until a role picks
    it up, so the blast radius on the day is zero.
  - **import** does the same act at very different scale — a hundred keys from a
    file — and scale is the reason someone might be trusted with one and not the
    other.
  - **update** changes what an EXISTING key means, under everyone already
    holding it. That is the dangerous one, and keeping it with create would have
    made the safe right imply the risky one.

  No umbrella key was kept. An umbrella that implies the others contradicts the
  model's stated core — no inheritance, everything a role means is the list it
  carries — and would put the implication in code rather than in the row.

  Verified across seven grant sets: read+create shows only New, read+import only
  Import, read+update only Edit, read+delete only Delete, and each write page is
  reachable only with its own key. `features:author` was DEPRECATED rather than
  deleted by the next `db:sync` (14 keys upserted, one deprecated), and
  super-admin re-derived to hold all of them without an edit — both behaving
  exactly as the registry model says they should.

  **Known and deliberate:** `features:create` without `features:read` gives
  someone who can reach the create screen but not browse the list, and whose
  Back link leads somewhere they are refused. That is the honest consequence of
  genuinely independent keys rather than a hierarchy; the alternative is
  implying read from every write key, which is inheritance by another name.
  Granting read alongside is the administrator's call.

  The coarse keys elsewhere — `members:manage`, `roles:manage`,
  `billing:manage`, `workspaces:manage` — are untouched. Splitting those the
  same way is a separate decision, and this is the worked example for it.

- **2026-09-05** — **The feature admin screens got their own registry entries,
  split by LEVEL rather than lumped under `roles:manage`.** Three keys:

  | key | level | privileged | why |
  |---|---|---|---|
  | `features:read` | organization | no | someone building roles inside one organization has to see what a role can contain; the list is the dictionary, not any organization's records |
  | `features:author` | **app** | yes | a feature is a platform-wide right — inventing one is not something a tenant administrator does for their own organization |
  | `features:delete` | **app** | yes | same reason as authoring |

  The level split is the substance, not the naming. `assertRoleFeatureLevels`
  refuses an app-level feature inside an organization-level role, so an org
  administrator **cannot** be granted `features:author` at all — verified. That
  matters because anyone able to invent a feature could invent one that grants
  anything, which is exactly the escalation the level rule exists to stop.
  Previously all four screens sat behind `roles:manage`, an ORGANIZATION-level
  key, so an org admin could have reached the authoring screens.

  Enforcement is at three surfaces, from one declaration each: the route
  descriptor (nav entry + middleware), the page body via `AdminPage`, and the
  individual toolbar controls via `FeatureGate`. Verified across four grant
  sets — a reader sees the page and the nav entry but no write controls and is
  refused on the write pages; an author gets Edit/New/Import but not Delete.

  Bindings name only surfaces that EXIST: `ui_route` and `ui_component`. No
  `rest_endpoint` or `graphql_operation` binding was written, because neither
  exists — these screens emit registry source rather than calling an endpoint.
  Naming a surface that is not there would be worse than naming none, since the
  audit would then report coverage for code nobody wrote. Two new open decisions
  (21, 22) record what has to happen before that changes.

  `perm_feature` carries no `level` column — level is registry-only, which is
  consistent with the registry being the source, and worth knowing before
  anyone tries to filter by it in SQL.

- **2026-09-05** — **Importing a second file now asks Replace or Add, and the
  words were the decision.** Previously a second file appended silently, which
  is a reasonable default and a bad assumption — someone who opened the wrong
  file first wants the opposite.

  **"Replace", not "Overwrite".** Nothing has been written anywhere at this
  point: the staged rows are discarded, not overwritten in storage, and
  "overwrite" would imply the database is involved. Each label names what
  happens to the rows ALREADY STAGED rather than to the file, because that is
  the half at risk — the incoming file arrives either way.

  **Asked only when there is something to lose.** With an empty grid, "replace
  nothing" and "add to nothing" are the same outcome, so the first import is not
  interrupted by a question with one answer. Prompting regardless is how people
  learn to dismiss dialogs without reading them, which is what makes the one
  that mattered get dismissed too.

  **Parsed before asking**, so the dialog can say "12 rows from features.csv"
  rather than "the file" — and a file that could not be read reports its error
  instead of prompting for a choice about nothing.

  `ConfirmDialog` gained an optional `alternative`, a third button between
  Cancel and Confirm. Replace keeps the destructive styling and Add is neutral:
  if both were emphasised the reader would have to read both to find the safe
  one. Without the prop the dialog is an ordinary two-button confirmation, which
  the delete and clear dialogs still are.

- **2026-09-05** — **The import page became an editable STAGING GRID rather than
  an importer.** A file is parsed into an AG Grid, corrected in place, added to
  by hand, and nothing leaves the page until "Save with validation" is pressed.
  That is the difference between an import that rejects a hundred-row file and
  one that lets you fix the three rows that were wrong.

  Validation is live: `validateDraftList` runs on every edit, so the count under
  the grid tracks what is actually in it and Save is not a moment of discovery.
  Errors are DERIVED on render rather than stored beside the rows — two things
  to update on every keystroke is one thing to forget, and the day it is missed
  the grid shows an error for a value already fixed.

  `validateDraftList` was extracted so the file import and the grid share one
  implementation of the cross-row rule. It flags the SECOND use of a duplicated
  key rather than the first (the first is where the key legitimately lives), and
  a malformed key never claims a slot — claiming it would report the same
  problem twice on two rows. Eight tests.

  Two details that are correctness, not polish:
  `stopEditingWhenCellsLoseFocus` on the grid, because without it typing in a
  cell and then clicking Save DISCARDS what was typed — AG Grid keeps the editor
  open, the value never reaches the row, and the edit looks accepted; and a
  second file APPENDS rather than replacing, because wiping staged work
  (including hand-typed rows) as a side effect of opening another file is a
  destructive surprise. Clear is an explicit button and it asks first.

  Save stays disabled only on an EMPTY grid. With invalid rows it stays live and
  refuses on press — a disabled button explains nothing, and the count beside it
  already says what is wrong. Errors are outlined per FIELD, not per row: a row
  with a bad key and a good label should point at the key.

- **2026-09-05** — **The confirm dialog rendered in the top-left corner, and the
  cause was Tailwind Preflight.** A modal `<dialog>` is centred by the UA
  stylesheet's `margin: auto` against the `inset: 0` it gives `dialog:modal`.
  Preflight emits `*, ::before, ::after, ::backdrop { margin: 0; padding: 0 }`,
  which overrides it — author styles beat the UA sheet — so the dialog collapsed
  into the corner. `m-auto` restores it and wins on specificity (0,1,0 against
  the universal selector's 0,0,0).

  Worth recording rather than just fixing: it is a general consequence of using
  a native `<dialog>` in a Tailwind app, so the next one needs the same line,
  and nothing about the symptom points at a CSS reset. Noted in web-ui's README
  beside the component.

  A height cap came with it — `max-h-[calc(100dvh-4rem)]` plus `overflow-y-auto`
  — because the UA caps a modal's height but does not make the overflow
  reachable: a long list of selected rows would be clipped with the buttons
  underneath it out of reach.

- **2026-09-05** — **Feature write screens, and dynamic route segments to reach
  them.** Added `/admin/features/new/manual`, `/admin/features/new/import` and
  `/admin/features/:featureId/edit`, plus New / Import / Edit / Delete on the
  list, double-click-to-edit, and a confirmation dialog.

  **module-kit gained `:param` routes**, which it did not have —
  `ModuleRouteProps.params` existed and nothing ever populated it.
  `matchRouteWithParams` scores literal segments above dynamic ones, so
  `/admin/features/new/manual` beats `/admin/features/:featureId/edit`
  regardless of declaration order; asserted, because the alternative is a route
  that works until someone reorders `WEB_MODULES`. The old prefix fallback is
  kept and only reached when nothing matches exactly.

  **The screens produce registry source, not database rows.** This is the part
  worth arguing with. `syncFeatureRegistry` deprecates every `perm_feature` row
  absent from `FEATURE_REGISTRY`, and `assertRegistered` refuses an unregistered
  key — so a feature written straight to the table is switched off by the next
  `pnpm db:sync` and cannot be granted to anyone in the meantime. It would look
  saved and be inert. So the screens validate and compose, and emit the entry to
  paste into `feature-keys.ts`; the delete dialog says the same thing rather than
  deleting a row the next sync rewrites.

  **The open decision this raises:** should the DATABASE become the source and
  the registry a cache? That would make these screens write for real, and would
  cost the typed `FEATURE.adminAccess` constants, the build-time
  `assertRegistered`, and the property that a checkout fully describes what can
  be granted. Not taken either way here.

  Validation is one function — `validateDraft` — shared by the form and the
  import, so the two cannot disagree about what a valid feature is. Every row of
  an import is validated and reported with its source line; nothing is emitted
  until all of them pass, since half a file imported is the half nobody
  remembers to finish. CSV/TSV is parsed in-repo (thirty lines, and it is the
  format this screen documents); `.xlsx` uses `read-excel-file` behind a dynamic
  import from its `/browser` subpath — the package ships no root export — so
  someone who only pastes CSV never downloads it.

  `ConfirmDialog` in web-ui is the native `<dialog>` element, not Radix: focus
  trapping, the inert background, Escape, and the top layer are all platform
  behaviour now, and the top layer is the part a hand-rolled overlay gets wrong.
  It opens with `showModal()` rather than the `open` attribute, which renders
  inline with none of that.

  Two grid details that are correctness rather than polish: `getRowId` is the
  feature key, so sorting or filtering cannot slide a selection onto different
  rows before a bulk delete; and row activation is DOUBLE click, because single
  click is how a row is selected and making it navigate would stop anyone
  ticking a checkbox. The Edit button exists alongside it — a double-click is
  unfindable and impossible on a touchscreen, so it is a shortcut, not the only
  route.

- **2026-09-05** — **The app shell got a definite height, which fixed a latent
  scroll bug and made a full-height data grid possible.** Asked for the features
  grid to span the available height and width.

  The shell was `flex min-h-dvh`, so its height was `auto`: `flex-1` on `<main>`
  resolved against its own content and `overflow-auto` never fired. Tall content
  grew the shell and the whole PAGE scrolled, carrying the header, the drawer and
  the status bar off screen — while the status bar's own comment already claimed
  "main already owns its own scrollbar". `h-dvh` plus `min-h-0` on the column and
  on `<main>` makes that true: the chrome stays put, content scrolls inside, and
  a child asking for `h-full` finally has something to resolve against.

  Safe for the drawer, which was already `min-h-0 flex-1 overflow-y-auto` — a nav
  longer than the viewport scrolls within the sidebar rather than clipping.

  `AdminPage` gained `layout: 'prose' | 'fill'` — ONE prop, not a `wide` and a
  `fill`. A screen that wants the whole width wants the whole height for the same
  reason, and two independent flags would make three of the four combinations
  meaningless. 'prose' keeps the readable measure for forms and settings; 'fill'
  is full width with the body taking the height the heading leaves.

  `DataGrid.height` gained `'fill'`, expressed through flexbox rather than as a
  percentage: AG Grid needs a RESOLVED height, and `height: 100%` inside a parent
  that has none collapses it to nothing. `'fill'` degrades to a short grid rather
  than to no grid when an ancestor forgets its own height.

  Verified by server-rendering both variants: Features renders
  `flex h-full w-full flex-col` → `mt-6 min-h-0 flex-1` → grid `h-full min-h-0` →
  wrapper `min-h-0 flex-1`, with no max-width cap and no fixed pixel height;
  Roles still renders `mx-auto w-full max-w-4xl`, unchanged.

- **2026-09-05** — **`<DataGrid>` exists, and it follows the palette through CSS
  variables rather than a theme object per mode.** PLAN §8 had specified this
  ("build one shared theme in `@kwtech/web-ui` mapped to the Tailwind v4 tokens";
  "apps import `<DataGrid>`, never `ag-grid-react` directly") and nothing had
  been built; `ag-grid-community` and `ag-grid-react` were declared as optional
  peers of web-ui with no code behind them.

  The decision that mattered was how to follow theme toggling. The obvious route
  with AG Grid's v33+ Theming API is two JS theme objects swapped in React state.
  Rejected on three counts: the grid re-renders on every theme change, it knows
  nothing about the TEN palettes (so `data-palette="ocean"` would leave the grid
  grey), and the swap lags the rest of the page by a frame.

  Instead every colour parameter is a `var(--token)` reference. Verified by
  inspecting what AG Grid emits — it writes the REFERENCE, not a resolved value:
  `--ag-background-color: var(--background)`, `--ag-accent-color: var(--primary)`,
  `--ag-header-background-color: var(--muted)`, `--ag-row-hover-color:
  var(--accent)`. So the browser re-resolves against whatever `<html>` carries,
  and both the palette and the mode repaint with no React involvement at all.

  `browserColorScheme: 'inherit'` is the non-obvious one: native widgets inside
  the grid — scrollbars, date pickers, filter inputs — are painted by the browser
  and ignore custom properties. Without it a dark grid keeps light scrollbars.

  `DataGridColumn` is re-exported from web-ui so §8's wrapper rule holds for
  TYPES too. A page writing `ColDef` from 'ag-grid-community' would satisfy the
  letter of the rule while leaving an Enterprise upgrade just as expensive.

  **The cost, on the record:** `module-permissions` now declares
  `@kwtech/web-ui` as an optional peer, because its `/react` subpath ships real
  screens and a real screen needs a grid. That is the first module → UI-package
  edge in the workspace. It does not breach "a module ships components, not a
  design system" — web-ui is entirely token-driven, so the app still owns every
  colour — but it does mean adopting the module's React surface now implies
  adopting web-ui. `/server` consumers still pull in nothing. Revisit if a
  second frontend wants these pages with a different kit.

- **2026-09-05** — **The server composes from a list too, and the last two
  hand-kept module registries are gone.** The web side had always composed
  (`WEB_MODULES`); the server hand-wrote `AuthModule.forRoot({...})` and
  `PermissionsModule.forRoot({...})` straight into `imports`, so adopting a
  module was a different shape of edit depending on which side you were on — and
  `permissionsServerModule()` had been sitting in the package, tested and unused,
  since it was written.

  Added `authServerModule()` (module-auth had none at all) and switched
  `app.module.ts` to `SERVER_MODULES` + `serverModuleImports` +
  `serverRoutePrefixes`. Verified by booting against the live database: both
  modules' routes answer through the descriptors — `/auth/signin` 400 and
  `/permissions/features` 401 rather than 404, GraphQL still carries `viewer`,
  `session` and `myPermissions`, `/docs` 200.

  `compose-schema.mjs` had the third hand-kept list (`['module-auth',
  'module-permissions']`). It now derives from `@kwtech/module-*` dependencies,
  exactly as the web app's `next.config.ts` derives `transpilePackages`, and
  skips a module with no `prisma/` folder. Forgetting that array was the worst
  of the three to forget: it fails silently, and the first symptom is a
  migration that drops tables or a query against one that does not exist.

  Two narrowing casts were needed in `app.module.ts`, and they are the right
  shape: `serverModuleImports` returns `unknown[]` because module-kit carries
  Nest modules as opaque values so it never imports Nest. The app is the layer
  that already depends on Nest, so the narrowing belongs there — the same
  arrangement as `requestFromContext`.

  **What deliberately stays app-side**, so this is not read as unfinished:
  `resolvePrincipal` (the seam), `module-clients.ts` (the app owns the Prisma
  client), `session-query.ts` (neither module may name the other's GraphQL
  field), the `APP_GUARD` order (identify → rate-limit → authorise, with an
  app-owned guard in the middle), and `nav-icons.ts` (a descriptor naming a
  `LucideIcon` would put React into a package the Nest server imports).

- **2026-09-05** — **Nav group placement moved onto the module descriptor, and
  the Administration entries reordered.** The drawer now reads Features, Roles,
  Subscriptions, Organizations — vocabulary before the roles assembled from it,
  then commercial state.

  The larger half: the nav ENTRIES already came from the modules via
  `composeNav`, but their GROUP's position did not. The app kept a hand-written
  `GROUP_ORDER = ['Overview', 'Administration']`, so adopting a module was a
  one-line edit in `@/modules` **plus** a second edit nobody would think of — and
  forgetting it silently dropped that module's whole group to the bottom of the
  drawer. That is precisely the per-module app edit the descriptor exists to
  remove.

  `WebModuleDescriptor.navGroups` plus `composeNavGroups` / `navGroupRank` close
  it. `module-permissions` places `Administration` at 50, `module-auth` places
  `Account` at 90, and the app names only its own `Overview`. Verified: a new
  module carrying `navGroups` slots itself between Overview and Administration
  with ZERO app edits, and the same module without them lands last rather than
  first.

  Two rules, both deliberate. **Lowest order wins for a shared group** — routes
  and feature keys throw on duplicates because two modules owning one is a bug,
  but a group is a shared namespace by design, so two modules naming a position
  is normal. Taking the minimum makes the drawer independent of the order
  modules are listed in, which is the property that matters. **An unplaced group
  sorts last** — visible and harmless, where ranking it first would put an
  unknown module's pages above the dashboard on install day.

  Still app-side, and correctly so: `nav-icons.ts` maps a module's icon NAME to
  a component, because making the descriptor name a `LucideIcon` would put a
  React dependency into a package the Nest server imports. An unknown name falls
  back to a dot rather than throwing, so it degrades rather than breaks.

- **2026-09-05** — **Seeders split by OWNER and by LIFECYCLE, and the app got a
  registry so developers can add their own.** Asked whether keeping seeders in
  `apps/web-server` was a good idea. Partly: the two files were three different
  things wearing one name.

  **By owner.** `syncFeatureRegistry`, `upsertAppRole` and `grantAppRole` moved
  into `@kwtech/module-permissions/server`. They had no app-specific content —
  `FEATURE_REGISTRY` in, `perm_feature` out — and, worse, the invariant was
  split across packages: the module's READ path filters `deprecatedAt: null`
  while the write that SET it lived in the app, with nothing making the two
  agree. Change how the module represents a retired key and the app keeps
  writing the old field, no compile error, deprecation silently stops working.
  That is exactly what `satisfies-modules.ts` exists to prevent everywhere else.

  What stayed app-side is what genuinely varies: `SUPER_ADMIN`/`CLIENT` are
  product decisions a second app would answer differently, and resolving an
  email to a `userId` reads `auth_user`, which is `module-auth`'s. So
  `grantAppRole` now takes a `userId` rather than an email — the same seam as
  `resolvePrincipal` and `session-query`.

  The move needed a third structural client, `PermissionsRegistryClient`, kept
  separate from the read and write clients because it is used once by a script
  at deploy time rather than injected into a running service. It caught a real
  bug on the first typecheck: `level: string` is wider than the `PermRoleLevel`
  enum and no generated Prisma client satisfies it — the same trap already
  documented on `permSubscription.status`.

  **By lifecycle, which matters more.** `perm_role_feature` references
  `perm_feature`, so until the registry is synced a newly added key CANNOT BE
  GRANTED TO ANYONE. That is reference-data migration, not sample data, and it
  belongs on every deploy — while seeding an operator account must NOT happen on
  a deploy, or a stale `SEED_USER_PASSWORD` silently rewrites somebody's
  password. They were welded into one `pnpm db:seed`. Now `db:sync` (deploys)
  and `db:seed` (once per environment, and it runs sync first, because seed data
  references reference data).

  **And a registry.** `src/seed/seeders/index.ts` is one array, the same idea as
  `WEB_MODULES`: adding a seeder is a file plus a line, and `package.json` never
  names an individual one. `--list`, `--only` and `--phase` are on the runner.
  Every seeder must be IDEMPOTENT, which is what replaces a transaction around
  the run — one spanning every seeder would be the long-lived interactive
  transaction Prisma times out on, and would not help across invocations anyway.
  Convergence does.

  Two smaller fixes came with it. One client for the whole run, where two
  `&&`-chained scripts had meant two processes, two pools, and a half-seeded
  database when the second failed. And `prisma.config.ts` now registers
  `migrations.seed`, so `prisma migrate reset` re-seeds instead of leaving an
  empty `perm_feature` in which the app denies everyone.

  Verified against the live database: repeated `db:sync` converges (9 features,
  2 roles, no accumulation, existing grants untouched), a key absent from the
  registry is DEPRECATED rather than deleted, and `--only`, `--phase` and both
  error paths behave.

  *Rejected: leaving it all in the app.* Simplest, and it is what a second app
  adopting the module would have to copy — with the read/write invariant still
  split across a boundary nothing checks.

- **2026-09-05** — **The Administration drawer group grew to four pages, each on
  a DIFFERENT feature key.** Added Features, Organizations and Subscriptions
  beside Roles. The keys were the only real decision: `admin:access` (Roles) is
  the baseline right to open the admin app, `roles:manage` (Features) because
  the registry is the vocabulary a role is assembled from and someone who cannot
  define roles has nothing to do with it, `members:manage` (Organizations)
  because that is where people are invited and re-roled, and `billing:manage`
  (Subscriptions), which the registry already describes as entitlement rather
  than authorisation.

  Four keys rather than one is the point of declaring them on the descriptor:
  `composeNav` filters once, so someone who can manage members but not billing
  sees Organizations and not Subscriptions — instead of every page discovering
  it is not allowed after the reader has already clicked. Verified across four
  grant sets, including the empty one, which yields no Administration group at
  all.

  Features has a real screen; the other two are placeholders. The split is not
  arbitrary: `FEATURE_REGISTRY` is a constant compiled into the package, so that
  page needs no query, no resolver and no loading state, while
  `PermOrganization` and `PermSubscription` live in tables no API exposes yet.
  It renders all 9 keys across three level sections with their bindings, flags
  the 6 privileged ones, and marks what the viewer holds from `effective` rather
  than `granted` — `granted` would tick features the organization has not
  bought, which is the confusion `entitled` exists to prevent.

  Two smaller things came with it. `AdminPage` was extracted so four pages do not
  each open with their own heading markup, and `RolesPage` moved onto it —
  `module-auth`'s `SettingsPage` is the same shape for the same reason. And the
  denial path now uses `renderDenied(reason)` instead of a flat string: the
  module already separates `not_entitled` from `not_granted`, and "upgrade your
  plan" and "ask an administrator" are different errands to send someone on.

- **2026-09-05** — **The global status bar lives in `module-kit`, not
  `module-auth`.** Asked for an online/offline indicator with automatic retry,
  plus a bottom status bar any page can write to. `module-auth` was the obvious
  home — it owns the session and already polls the API in `SessionKeeper` — and
  was rejected on one test: reachability is a transport concern, and *every*
  module has something to say in a status bar. Putting the channel there would
  force `module-permissions`, and module number three, to depend on
  `module-auth` to publish a sentence, closing the cycle §9 keeps open and
  making the two-line seam between those modules a three-line one permanently.

  The rule is the one `FeatureContribution` already follows: every module
  declares, one thing renders. So the vocabulary and the store are in
  `@kwtech/module-kit` (React-free, testable without a renderer), the provider
  and hooks in a new `@kwtech/module-kit/react` entry point (so the root export
  stays runtime-free and `react` stays an optional peer), `<StatusBar>` in
  `@kwtech/web-ui`, and the probe route, monitor and host in `apps/web-app`.

  `web-ui` deliberately does not import `module-kit` — it is not a module.
  `StatusBarMessage` is declared structurally and the shapes meet in
  `StatusBarHost`, where a disagreement fails to compile. Same arrangement, same
  reason, as `satisfies-modules.ts`.

  *Rejected: an app-only channel with no module access.* Simplest, but
  `RolesPage` and the settings pages arrive from packages and would have had
  nothing to write to — the bar would be for app pages only, which is not what
  "global" means.

- **2026-09-05** — **`getSessionSnapshot` conflated "signed out" with "could not
  ask", and the redirect turned every outage into an apparent sign-out.** Found
  while deciding where the connectivity monitor should mount. With the API down,
  `viewer` came back null, `AppShell` redirected to `/auth/signin`, and signing
  in failed too — because the thing that was down was the thing sign-in needs.
  Nobody would ever have seen the new status bar, because nobody was ever left
  in a shell that renders one.

  `SessionSnapshot.reachable` now carries the distinction. A 4xx is the API
  answering (sign out and redirect); a 5xx, a rejected fetch or a timeout is the
  API failing (stay put, render an outage panel, poll). An absent cookie is
  `reachable: true` — it is an answer this app already has, and reporting it as
  an outage would put "cannot reach the server" on the sign-in page of a
  perfectly healthy deployment.

  Verified against a stopped API: no cookie still redirects (307 to
  `/auth/signin`); a session cookie now renders "Cannot reach the server" with a
  200 instead of bouncing. `SessionKeeper` needed no change — it already
  retried on `!response.ok` and only redirected on a confirmed 401.

- **2026-09-05** — **The browser cannot probe the API, so `/api/health` proxies
  it.** `API_URL` is deliberately not `NEXT_PUBLIC_`: the browser talks to this
  app's route handlers, never to the API, which is what keeps tokens in httpOnly
  cookies. A client-side probe would have published the API origin to every
  visitor to save one hop.

  The proxy is the better test anyway — it exercises the actual path every
  request takes rather than a second path that could be healthy while the real
  one is not — and it yields three answers where a direct probe yields two:
  unreachable, degraded (API up, database down) and ok. The upstream `/health`
  already drew that last distinction and it was being thrown away; it is worth
  carrying, because "we cannot reach the server" and "the server cannot reach
  its database" send someone to different people. All three verified end to end
  against a stub.

- **2026-09-05** — **Status colours are the one thing the palette does not
  own.** Every other token is named by role so a theme can change what a colour
  *is* without changing what it *means*. "Error" already means something, and it
  does not mean "whatever hue this app chose" — on the forest palette a
  palette-derived danger colour is green, which forces the reader to stop and
  *read* to learn something is broken at the one moment colour was supposed to
  tell them first.

  So the four levels are defined once in `base.css` for all ten palettes, and
  `check:contrast` was extended to measure them. It immediately caught two real
  defects in the first values: a light-mode red 0.045 outside sRGB, and
  warning/error only 0.04 apart in oklab — two tints nobody could have told
  apart. The separation check measures the *foregrounds*, not the surfaces:
  the surfaces are deliberately near-neutral tints, so two of them are always
  close, and holding them to `MIN_DANGER_SEPARATION` would force exactly the
  saturated bar the design avoids. 188 pairs green.


- **2026-08-30** — **App-level roles may collect features at ANY level; every
  other level still may not.** Asked for a `super-admin` role with all access,
  and found it was not expressible: `assertRoleFeatureLevels` required a role's
  features to match its own level, and only 2 of the 9 registry keys are
  app-level — so the strictest possible super admin could not read an
  organization's roles or fix its billing.

  The rule was kept for `organization` and `workspace` and dropped for `app`,
  because the escalation it guards against needs a lesser right to escalate
  FROM. Creating workspace roles is routine and widely delegated, which is what
  makes a workspace role holding `billing:manage` dangerous; minting an
  app-level role is a platform operation attached to no membership, so there is
  no equivalent path. An unregistered key is still refused at every level.

  *Rejected: a `platform:super_admin` wildcard that `checkFeature` short-circuits
  on.* It would have left the level rule untouched, but it contradicts the
  model's stated core — "no inheritance, no implied rights, everything a role
  means is the list it carries" — and would make a role row stop describing what
  its holder can do.

  The read path already assumed the relaxed shape: `composeContext` applies an
  app-level role at every scope and unions its features in AFTER the
  subscription filter, so an app role holding organization-level features
  resolves exactly as intended. Only the write-time assertion stood in the way.

- **2026-08-30** — **The feature registry now has a seed task, three months
  after `feature-keys.ts` started claiming it did.** `perm_feature` was empty,
  and since `perm_role_feature` carries a foreign key to it, no role could be
  granted anything at all — the registry was a source with no mirror.
  the seed task upserts every spec (now `syncFeatureRegistry` in the module,
  invoked by the app's `permissions:features` seeder), marks
  removed keys deprecated rather than deleting them (grants and the audit trail
  have to stay readable; the read path already filters `deprecatedAt: null`),
  and seeds the two app-level system roles.

  `super-admin` derives its features from `FEATURE_REGISTRY` on every run rather
  than listing them, so a key added later is granted on the next seed. A frozen
  list would leave the role named "super admin" while quietly ceasing to be
  all-access — discovered as a denied request months later.

  Both roles carry an explicit `user:organizations` cap (9999 and 5). Necessary,
  not decorative: role-sourced limits have no "unlimited" value — `resolveLimits`
  takes the MAX any app role assigns and falls back to the registry floor of
  **1** when none does, so a super admin with no limit row would have been
  capped at one organization.

- **2026-08-27** — **Revocation is now IMMEDIATE, without shortening the token
  lifetime.** `SessionRevocationStore` holds revoked sessions for exactly as long
  as an access token can live, and `JwtAuthGuard` checks it after verifying the
  signature. Entries expire on their own, so the store only ever holds the last
  few minutes of revocations — a handful of keys and an O(1) lookup, not the
  per-request database read the whole design exists to avoid.
  Two kinds of entry, because there are two kinds of revocation: **by session**
  (sign out this device; change-password, which spares the caller's own session)
  and **by user before an instant** (sign out everywhere; password reset). The
  second is one entry however many sessions existed, and it catches a token that
  was IN FLIGHT when the revocation happened — which a list of known session ids
  cannot. It compares against the token's `iat`, so `Principal` gained
  `issuedAt`; comparing against `exp` would be wrong, because two tokens minted
  seconds apart can share an expiry and the newer one, from a legitimate sign-in
  AFTER the revocation, must survive.
  **This decouples revocation from `AUTH_ACCESS_TOKEN_TTL`.** That variable was
  lowered to 5m yesterday purely to bound the window; with a denylist it is free
  to go back up, trading refresh chatter for nothing.
  ⚠️ `InMemoryRevocationStore` is correct for exactly ONE API instance. A second
  replica has its own Map and will accept a token the first just revoked — the
  same caveat the in-memory PubSub carries (§7), with the same remedy: pass a
  Redis-backed store to `forRoot`. On by default anyway, because the alternative
  to a default is no revocation at all, and an app that never scales should not
  need Redis for correct sign-out.
- **2026-08-27** — **Session cookies were killing the seven-day session.** Both
  were written with no `Max-Age` and no `Expires`, which makes them SESSION
  cookies: the browser discards them when it closes, so `AUTH_SESSION_TTL=7d`
  described a row the browser could never reach again. "Stay signed in for a
  week" actually meant "until you quit your browser". Now persistent, at
  `DEFAULT_SESSION_MAX_AGE` (= `SESSION_TTL`). The trade is stated where the
  constant is: a persistent cookie survives a browser restart, and on a shared
  machine that means the next person is still signed in as you. Most products put
  this behind a "Keep me signed in" checkbox; this one keeps people signed in
  unconditionally, which is a product decision and not a default.
- **2026-08-27** — **Middleware renews before the render**, and it is the other
  half of the same fix. Persistent cookies alone still bounced people: reopening
  after five minutes means the access token is expired, the server renders,
  `getViewer()` is null, and the shell redirects — while the refresh token sits
  unused. `SessionKeeper` cannot help, because the server decides before any
  client code runs. `renewSessionIfNeeded` returns plain `Set-Cookie` strings so
  the module imports no `next/server` (see cookies.ts for the runtime failure
  that forced that rule), and the app's `middleware.ts` applies them.
  Two details that would have half-fixed it: the renewed token is put on the
  REQUEST as well as the response, or the page still reads the old cookie and
  only the NEXT navigation works; and `/api/auth` is excluded from the matcher so
  middleware and `SessionKeeper` never rotate the same refresh token at once.
  It runs on the **Node runtime**, not Edge — it decodes a JWT payload with
  `Buffer` and reads `process.env` at request time, both of which build cleanly
  and fail on the first production request under Edge.

- **2026-08-26** — **Nothing ever called `/auth/refresh`.** The refresh cookie was
  written at sign-in and never read again, so a signed-in person was returned to
  the sign-in page after fifteen minutes with an unused week-long refresh token
  beside them. `SessionKeeper` spends it — renewing at 60% of remaining lifetime,
  plus on `visibilitychange` and `online`, because a backgrounded tab has its
  timers throttled hard and a slept laptop wakes with an expired token and a
  timer that never fired. Found while answering "can a background service check
  the token", which turned out to be the right instinct for the wrong reason.
- **2026-08-26** — **Refresh ROTATES, so multiple tabs signed each other out.**
  The update is conditional on the token presented, and the loser is told
  `session_revoked` — correct on the server, where two callers holding one token
  is indistinguishable from a theft, and wrong in a browser where it is just a
  second tab. `visibilitychange` made it near-certain: restoring a minimised
  window fires it in every visible tab at once. Fixed with Web Locks
  (origin-scoped, one renewal at a time) AND a single retry on 401 — the lock
  prevents the race, the retry covers browsers without locks and the tab opened
  mid-rotation. Both are needed; either alone leaves a hole.
- **2026-08-26** — **`AUTH_ACCESS_TOKEN_TTL` lowered 15m → 5m**, and the reasoning
  is quantitative rather than a shrug. This number IS the window in which a
  revoked or stolen access token still works, because verification reads no
  database. The cost of lowering it scales with SESSIONS, not requests: about 7
  queries/sec per 1000 concurrent users at 5m, against ~170/sec if the session row
  were checked on every request instead — so a short TTL is a ten-times-cheaper
  approximation of per-request revocation checking. Below ~2m the refresh chatter
  stops being free and the rotation races tighten.
  It BOUNDS the window; only a server-side denylist CLOSES it. Deferred until
  Redis arrives for subscription pub/sub (§7) rather than shipping an in-memory
  version that stops being correct on the second replica.
- **2026-08-26** — **A client-side token check is UX, not a control**, and the
  component says so at the top. Revocation is enforced server-side at
  `/auth/refresh` by a row; the loop makes an HONEST client notice sooner. It
  cannot make a stolen token stop working, because whoever stole it will not run
  the loop — they send the token straight to the API, which verifies it by
  signature alone. Worth building for the UX; worth never confusing for the other
  thing.
- **2026-08-26** — **The revocation window is PUBLISHED, not hardcoded in copy.**
  `SessionInfo.accessTokenTtl` exists so the sign-out-everywhere prompt can say
  "5 minutes" and keep being right when a deployment changes the variable. It is
  not a secret — derivable from any two tokens' `iat` and `exp` — and the
  alternative was a sentence that becomes a lie on the one screen where being
  precise matters most. The prompt falls back to "a few minutes" when the query
  fails: vague and true beats confident and wrong.

- **2026-08-26** — **The account-settings surface lives in `module-auth`**, not in
  the app: three pages (`/settings/profile`, `/settings/security`,
  `/settings/two-factor`) shipped as `ModuleRoute`s with nav entries, exactly as
  the sign-in pages are. Identity is the module's, so the screens for managing it
  are too — an app gets them by listing `authWebModule`, which it already does.
  They carry **no feature key**, deliberately: a key answers "may this person do
  X", and managing your own account is not a grantable right. Gating it would let
  an administrator remove someone's ability to change their own password.
- **2026-08-26** — **The password/graph split held under pressure.** `changePassword`
  and every MFA mutation take the CURRENT password, so they stayed on REST for the
  same aliasing reason sign-in did — `mutation { a: changePassword(current:"1"…)
  b: … }` is fifty guesses in one request. `changePassword` joined
  `CREDENTIAL_ENDPOINTS`, so a stolen cookie plus an unthrottled endpoint is not a
  password oracle. `updateProfile` and `mfaFactors` carry no secret and went on
  the graph.
- **2026-08-26** — **The Next proxy now forwards `/graphql` wholesale, and that is
  a deliberate widening.** Every other entry in `PROXIED` is one named action,
  because for REST the unit of authorisation is the PATH. GraphQL has one path and
  many fields, and the unit is the FIELD — every resolver runs the guards.
  Allowlisting operation names would be theatre: the name is text the caller
  chooses. What keeps it safe is the guards on the far side, not a picky handler.
  The handler also stopped collapsing non-credential responses to `{ ok: true }`:
  that collapse exists to keep TOKENS out of JavaScript, and a GraphQL envelope or
  a set of recovery codes carries none.
- **2026-08-26** — **Self-service email change was NOT built, and the page says so
  in a sentence rather than showing a disabled input.** Changing the address a
  reset is delivered to, before the new one is proved, is an account-takeover
  primitive: take a session, change the email, request a reset, receive it. It
  needs a confirmation sent to the new address with the old one still working —
  a flow, not a field. `UpdateProfileInput` has no `email` member so the omission
  cannot be undone by adding a field name to a document.
- **2026-08-26** — **"Sign out everywhere" ends THIS session too**, and the page
  states the fifteen-minute caveat rather than hiding it. Sparing the current
  device answers a different question from the one the button asks, and the person
  clicking it usually suspects a device they no longer hold. Revocation bites at
  the next refresh because access tokens are verified without a database read —
  the trade that keeps auth off the hot path, and the number to lower if it must
  bite faster. `changePassword` is the opposite: it spares the current session,
  because being signed out of the tab you just used reads as a failure.
- **2026-08-26** — **The module returns the `otpauth://` URI and draws no QR code.**
  Rendering needs a library, and a package that picked one would decide it for
  every consumer. `TwoFactorPage` takes a `renderQr` prop; until an app passes
  one, the page shows the base32 key, which every authenticator accepts. The doc
  recommends rendering server-side to a data URI — a client-side QR library keeps
  the secret in the browser's heap for as long as the tab is open.

- **2026-08-26** — **GraphQL is mounted, code-first, and no module is named in
  the app's configuration.** `GraphQLModule.forRoot(graphqlOptions())` is the
  whole registration; a module's resolver is an ordinary provider it already
  declares (`expose.graphql`), so its queries reach the schema by the module
  being imported. `schema.graphql` is emitted at boot and committed — §6 makes it
  the contract the frontend generates from, so a resolver change that alters the
  public schema shows up in review rather than in a frontend build days later.
  Excluded from Biome for the same reason `next-env.d.ts` is: formatting a
  generated file is churn the next boot reverses.
- **2026-08-26** — **THREE guards each assumed HTTP, and each broke GraphQL
  differently.** `JwtAuthGuard` read `.headers` off undefined; `FeatureGuard`
  would have resolved nobody and refused everyone; `ThrottlerGuard` read `.ip`
  off undefined. All three now share ONE function, `requestFromContext` —
  `module-auth` gained the `getRequest` hook `module-permissions` already
  published, and the throttler takes an override because it is third-party code.
  Two ways of finding the request is two chances for authentication and
  authorisation to disagree about who is calling, and it is what will let the
  subscription handshake reuse the same path rather than inventing a fourth.
- **2026-08-26** — **§12.6's split settled in practice: credential exchange stays
  REST, reads move to the graph.** Not a compromise — moving sign-in onto GraphQL
  would be a security regression. One operation may repeat a field under
  different aliases, so `mutation { a: signIn(…) b: signIn(…) … }` is fifty
  password attempts in a single HTTP request the per-IP throttler counts once;
  aliasing is core to the language and, unlike batching, cannot be switched off.
  The tight `credential` bucket is also selected by matching the resolved handler
  against `AuthController`, which has no equivalent when every operation is one
  POST. Cookies and sign-out's 303 finish the argument. Six routes stay REST
  (`signin`, `verify-mfa`, `refresh`, `signout`, `forgot-password`,
  `reset-password`); `viewer` and `session` are the module's first two queries.
- **2026-08-26** — **The shell went from two sequential REST calls to one GraphQL
  request.** `GET /auth/profile` then `GET /permissions/me` each paid a full
  round trip before the next could start. `@/lib/session-query` asks for both
  fields in one operation, and it lives in the APP because neither module may
  name the other's field (§9) — composing them is what an app is for. Wrapped in
  React `cache()`, so the shell and the page it wraps share one response; that
  closes the duplicate-`getViewer()` note the dashboard carried. Each module
  still ships its own `/next` helper for an app that wants them separately.
- **2026-08-26** — **A circular import cost a boot.** `permissions.module`
  imports the resolver it registers; the resolver imported the DI token back from
  it, so ESM handed it a binding still in its temporal dead zone and the
  decorator ran with `undefined`. Nest failed with `can't resolve dependencies of
  the PermissionsResolver (?, PermissionsService)` — naming the argument position
  but not the cause, and suggesting `import type`, which is the opposite of the
  problem. The token moved to `permissions.tokens.ts`, a file that imports
  nothing. `FeatureGuard` had survived the same cycle by an accident of
  evaluation order, which is not a property worth relying on twice.

- **2026-08-26** — **`APP_NAME` is the single source for every displayed product
  name.** It was three independent strings — the email brand, the authenticator
  entry, and a hardcoded `kwtech` in the side drawer — which is three chances to
  rename two of them, and the one that gets missed is always the one a customer
  sees. `MAIL_BRAND` and `AUTH_MFA_ISSUER_LABEL` are now overrides that fall
  back to it, resolved in the zod transform so every call site reads a `string`
  rather than a `string | undefined` it has to remember to default.
  The `From:` display name is composed from it too — a bare `MAIL_FROM` gets the
  name attached, a full `Name <addr>` is left alone. That header is the only part
  of an email every inbox shows in its list view, so a stale name there is the
  most visible way a rename can be half-done. The two-letter drawer mark is
  derived (`KWTech` → KW, `Northwind Trading` → NT) rather than configured,
  because a third variable is a third thing to update to save one lookup.
- **2026-08-26** — **`APP_NAME` is set TWICE, once per app, and nothing enforces
  that they match.** `apps/web-server` and `apps/web-app` are separate processes
  with separate environments and no shared configuration; the alternative — the
  web app fetching its own name from the API — puts a request in front of the
  first paint to save a duplicated line. Documented in both `.env.example`s
  instead.
- **2026-08-26** — **The web app's name is NOT `NEXT_PUBLIC_`.** That prefix
  inlines at build time, so one built image could never run under two names and a
  rename would need a rebuild rather than a restart. The drawer is a client
  component, so the value is read on the server and passed down as a prop, and
  the browser tab moved from a static `metadata` export to `generateMetadata()`
  for the same reason — a static export is evaluated when the route is built.

- **2026-08-26** — **Email copy moved out of TypeScript into template files**
  (`apps/web-server/src/mail/templates/`, rendered by `render.ts` with Eta).
  The code passes FACTS — a name, a URL, a duration — and the template writes
  the sentences, including the subject, which lives on a `Subject:` first line
  in the `.txt` twin so the HTML and text parts cannot disagree about it.
  The trigger was a **real bug**: `displayName` is free text the account holder
  chooses, and the string-concatenated version interpolated it into the HTML
  unescaped. A display name of `<a href="https://evil.example">Reset here</a>`
  rendered as a live link inside a genuine, DKIM-signed password-reset email —
  a phishing primitive handed to anyone who can edit their own profile. Mail
  clients strip `<script>`; they do not strip anchors.
  **The property selected for was escaping-by-default, not "templates are
  files".** The obvious file-based version — `.html` plus
  `.replace('{{url}}', url)` — has exactly the same hole, only harder to see
  because the template and the interpolation are in different files. Eta escapes
  `<%= %>` by default; `<%~ %>` is the opt-out and appears once, inserting an
  already-escaped body into the layout. The `.txt` part renders through a second
  Eta instance with escaping OFF, because escaping a plain-text part is how text
  alternatives end up showing `&#39;` to a reader.
  Rejected: **react-email** — it is the better DX but puts React into an API with
  sixteen dependencies and none of them React; revisit at ~10 emails or when
  someone non-technical needs the preview server. **MJML** — solves Outlook's
  Word-based rendering engine, which is a real problem for laid-out marketing
  mail and not for two paragraphs and a button. **Provider-hosted templates
  (Postmark/Mandrill)** — the copy of a security email is load-bearing and
  reasoned about in this repo; moving it to a vendor dashboard drops the review
  trail and does not survive a provider change.
- **2026-08-26** — **HTML comments in an email template are DELIVERED.** Found
  by capturing an actual message off the wire: 922 of 4005 characters were
  engineering notes, including the reasoning behind the enumeration-oracle
  wording, sent to every recipient. Eta strips `<% /* … */ %>` and does not
  strip `<!-- … -->`. Converted, and `test/render.test.ts` now asserts no `<!--`
  survives a render. Gmail also clips a message at ~102KB and hides the
  remainder, so the bytes were never free either.
- **2026-08-26** — **Two build-level gotchas that file-based templates bring**,
  both now handled and both silent failures otherwise:
  `tsc` copies nothing but JavaScript, so `nest-cli.json` needs an `assets`
  entry or the templates compile fine and are absent at runtime; and Biome
  parses `.html`, chokes on `<%` as an unescaped `<`, and **a file it cannot
  parse is a file it silently stops checking** — so `biome.jsonc` excludes the
  template directory explicitly rather than incidentally.
  Paths resolve from `import.meta.url`, never `process.cwd()`: a container's
  working directory is whatever the entrypoint chose.
- **2026-08-26** — The reset email is **rendered before the no-mailer branch**,
  not inside the sending path. Rendering only when SMTP is configured would mean
  a broken template — a renamed field, a typo in a tag — first surfaced in
  production, because the whole of local development runs down the other branch.

- **2026-08-26** — **2FA is implemented for TOTP**, replacing the schema-only
  state recorded on 2026-08-25. The whole feature turns on one line: `refresh()`
  **re-derives the token scope from `AuthSession.mfaSatisfiedAt`** instead of
  carrying over the scope of the token it replaces. Without that, the `mfa`
  scope is decorative — sign in, wait fifteen minutes, refresh, and be `full`
  for having done nothing. It is the property `test/mfa.test.ts` spends the most
  tests on.
  Everything else follows from decisions the schema already fixed: `confirmedAt`
  keeps an unconfirmed factor inert, `lastUsedStep` is advanced in a CONDITIONAL
  update so two requests carrying the same code race in the database rather than
  in application code, and `mfaSatisfiedAt` is per session. Recovery codes are
  scrypt-hashed and scanned one at a time — ten hashes is about a second, which
  is a rate limit that needs no configuration on a path used once a year.
- **2026-08-26** — **The TOTP secret is encrypted, not hashed, and the key is
  configuration** (`AUTH_MFA_SECRET_KEY`, AES-256-GCM in
  `server/secret-box.ts`). Unlike a password hash a TOTP secret is symmetric: a
  stolen row generates valid codes forever, so hashing is not available and
  plaintext defeats the factor entirely on one dump. GCM rather than CBC or CTR
  because it authenticates — without a tag a stolen row can be *edited*, and the
  verifier would derive codes from an attacker's secret while reporting nothing
  unusual. Deliberately NOT the same value as `AUTH_JWT_SECRET`: rotating that
  one to respond to a token incident would otherwise lock every 2FA user out.
  Unlike the JWT secret it does **not** fail the boot when absent — an app with
  no 2FA users has no reason to hold it — so enrolment refuses instead, the same
  shape as `sendPasswordResetEmail`.
- **2026-08-26** — **`AuthUser.mfaRequiredAt` is recorded but NOT enforced at
  sign-in**, and that is deliberate rather than unfinished. A user who is
  required but has not enrolled cannot satisfy a challenge, so holding them at
  one locks them out with no way forward. Enforcing the policy needs a fourth
  `TokenScope` admitting the enrolment endpoints and nothing else — and adding a
  scope quietly is the change §12.8's reasoning exists to prevent, since every
  already-issued token was minted by a verifier that did not know about it.
- **2026-08-26** — **TOTP is written out rather than taken from a dependency**
  (`server/totp.ts`, ~40 lines), pinned by RFC 6238's own test vectors including
  the T=20000000000 one that catches a 32-bit counter. On a path where a silent
  difference means either "nobody can sign in" or "any code works", vectors are
  a better argument than a download count. SHA-1 is kept, despite being SHA-1:
  every authenticator app assumes it, `algorithm=SHA256` is quietly ignored by
  enough of them that enrolment would appear to work and then reject every code,
  and HMAC is not affected by the collision weaknesses that retire SHA-1
  elsewhere.
- **2026-08-26** — **Enrolling or removing a factor requires the CURRENT
  PASSWORD**, not just a valid session. A stolen cookie must not be enough to
  add an authenticator the real owner does not hold, or to strip the one they
  do — the second is the first move an attacker on a session would make.
  Confirming an enrolment also **revokes every other session**, which is what
  keeps the refresh rule above from challenging a user on devices they were
  already signed in on, minutes after enrolling, with no explanation.
- **2026-08-26** — **The Next proxy learned to FORWARD the session cookie**, for
  exactly one action. `PROXIED` is an allowlist and stays one; `verify-mfa` sets
  `sendsSession` because the credential it needs — the half-admitted `mfa`
  token — is already in an httpOnly cookie the page cannot read. An `mfa` token
  is refused at every endpoint but that one, so forwarding it widens nothing.
  The proxy also now returns `{ ok: true, mfaRequired }`: the tokens stay in the
  cookies, and that flag is the only field of the API's answer that crosses back
  into JavaScript, because the sign-in page cannot route without it.
- **2026-08-26** — **The `credential` throttler bucket was declared but wired to
  nothing.** `/auth/signin` and `/auth/forgot-password` had been sitting in the
  default bucket at 120/min per IP since it was added, while USAGE.md §6 claimed
  both halves of the brute-force defence were in place; only the per-account
  lockout was. Fixed with `CredentialThrottlerGuard` in the app, which matches on
  the handler reference the module exports (`CREDENTIAL_ENDPOINTS`) rather than
  on URL strings — a URL list would be a second list, in a second place, that
  stops covering an endpoint the day the module adds one. A `@Throttle`
  decorator in the module was the obvious alternative and was rejected: it would
  make `@nestjs/throttler` a dependency of every consumer, including ones that
  never mount an HTTP server.
- **2026-08-26** — **SMTP is wired, as one `SMTP_URL` rather than five
  variables**, because that is the form every provider documents and five
  variables is five chances to set four of them. Postmark, Mandrill, SES and
  Resend all fit it, so choosing one later is a value change and not a code
  change. Production now **fails to boot** without it (`config/env.ts`) instead
  of 500ing on the first reset form of the quarter.
  The send is deliberately **NOT awaited**: `requestPasswordReset` returns
  immediately for an address it does not recognise, so awaiting an SMTP round
  trip would make the known-address path measurably slower — an
  account-enumeration oracle in the response time, defeating the identical 202
  the endpoint goes to some trouble to produce. The cost is that a delivery
  failure cannot be reported to the caller, which the design already answers:
  the raw token exists only in that closure, so a failed send means the user
  asks again.

- **2026-08-25** — **The frontend was not actually styled**, and the reason was
  worse than a missing palette. Tailwind ignores everything reachable through
  `node_modules` — which is how every workspace package is reached under pnpm —
  so it never saw the module pages' class names at all. Not merely unthemed:
  `rounded-md` and `px-3` were missing too, because Tailwind only emits classes
  it has seen written down. Proof it was that and not the palette: `min-h-dvh`
  was present (used in the app's own `page.tsx`) while `rounded-md` was not
  (used only inside `module-auth`). Fixed with `@source` lines in the app's
  globals.css, mirroring `WEB_MODULES` in `src/modules.ts` — a glob over
  `packages/*` would scan packages the app does not compose.
- **2026-08-25** — Design tokens filled in (`@kwtech/web-ui/styles.css`): a
  neutral oklch palette named by ROLE, `@theme inline` so `.dark` can swap them,
  and a class-based `dark` variant for `next-themes`. `@theme` had been left
  empty "until the first real component needs one" — components that needed
  them were then written, so `bg-background`, `text-foreground` and the rest
  resolved to nothing.
- **2026-08-25** — **Sign-in went nowhere.** `SignInRoute` rendered
  `<SignInPage />` with no `onSignedIn`, so a successful sign-in set the cookies
  and left the user looking at the form. It now navigates, and does so with a
  FULL page load rather than a client-side route change — the session cookie is
  httpOnly, so only the server can see it, and a soft navigation would re-render
  from a client cache that still believes nobody is signed in.
- **2026-08-25** — `?next=` is honoured only when app-relative. An absolute URL
  would make the sign-in page an open redirect, sending a freshly authenticated
  user to an attacker's page wearing the trust of having just arrived from ours.
  Verified: `?next=https://evil.example` resolves to `/`, `?next=/settings` is
  kept.
- **2026-08-25** — **A place to land**: the home page is a server component that
  reads the httpOnly cookie, and there is a sign-out. Signing out does BOTH
  halves — revokes the session server-side and clears the cookies — because
  clearing cookies alone leaves anyone who captured the refresh token holding a
  working session for its full week. The cookies are cleared even when the
  revoke call fails: being stuck signed in on a shared machine is the worse
  outcome.
- **2026-08-25** — `GET /auth/profile` added, separate from `/auth/me`. `/me`
  returns the token's claims and reads no database, which is what makes it cheap
  enough for every page load; `/profile` reads the user row for a page that
  wants to greet someone by name. Keeping them apart also means the profile read
  is the thing that notices a user suspended or deleted since the token was
  issued — the token stays cryptographically valid until it expires.

- **2026-08-25** — **`pnpm dev` starts the whole stack**: every package in watch
  mode plus both apps, one command. Ports moved to **:8080** (API) and **:8081**
  (web) to sit clear of the sibling repos on this machine.
  - Packages gained a `dev` watcher, without which editing a module changed
    nothing in the running apps until someone remembered to rebuild.
  - `dev` dependsOn **`^build`**, not `^dev`: a persistent task never finishes,
    so nothing can depend on it. The one-shot build is what makes a cold
    checkout work; the watchers take over afterwards.
  - A package's `build` and its `dev` watcher compile the same project into the
    same `dist/`, so they are given **separate build-info files**. Sharing one
    lets whichever loses the race conclude "nothing changed" and emit nothing.
  - Verified from a cold start with every `dist/` deleted, and by editing a
    module source and watching the change reach the rendered page.
- **2026-08-25** — `tsBuildInfoFile` moved inside `dist/` for the packages too,
  after the same trap that had already bitten `web-server` broke the first cold
  `pnpm dev`: `rm -rf dist` left the build info behind, tsc read it, concluded
  nothing had changed and emitted nothing — reported three packages later as
  "Cannot find module '@kwtech/module-kit'".

- **2026-08-25** — **Local Postgres 16 on WSL2** (apt, not Docker): systemd is
  already enabled in `/etc/wsl.conf`, which is the only thing that usually makes
  Postgres-on-WSL awkward, so a container would add a daemon and a disk penalty
  for nothing. Note what it does NOT reproduce: the connection-churn behaviour
  §5's pooling requirement exists for.
- **2026-08-25** — **Phase 1 finished for real.** The first two migrations ran
  against a live database: 21 tables, both module fragments composed into one
  schema, and the whole flow verified end to end — sign-in by username and by
  email (200), wrong password (401), forgot-password (202 for a real address and
  an unknown one alike), reset token stored as a 64-char hash with a one-hour
  life, and the Next app setting both cookies `HttpOnly` while its response body
  carries only `{"ok":true}`.
- **2026-08-25** — **`AuthUser.username` added, and sign-in takes an
  `identifier`** — one field accepting either an address or a username.
  Unambiguous because a username may not contain `@`, which is the single
  restriction that keeps the two namespaces from overlapping; without it someone
  could register the username `you@example.com` and make every lookup ambiguous.
  Normalised (lower-cased, NFKC) exactly like email, for the same reason:
  `Gilbert95` and `gilbert95` must not be two accounts. `displayName` holds the
  human name and is never an identifier.
- **2026-08-25** — **The first account is a seed script, not a sign-up
  endpoint.** Who may create an account — open registration, invite-only,
  administrator-provisioned — is three different products and is not decided.
  `pnpm db:seed` is idempotent (re-running resets the password, which is the
  usual reason to run it again) and reads its values from the environment so a
  real password is never committed.
- **2026-08-25** — The seed **warns rather than refuses** when the password
  misses the application's own policy. Refusing would block an operator who
  chose a value deliberately for a local database; staying silent would be worse
  — a password the app will not let you CHOOSE but happily lets you keep is a
  trap that surfaces months later at a password reset. ⚠️ The seeded
  `Master101!` is 10 characters against a `MIN_PASSWORD_LENGTH` of 12 and is in
  exactly that state today.
- **2026-08-25** — **2FA is schema-only** (`auth_mfa_factor`,
  `auth_recovery_code`, `AuthSession.mfaSatisfiedAt`, `AuthUser.mfaRequiredAt`)
  plus a reserved `mfa` token scope. Nothing implements it. Four decisions taken
  now because they are the ones that cannot be taken later:
  1. **`confirmedAt`** — a factor is inert until proved once. Without it, a
     mis-scanned QR code locks a user out with a factor they can never satisfy.
  2. **A TOTP secret is SYMMETRIC, unlike a password hash**, so it must be
     encrypted at rest with a key that is not in the database. Left a plain
     column deliberately, so whoever implements TOTP has to decide explicitly
     rather than inherit a silent default.
  3. **`lastUsedStep`** — replay protection. A 6-digit code is valid for its
     whole window, so an observed code can be presented again without it.
  4. **`mfaSatisfiedAt` is per SESSION, not per user** — one device may have
     completed MFA while another, opened earlier, has not.
  The `mfa` scope had to be reserved in `TokenScope` now: adding it later would
  mean every already-issued token was minted by a verifier that did not know it
  existed. `resolvePrincipal` admits `full` only, so the new scope grants nothing
  anywhere by default.
- **2026-08-25** — **Biome's `useImportType` broke DI a second time**, in
  `apps/web-server` this time — the override was scoped to `**/src/server/**`,
  which protected the modules and missed the app that is Nest from top to
  bottom. It erased `PrismaService` in `HealthController` and the app failed to
  boot with "argument Function at index [0]", naming neither the file nor the
  cause. The override is now scoped by what the code IS, not by a directory that
  happens to be called `server`.
- **2026-08-25** — `tsBuildInfoFile` moved **inside `dist/`**. With it beside
  the tsconfig it outlived every `rm -rf dist`, after which tsc read it,
  concluded nothing had changed and emitted nothing — silently, with the failure
  surfacing later as a module-not-found pointing nowhere near the cause.

- **2026-08-25** — **Authentication went into a NEW `module-auth`, not into
  `module-permissions`** (§12.12 closed: no). Credentials and reset tokens are
  the most identity-shaped data there is, and §9 rule 5 exists to keep the
  permissions module free of them. What the boundary buys, concretely: an
  external IdP stays possible without migrating the permission tables, and two
  apps on two databases can still share `module-permissions`.
- **2026-08-25** — **The two modules meet in exactly one function**,
  `apps/web-server/src/auth/resolve-principal.ts`. Auth verifies a token and
  leaves a Principal on the request; that function reads the `userId` off it and
  hands it to permissions. Neither package imports the other; both depend only
  on `module-kit`. Extracted from an inline arrow in `AppModule` so it can be
  tested — it is the highest-consequence function in the app.
- **2026-08-25** — **A step-up (`pwd_change`) token resolves to no permission
  context at all.** Otherwise a user who must change their password would be
  authorised normally everywhere except the one endpoint that checks scope,
  making the restriction decorative.
- **2026-08-25** — **§12.8 closed: NestJS issues the JWT**, Auth.js is not
  adopted. §5 puts the API on a different host and §7 rides subscriptions over
  one socket, so REST, GraphQL and the WS handshake need one issuer and one
  verification path. Auth.js would have left the API verifying a session it did
  not mint, and forgot/reset-password is hand-built either way.
- **2026-08-25** — Access token (15m, stateless) + opaque refresh token
  (**1 week**, addresses a revocable `auth_session` row). Split deliberately:
  verification reads no database, which keeps auth off the hot path, and the
  cost is that revocation lags by the ACCESS token's life. `AUTH_SESSION_TTL`
  and `AUTH_ACCESS_TOKEN_TTL` are separate env knobs for exactly that reason —
  raising the second to a week would make "sign out everywhere", suspension and
  a password reset all take seven days to bite. Note this diverges from masterdb,
  which sets a 7d access token *and can*, because its guard re-reads the session
  row on every request.
- **2026-08-25** — **The credential path tells the caller nothing.** One message
  and one status for unknown address, wrong password, locked account, suspended
  account and expired session — and the same amount of WORK, via a dummy scrypt
  verify when the address does not exist, because a millisecond-vs-100ms
  difference answers the question the status code refuses to. `AuthFailureReason`
  exists for the operator hook and never reaches a response.
- **2026-08-25** — Forgot-password answers identically whether or not the
  account exists. "No account with that email" is an enumeration oracle that
  needs no password guessing at all, and it ships constantly because it reads as
  helpful.
- **2026-08-25** — Reset tokens are **stored hashed, single-use, and revoke every
  session on consumption**. Someone resetting a stolen password is not helped by
  a reset that leaves the thief signed in.
- **2026-08-25** — scrypt from `node:crypto`, not argon2id: every argon2 binding
  needs a native build step and `allowBuilds` is kept short on purpose (§2). The
  stored hash is self-describing (`scrypt$N=…$salt$hash`), so moving to argon2id
  later costs no migration and no forced reset.
- **2026-08-25** — **Federated identity is in the SCHEMA only** — `auth_identity`
  with `AuthIdentityProvider { google, microsoft }`, nothing implemented. Two
  properties cannot be retrofitted without a data migration and a security
  review, so they are fixed now: the match key is the provider's **`subject`**
  claim and never email (matching on email is the classic federated
  account-takeover), and `emailVerifiedByProvider` gates auto-LINKING to an
  existing account. Provider access/refresh tokens are deliberately absent —
  nothing calls provider APIs, and storing them meanwhile is a liability with no
  reader.
- **2026-08-25** — **Tokens never reach client JavaScript.** The API sets no
  cookies (no CSRF surface, and a mobile app can use the identical mechanism), so
  `apps/web-app/src/app/api/auth/[action]` proxies the three unauthenticated
  actions and sets httpOnly cookies. It is an allowlist, not a pass-through: a
  general proxy would let the browser reach every endpoint with the session
  attached.
- **2026-08-25** — Next needed a **required** catch-all (`[...slug]`), not the
  optional one §12.11 implied: an optional catch-all also matches `/` and
  collides with the app's own root page. Required is the honest shape anyway.
- **2026-08-25** — **Three bugs found only by running it**, none visible to
  typecheck or unit tests:
  1. **Two copies of `@nestjs/common`** (11.2.1 in the modules' devDeps vs
     11.1.29 in the app). Nest decides an HTTP status with
     `instanceof HttpException`, so every 401 and 400 raised inside a module
     reached the client as a **500**. Fixed by cataloguing `@nestjs/*` and
     `reflect-metadata` in `pnpm-workspace.yaml` — a second copy is not a
     duplicate, it is a bug.
  2. **`Reflector` is auto-provided in the ROOT injector only**, so both guards
     failed to construct inside their dynamic modules. Both modules now list it,
     and `APP_GUARD` uses `useExisting` rather than `useClass` — `useClass`
     builds a second instance in the app's injector, where it is absent again.
  3. **Prisma 7 emits ESM-targeted source** (`import.meta.url`), so
     `apps/web-server` must be `"type": "module"`. Under CJS the generated client
     died at import with "exports is not defined in ES module scope".
- **2026-08-25** — **A compile-time assertion that the app's PrismaClient fits
  each module's structural interface** (`src/prisma/satisfies-modules.ts`).
  `{ provide: X, useExisting: PrismaService }` is typed as `Provider` — token and
  class, with no relationship TypeScript checks — so the property the whole
  database-agnostic design rests on was being taken on trust in the one place it
  matters. Adding the assertion immediately found two type lies in
  `module-permissions`: `permSubscription.findMany` declared `status: string`
  where the schema has an enum, and `RoleWithFeatures` declared a required
  `limits` that the membership and workspace-member queries never include.
- **2026-08-25** — `$transaction` is the one thing PrismaService cannot satisfy
  structurally — it is overloaded, and TypeScript gives up on the comparison once
  Prisma's generics are involved. The app supplies a small adapter
  (`src/prisma/module-clients.ts`) with one narrow, commented cast, rather than
  loosening the modules' `$transaction` to `any` and discarding the transaction
  handle's type inside every write in both modules.
- **2026-08-25** — Validation stays in `AuthService`, not a global pipe. §12.6 is
  still open between a zod pipe and `class-validator`, and a module that picked
  one would decide it for every consumer; a pipe also only guards HTTP, while the
  same service is reachable from a CLI, a worker and a test.


- **2026-08-25** — Repo scaffolded: Turborepo v2 + pnpm workspaces.
- **2026-08-25** — Scope set: 5 apps (api, web, admin, worker, cli).
- **2026-08-25** — **Stack decided:** NestJS + GraphQL + WebSocket subscriptions +
  REST + Prisma + Postgres; Next.js + Tailwind + Apollo + AG Grid Community.
  Supersedes the earlier tRPC-vs-GraphQL analysis, now dropped.
- **2026-08-25** — REST client: `openapi-typescript` + `openapi-fetch`;
  `@tanstack/react-query` deferred until REST needs caching (§6).
- **2026-08-25** — Deploy split: Vercel hosts the Next.js apps only; `apps/web-server`
  and `apps/worker` need a container host, because Vercel cannot hold WebSocket
  connections (§5).
- **2026-08-25** — **Reference repo switched** from `coseller-mono` to
  `masterdb-mgt-tool` (newer). Consequences absorbed: Biome replaces
  ESLint + Prettier (the `eslint-config` and `typescript-config` packages were
  deleted); `tsconfig.base.json` replaces the tsconfig package; pnpm 11 with
  `catalog:` + `allowBuilds`; Node >= 22; Turbo 2.10.8; lefthook + commitlint
  adopted now rather than deferred; Prisma 7 with driver adapters; Next 16;
  Apollo Client 4; Tailwind 4; AG Grid Community 36.
- **2026-08-25** — Noted that masterdb has **no** GraphQL server yet, making
  Phase 3 the highest-risk phase and `coseller-mono` its only reference (§6).
- **2026-08-25** — **Initial scope narrowed** to `apps/web-server`,
  `apps/web-app`, `packages/web-ui`, `packages/module-permissions`. `admin`,
  `worker`, `cli` and `mobile-ui` move to later phases.
- **2026-08-25** — `packages/ui` renamed `packages/web-ui`, leaving room for a
  future `mobile-ui`. Peers: react, react-dom, tailwindcss 4, ag-grid-community
  and ag-grid-react 36.
- **2026-08-25** — **Feature-module pattern established** (§9): one package,
  pure core plus `/nest` and `/react` adapters behind subpath exports, framework
  deps as optional peers, app-supplied wiring via `forRoot`. `module-permissions`
  is the first instance and the template for the next module.
- **2026-08-25** — Flagged that `web-` is the wrong prefix for a platform-neutral
  domain module (§10) — rename to `@kwtech/permissions` recommended, §12.9.
- **2026-08-25** — `web-permissions` renamed **`module-permissions`** and widened
  from a shared-logic package into a **full vertical feature module** (§9):
  Prisma schema fragment, domain entities and processes, GraphQL object types and
  resolver, Nest wiring, React components, client operation documents. The
  `module-*` prefix supersedes open decision §12.9, which is closed.
- **2026-08-25** — **Modules are database-agnostic.** No `@prisma/client`
  dependency; `PermissionsService` depends on a structural `PermissionsPrismaClient`
  the host injects. Two apps on two different databases can consume the same
  module. Consequence: one Prisma schema per *database*, not one per repo (§12.2).
- **2026-08-25** — GraphQL hooks generate app-side; modules ship documents and
  presentational components. Splitting a module into `-web` is the escape hatch
  if hooks must live inside it (§9).
- **2026-08-25** — **`@kwtech/module-kit` extracted** so module registration is
  generic across an indefinite number of modules: descriptor types, `composeRoutes`,
  `composeNav`, `composeFeatures`, `matchRoute`, and the Nest import/prefix
  helpers. Duplicate paths and duplicate feature keys throw at composition time.
  `FeatureContribution` moved here — every module declares rights, only
  `module-permissions` enforces them.
- **2026-08-25** — Module endpoints auto-register server-side:
  `PermissionsModule` now declares its own `controllers` and resolver providers,
  with `forRoot({ expose })` to opt a transport out. Swagger picks the routes up,
  so they reach `openapi.json` and the generated frontend types with no app wiring.
- **2026-08-25** — Next.js **cannot** auto-register routes from a package (no
  plugin API; filesystem discovery only). Modules declare routes as data; nav and
  middleware derive from it automatically; the page file itself comes from a
  catch-all, a thin re-export, or a generated stub. §12.11.
- **2026-08-25** — **`module-permissions` data model expanded** to users,
  organizations, workspaces, roles, features and subscriptions (11 Prisma
  models). Hierarchy: user → organization → workspace, both levels shared
  explicitly (`PermMembership`, `PermWorkspaceMember`).
- **2026-08-25** — Core design rules fixed with the model, all reflected in the
  types: permissions answer per (user, organization, workspace), never per user
  alone; **role grants and plan entitlements stay separate** so a denial can say
  which it was; scope is a filter, not a precedence chain, and a null workspace
  is never a wildcard; three subscription states (`entitled: null` / `[]` / a
  plan) so a lapsed organization is not silently granted everything;
  "see all workspaces" is a granted right, not a structural rule.
- **2026-08-25** — Identity boundary left OUTSIDE the module for now (§12.12);
  `userId` carries no foreign key.
- **2026-08-25** — **Feature defined precisely**: the smallest thing a user can
  be given access to, with a *binding* naming where it is enforced. Eight
  surfaces — `rest_endpoint`, `graphql_operation`, `graphql_subscription`,
  `graphql_field`, `job`, `cli_command`, `ui_route`, `ui_component`. The test for
  adding a surface is a genuinely different enforcement *moment*, which is why
  subscriptions are separate from operations and `ui_action` is not a surface.
- **2026-08-25** — Bindings made load-bearing rather than decorative:
  `auditRegistry()` reports unbound keys and surfaces claimed by two keys,
  `assertRegistered()` catches keys used in code but missing from the registry,
  and `ui_route` bindings are derived from route descriptors instead of written
  twice. Both run from the seed task and a test so drift breaks CI.
- **2026-08-25** — Record-level access ("may I edit *this* document") explicitly
  **not** a feature — it is a data policy, and forcing it into the registry
  yields a key per record. To be modelled separately when needed.
- **2026-08-25** — **Roles are a named collection of features, at three levels** —
  `app`, `organization`, `workspace` — and every feature carries the level a role
  must be at to grant it. No inheritance, no precedence: level filters, it does
  not override, so there is no "which wins" rule (the same reason there is no
  deny rule).
- **2026-08-25** — App-level roles get their own grant table `PermUserRole`: a
  membership is (user, organization) and an app-level role has neither an
  organization nor a workspace to hang from. Consequence handled — a user with
  only app-level roles has no membership, and `loadContext` still returns a
  usable context rather than null, or support would be locked out of every
  organization.
- **2026-08-25** — `assertRoleFeatureLevels()` enforces that a role only collects
  features at its own level. Otherwise a workspace role could hold
  `billing:manage`, making the routine right to create workspace roles a path to
  organization-wide privilege. It throws rather than filtering silently.
- **2026-08-25** — App-level grants **bypass plan entitlement**
  (`grantedAtAppLevel` on the context): a lapsed organization is when support is
  most needed. The one path that ignores billing state — flagged for explicit
  sign-off at §12.14.
- **2026-08-25** — **Scope is derived from the path**, one convention on both
  sides: `/api/v1/*` and `/*` app, `/organizations/:orgId/*` organization,
  `/organizations/:orgId/workspaces/:wsId/*` workspace. `parseScope()` and
  `scopePath()` live in the module's dependency-free core so the Nest guard, the
  Next middleware, the nav builder and the tests share one implementation.
  Unrecognised paths resolve to app level with no ids — the most restrictive
  reading, never an exception.
- **2026-08-25** — `@RequireScope(level)` declares a handler's level. REST does
  not need it (the ids are in the URL) but benefits: the guard compares declared
  against parsed and refuses on mismatch, catching a controller mounted a level
  from where it thinks it is — otherwise a silent under-check. GraphQL resolvers
  do need it, and name the args carrying the ids; the app supplies `getArgs` so
  the module never imports `@nestjs/graphql`.
- **2026-08-25** — Per-request context cache keyed on **scope**, not just the
  request: otherwise one GraphQL operation could serve a workspace-scoped answer
  to an organization-scoped field.
- **2026-08-25** — **Subscriptions carry features like roles do** and attach at
  organization or workspace level (`PermSubscription.workspaceId`). Additive, not
  overriding — a precedence rule here would let a downgraded workspace plan
  silently revoke an organization-wide entitlement. `entitled` is the union of
  active plans for the current scope.
- **2026-08-25** — **Enforcement is opt-in**: only registered features are
  checked. An unregistered surface — `/auth/signin`, a health check, an
  unannotated handler or resolver, an unwrapped component — is never inspected
  and loads no context. Most surfaces are not access-controlled, and a registry
  naming all of them would be noise that buries the entries that matter.
  Recorded as policy across all eight surface types, not just UI routes.
- **2026-08-25** — Corollary kept explicit: an empty `<FeatureGate>` is a
  mistake, not a public control — it renders its fallback, because a gate that
  rendered would look guarded while guarding nothing. And the cost of opt-in — an
  endpoint that should be guarded is indistinguishable from one deliberately
  public — is named rather than papered over; §12.15 is the mitigation if wanted.
- **2026-08-25** — **Resolution pipeline fixed and materialised.** A request
  resolves as: combine organization- and workspace-level role features → filter
  against the organization subscription → union app-level features (unfiltered).
  The result is `PermissionContext.effective`, computed once per request by
  `composeContext()`; every check is a set lookup rather than a re-derivation.
  Order is load-bearing — filtering before the app union is what makes app-level
  an exemption instead of just another grant.
- **2026-08-25** — Denial reasons now follow pipeline order: `not_granted`
  before `not_entitled`. A caller with no role grant is told to ask an
  administrator rather than to buy a plan they may not control, and the
  organization's billing state is not disclosed to every member.
- **2026-08-25** — `explainFeature()` added: returns which step dropped a
  feature (`no_role_grant` / `subscription_filter`) plus the inputs. The answer
  is otherwise spread across a role, a plan and a scope with no one place to see
  all three. `myPermissions` exposes `effective` plus those inputs.
- **2026-08-25** — **The trigger level decides which grant levels participate.**
  App-level requests are answered by app-level roles alone, with no subscription
  consulted; organization-level requests use organization features ∩ subscription
  ∪ app-level; workspace-level adds that workspace's roles to the combined set
  before filtering. An organization role is not "also true" at app level — it is
  unasked, because the request named no organization.
- **2026-08-25** — `PermissionsService` short-circuits at app level, skipping the
  membership and subscription queries. Not only an optimisation: querying a
  membership with no organization in hand would pick an arbitrary one and answer
  a question nobody asked.
- **2026-08-25** — Consequence recorded: an app whose URLs do not carry the
  organization id must supply it via `resolvePrincipal`, or its organization
  roles never participate.
- **2026-08-25** — Model restated and confirmed: **all three levels are roles
  held by a user** — app (global), organization (where they are a member),
  workspace (finer granularity under an organization). No level overrides
  another; both applicable levels simply apply.
- **2026-08-25** — **Contradiction fixed:** `accessibleWorkspaceIds` was built
  only from `PermWorkspaceMember`, while workspace-level role grants applied
  regardless — so a user could hold a role in a workspace the UI told them they
  could not enter, while the API served its data. Accessible workspaces are now
  the union of explicit shares and workspaces the user holds a role in; a grant
  implies access. Raises §12.16.
- **2026-08-25** — **Membership restructured** (§12.16 closed). An organization
  has many members with organization-level roles; each workspace has its own
  members with workspace-level roles. Workspace roles moved from
  `PermMembershipRole.workspaceId` onto a new `PermWorkspaceMemberRole` hanging
  off `PermWorkspaceMember`. Consequences: holding a role in a workspace you
  cannot enter is now impossible to express; both grant tables get real
  composite primary keys (the old nullable-column shape needed a surrogate key
  and could not prevent duplicate organization-wide grants, since Postgres
  treats NULLs as distinct); and workspace roles are loaded only for the
  workspace in hand.
- **2026-08-25** — **Plan limits added.** Member and workspace counts are capped
  by the subscription, stored as key/value rows in `PermPlanLimit` so a new limit
  is a row, not a migration. Kept separate from features throughout: a feature is
  checked on read, a limit on write, and merging them makes a full organization
  look unauthorised. Resolution mirrors entitlement — no model → uncapped, no
  active plan → 0, active plans → max per key.
- **2026-08-25** — `LimitDecision.remaining` is `null` when unrestricted rather
  than `Infinity`: it crosses a JSON boundary and `JSON.stringify(Infinity)` is
  `null`, indistinguishable from "unknown" to a client.
- **2026-08-25** — **Workspace member counts are capped like organization member
  counts** — no limit is unlimited by accident. `LIMIT_REGISTRY` added as the
  source of truth for limits (mirroring `FEATURE_REGISTRY`): every registered
  limit is `required` and defaults to **0**, not unrestricted, and
  `assertPlanLimits()` refuses at seed time a plan that omits one. So nobody
  reaches the zero, but an unset seat cap fails closed instead of granting
  infinity. `checkCapacity()` now throws on an unregistered key, which would
  otherwise resolve to "no cap" and allow everything.
- **2026-08-25** — Limit floor changed from **0 to 1** for organization members,
  organization workspaces and workspace members. Zero was wrong in the other
  direction: an organization is created before it is subscribed, so a cap of zero
  stopped its founder from being its own first member and sign-up failed before
  billing was reached. One admits exactly the owner. The same floor now serves
  both the unconfigured and the lapsed — a separate rule for "no plan at all"
  would be a second thing to keep in step for a case that behaves identically
  (`current < limit` refuses new members either way, and never removes existing
  ones).
- **2026-08-25** — **Limits now come from two sources.** `user:organizations` —
  how many organizations a user may belong to — is capped by their **app-level
  role** (`PermRoleLimit`), not by a subscription: the question is asked before
  any organization exists, so there is no plan to ask. Seat and workspace caps
  stay plan-sourced (`PermPlanLimit`). `LimitSpec.source` ('plan' | 'role')
  carries the distinction so one registry and one map hold both.
- **2026-08-25** — Default for `user:organizations` is **1** when no role
  assigns one, matching the other limits' floor. Role-sourced limits are not
  `required`: most roles say nothing about it, and one organization each is the
  right answer for them.
- **2026-08-25** — `PermissionContext.limits` is no longer nullable. Role-sourced
  caps must resolve even at app level, where no subscription is consulted at all;
  a null map there would have made "how many organizations may I create"
  unanswerable at exactly the moment it is asked. A null VALUE still means that
  key is unrestricted.
- **2026-08-25** — **Permissions review + fix pass.** Three critical
  tenant-isolation holes found and two closed outright: workspace access was
  never enforced server-side (`canAccessWorkspace` existed and was never called,
  so organization-level features applied in every workspace including
  unshared ones), and a workspace was never checked to belong to the organization
  in the same URL (so an admin of one tenant was authorised for another's
  workspace by their own roles). Also fixed: deprecated features kept granting,
  archived workspaces still resolved, `level`/`status` were unvalidated strings,
  and an unauthenticated request returned 403 instead of 401.
- **2026-08-25** — Enforcing workspace access required `platform:support_access`
  to imply access-all, alongside `workspaces:access_all`. Support staff hold no
  membership anywhere, so the new check would have locked out exactly the people
  it must not.
- **2026-08-25** — Deprecation now revokes: role-feature reads filter on
  `deprecatedAt: null`. Done in the query, not in `composeContext` — the module's
  registry holds only its own features, so filtering there would have dropped
  every other module's keys. `PermFeature` is the shared table and the only place
  that can answer for all modules at once.
- **2026-08-25** — **First real install and compile.** §12.1 closed: pnpm
  11.18.0 installs cleanly. The module had never been compiled, and `tsc` found
  seven errors — including a **runtime bug**: the subscription query omitted
  `plan.limits` while the mapping below it read `sub.plan.limits`, so every
  plan-sourced cap would have thrown on the first guarded request. Also:
  `UserRoleRow` did not declare the `limits` its own query includes, and four
  `exactOptionalPropertyTypes` violations where `plans: undefined` — a
  *meaningful* state (no subscription model) that both readers branch on — was
  not assignable to an optional property. Fixed by widening those declarations
  to `| undefined` rather than by dropping the flag.
- **2026-08-25** — **Biome's `useImportType` autofix breaks NestJS DI**, and did:
  it rewrote `Reflector` and `PermissionsService` to `import type` in the guard
  and the resolver. Nest resolves constructor parameters from the
  `design:paramtypes` metadata `emitDecoratorMetadata` emits, and that metadata
  comes from the VALUE binding — a type-only import erases it, so the container
  has nothing to resolve. The failure is at startup, with a clean typecheck on
  both sides of it. Reverted, and `useImportType` (plus `noStaticOnlyClass` and
  `noUnusedPrivateClassMembers`, which misread `forRoot` and a reserved
  injection) is now **off under `**/src/server/**`** via a `biome.jsonc`
  override. Every future `module-*` server adapter inherits it.

- **2026-08-25** — **Test suite written — 202 tests, the review's top priority
  closed.** Jest 30 + `@swc/jest` per §3, in `module-permissions` (181) and
  `module-kit` (21). No database: `PermissionsPrismaClient` is structural, so the
  service is exercised against a literal object that also RECORDS its queries —
  which is what lets "did it ask at all" be a test (the app-level short circuit,
  the `deprecatedAt` filter, the workspace/organization pairing) rather than only
  "what did it answer". Every rule in this log is a case.
- **2026-08-25** — Second defect found by the tests: **`parseScope` misread
  interior empty path segments.** `filter(Boolean)` collapsed
  `/organizations//workspaces/ws1` into `['organizations','workspaces','ws1']`
  and read the literal string `'workspaces'` as the organization id. It failed
  closed, but the guard and the router would then disagree about the request's
  LEVEL — the exact mismatch `@RequireScope` exists to catch rather than to
  produce. Only the empties a well-formed path produces (leading, trailing) are
  dropped now; an interior one makes the path resolve to app level with no ids.
- **2026-08-25** — **Tests are typechecked**, via a `tsconfig.test.json` per
  package that adds `test/` and emits nothing. Not ceremony: the first run of it
  caught six assertions built on a `ModuleRoute` shape the source no longer had.
  Under `@swc/jest` those compile and pass regardless, so an untypechecked suite
  is one that can go on asserting against a type that is gone.

- **2026-08-25** — ~~The module has no write path.~~ **`PermissionsWriteService`
  built** (M4): organizations, members, organization- and workspace-level role
  grants, workspaces and workspace sharing. Closes H1's limits and C3's write
  side, and is the first caller of `assertRoleFeatureLevels`.
- **2026-08-25** — **The write client is bound on its own key**
  (`PERMISSIONS_PRISMA_WRITE`, `prismaWriteProvider`), separate from the read
  one. An app that only answers permission questions — a worker, a read replica,
  an app administering grants elsewhere — should not acquire a write path by
  having wired reads; granting one is a visible line in its own wiring. Unbound,
  the service still injects and refuses on first use with an error naming the
  option, rather than failing to resolve at boot.
- **2026-08-25** — **Every write checks the actor**, duplicating `FeatureGuard`
  deliberately. A worker, a CLI command and a seed script arrive with no guard in
  front of them, and "the caller already checked" is not a property this code can
  verify. Fail closed (§9 rule 7) matters most on writes: a skipped check is not
  a wrong answer, it is a wrong row that outlives the request.
- **2026-08-25** — **Capacity moved from advisory to enforced**: counted inside
  the transaction that creates the row. `checkCapacity()` survives as the *read*
  of the same question — "have I room for one more", asked to grey out a button —
  but nothing now depends on a caller remembering it.
- **2026-08-25** — Capacity's residual race **documented rather than claimed
  away**: under READ COMMITTED two concurrent invites can both count N and both
  insert. The transaction narrows the window to a round trip; closing it needs
  `Serializable` or an advisory lock, and this module emits no SQL by design, so
  it is the host's lever. A limit that looks enforced and is not would be worse
  than one documented as advisory.
- **2026-08-25** — **Write refusals are `PermissionWriteError`, not Nest
  exceptions**, with their own reason vocabulary distinct from `DenialReason`:
  `at_capacity` means buy more, `not_permitted` means ask an administrator, and
  `role_foreign_to_organization` means neither will help. Keeps the service
  callable from a CLI, a worker and a test that never load Nest.
- **2026-08-25** — **Grants are idempotent; membership is not.** Re-granting a
  held role returns `{ granted: false }` — making a retry an error turns every
  network blip into a support ticket. Re-adding an existing member is
  `already_exists`, because "add this person" carries an intent that has already
  been satisfied differently, and hiding that hides a stale invite.
- **2026-08-25** — **Subscription writes deliberately excluded from M4.** They
  are written by the billing integration, not by a user action, and who writes
  them, with what idempotency, and what happens between a payment failing and
  `status` changing are all unanswered. A guess would land in the one table a
  permission check must not have to doubt. Users are excluded too (§12.12), and
  M7's audit trail stays open — but every write method takes the actor, so adding
  it is a new table and a call rather than a change to every signature.
- **2026-08-25** — **The app shell**: a main header, a collapsible side drawer,
  an account dropdown and a Light/Dark/System theme toggle, following
  `../masterdb-mgt-tool`'s `(private)` layout. Radix dropdown + `lucide-react` +
  `next-themes` + `clsx`/`tailwind-merge` installed as §3 had already decided;
  `tw-animate-css` added for the menu open/close states, and Geist wired into
  Tailwind's `--font-sans`. The primitives are hand-owned in the app, NOT in
  `@kwtech/web-ui`, because that package's own scope rule says a component with
  one consumer belongs to its consumer — `apps/admin` (§11 Phase 7) is what
  should drive the extraction, not anticipation of it.
- **2026-08-25** — **The shell is a COMPONENT, not a layout**, and that is
  forced rather than chosen. §12.11 strategy A puts every module route behind
  one catch-all, so Next cannot see the individual routes and cannot give them
  nested layouts — exactly the cost the catch-all's comment records. `/` and the
  catch-all each wrap themselves. Moving to generated stubs (strategy C) turns
  this back into a layout with no change to what it renders.
- **2026-08-25** — **`ModuleRoute.chrome: 'app' | 'bare'`** added to
  `@kwtech/module-kit`; the three auth routes declare `'bare'`. The catch-all
  has to know which shell a route wants, and the alternative — testing whether
  the path starts with `/auth` — would make a naming convention load-bearing for
  a rendering decision, so renaming the prefix would silently lose it. Bare
  pages still get the theme toggle (`BareShell`): someone who needs dark mode
  needs it on the sign-in screen too.
- **2026-08-25** — **The drawer is filtered by the same keys the pages check.**
  `composeNav()` existed since Phase 0 and nothing called it; it does now, fed
  by a new `getPermissionContext()` reading `GET /permissions/me`. That endpoint
  requires no feature of its own — asking what you hold is not a privilege, and
  gating it would deadlock the first render. **It fails CLOSED**: a null context
  becomes an empty grant list rather than "skip the filter", so an unreachable
  permissions service shrinks the menu instead of opening it. `AppShell` also
  mounts `PermissionsProvider` with that context, so `<FeatureGate>` works
  inside module pages that cannot mount a provider themselves.
- **2026-08-25** — `module-permissions` is now composed into `WEB_MODULES`, so
  `/admin/roles` is real. Its body is still the Phase 6 stub, but the entry
  proves the whole path — descriptor → `composeNav` → grant filter → link — and
  it is hidden from anyone without `admin:access`, so an unfinished page is not
  an exposed one. Verified both ways: the seeded user (no grants) sees only
  Dashboard; with `admin:access` the Administration group appears.
- **2026-08-25** — ⚠ **`export *` is a trap in any `module-*` react barrel, and
  it cost a real bug.** TypeScript compiles it to `__exportStar`, which copies
  keys with `for...in`. Next replaces a `'use client'` module with a
  client-reference proxy that does not answer that enumeration, so the re-export
  yielded nothing and `PermissionsProvider` arrived as `undefined` — surfacing
  as "Element type is invalid" at render, pointing nowhere near the barrel.
  Both react barrels now use NAMED re-exports, which compile to property
  getters that read through the proxy. `module-auth` had the same latent bug and
  escaped it only because `authWebModule` reaches its pages through
  `module.tsx`, which imports them directly rather than through the barrel.
- **2026-08-25** — The shell **redirects a signed-out visitor and is not a
  gate.** It sends them to `/auth/signin` rather than rendering an account menu
  with no account in it; enforcement stays with the API, which sees the bearer
  token on every request. Treating a render-time check as protection is how a UI
  ends up guarded by something an attacker never runs. `apps/web-app` still has
  no `middleware.ts` — §12.15 and Phase 6 own that.
- **2026-08-25** — **`pnpm dev` now frees its own ports first**
  (`scripts/dev-ports.mjs`), because `EADDRINUSE :::8081` on restart was a
  recurring cost. The cause is structural, not a mistake: **turbo runs each
  persistent task in its own process group.** A clean Ctrl-C is fine — turbo
  catches SIGINT and tears the tasks down, verified by signalling the
  foreground group and watching every process exit. Anything that stops turbo
  without giving it that chance — a closed terminal, `kill -9`, starting it
  detached and killing only the top process, or one task dying while the others
  are still coming up — leaves those groups re-parented to init and still
  listening. The build/dev race that wiped `web-server/dist` mid-session was
  exactly this.
  The script kills the listener's **process group**, not the listener: `nest
  start --watch` supervises `node dist/main`, so killing the leaf only makes the
  supervisor spawn a new one. Because turbo isolated the group already, killing
  it takes down that one task and nothing else.
  **It refuses to kill anything running from outside this repo** — checked via
  `/proc/<pid>/cwd`, and it exits non-zero naming the holder instead. Verified
  both ways: a listener with cwd `/tmp` survives, one with cwd inside the repo
  is cleared. `dev:api` and `dev:web` free only their own port, so running them
  in two terminals does not evict each other. `pnpm dev:stop` clears both;
  `pnpm dev:ports` reports without killing.
- **2026-08-25** — **Adopting a module is now two lines per surface**, and the
  auth plumbing moved out of the app into the module that owns it. `module-auth`
  gained a **`/next` entrypoint** — the credential proxy, the httpOnly cookie
  handling, sign-out-that-revokes, and the server-side `getViewer()` — so
  `apps/web-app` deleted ~220 lines of security-critical code it had been
  carrying. That code was never app-specific: every Next app adopting this
  module would have rewritten it, and the copy that got a `sameSite` or a
  missing revoke wrong is the one nobody reviews. `/next` sits alongside
  `/server` (Nest) and `/react` (browser) as a third optional-peer adapter,
  which PLAN §9 rule 2 already allows for.
- **2026-08-25** — **§9 rule 6 refined: apps configure, modules publish a
  contract.** The rule said modules must not guess, and `/next` reading
  `API_URL` looks like guessing. The distinction that matters: the module does
  not *discover* configuration, it *documents an environment contract* — an app
  that sets those names has configured it, and an app that passes values
  explicitly never consults them. Without defaults the rule was costing every
  adopter the same twenty lines of wiring.
  **The JWT secret is the deliberate exception and has no fallback value.**
  `AuthModule.forRoot` reads `AUTH_JWT_SECRET` and throws at boot when neither
  it nor an explicit `jwtSecret` is present — a module-supplied default secret
  would be the same secret in every deployment that forgot one, which is worse
  than a failed boot because nothing ever reports it. `issuer`/`audience` do
  default: they are consistency checks, not credentials.
- **2026-08-25** — ⚠ **`next/server` does not survive `transpilePackages`.**
  The route handlers were written with `NextRequest`/`NextResponse`; compiled to
  CJS and run through Next's transpile step, `require("next/server")` became a
  binding that is not there — `ReferenceError: server_1 is not defined`, thrown
  on the first request rather than at build. Rewritten on plain Web
  `Request`/`Response` with a small `Set-Cookie` serialiser, which costs nothing
  (route handlers take and return exactly those types) and makes the handlers
  portable to any Web-standard runtime. `next/headers` is still used for reading
  cookies in `getViewer` and works fine — the failure is specific to
  `next/server`.
- **2026-08-25** — **The web-side seam mirrors the server-side one.**
  `module-permissions` gained `/next` with `getPermissionContext({ token })`,
  taking a TOKEN rather than reading a cookie, because it must not import
  `module-auth` and would be guessing if it picked a cookie name. `AppShell`
  reads the token from auth and hands it to permissions — one direction, one
  function, exactly like `resolvePrincipal` on the server.
- **2026-08-25** — **Two per-module boilerplate lists deleted.**
  `transpilePackages` is now derived from `package.json`'s `@kwtech/*`
  dependencies, and `globals.css` uses a single `@source "packages/*/src"` glob
  instead of a line per module. The glob was previously rejected to avoid
  padding the stylesheet with an uncomposed module's classes — that traded a
  small silent cost for a large one, since a forgotten `@source` line does not
  warn, it renders the app with no CSS at all, which this repo has already
  shipped once. Adopting a module is now a dependency and nothing else.
- **2026-08-25** — `apps/web-app/src/config/env.ts` survives as a **boot
  assertion** rather than a value the app threads around, loaded once from
  `instrumentation.ts`. The convention that makes setup one line also makes a
  typo in `API_URL` silent — it falls back to localhost and first shows up as a
  sign-in hanging in staging. It imports the module's exported defaults rather
  than repeating them, so the two cannot drift.
- **2026-08-25** — **The two-line setup reaches the server too, and is now
  tested rather than asserted.** `AuthModule.forRoot({ prismaProvider })` boots
  from the environment alone: `resolveAuthOptions` reads `AUTH_JWT_SECRET`,
  `AUTH_TOKEN_ISSUER`/`AUDIENCE` and the three `AUTH_*_TTL` durations. A new
  `auth.options.test.ts` (12 cases) boots `forRoot({})` for real and asserts a
  missing secret still throws — the README's promise had been a claim nobody
  ran.
  `apps/web-server` now passes only what is genuinely its own — the Prisma
  provider, how a reset link reaches a person, where a failed sign-in is
  logged — down from ten config lines to three.
- **2026-08-25** — **`JWT_SECRET` renamed `AUTH_JWT_SECRET`** in web-server's
  `.env`, `.env.example` and env schema, to match the name the module publishes.
  Consistent with `AUTH_SESSION_TTL` and friends, which were already prefixed.
- **2026-08-25** — **The TTLs have ONE owner again.** They were declared and
  parsed in `apps/web-server/src/config/env.ts` and passed to a module that can
  now read them itself — two parsers, two defaults, and a day when they disagree
  and each component is correct according to a different number. The declaration
  and the `duration()` helper were deleted from the app; `parseDuration` is
  exported from the module for anything that needs the same unit table.
  **A bare number is rejected rather than assumed**: `AUTH_ACCESS_TOKEN_TTL=15`
  is ambiguous between seconds and milliseconds, and fifteen seconds looks like
  an application bug rather than a configuration error. The
  session-longer-than-access-token check moved with them, into
  `resolveAuthOptions`, where both values are finally known whatever mix of
  sources they came from.
- **2026-08-25** — `packages/module-auth/docs/USAGE.md` written as the module's
  reference for future developers and agents: entrypoints and what may import
  what, the sign-in sequence, the two-token trade stated plainly, the security
  properties not to regress, both halves of the permissions seam, extension
  points, and a troubleshooting table carrying the two traps that already cost
  debugging time (`export *` over a `'use client'` barrel, and `next/server`
  under `transpilePackages`). Verified against the code rather than written from
  memory — which is how the model list turned out to include three tables that
  are schema-only.
- **2026-08-25** — ⚠ **The `@source` glob shipped broken, and the check that
  passed it was worthless.** `@source "…/packages/*/src"` matches nothing:
  Tailwind auto-globs a bare directory path, but does not expand a `*` inside
  one. Every class used only in a package vanished, so the sign-in card lost
  `max-w-sm` and stretched to the full window while the rest of the app looked
  fine — because it used the same utilities elsewhere.
  **The verification was the real failure.** It grepped the built CSS for
  `rounded-md`, which `apps/web-app` also uses, so it would have passed with the
  packages not scanned at all. Fixed to
  `@source "…/packages/*/src/**/*.{ts,tsx}"` and re-checked against all 22
  classes that appear ONLY in `packages/` — 18 plain, 4 variants — every one now
  emitted. **When testing whether a source path works, the probe must be a class
  the other sources cannot supply.**
- **2026-08-25** — **Themes are swappable, and picking one is a single import.**
  `@kwtech/web-ui` now ships five palettes — `neutral` (grayscale, the default),
  `ocean` (blue), `ember` (warm amber), `forest` (green), `violet` — each
  carrying its own `.dark` block, so switching costs one line in an app's
  globals.css and nothing else changes. The machinery moved to `src/base.css`
  (dark variant, `@theme inline` mapping, base layer) and each theme imports it
  itself, so an app cannot acquire the mapping without a palette (utilities
  resolving to nothing) or a palette without the mapping (properties nothing can
  reach). `styles.css` stays as an alias for the default, so existing imports
  keep working.
  Every theme shares ONE recipe — identical lightness and chroma per role,
  differing only in hue — which is what gives them consistent visual weight and
  makes a new theme a hue change rather than a design exercise. The dark block
  is a re-decision, not an inversion: `--primary` is lighter and less saturated
  there, and `--destructive-foreground` flips from light to dark, because the
  same colour on a dark ground reads muddy or loses contrast.
- **2026-08-25** — ⚠ **The contrast checker found two failures in the palette
  already shipped.** `scripts/check-contrast.mjs` measures every
  foreground/background pair in both modes against WCAG minimums, plus an sRGB
  gamut budget. On its first run the grayscale theme failed twice:
  `--muted-foreground` was 4.34:1 on `--muted` (its old comment claimed AA, and
  it was true only against `--background` — not the surface that text usually
  sits on), and white `--destructive-foreground` on the dark-mode red was
  2.77:1, because raising the red's lightness for a dark ground moved it toward
  the white on top of it. Fixed to `oklch(0.546 0 0)` and a DARK
  destructive-foreground respectively.
  The checker **parses the CSS** rather than importing a shared table of values:
  one fed from the same constants as the output can only confirm that a file
  matches itself. Wired into `pnpm test`, so a "small" lightness tweak that
  drops muted text below AA fails the build instead of shipping — that class of
  regression is invisible in review and invisible on the rendered page.
- **2026-08-25** — **`apps/web-app` runs on `ocean`** (cool blue) rather than the
  grayscale default, and its `globals.css` now lists all five theme imports with
  the unused four commented out — switching is uncommenting one line and
  commenting another, which is the fastest way to actually look at a palette
  rather than reason about it.
  The block warns about the failure mode it creates: two uncommented imports is
  not an error, it is a silent one. Both palettes are emitted, the later import
  wins, and the file still reads as deliberate — so "count the uncommented
  lines" is written down next to the lines themselves. Verified the commented
  ones are genuinely inert: with `ocean` active, neutral's `#171717` primary
  appears nowhere in the served CSS.
- **2026-08-25** — **The palette is now a viewer choice, not a build constant.**
  Every theme moved from `:root` to its own `[data-palette="…"]` scope, so all
  five coexist in one stylesheet and switching is one attribute on `<html>` —
  no reload, no React re-render, nothing below the control even knows. The
  header dropdown gained a "Colour scheme" group above a rule, with
  Light/Dark/System below it: they are two questions, not one, because every
  palette has both a light and a dark form and a flat list would make "Ocean"
  and "Dark" read as alternatives.
  Persisted in a **cookie**, not localStorage — the root layout is a Server
  Component, so it stamps `data-palette` during the render that produces the
  page. localStorage is only readable after hydration, which would mean a
  full-page colour flash on every load. (next-themes solves the same problem for
  the mode with a render-blocking inline script; the server already knows this
  value, so there is nothing to unblock.) The cookie is **validated, not
  trusted**: the value becomes an attribute selector, so an edited one would
  match no rules and render an unstyled page — `isPalette()` falls back instead.
  `apps/web-app` imports `themes/all.css`; a fixed-palette app still imports one
  theme and hard-codes the attribute. Costs ~5 sets of custom properties, since
  no component CSS is duplicated — the utilities resolve through `var()`.
- **2026-08-25** — Each palette's dark rule is a selector LIST:
  `[data-palette="x"].dark` matches `<html>`, which carries both; `.dark
  [data-palette="x"]` matches an element INSIDE a dark page naming a palette it
  is not in. The second exists for the menu's swatches — each carries
  `data-palette` so it previews with the real tokens, and without the descendant
  form it would show light colours on a dark page and misrepresent the choice.
- **2026-08-25** — ⚠ **CSS comments do not nest, and it took the dev server
  down.** The generated theme headers documented both import styles with a
  trailing `/* every palette */` inside an already-open block comment; the inner
  `*/` closed the outer one, and everything after it parsed as declarations —
  `Invalid declaration: * @import …`, pointing at a line that is a comment.
  Fixed in all five, with a nesting check run over every CSS file in the package
  to confirm none remain.
- **2026-08-25** — **The three viewer preferences are now uniformly named and
  have one owner**, `apps/web-app/src/lib/preferences.ts`: `kwtech_palette`
  (cookie), `kwtech_sidebar_collapsed` (cookie) and `kwtech_theme`
  (localStorage, via next-themes' `storageKey`). The last was a bare `theme`,
  which two of these apps on one machine would share — and `pnpm dev` runs
  exactly that arrangement, so it was a real collision rather than a tidiness
  point. Collected in one module because "uniform" is a property of the SET, and
  a set spread across three files drifts the first time someone adds a fourth
  key without reading the other three. Both cookies now go through one writer,
  so their attributes cannot diverge either.
  **The two STORAGE MECHANISMS stay different, and that is not inconsistency.**
  A cookie is used wherever the server must know the value while rendering — the
  palette stamps `data-palette` on `<html>`, the drawer renders at its stored
  width. Light/dark cannot: one of its values is `system`, and what `system`
  means is `prefers-color-scheme`, which only the browser knows. A cookie could
  record that choice and still leave the server unable to resolve it, so
  next-themes keeps it in localStorage and applies it from a script that runs
  before first paint — verified at byte 2070, ahead of the first content at
  2908. Neither flashes; they simply cannot share storage.
  (`Sec-CH-Prefers-Color-Scheme` would tell the server, but it needs an
  `Accept-CH` round trip and neither Safari nor Firefox sends it.)
- **2026-08-25** — **Both theme preferences now live in localStorage**
  (`kwtech_theme`, `kwtech_palette`), reversing the cookie decision above at the
  user's direction. The reasoning that produced the cookie still holds and is
  worth keeping visible: the mode cannot be a cookie, because `system` resolves
  to `prefers-color-scheme` and only the browser knows it, so uniformity had to
  be reached from the other side — the palette moved to localStorage instead.
  A cookie-based mode WAS viable and was prototyped: a multi-rule
  `@custom-variant dark` with a `@media (prefers-color-scheme: dark)` branch
  resolves all three states in pure CSS from a `data-mode` attribute, needing no
  script at all (verified compiling under Tailwind 4.3). It was reverted because
  it meant replacing next-themes; recorded here because it is the answer if that
  dependency is ever dropped.
  **The cost of the direction taken, paid explicitly:** localStorage is
  unreadable on the server, and nothing applies without `data-palette`, so the
  first paint would be an UNSTYLED page rather than merely a mis-coloured one.
  Two things prevent it — the server renders `DEFAULT_PALETTE` (which is also
  what a no-JavaScript visitor keeps), and a 165-byte inline script overrides it
  before paint. Verified by executing the emitted script against a stub DOM:
  stored/absent/invalid/`__proto__`/throwing-storage all resolve correctly, and
  both it and next-themes' script land ahead of the first content.
- **2026-08-25** — `DEFAULT_PALETTE` is **neutral**, not ocean. It is what a
  visitor with JavaScript disabled sees permanently, so the palette that cannot
  clash with anything is the right answer there — the interesting one is a
  choice the viewer makes.
  The sidebar's collapsed state stays a COOKIE: it is not theme configuration,
  has no `system` equivalent, and the shell is a Server Component that can
  render the drawer at its stored width with no script at all.
- **2026-08-25** — **The palette RUNTIME moved into `@kwtech/web-ui`; the picker
  did not.** `palette-runtime.ts` now owns `applyPalette`, `readStoredPalette`,
  `palettePreloadScript`, `PALETTE_STORAGE_KEY` and `PALETTE_ATTRIBUTE` — the
  half of a palette picker that is easy to get subtly wrong, and that a second
  app would otherwise re-derive from prose: validate before the value reaches
  the DOM, catch storage that throws in private mode, and emit an inline
  undeferred script so the choice lands before first paint.
  The dropdown itself stays in the app. Moving it would have dragged
  `lucide-react`, `next-themes`, Radix, `clsx` and `tailwind-merge` into a
  package with **zero runtime dependencies today**, and would have mandated
  next-themes for every future consumer including the planned `mobile-ui`. §9
  rule 8 and this package's own scope rule both say a component with one
  consumer belongs in that consumer, and `AppShell`, `Header` and `Sidebar`
  already stayed for that reason — extracting only the toggle would have been
  inconsistent as well as premature. Phase 7 (`apps/admin`) is what should drive
  the rest, once there is real evidence of what two apps share.
  The split is where the seam actually was: `web-ui` defined the palettes while
  the app knew how to apply them, so the knowledge and the data lived in
  different packages. Now the package that defines a palette also knows how to
  put one on the page. README §"Adding a palette picker to an app" is the
  copy-paste path, including the two steps an app cannot skip — a
  server-rendered fallback and the pre-paint script.
- **2026-08-25** — **`ThemeSwitcher` and the dropdown primitive moved into
  `@kwtech/web-ui`, behind a new `/react` subpath.** The subpath is what makes
  it affordable: the package ROOT keeps **zero runtime dependencies** and stays
  importable by a build script, a test or a non-React consumer, while `/react`
  declares Radix, lucide, clsx and tailwind-merge as OPTIONAL peers that an app
  never installs unless it imports that path. Same shape as the module-*
  packages' `/server` `/react` `/next` split, for the same reason.
  **The mode is a controlled prop; the palette is not.** The palette is this
  package's own concern — it defines the palettes, so it owns applying and
  persisting one. The mode is not, and depending on `next-themes` here would
  make it a hard requirement of every consumer, including the planned
  `mobile-ui`, to solve a problem this package did not define. The app's
  `theme-toggle.tsx` is now nine lines wiring `useTheme()` to the component, and
  is the entire seam.
  `cn` and `dropdown-menu` moved with it — `user-menu.tsx` and `sidebar.tsx` now
  import both from `@kwtech/web-ui/react`, and `apps/web-app/src/components/ui`
  and `lib/utils.ts` are gone.
  This is a DELIBERATE exception to the one-consumer scope rule, recorded as
  such: the switcher is the UI of a system the package already owned, and
  leaving it out meant `web-ui` defined the palettes while each app separately
  worked out how to present them. The app SHELL — AppShell, Header, Sidebar,
  UserMenu — stays put: it is layout rather than vocabulary, and Phase 7's
  second app should drive that extraction with evidence.
- **2026-08-25** — **Five more palettes: crimson, rose, clay, gold, teal** —
  ten in total, spread around the colour wheel and exported in wheel order so a
  picker reads as a spectrum. Same recipe as the first five (identical lightness
  per role, hue per theme), with a chroma scale added for hues the eye reads as
  louder — and for clay, which is not a hue at all but Ember's hue at
  three-quarters chroma, because brown IS a dark low-chroma orange.
- **2026-08-25** — ⚠ **A red theme exposed a check the palettes did not have:
  is the primary action distinguishable from the destructive one?** Contrast
  ratios cannot answer it — they compare a colour to its own text, so two
  buttons can each be perfectly legible and still be the same red to the person
  deciding which to click. Crimson's first draft measured **0.043** apart in
  oklab from `--destructive` in dark mode; it now sits DEEPER than the danger
  red rather than lighter, with light text, separating on lightness — the axis
  the eye reads most reliably.
  `check-contrast.mjs` gained the check, with a floor **calibrated rather than
  invented**: 0.12, which is what the tightest already-shipping palette (ember,
  dark) measures. Anything looser would pass a red-on-red theme; anything
  tighter would fail a palette that has been fine in use. Verified the check
  fails when it should by reverting crimson and watching it catch both the
  separation and the resulting contrast failure.
  Gold needed the opposite kind of care: at the lightness where yellow reads as
  yellow, white text on it fails AA, so its primary is closer to olive than
  lemon. A readable button beats a bright one.
