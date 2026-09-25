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

Last updated: 2026-09-13

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
| `packages/module-chat` | `@kwtech/module-chat` | Messaging — schema, pure domain, the server, realtime, `/chat`, and the ephemeral tier (presence, availability, typing) as of 2026-09-11. Both apps depend on it. Tone and settings are step 9; Redis is step 10 (§9) | — |

**Planned, not built yet:** `packages/db` (Prisma — see the note below),
`apps/admin`, `apps/worker`, `apps/cli`, `packages/mobile-ui`, and
`packages/module-queuing-window` — a per-workspace walk-in queue with a live
public display over `graphql-ws`, planned end to end in §13 (2026-09-13).

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
| 13 | ~~Where the active organization and workspace come from on a request~~ **Closed** | — | **The URL, 2026-09-09.** `/organizations/:orgId/*` is organization level and `/organizations/:orgId/workspaces/:wsId/*` workspace level — the convention `scope.ts` has defined since it was written and which nothing used. Rejected: a header (forgettable, invisible in a bug report), a subdomain (a DNS record per tenant), and the token (baking the active tenant into a week-long credential makes switching organization need a new sign-in). Thirteen resolvers now declare `@RequireScope`, `myPermissions` takes an optional scope, and the web catch-all derives one from the matched route. Until this landed, an ORGANIZATION-LEVEL ROLE GRANTED NOTHING ANYWHERE — see the decision log |
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
| 27 | Scope role writes to the actor's organization, and put `roles:create/update/disable` back at organization level | **unblocked 2026-09-09** — §12.13 closed | `createRole` writes `organizationId: null` — a SHARED PRESET every tenant sees — and `listRoles` reads that same null scope, so a role write is a platform operation. The three write keys were raised to APP level on 2026-09-07 to say so. Reversing it needs the active organization on the request (§12.13), which is exactly why `role-draft.ts` cannot offer an organization picker today. Do both together or neither. **⚠ The blocker is gone: §12.13 closed on 2026-09-09 and the active organization is now on the request, so `role-draft.ts` COULD offer an organization picker.** Nothing was changed here with it, deliberately — re-levelling three write keys and re-scoping `listRoles` is a change to what every existing role means, and it does not belong in the same commit as the screens that revealed it was possible. What the tenant area does today is narrow the PICKER (`myOrganizationRoles` filters app-level roles out), which is a presentation fix and not the re-scoping this decision asks for |
| 28 | ~~Redis-backed pub/sub, before `web-server` scales past one replica~~ **CLOSED 2026-09-13** | — | `graphql-subscriptions`' in-memory `PubSub` is bound in app.module.ts. An event published on replica A never reaches a socket held by replica B, and the failure is SILENT — half the users simply stop updating. The module depends on the structural `PermissionsPubSub`, so the swap to `graphql-redis-subscriptions` is one provider and no resolver change (§7). **⚠ HARDENED 2026-09-10 — the trigger is now PRESENCE, not the second replica.** Pub/sub across replicas fails silently; presence across replicas fails LOUDLY and constantly, because replica A cannot see sockets held by replica B and half the users show as offline forever. So: Redis before presence ships, or single-replica recorded as a deliberate choice. **`module-chat` is also the feature that makes the pub/sub half unsurvivable** — a plan key arriving late is a stale badge, a message that never arrives is a broken product. **⚠ HARDENED AGAIN 2026-09-11 — the gate is now CHAT ITSELF, not presence.** Delivery is a requirement rather than an enhancement, and the silence of the failure stops being the point: a message that does not arrive is indistinguishable from being ignored. Redis before anyone uses `/chat`, or single-replica enforced by something that FAILS THE BOOT when a second replica appears. **⚠ PARTLY CLOSED 2026-09-11 — single replica is now a DECISION, not an assumption.** `src/realtime/realtime.pubsub.ts` is the one place the engine is chosen, every module's pub/sub token binds to `realtimePubSub()` rather than to a constructor, and `assertRealtimeTopology` fails the boot on `REALTIME_REPLICAS > 1` or on a `REDIS_URL` that is set but not wired. **✅ CLOSED 2026-09-13, and NOT as the three-step swap this entry described.** The operator asked for it to be a CONFIGURATION rather than a code change, which is the better design and was adopted: `graphql-redis-subscriptions` + `ioredis` ship installed, and **`REDIS_URL` alone chooses the engine** — set it and the process runs on Redis, leave it unset and it runs in memory. No rebuild, no flag, no edit. The old arrangement made scaling out — an operational act, usually urgent — need a developer, a pull request and a release, and its 'set but not wired' branch turned configuring the thing correctly into a boot failure. ⚠ The ONE refusal left is the one worth keeping: `REALTIME_REPLICAS > 1` with no `REDIS_URL` still fails the boot, because that is the silent failure. With Redis configured the replica count is not consulted at all |
| 29 | Rate-limiting subscription volume on an open socket | when realtime carries real traffic | `CredentialThrottlerGuard` skips WebSocket operations — it writes rate-limit headers onto a response a socket does not have, and per-request IP limiting is not the question a socket asks. Bounded today only by the handshake needing a live-session ticket and the connection closing at token expiry. Belongs in `graphql-ws`' `onSubscribe`, which can see the connection. **Narrowed 2026-09-10:** `module-chat` puts MUTATIONS on HTTP and only subscriptions on WS, so a send passes `ThrottlerGuard` and message-rate limiting comes for free. What is left is how many topics one socket may hold |
| 30 | ~~A per-workspace member screen, for WORKSPACE-level role grants~~ **Closed** | — | **2026-09-07.** Each workspace on the organization detail screen expands to its members and their workspace roles, and an Add-member dialog picks from organization members not already in it, with an optional workspace role beside it. `assignWorkspaceRole` and `revokeWorkspaceRole` now have a UI. Original entry: | `assignWorkspaceRole` and `revokeWorkspaceRole` are exposed and guarded and reachable only through the API. The organization detail screen already toggles workspace MEMBERSHIP per member; adding a second role picker to that same row is how a screen becomes unreadable, so the grants belong on a workspace's own screen |
| 31 | ~~An invite flow for an address with no account~~ **Closed** | — | **2026-09-07.** `PermInvitation` + `inviteMember`/`revokeInvitation`/`acceptInvitation`, a seven-day single-use token stored as a SHA-256 hash, an app-supplied `sendInvitationEmail` hook, and `/invitations/accept` — which creates the account when there is none. `PermMembershipStatus.invited` is still unwritten and now never will be: an invitation is addressed to an EMAIL, and a membership carries a userId there may not be one of. See the decision log |
| 34 | A composite foreign key tying a workspace membership to ONE organization | with §12.19 (raw-SQL schema extras) | `PermWorkspaceMember` references a MEMBERSHIP and a WORKSPACE independently, so nothing in the schema stops a membership in org A being linked to a workspace in org B. A cross-tenant row was inserted against a live database and surfaced in `accessibleWorkspaceIds`. The read path now filters it (C3's defence, one table over) and the write path always checked it — but the row is still writable. Closing it needs `organizationId` denormalised onto the row plus compound uniques on both parents, which is the same raw-SQL-extras question as §12.19 |
| 33 | ~~How does somebody reach a workspace they were not added to?~~ **Closed: they do not** | — | **2026-09-07.** Workspace membership is REQUIRED; `workspaces:access_all` is removed from the registry. Platform support is the single exemption, because a support engineer holds no membership anywhere. See the decision log |
| 32 | ~~Should the one-role rule extend to APP level?~~ **Closed: yes** | — | **Workspace level: closed 2026-09-07.** `@@unique([workspaceMemberId])` matches the organization rule. **App level: closed 2026-09-08 — one role, enforced by the WRITE PATH rather than by the schema.** `assignAppRole` replaces, and `acceptInvitation` grants only to somebody holding none, so no path produces a second app-level grant. The primary key is `(userId, roleId)`, which still permits a collection, so this is upheld by code where the other two levels are upheld by a constraint — a `@@unique([userId])` can follow when there is a migration to carry it. Decided in the direction that matches the other two: a person is one thing at app level, and `super-admin` + `normal-user` at once would be incoherent |
| 35 | The seat cap is not checked when an invitation is ACCEPTED | when a plan's seat cap is enforced commercially | `assertCapacity` reads the ACTOR's resolved limits, and on the accept path there is no actor — the person joining holds nothing. So an invitation sent when there was room can be accepted after there is not, and the organization ends up one seat over. The honest fix is to check at invite time AND again on accept, and the second needs a limit lookup that does not go through a `PermissionContext` |
| 36 | Sign-up exists only through an invitation | when self-service registration is a product decision | `AuthService.createAccount` is a METHOD with no route: the only thing that calls it is `signUpFromInvitation`, which supplies the address from the invitation rather than from the form. There is no public registration page and adding one is a product decision with a spam problem attached — not something to arrive at by leaving an endpoint exposed. Note what an open endpoint would also be: `createAccount` says plainly that an address is taken, which is an enumeration oracle anywhere but behind a token |
| 37 | ~~An app-level role can be GRANTED to nobody: `perm_user_role` has no write path~~ **Closed** | — | **2026-09-08.** `assignAppRole` behind a new `roles:grant_app` key, plus `inviteUser`, which carries the chosen role on the invitation and applies it at acceptance. Both refuse a role carrying features the granter does not hold, so neither can be used to mint somebody more powerful than yourself. Original entry: | `assignRole` writes `perm_membership_role` and takes an `organizationId`; nothing writes `perm_user_role` at all, so the two app-level grants in the live database were inserted by hand. `roles:manage_app` guards WRITING an app-level role, not granting one — a different act, and currently an unguarded impossibility rather than a hole. The user detail screen is the first surface that wants it, and the key is permissions-side (`roles:*`), not `users:*`: it grants a role, it does not change an account |
| 38 | Deleting an account orphans its permission rows | if an erasure path is ever built | `perm_membership.userId` has no FK to `auth_user` by design (§12.12), so `DELETE FROM auth_user` leaves memberships and role grants pointing at nobody — verified by hand three times on 2026-09-08 removing test accounts, each needing an explicit membership and `perm_user_role` delete first. `findUsersByIds` and `listAppRolesForUsers` both tolerate the orphan by returning fewer rows than asked for. **No longer urgent: `users:delete` was removed the same day and the product has no delete at all** — an account is suspended, which keeps every row and is reversible. This stays open because the hazard returns the moment somebody builds an erasure path for a legal request, and because deleting by hand in a console hits it today. The composed delete belongs in the APP, the only layer allowed to touch both modules' tables |
| 39 | ~~Nothing in `apps/web-app` opens the realtime socket~~ **CLOSED 2026-09-11** | — | The API half is complete and running — `graphql-ws` subscriptions on the same URL as HTTP, a ticket verified at `onConnect`, `planChanged` published, `NEXT_PUBLIC_WS_URL` set in both env files — and the app never calls `createRealtimeConnection`, so `PlansPage` receives no `realtime` prop and nothing listens. **Decided 2026-09-08: leave it.** `module-auth` and `module-permissions` stay on HTTP; realtime arrives as its OWN module, which is what the seam was built for — `onConnect` shapes the socket into the same `{ req }` an HTTP request produces, so `FeatureGuard` and `resolvePrincipal` are transport-blind and a new module's subscriptions are guarded like its queries. When it lands: the APP owns the one connection and passes it in (a `createRealtimeConnection` per module means a socket per module per tab), the `graphql-ws` import sits behind a subpath, the ticket path is an option rather than a hardcoded reference to module-auth's URL, and the subscription gets its own `graphql_subscription` binding. §12.28 and §12.29 become live the day it does. **⚠ That day is scheduled: `module-chat` (2026-09-10) is the own-module realtime was waiting for.** It also adds a requirement the plan half of this entry did not state — events must be filtered PER PUBLISH, re-checking participation, because a subscription is authorised once at subscribe and `planChanged` fans out to every subscriber unfiltered | **✅ CLOSED 2026-09-11.** The app opens exactly one connection, in `providers.tsx`, and hands it to every module through `RealtimeProvider` / `useRealtime()` in `@kwtech/module-kit/react`. The contract and `createRealtimeConnection` moved OUT of `module-permissions` into `module-kit` — a socket is a resource of the application, and with two subscribing modules the old arrangement would have given a tab one socket per module, each with its own ticket and reconnect, failing in no visible way and costing N times what it should. `PlansPage` now receives live `planChanged` events through that connection, so the half of this entry that was built and unused is running. What is NOT done is the rest of the list: a `graphql_subscription` binding exists for both modules now, and the ticket path was already an option.
| 40 | Billing is unbuilt: nothing charges, and `currentPeriodEnd` is informational | when a payment provider is chosen | **Not to be built before the provider is.** Stripe, Paddle and manual invoicing imply genuinely different tables — Paddle is a merchant of record and handles tax, Stripe is not and does not — and guessing that shape is how a schema ends up fighting the integration. What IS decidable now, and was, on 2026-09-08: billing gets its OWN module, referencing `organizationId` and `planKey` as bare values with no foreign key, exactly as `perm_membership.userId` references an account. Roughly `BillingCustomer` (organization ↔ provider customer), `BillingPrice` (planKey → amount, currency, interval), `BillingInvoice`/`BillingPayment`. **Price does NOT go on `PermPlan`:** a plan is a bundle of entitlements and its price is commercial — currency, regional pricing, per-seat vs flat, promotions — so merging them makes every price change a permissions migration, puts "what Pro entitles" and "what Pro costs" in one row two teams edit, and makes a grandfathered customer paying last year's price for today's entitlements inexpressible. **No FK into `perm_subscription` either:** §12.24 already settled that a provider RECONCILES against those rows rather than owning them, so the seam is a webhook landing in the APP, which reads its billing rows and calls `PermissionsWriteService.updateSubscription` — the composition `resolve-principal` and the invitation resolvers already use. ⚠ Until it exists, a lapsed subscription KEEPS ENTITLING: `currentPeriodEnd` is written and rendered and never compared to `now`, because `status` decides entitlement so a clock cannot revoke a tenant with no row saying why. Nothing writes that status on a lapse — there is no scheduler in `web-server` — so the renewal date on the organization screens promises an enforcement that does not exist, and saying so on those screens is a cheap fix available before the module is |
| 18 | WebAuthn as a second factor type | Phase 7+ | `AuthMfaFactorType.webauthn` exists and every query pins the type to `VERIFIABLE_MFA_TYPES` (`totp`, `email` since 2026-09-25), so adding it is a code change and not a migration. It stores a public key, so it needs none of `secret-box.ts` |

| 41 | Can chat ever be sold in a plan? | before chat is priced | `module-chat` is APP level (§12.13 gives it that free: `/chat/*` is not `/organizations/*`), and a plan may only sell organization- and workspace-level features — an app key in a plan entitles nobody. So "group chat is a Pro feature" is unexpressible today, and the ROLE-sourced cap is the only commercial lever. Accepted on 2026-09-10 as the price of chat being person-to-person rather than tenant-scoped: two users with no organization in common must be able to reach each other, which is the whole point. Reversing it later re-levels every `chat:*` key and every role holding one |
| 42 | Does anyone get to read a conversation they are not in? | before a compliance or abuse report arrives | Shipping with NO such key: `platform:support_access` is the single exemption in the permission model and must not quietly become "read everyone's private messages". `chat:moderate` deletes a message in a conversation the actor is a PARTICIPANT of, which is a different act. The pressure will come from abuse reports and legal holds, and the honest answer when it does is a separate, `isPrivileged`, audited key — not widening support access, and not an unlogged database console |
| 43 | Message retention, edit history and attachments | after `/chat` ships | v1 stores `body` text with `editedAt`/`deletedAt` tombstones and no prior-version table, so an edit destroys what was said and a delete is soft with no purge. Fine while chat is internal; none of it survives a retention policy or a deletion request. Attachments were part of this entry and are now §12.45, which is a bigger question than retention |

| 44 | What `dnd` suppresses beyond the local tone | ⚠ PARTLY CLOSED 2026-09-13 | Availability ships as a coloured dot, and a dot that lies is worse than no dot. The one thing it CAN do today it does: `dnd` mutes the receive tone locally. Everything else people assume it means — no email, no push, no badge — needs a notification system, and this repo has none. ⚠ The availability picker must SAY so, in the picker, the way `/admin/defaults` says what it hands over. When notifications arrive, `dnd` is the first consumer and the question becomes whether it suppresses delivery or only presentation. **⚠ ANSWERED 2026-09-13: DELIVERY.** Email notifications shipped, and `shouldNotify` refuses outright for `dnd` — so it now means no tone AND no mail. What is still unclaimed is push and any badge, neither of which exists; the picker's wording must be re-read the day either does |
| 45 | Attachments: the blob store, and the signed URL that is a bearer token | before files are promised to anyone | v1 is text and emoji, and the schema is shaped so files need NO migration: `body` is nullable (an image-only message with `body: ''` is a lie), `ChatMessage.kind` already exists for system messages, and there are deliberately no `fileUrl`/`fileName` COLUMNS — attachments will be a child table, because the columns are the shortcut that breaks on the second file. ⚠ **No `ChatAttachment` table is created.** An empty table is a claim to have thought it through, and this repo already carries `PermMembershipStatus.invited` as the scar. What actually gates files is not schema: there is no blob store anywhere in the monorepo, so it needs storage, a size cap, a virus-scan decision, and a per-plan storage limit that lands back on the `LimitContribution` work. ⚠ And it CHANGES THE PRIVACY MODEL: a signed URL is a BEARER TOKEN — anyone holding the link reads the file, with no `canAccessConversation` on it. Decide that before the first upload, not after |
| 46 | Typing pings ride HTTP, not the socket | if they show up in metrics | A typing signal is the highest-frequency write in the product: one per user per conversation every few seconds. It goes over HTTP with every other mutation, which is the §12.29 bargain — `ThrottlerGuard` bounds it for free, where a socket-borne ping is cheaper and completely unthrottled. A deliberate trade of bytes for a limit that already exists. Reverse it if typing traffic ever registers, and take §12.29 seriously in the same change |

| 47 | Read receipts — "seen by" | before the thread UI is final | `lastReadMessageId` already exists for the unread badge, so who has read past message X is nearly FREE to expose, which is exactly why it needs a decision rather than a default. It is a privacy change, not a feature toggle: it tells a sender when a specific person read a specific line, and in a workplace tool that is a management surface. If it ships it must respect `invisible` — somebody appearing offline who silently marks read has been leaked by the side door §12 already closed for typing |
| 48 | Message search | when a conversation outgrows one screen | Nothing finds anything today. Postgres full-text or `pg_trgm`, scoped by `canAccessConversation` — search is the easiest place to accidentally return a message from a conversation the searcher is not in, because the natural query starts from the message table rather than from participation. Start from participation |
| 49 | Abuse has no path, which is §12.42's cost | when the first report arrives | `chat:moderate` acts only inside a conversation the actor PARTICIPATES in, and §12.42 deliberately ships no read-any-conversation key. Consistent, and it means a platform-wide abuse report can be received and acted on by nobody. The blocking added in v1 is the USER's remedy; the PLATFORM has none. The honest fill is a report flow that escalates a specific conversation with the reporter's consent — narrow, audited, and not a general read key |
| 50 | ~~Web Push, and what `dnd` gates once it exists~~ **CLOSED 2026-09-13 — by EMAIL, not push** | — | The tone only plays in an open tab. Everything people expect from a chat notification when the tab is closed needs Web Push — a service worker, a permission prompt, VAPID keys and a delivery path — and it is the moment §12.44 stops being theoretical: `dnd` starts suppressing DELIVERY rather than presentation, and per-conversation `mutedUntil` becomes load-bearing rather than a convenience. **⚠ IN SCOPE 2026-09-11:** the operator's requirement is that people are TOLD on time, and a tone in an open tab satisfies that only for somebody already looking. Either this comes forward, or `sendChatNotification` is wired at v1 to something that reaches a closed tab — email being the cheapest. Shipping neither does not meet the requirement. **✅ CLOSED 2026-09-13 with the second option**, chosen by the operator: `ChatNotifier` is a port in the module, `shouldNotify` is a pure rule in the domain, and the app fills it with email through the mail path that already existed. ⚠ **The notification carries NO MESSAGE TEXT** — who wrote, whether it was a group, and a link. ⚠ `dnd` now suppresses DELIVERY, which closes the live half of §12.44, and `mutedUntil` became load-bearing exactly as this entry predicted. Web Push stays open and is now CHEAP: the port carries ids and a group flag, so a push implementation replaces one provider in the app and changes nothing in the module |
| 51 | ~~Does an INVITED person see the first message before they accept?~~ **CLOSED 2026-09-13: yes, the first only** | — | `canAccessConversation` is ACTIVE ONLY (2026-09-11), so an invitation shows who sent it and nothing else. ⚠ That makes accept-or-decline close to a coin flip, and every product that has solved this shows the first message — which is the honest argument for changing it. The argument against is the one the helper exists to make: rendering somebody's message content to a NON-PARTICIPANT is what C1 was. A middle exists — the first `kind: user` message only, never the thread — and it is a PRIVACY decision rather than a UI one, so it is not being made by default. ⚠ Whatever is chosen, it must not leak differently for a blocked sender than an unknown one. **✅ CLOSED 2026-09-13: the middle, chosen by the operator.** The first `kind: user` message, never the thread. ⚠ `canAccessConversation` was NOT widened — it stays ACTIVE ONLY, and the preview is a separate narrow read with its own name (`previewsForInvitations`), so an audit of "who can see message content" finds two call sites rather than one helper that quietly means two things. ⚠ The blocked-sender requirement is met by the function containing NO block check at all, with a test that fails if somebody adds one |
| 52 | ~~Where the chat PANEL opens from~~ **CLOSED 2026-09-11: there is no panel** | — | **✅ CLOSED.** `/chat` is the only home. The panel was a shortcut to this data hanging off a header icon that no longer exists, and building a shortcut before the place it shortcuts to is how the shortcut becomes the only home — permanently cramped. It can return the day something exists to anchor it to, against a page that already works. Original entry: | The anchored popover was anchored to the icon in the main header, and that icon was removed on 2026-09-11 because the drawer already leads to `/chat` — a second door to one place. Three honest answers: `/chat` is the only home and the panel is dropped, which is the smallest and loses the read-without-leaving-the-page property the panel existed for; the panel re-anchors to the drawer entry, which is a popover hanging off a navigation list and is unusual for a reason; or it opens from somewhere new that has to be designed. ⚠ Not guessed at — the panel is most of step 7's UI, and building it against the wrong anchor is the expensive mistake |
| 53 | There is no longer a genuinely EMPTY app-level role | when a denial needs proving again | `normal-user` was the control case for the whole access-checking chain — route guard, page gate, component gate, API guard — and it held nothing on purpose, because a role that grants nothing is the only one that proves a denial is real rather than incidental. It now carries `chat:*`, on the operator's direct request (2026-09-12), and that was the right call: messaging a colleague is not an administrative power, and a product whose ordinary person cannot use its chat has a chat nobody uses. What is left is weaker — it proves ADMIN denials, since it still holds no `admin:*`, `roles:*` or `members:*` and nothing at organization or workspace level. `app-roles.ts` has always named the replacement: `restricted-user`, the account whose identity is managed elsewhere, which withholds even the `account:*` keys. ⚠ NOT created, because inventing a role nobody asked for is the other way to get this wrong — an operator's role catalogue is theirs. Create it the day a test needs a true zero |
| 54 | ~~⚠ Chat has two default-shaped decisions and no way to declare them~~ **CLOSED 2026-09-12** | — | Group roles created exactly the pair `workspace.*` already has: the role a group's CREATOR gets (hardcoded `owner`) and the role somebody ADDED gets (hardcoded `member`). §12's earlier "chat needs no platform default" was about ACCOUNT creation and predates roles entirely — it is not an answer to this. ⚠ But `APP_DEFAULT_REGISTRY` is a FIXED CONSTANT in `module-permissions`: features are contributed through `FeatureContribution` and limits through `LimitContribution`, and defaults have no equivalent, so chat cannot declare one without permissions importing chat (§9 forbids). Closing it needs the same treatment limits got in step 1 — a `DefaultContribution` port in `module-kit`, `composeDefaults`, and `listDefaults` reading the composed registry through options rather than its own constant — PLUS a new `kind` whose target is an ENUM VALUE rather than a `perm_role` row, which every existing default resolves to. Four parts, one of them new machinery. **✅ CLOSED 2026-09-12 — and it was FIVE parts.** `DefaultContribution` and `composeDefaults` in `module-kit`; `AppDefaultSpec` widened (`key` and `moment` become strings, `module` becomes required) with a `choice` kind and `isValidDefaultFor`; `defaultRegistry` on the options, read by BOTH `listDefaults` and `setDefault`; chat declares its two and reads them back through a `ChatDefaultReader` port. The fifth was found by looking rather than by planning: **the screen groups by MOMENT and owned the list of moments**, so a contributed default had no section and never rendered — declared, composed, settable through the API, invisible on the only screen it can be set from. `DefaultMomentContribution` + `composeDefaultMoments` fix that, and an undeclared moment now renders an unnamed section rather than nothing |

| 55 | ⚠ The chat notification path has never sent a real email | before anybody relies on being told | Built and wired 2026-09-13, and **exercised only against fakes**: there is no SMTP server on the development machine, so `renderEmail('chat-message', …)` is rendered but `transport.sendMail` has never run. What is unproven is everything a mail server decides — whether it is accepted, whether it lands in a spam folder, whether the `text`/`html` pair renders, and whether the From address passes SPF/DKIM on the real domain. ⚠ The FAILURE IS SILENT BY DESIGN: the notifier swallows everything so a dead mail server cannot break a send, so nobody finds out by chatting. Send one real message to a real inbox, then re-read this row. ⚠ Chat itself does not depend on it — with no `SMTP_URL` the path returns early and logs |
| 56 | ⚠ The plan describes seams in the PRESENT TENSE that were never built | next time this document is trusted | Three found in three days, all by looking rather than by testing: `sendChatNotification` was "the optional hook already in the design" and did not exist; `listConversations` said "ONE GROUPED PASS — three queries total" while running `3 + 2n`; the nav badge told its reader "the server already computes unread in one grouped pass". Each read as a description of the code and was a description of the INTENTION. That is the cost of a document written alongside the work rather than after it — which is still the right trade — but it means **a claim here is not evidence**. ⚠ Nothing has audited the rest of §§9–11 for the same thing, and the ones found were all in areas that happened to be worked on. Grep the plan for present-tense claims about behaviour and check each against the code |
| 57 | ⚠ Two more batch-by-id queries rest on the argument `findUsersByIds` just retracted | before either key is granted below platform admin | `permissionUserAppRoles` (`roles:read`) and `permissionUserOrganizations` (`organizations:read`) accept a list of user ids and justify it with the same comment: *"the ids come from a list the caller could already see, so batching discloses nothing new"*. That is true of the screen and not of the endpoint, which answers for whatever ids it is sent — the flaw fixed in `findUsersByIds` on 2026-09-13. **Neither declares `@RequireScope`, so both resolve at APP level today and only platform administrators reach them.** That is why this is open rather than fixed: the exposure is the one `findUsersByIds` had before its fix, and it is acceptable only while it stays admin-only. The moment either key is granted inside an organization, or the query gains a scope, it needs the same membership intersection, done in the database. Their comments, and the matching ones in `permissions.service.ts`, still cite `findUsersByIds` as their precedent and should be reworded when this closes |

| 58 | ~~How queue numbers are ISSUED: outside the system, or a kiosk~~ **CLOSED 2026-09-13: outside the system, by a person** | — | **✅ CLOSED by the operator.** A staff member or guard hands out numbers; Call next allocates the next one, skipping numbers already called, and a line's next number can be set to match the slips. The system cannot know who is waiting. ⚠ First recorded as in-system issuing, corrected the same day. Original entry: | **v1: outside** — a paper roll, a dispenser or a receptionist — and Call next allocates the next number. A kiosk ("take a number") is what makes "how many are waiting" and "estimated wait" answerable at all. ⚠ It is also a PUBLIC WRITE: an anonymous route that creates rows, which is a spam and exhaustion surface the read-only board is not, so it needs its own limit before its own screen. The schema already carries `waiting`, so this is a route and a status, not a migration. ⚠ "Text me when my turn is near" needs the kiosk AND a phone number, which is personal data this module does not hold today — and holding it changes §12.60 and the display-key paragraph of the 2026-09-13 entry |
| 59 | Per-IP limits on anonymous `graphql-ws` sockets | before a display is used anywhere public | **✅ CAPS BUILT 2026-09-13:** 2 sockets per display pass and 1000 anonymous sockets per process, refused with a RETRYABLE 4500 (never 4403, which a TV reads as "stopped"). A dead socket's slot is freed by graphql-ws' own keepAlive: ping every 12 s, terminate after one missed pong — so the "liveness first" blocker below was already met by the library. Per-IP caps stay unbuilt, for the proxy reason at the end of this row. **⚠ NARROWED 2026-09-13:** the code is exchanged over HTTP under the `credential` bucket plus a per-session attempt count, and the socket takes a 256-bit pass, so the handshake is no longer a guessing surface. What remains is sockets per pass (cap 2, to cover a reload's overlap) and a ceiling on total anonymous sockets. ⚠ **Not built in step 2 (2026-09-13):** a socket that drops without a close frame is not noticed until TCP gives up, so a per-pass cap of 2 would lock out a TV whose Wi-Fi blinked twice — a server-side liveness timeout has to come first. Original entry: The handshake caps connections PER DISPLAY KEY (default 10). Nothing caps connections per IP or in total, and the credential is printed on a screen in a public room. §12.29 was bounded by "the handshake needs a live-session ticket", and for anonymous sockets that bound is gone. `ThrottlerGuard` skips WebSocket operations, so this lives in `onConnect`, which can see the upgrade request's address. ⚠ Behind a proxy, that address is the proxy's unless `trust proxy` is set, and a per-IP cap then becomes a global one that locks every TV out together |
| 60 | ~~Staff names on the public board~~ **CLOSED 2026-09-13: optional per display, nickname only** | — | **✅ CLOSED by the operator.** `showStaffNames` as one persistent workspace setting, off by default, showing a nickname the person sets for themselves — never their account name as a fallback. That keeps call events free of personal data and the display key a plain link. Original entry: | **No, by default.** The board says "C-042 → Window 3". A name on a screen in a public room makes a person findable by anybody with a grievance. Saying yes is more than a UI change: call events would then carry personal data, so they need chat's per-publish membership re-check, and the display key becomes a credential that should be hashed. Decide both together |
| 61 | ~~Which plan tiers sell `queue:*`~~ **CLOSED 2026-09-13: every tier except `free`** | — | **✅ CLOSED by the operator.** `starter`, `pro` and `enterprise` carry all six keys as one `QUEUE` group. ⚠ Environments that are already seeded still need an operator on `/admin/plans`. Original entry: | Workspace-level keys pass the entitlement filter, so a key no plan carries grants nothing, and the denial correctly says `not_entitled`. This is a product decision (free? starter and up?), not an engineering one. ⚠ Whatever is chosen, `createPlanIfAbsent` will not add it to plans that already exist, so every seeded environment needs an operator on `/admin/plans` |
| 62 | A queue seat outlives workspace membership | before the console is relied on | **⚠ NARROWED 2026-09-13:** assignment now checks `QueueStaffCheck` when it is made, and the guard refuses Call next from anyone who lost `queue:serve` or membership, so the leftover harm is a window that LOOKS occupied. Whoever holds `queue:assign_windows` fixes it by reassigning. **⚠ Not narrowed further:** by the operator's choice, seats persist across queuing runs, so only an assigner ends a stale seat. The console flags any seat whose holder can no longer serve. Original entry: `userId` has no FK and removing a workspace member writes nothing in `queue_*` — `module-permissions` does not know the queue exists, and §9 keeps it that way. So a removed member still holds Window 3 until `queue:manage_windows` releases it or the service day ends. The honest fixes are an app-side hook on member removal (the app is the only layer that sees both modules), or re-checking `canAccessWorkspace` when reading seats — which costs a permission resolution per seat per read |
| 63 | ~~Can any server OPEN a window, or only an administrator?~~ **CLOSED 2026-09-13: through a role** | — | **✅ CLOSED by the operator.** `queue:manage_windows` creates windows, and `queue:assign_windows` assigns one to a member (yourself included). Self-seating is a role carrying both it and `queue:serve`, not a setting. Original entry: | **v1: anyone holding `queue:serve` may open one by naming it**, bounded by the `queue:windows` cap and by case-insensitive name uniqueness — the operator's "assign a window name for his unit". The cost: a typo creates "Windw 3" and it sits on every TV until somebody archives it. The alternative — administrators define windows and staff only pick — is tidier and slower on a site's first morning. A workspace setting could offer both, and that setting is exactly the sort of switch not to build before someone asks for it |
| 64 | Spoken announcements: language, voice and how a code is read | before a non-English site | `speechSynthesis` voices are whatever the TV's OS ships, so the same board sounds different on two devices and may have no voice at all for a language. "C-042" also has to be read as "C, zero four two" rather than "C minus forty-two", which is a formatting rule per language. Needs a `lang` chosen on the TV and a fallback to the chime alone when no voice matches — silently announcing nothing is the failure to avoid |
| 65 | Queue history: retention and reports | after `module-queuing-window` v1 | `calledAt`/`completedAt` make wait and service times computable, which is the first thing a site manager asks for. Nothing purges `queue_ticket`, and a busy site writes thousands of rows a day. Decide how long tickets are kept and whether a report reads live rows or a daily rollup before the table is large, not after |
| 66 | ~~Printing an issued number~~ **CLOSED 2026-09-13: moot** | — | Raised only by the in-system issuing reading of §12.58, which the operator corrected the same day: numbers are handed out outside the system, so nothing here prints. Original entry: | v1 has the issuer read the number out or write it down. A small browser print view of one ticket is cheap and needs no new dependency. A thermal receipt printer (ESC/POS over USB or the network) is a hardware and driver decision, and browsers cannot reach one without a local bridge or WebUSB. Do not pick a printer on a customer's behalf |
| 67 | A new display code without stopping the queue | if a code leaks mid-session | Per the operator, a new code comes only with a new session. So the remedy for a code seen by the wrong person is Stop and Start — which, unless Continue numbering is ticked, restarts the numbers. A "new code" button that also invalidated every existing pass would be gentler. It is not built, because nobody asked for it and because a leaked code exposes a board that is already on a public wall |
| 68 | A session nobody stops | before the first site forgets | There is no job runner (§12.40), so nothing ends a session at closing time. Numbers keep counting into the next morning and TVs stay admitted. v1: the console shows "Running since yesterday, 8:02 am", in warning colour, to holders of `queue:stop`. An automatic stop at a set hour needs a scheduler AND a time zone — the very setting this design just removed |
| 69 | The API cannot see a browser's own IP address, so rate limits are shared | before a display, or sign-in, is used by more than a handful of people | **⚙ CONFIGURABLE 2026-09-13, default OFF:** `TRUST_PROXY` (hop count or address list; `true` refused at boot) sets Express's `trust proxy`. Still OPEN as a deployment decision: set it only where an edge proxy REWRITES `X-Forwarded-For`, because the Next route handlers pass on whatever the browser sent. Every browser request reaches the API through the Next server's proxy. `module-auth`'s route handlers forward `X-Forwarded-For`, but `web-server` does not set Express's `trust proxy`, so `ThrottlerGuard` tracks the Next server's address for every request. **The tight `credential` bucket (10 a minute) is therefore shared by every person and every TV behind that server** — sign-in, the 2FA challenge, password reset, and now `openQueueDisplay`. One waiting room setting up four TVs while staff sign in can exhaust it. This predates the queue and is a DEPLOYMENT decision: `trust proxy` must name exactly the proxies in front of the API, or a client sets its own `X-Forwarded-For` and escapes every limit. §12.59's note about proxies is the same problem one layer out |
| 70 | Google-only accounts: accepting an invitation with Google | when invited people ask to skip choosing a password | Google sign-in (2026-09-25) reaches only accounts that already exist, which today always have a password. An invitation accepted with Google would create one WITHOUT a password — and every step-up in `AuthService` (`requirePassword`: enrol or remove a factor, new recovery codes, change password) would then refuse that person with `no_password_credential`. Building it means a second step-up proof (a fresh Google round trip with `prompt=login` and `max_age`) before the invitation path can use Google |
| 71 | No screen shows or unlinks a linked Google account | before someone asks why a Google account they lost still signs them in | `auth_identity` is written on first link and read by sign-in only. Needed: a Security card listing the identity with an Unlink (password-confirmed), an admin view of it, and the rule that unlinking may never remove the account's last way in |
| 72 | Email as a second factor is only as strong as the mailbox | if a policy ever REQUIRES a second factor | Offered because it needs no phone app, and labelled weaker in the UI. A policy that counts "any factor" as compliance would accept it; one that means phishing resistance must exclude `email` (and `totp`) and wait for WebAuthn (§12.18) |

Decisions 1, 2, 3 and 5 gate the next step.


## 13. Decision log

- **2026-09-25** — **Two-step verification is managed inline on Security;
  `/settings/two-factor` now renders the Security page.**

  A user request: make it easy to see whether two-step verification is on. The
  Security page answered that nowhere — its card said "Manage two-step
  verification" and linked to a separate screen.
  - **A summary at the top** (`summariseSecurity`, `src/react/view/security-view.ts`,
    tested): basic / good (email codes only) / strong (authenticator app), with a
    checklist. A failed or pending load is `unknown`, never "off" — the wrong
    direction to be wrong in.
  - **`TwoFactorSettings`** is the whole two-step flow as one card: each method a
    row with its own Set up / Remove, recovery codes regenerated inline and
    offered for copy and download. One inline panel at a time, because every
    panel has a `password` field and `AuthField` derives its id from the name.
  - **The password form is folded** behind "Change password", so the answer is
    above the fold rather than three empty boxes.
  - **Not done:** the route was kept rather than removed, so old links still
    land on the controls. `TwoFactorPage` remains exported as a thin wrapper for
    an app that wants it apart. `SecurityPage` lost `twoFactorHref` (nothing
    passed it) and gained `renderQr`. The `ui_component` bindings were renamed
    to `TwoFactorSettings.*`.

- **2026-09-25** — **Two-step verification draws its QR code; `QrCode` moves
  to `@kwtech/web-ui`.** Reverses 2026-08-26 ("draws no QR code").

  A user report: enrolment said "Scan this, then enter the code" above no QR
  code. The 2026-08-26 seam, `TwoFactorPage`'s `renderQr` prop, was never
  reachable — the route renders the page with no props, and a function cannot
  travel through the route table — so no app could ever have passed one.
  - **Drawn by default** with `QrCode`, the component module-queuing-window
    already used for its display link: the `qrcode` library's matrix as one SVG
    path, in the browser, never a QR web service. `renderQr` stays as an override.
  - **Moved to `web-ui`, not copied**, because auth is its second user (the
    rule in `frontend.md`). `qrcode` is now web-ui's dependency, and the queue
    module imports the component from there. module-auth gains `@kwtech/web-ui`
    as an optional peer, like the queue module.
  - **No new exposure:** the page already shows the TOTP secret as text for
    manual entry, so the secret was in the browser either way.

- **2026-09-25** — **"Sign in with Google" for existing accounts, and emailed
  codes as a second factor beside TOTP.**

  A user request: multi-factor authentication by TOTP or email, and sign-in with
  Google, in addition to email and password. Google was schema-only since
  2026-08-25; this implements it on the two properties fixed then.
  - **Google: authorization code + PKCE, no library.** The Next handler
    (`GET /api/auth/google`, `/callback`) holds `state`, `nonce` and the PKCE
    verifier in an httpOnly, `SameSite=Lax` cookie scoped to `/api/auth/google`
    for ten minutes and checks `state` on return. The API holds the client
    secret, exchanges the code and checks `iss`, `aud`, `exp` and `nonce`
    (`prepareGoogleIdentity`). No JWKS: the ID token comes only from the token
    endpoint over TLS, which OIDC Core §3.1.3.7 accepts in place of a signature.
  - **Existing accounts only — the user's choice.** Matched by `(google, sub)`;
    otherwise LINKED once to the account with the same address when Google says
    `email_verified`, never matched by address after that. An unknown Google
    account is refused: sign-up stays invitation-only (§12.36). One message for
    every refusal; the `federated_*` reason goes to `onAuthFailure`.
  - **Google is not a way around MFA.** It ends in the same
    `startSession(… mfaOwed ? 'mfa' : 'full')` as a password, and locked or
    suspended accounts are refused the same way.
  - **Email codes: a factor type, not a flag.** `AuthMfaFactorType.email`, and
    each code a row in `auth_mfa_email_code`, **bound to the session that asked
    for it**, so a code requested by one sign-in cannot be spent by another.
    scrypt-hashed (a million values: a fast hash would fall in a second), ten
    minutes, single use, a new code retires the old, one send per 30 s per
    session. Wrong codes draw on the account lockout like TOTP ones.
  - **One list, `VERIFIABLE_MFA_TYPES`**, read by "owes a factor", by the
    challenge, by confirmation and by the admin view, so they cannot disagree.
  - **Enrolment proves the mailbox** through the existing `confirmMfa`, and needs
    the password like TOTP enrolment; the endpoint is bound to
    `account:two_factor_enrol`. `send` and `enrol` join the credential throttle.
  - **Config:** `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`, both or
    neither (the boot refuses one); the redirect URI defaults to
    `FRONTEND_URL/api/auth/google/callback`. The sign-in page asks the API whether
    to draw the button, so the web app has no setting of its own.
  - **Verified:** 83 new tests (claims, matching, the service, the Next legs);
    against the live API, email enrol → confirm → a half-admitted sign-in →
    send → resend refused → wrong code → verify → replay refused; with a
    placeholder Google client, the authorization URL (S256, no verifier in it)
    and a refused exchange; the boot refusing a half-configured client.
  - **Found by running it:** a mail hook that throws before its own logger
    reached the user as a bare 503 with nothing logged. The hook now logs every
    failure, render included, and the 503 carries the cause. The trigger was a
    new template the running watcher had not copied, which is now in the mail
    README.
  - **Not done:** Google-only accounts and accepting an invitation with Google
    (§12.70), a screen to see or unlink a linked Google account (§12.71), and a
    per-code attempt counter (the lockout covers it). A running `next dev` did
    not pick up the rebuilt module's new `GET` export; restart it after pulling.

- **2026-09-25** — **The API reads `.env.local`, the same file name as the web
  app.**

  A user request, for uniformity: both apps now read `.env.local`, and
  `pnpm env:use` links each profile to that name in both.
  - **One loader:** `apps/web-server/src/config/load-env.ts`, imported first by
    `env.ts`. `prisma.config.ts` does the same in one line, because it is loaded
    by Prisma rather than by the app.
  - **Migrated, not broken:** `env.mjs` renames an old `apps/web-server/.env`
    (plain file or profile link) to `.env.local` on any `pnpm env:*` or
    `pnpm dev`. Until then the API still boots from `.env` and prints a warning
    naming the fix, so pulling this change breaks no machine. If both files
    exist, `.env.local` wins and the old file is reported, never deleted.
  - **Verified:** a real boot (`/health` reports the database up), `prisma
    migrate status`, the seed runner, 177 tests, and the migration from both a
    pre-profile machine and a post-profile one.

- **2026-09-25** — **Environment profiles: one command switches local, staging
  and production, and development defaults to local.**

  A user request: an easy way to handle `.env` files across local, staging and
  production, fast to switch, defaulting to local in development for both the
  frontend and the backend. Found on the way: the committed
  `apps/web-server/.env.example` carried the real seed account's email and
  password, public since `7208b0d`. The values were removed; the password must
  be CHANGED, because removal does not unpublish history.
  - **Profiles:** `envs/<name>/{web-server,web-app}.env`, gitignored.
    `pnpm env:use <name>` symlinks them to `apps/web-server/.env` and
    `apps/web-app/.env.local`, the files each tool already reads, so Nest, Next,
    Prisma, the seeders and `dev-db.mjs` needed no change. Symlinks rather than
    copies, so an edit in the IDE edits the profile instead of drifting from it.
    Existing plain files are adopted into `envs/local/` on first run, and moved
    rather than copied.
  - **Local by default:** `pnpm dev` runs `env.mjs ensure`, which activates
    `local` and creates it from the templates, with fresh `AUTH_JWT_SECRET` and
    `AUTH_MFA_SECRET_KEY`, when none exists. A profile somebody chose is left
    alone, with a loud banner off local.
  - **`APP_ENV` (`local | staging | production`) in both apps' env schemas,**
    separate from `NODE_ENV` because staging runs a production build. Unset means
    local, EXCEPT in a production build, which refuses to boot without it. A
    deployed host that forgot it would otherwise call itself local and pass the
    local-only guards.
  - **Guards:** `db:migrate` (which can reset a database) and `db:snapshot`
    (which writes a PUBLIC file) run only on local. `db:restore` never runs on
    production.
  - **turbo:** the web-app build's inputs include `.env*` (Next inlines them,
    and turbo hashes only shell env), and `APP_ENV` is a `globalEnv`. Verified
    that the build hash changes on a switch and returns on switching back.
  - **Pre-commit:** `env:check --examples-only` fails a commit whose
    `.env.example` sets any `*_PASSWORD|*_SECRET|*_KEY|*_EMAIL`.
  - **Fixed:** the root `db:migrate`, `db:deploy` and `db:studio` scripts
    filtered `@kwtech/db`, which does not exist. They now target
    `@kwtech/web-server`, and `db:sync` / `db:seed` were added at the root.
  - **Not done:** no secret manager integration (Doppler, 1Password CLI,
    Infisical). Profiles plus a password-manager copy are enough for one
    developer. Revisit when a second person or CI needs the staging secrets.
    Deployed hosts keep their variables in the host's own settings.

- **2026-09-25** — **Coding standards, extracted from the code, loaded by Claude
  Code on their own.**

  A user request: standards for everything from conditions and loops up to
  React, GraphQL, Next.js, NestJS, modules and features, followed during
  development without being asked, and based on this repository's own
  structure. They live in `.claude/rules/`, and `docs/STANDARDS.md` indexes them.
  - **Path-scoped, not one file.** `00-principles.md` is the only file loaded in
    every session. The TypeScript, modules, backend, database, frontend and
    testing rules load when a matching file is read (`paths:` frontmatter). One
    large document in `CLAUDE.md` would cost context in every session, and long
    instructions are followed less reliably.
  - **Descriptive, not aspirational.** Every rule is what most of the code
    already does, found by reading and counting (early return vs `else` about
    1165:4; JSX `&&` 0 vs `? … : null` 250; zero `enum`, zero `any`). Adopting an
    outside guide would have made most of the repo non-compliant on day one.
  - **When the code disagrees with itself, the newest module wins**
    (`module-queuing-window`, then `module-chat`). The older pattern is marked
    **Legacy — do not copy** and listed as a backlog of 16 items in
    `docs/STANDARDS.md`. Converging it is deliberate work, never a side effect.
  - **Corrected on the way:** the frontend does NOT use Apollo Client or codegen.
    It uses hand-written `create*Client()` fetch clients and graphql-ws through
    module-kit. PLAN §9's `src/graphql/*.graphql` layout is superseded by
    `src/operations.ts`.
  - **Not done:** none of the legacy code was changed. Two findings look like
    bugs rather than style and are recorded in `docs/STANDARDS.md` for a
    decision:
    - `formatError` drops the refusal `reason` in production.
    - The public invitation mutations take a token but carry no credential
      throttle marker.

- **2026-09-25** — **A committed snapshot of the dev data.**

  A user request: set up local dev on another machine and continue with the
  same data. `pnpm db:snapshot` writes every table's rows to
  `apps/web-server/seed-data/snapshot.json`. `pnpm db:restore` loads them into an
  empty, migrated database and then runs the seeders. `scripts/dev-db.mjs` does
  the restore itself on a brand-new container when the file exists.
  - **Not a Seeder.** Snapshot rows keep their ids, and grants and memberships
    point at them. Running sync first would create roles under new ids, and the
    snapshot's rows would then fail their foreign keys. So the restore needs an
    empty database, refuses a non-empty one unless `--force` (which truncates),
    and the seeders run after it, where they converge as usual.
  - **No credentials, because the repository is public.** The user chose
    "commit, credentials stripped" over a gitignored file they would copy by
    hand. Left out: `auth_credential`, `auth_mfa_factor`, `auth_recovery_code`,
    `auth_identity`, `auth_session`, `auth_password_reset`,
    `queue_display_pass`. Invitation token hashes are replaced with random ones.
    Names, emails and chat messages ARE published. That was accepted for dev
    data, and is the reason real customer data must never reach a dev database.
  - **Schema-agnostic.** Tables come from `pg_tables` and are ordered by their
    foreign keys. Rows go through `row_to_json` and back through
    `json_populate_recordset`, so Postgres handles every type conversion
    (enums, jsonb, timestamps). A restore writes only the columns the snapshot
    and the current table share. The snapshot records its migration, and a
    database that has not applied it is refused.
  - **One row per line, never re-serialised in JS on export.** Re-exports diff
    by row, and a bigint keeps every digit (the restore keeps integers past
    2^53 as their source text). Biome ignores the file so it keeps that layout.

- **2026-09-14** — **Rate limits raised and made configurable.**

  A user hit `ThrottlerException: Too Many Requests`. The cause is §12.69: the
  API sees one address for every browser, the Next server's, so the `default`
  bucket (120 a minute) was shared by every person, tab and TV. The queue
  console spends it quickly: every action re-reads two queries, and so does
  every live event (debounced).
  - `THROTTLE_DEFAULT_LIMIT`, **default raised to 600**, and
    `THROTTLE_CREDENTIAL_LIMIT`, **default kept at 10**, in `env.ts`.
  - **The credential bucket stays tight on purpose.** It is what slows password
    and display-code guessing. It is configurable, but raising it trades
    directly against that.
  - **Not done, and the real fix:** count signed-in requests per USER rather
    than per address (JwtAuthGuard runs before the throttler, so the principal
    is already on the request), and set `TRUST_PROXY` where an edge proxy
    rewrites `X-Forwarded-For`. A higher shared limit only moves the ceiling.

- **2026-09-14** — **The TV board, redesigned, with a theme selector of its own.**

  A user request: a more modern and friendly display, plus the app's theme
  selector on top, remembered per TV in the browser only.
  - **Every phase shares one frame.** A top bar shows the workspace (only after a
    pass, so the prompt still reveals nothing), a Live / Connecting /
    Reconnecting badge, the clock and the selector. A soft backdrop is tinted by
    the palette's own primary. The code prompt, start screen and board are
    cards. The code prompt gains a three-step hint and tone-coloured notices
    ("stopped" is a warning, not an error). The start screen names the three
    things the tap unlocks. On the board, each window is a card that lights up
    in the primary colour while calling, sized to how many windows there are.
    Recent calls show their time. Sound and the line filter are pill buttons.
  - **Kept on purpose:** stable window order (the lit card marks the newest
    call, rather than moving it — the step 8 rule). Every accessible name the
    browser tests use is unchanged. Inline SVG icons, so no icon dependency is
    added to the module.
  - **The theme is the SCREEN'S, under its own localStorage key**
    (`kwtech_queue_display_theme`, mode and palette). It is never sent to the
    server, and it is not the app's `kwtech_theme` / `kwtech_palette`: a TV is
    often a browser somebody also signs in on, and neither choice should
    repaint the other.
  - ⚠ **Applied to `<html>` and held there.** Palette tokens hang off the root's
    `data-palette`, and dark tokens off a `.dark` ancestor, so a wrapper cannot
    force light inside a dark app. `next-themes` owns the root. A nested
    provider is a no-op, and next-themes rewrites the class on a system-scheme
    change or another tab's storage event. So `useDisplayTheme` sets the root,
    re-asserts it with a MutationObserver (writing only on a difference, so it
    cannot loop), and restores what it found on unmount. **Accepted:** a brief
    flash of the browser's app theme on load, because localStorage is
    client-only.
  - **`@kwtech/web-ui`'s `ThemeSwitcher` gained an optional CONTROLLED
    palette** (`palette` + `onPaletteChange`), the way `mode` always was.
    Uncontrolled behaviour, used by every app page, is unchanged.
    **Rejected: a second switcher component in the queue module.** It would
    re-draw the same menu and drift from it.

- **2026-09-14** — **The queue on the existing workspace roles.**

  A user decision, after a member could not see the queue and nobody could be
  assigned to a window. The cause was step 4's "role presets are exported, not
  seeded": the plan sold the six `queue:*` keys, but no role except
  `super-admin` granted them. So a workspace member had no `queue:read`, which
  hides the Queue item. The assign picker lists only members holding
  `queue:serve`, so it offered nobody.
  - **`workspace-user`** gains the `queue-staff` preset: `queue:read`,
    `queue:serve`. Any member of a workspace can staff a window there.
  - **`workspace-admin`** gains the `queue-admin` preset: all six keys.
  - **Read from `QUEUE_ROLE_PRESETS`, not restated.** This matches `CHAT_USER`,
    and it throws if a preset disappears.
  - **Rejected: separately assigned Queue staff / supervisor / admin roles.**
    They are more precise, but every member would need a second role before the
    queue works. The presets stay exported for a tenant that wants that split
    later.
  - Still gated by the plan. The organization's subscription must include the
    keys, and on a free plan these grants do nothing.
  - ⚠ Assignment is still per workspace: a person appears in a workspace's
    picker only once they are a MEMBER of that workspace.

- **2026-09-13** — **Browser tests: Playwright, against a stack you start.**

  `apps/web-app/e2e` (`pnpm --filter @kwtech/web-app test:e2e`) runs headless
  Chromium against the BUILT API and app. It proves what no unit test can see.
  A signed-in console starts queuing. A second, signed-out browser opens the
  display from the console's link, and the `#code` leaves the address bar.
  Call next appears on that TV over its own socket, and Stop returns the TV to
  its code prompt. The Announcements settings save and survive a reload. A
  wrong code gets the one refusal sentence. **All three pass locally**
  (2026-09-13).
  - **Nothing is started or seeded by the tests.** A suite that booted its own
    servers would quietly test its own setup. They need `E2E_*` variables and
    skip with the reason without them.
  - ⚠ **They write real rows** (line `Z9`, window "E2E window", a seat, a
    session) and put them back: stopped, released, archived, pitch restored.
    Checked in the database after the run.
  - ⚠ **`page.request` arrived "Not signed in".** Under `next start` the
    session cookie is `Secure` (`module-auth` sets it in production). Chromium
    sends that to 127.0.0.1, but Playwright's separate request context does not.
    Setup calls therefore use `page.evaluate(fetch)`, the same same-origin call
    the console makes. This is not a product bug.
  - **Not covered:** headless Chromium has no audio device and no speech
    voices. The tests prove a board RECEIVES a call, not that a TV chimes or
    speaks. Check those on a real screen.
  - Without root, Chromium's missing libraries (`libnspr4`, `libnss3`,
    `libasound2`) are unpacked from `apt-get download` and passed in with
    `PLAYWRIGHT_LIBRARY_PATH`. See the e2e README.

- **2026-09-13** — **What a display says, and a workspace voice.**

  A user request. The spoken call is now **"Number C, zero four two, please
  proceed to window Cashier 1."** It was "Now serving C, zero four two, at
  Cashier 1." `announcementSentence` does not say "window Window 3" when a
  window is already named that way.

  **The voice is a workspace setting** (`setQueueVoice`, bound to
  `queue:start` beside `setQueueShowStaffNames`: the people who decide what a
  display publishes). It covers on/off, voice (display default · woman · man),
  pitch (low · normal · high · very high), speed (slow · normal · fast), volume
  (soft · medium · full), and read once or twice. It travels on the board
  snapshot, so a change reaches every TV with the next redraw. The
  settings-changed event already causes that redraw.
  - **Presets, not numbers.** The API takes pitch 0–2, rate 0.1–10 and volume
    0–1. Named presets map to values that sound reasonable (`speechPlan`), so
    nobody has to find out 3× speed is a blur on a live TV.
  - **Stored as text columns, not a Prisma enum.** Migration
    `20260913150028_queue_voice` adds six defaulted columns, so it is additive
    and existing rows hear what they heard before. A new preset is then a code
    change. A stored value no longer offered reads back as its default
    (`normalizeVoice`), so it cannot break a TV. Writes are strict:
    `voiceRefusal` refuses the whole voice when any of the six fields is
    missing or not a choice.
  - ⚠ **"Woman" / "man" is a preference, and the UI says so.** The Web Speech
    API exposes a voice's name and language, nothing about how it sounds.
    `pickVoice` matches names known to be a woman's or a man's across
    Chrome, Edge, Safari, Android and Windows. It prefers English voices and
    checks women first, because "Female" contains "male". A device with no
    match keeps its default voice, shifted ±0.3 in pitch, rather than
    pretending. **Rejected: a free voice-name field.** Voice names differ on
    every device, so a name chosen on the supervisor's laptop would usually
    mean nothing on the TV.
  - **Play a sample** speaks on the settings computer, and the note says the
    TV's voices may differ.
  - Speech moved into `src/react/speech.ts`, and the choice logic into
    `view/voice-view.ts`, which is pure and tested. A new call still cancels the
    one being read. §12.64 (language) stays open: the digit words and the
    sentence are English.

- **2026-09-13** — **After the queue build: socket caps, a trust-proxy switch, and the queue on the local plans.**

  **§12.59 — anonymous socket caps, built.** `AnonymousSocketLimiter` in
  `apps/web-server/src/graphql/ws-context.ts` counts anonymous sockets: 2 per
  admission and 1000 in total, per process. An admission names what it is
  counted against by returning a `connectionKey`. The queue returns
  `queue-display:<passId>`, so the app still knows nothing about displays.
  - ⚠ **A full cap is THROWN (4500), never refused (4403).** A queue display
    treats 4403 as "queuing has stopped" and discards its pass. Capacity is
    temporary, so the TV must retry.
  - ⚠ **Released on `onClose`, not `onDisconnect`.** The slot is taken inside
    `onConnect`, before the acknowledgement. `onDisconnect` fires only for
    acknowledged sockets, so a socket that dropped in that gap would leak its
    slot. Release is idempotent.
  - **Liveness was already there.** Step 2 held the caps back for a
    server-side liveness timeout. On reading graphql-ws, `useServer` already
    pings every socket every 12 s and terminates one that misses a pong. Nest
    calls it with that default. Termination fires `onClose`, so a dead TV's
    slot is free within about 24 s. A duplicate ping timer was written and
    then removed.
  - Tested over real sockets in `test/anonymous-socket.test.ts`: the third
    socket on one pass closes 4500, the slot frees on close, and signed-in and
    refused sockets are never counted.
  - **Rejected, still: per-IP caps.** The API cannot see client addresses
    reliably (§12.69), so a per-IP cap would be one global cap.

  **§12.69 — `TRUST_PROXY`, default OFF.** It is parsed in
  `src/config/trust-proxy.ts` and applied in `main.ts`. It accepts a hop count
  or a list of addresses and presets. `true` is refused at boot.
  ⚠ **Why off rather than "trust the Next server":** Next's route handlers
  forward whatever `X-Forwarded-For` the browser sent. Trusting Next without an
  edge proxy that rewrites that header lets any client choose its own address,
  and so escape every rate limit. That is worse than today's shared bucket.
  The switch exists; turning it on is the deployment decision §12.69 names.

  **The queue on the local plans.** This is the operator step from step 4, run
  against the local database only: the six `queue:*` keys and
  `queue:windows=10`, `queue:displays=5` on starter, pro and enterprise. Free
  gets nothing. `seed/plans.ts` still does not add them, deliberately (step 4).

- **2026-09-13** — **`module-queuing-window` step 8: the public board, on a TV.
  The build is complete.** A TV opens
  `/queue-display/:organizationKey/:workspaceKey`, takes the code (typed, or
  from the console's QR), taps Start display once, and shows the queue live
  until queuing stops. **Verified end to end through the real web app** — see
  below.

  **What was built:**
  - **The page**, in the package: `QueueDisplayPage`, driven by
    `useQueueDisplay`. It is the descriptor's third route: no feature, no drawer
    entry, `chrome: 'fullscreen'` — the chrome step 1 added for it. The app's
    whole edit is `queueWebModule({ wsUrl: process.env.NEXT_PUBLIC_WS_URL })`.
  - **The phases:**
    - **prompt** — the code. It renders identically for a workspace that exists
      and one that does not, and every refusal shows the one message.
    - **start** — a pass is held, and one tap unlocks the chime and speech and
      takes a Screen Wake Lock.
    - **board** — live.
    - **back to prompt** on `stopped`, or when the handshake refuses the pass
      with 4403.
  - **The board:**
    - the workspace name and a clock;
    - Now serving, one large row per window, in a STABLE order by window name,
      with the newest call pulsing for ten seconds;
    - the recent calls;
    - a line filter kept on this screen;
    - a "Sound is off — press to turn it on" control whenever audio is still
      locked.
  - **The call:** `QUEUE_CALL_CHIME`, a falling ding-dong at a louder peak than
    chat's desk tone, then "Now serving C, zero four two, at Window 3." spoken
    after the chime rather than over it.
  - **`module-kit`'s `createRealtimeConnection` gained three options** and stays
    the one constructor: `connectionParams` (a display pass instead of a
    ticket), `onConnected`/`onClosed(code)`, and `retryForever` with a capped,
    jittered `reconnectDelay` (tested).
  - **`DISPLAY_PASS_PARAM` moved into the framework-free domain,** so the
    browser never imports server code to learn how to spell it.

  **Decisions the plan did not contain:**
  - ⚠ **A refused reconnect IS a stop.** A TV asleep when queuing stopped never
    received `stopped`. When its next handshake is refused with 4403, it deletes
    its pass and returns to the prompt exactly as if it had. Without that, it
    would show the last number of a stopped queue forever.
  - ⚠ **The TV never gives up reconnecting.** `graphql-ws` stops after five
    attempts by default, and a TV that gave up at 3am shows yesterday's number
    all morning. Backoff is capped at 15s, with up to a second of jitter so a
    room of TVs does not reconnect in one stampede. After 15s disconnected the
    board dims under "Reconnecting… the numbers below may be out of date."
  - **Rows are ordered by window name, not by latest call.** A board reordering
    on every call makes people re-find their window; the pulse marks the newest
    call instead.
  - **The code in the fragment wins over a stored pass.** Scanning a new QR on a
    TV that already holds an old pass exchanges the new code. The fragment is
    removed from the address bar before anything renders.
  - **Speech reads each digit** ("C, zero four two"), because read naively
    "C-042" is "C minus forty-two". English only — §12.64 stays open for other
    languages and voices.
  - **Start display keeps `autoFocus`**, with a lint suppression that says why:
    a TV is driven by a remote with no pointer, and focus already on the one
    button is what makes OK start it.
  - **Storage failures are survivable.** Every `localStorage` call is guarded:
    without storage a TV simply asks for the code again after a reload.

  **Verified end to end,** with the API and the production-built web app
  running against the local database, a real organization and workspace
  (`kwtech-printing` / `kwtech-ilang-branch`), and a session inserted directly:
  1. The public page answered 200 with no session.
  2. A wrong code sent through the web app's GraphQL proxy was refused with
     `null`, and `failedCodeAttempts` went to 1.
  3. The right code, typed lower-case with a dash, returned a 43-character pass
     for "Kwtech Ilang Branch", stored only as its hash.
  4. A socket presenting that pass received `queueDisplay`'s board.
  5. After the session was stopped, the same pass was refused with 4403.

  Tests: `module-kit` 91, the queue package 289 (board rules, chime, descriptor
  and more), and the web app typechecks and builds.

  ⚠ **Not verified in a browser on a TV:** the chime, speech, the wake lock
  and the visuals. Nothing here runs a browser. They are the next thing to
  check by hand, on the TV that will actually hang in the room.

  **New open decision, §12.69:** every browser's request reaches the API
  through the Next server, and the API does not trust `X-Forwarded-For`, so the
  tight credential bucket is shared by everyone behind that server.

- **2026-09-13** — **`module-queuing-window` step 7: the tone engine moved from
  `module-chat` to `@kwtech/web-ui`; chat's catalogue stayed.** The queue board
  needs a chime and may not import chat (§9), so the second consumer moves the
  code (§9 rule 8). No behaviour changed for chat.

  **What moved, and what did not:**
  - ⚠ **The ENGINE moved; the CATALOGUE did not.** How notes become sound —
    the one lazy `AudioContext`, the unlock, the fades, the exponential sweep,
    struck-note decay to true silence — is now `playTone`, `unlockTones` and
    `toneState` in `packages/web-ui/src/tones.ts`. Which ten sounds a message
    can make is chat's product decision, so `CHAT_TONES` stays in
    `module-chat/src/react/chat-tone.ts`. The queue board will define its own
    chime in step 8.
  - **It sits at `web-ui`'s framework-free ROOT, not `/react`.** It needs no
    React and no dependency, and touches `window` only when a sound is asked
    for, so the root's zero-runtime-dependency rule still holds.
  - **Chat's public surface is unchanged.** `playChatTone`, `unlockChatTones`,
    `CHAT_TONES`, `ChatToneId`, `DEFAULT_CHAT_TONE` and `isChatToneId` are all
    still exported. They are now a catalogue plus two one-line wrappers.
    `ChatTone` and `ChatToneNote` became deprecated aliases of `Tone` and
    `ToneNote`.

  **Two additions the board needs, both beside the engine:**
  - **`playTone(tone, { peak })`.** Chat's desk-level 0.14 stays the default. A
    waiting room is louder than a desk, and a TV may ask for more, capped at
    `MAX_TONE_PEAK` (0.5) because overlapping notes past that clip into
    distortion rather than sounding louder.
  - **`toneState()` ('unavailable' | 'locked' | 'ready') and an `unlockTones()`
    that resolves to whether it worked.** A TV is a screen nobody touches after
    it is set up. It must know that audio is still locked and ask for the one
    tap, instead of chiming into silence all day — the "looks like it works"
    failure the board plan names.

  **Tests moved with the code.** `web-ui` gains Jest, its first code whose
  behaviour a script cannot check, and its `test` script runs the contrast check
  first, then Jest.
  - `test/tones.test.ts` has 12 tests over a faked audio graph: one oscillator
    per note and every one stopped, the sweep only when asked, waveforms,
    decay ending at a hard zero, fades on flat notes, peak scaling and its
    ceiling, a suspended context building nothing, never throwing on a zero
    ramp target, silence on a server, and the unlock resolving true or false.
  - Chat's `tone-playback.test.ts` shrank to chat's half: every catalogue tone
    reaches the engine with all its notes, an unknown id falls back rather than
    going silent, and the unlock still unlocks.
  - Chat's catalogue tests (`tone.test.ts`: short, positive frequencies, no
    brand names) are unchanged.

  **Verified:** `web-ui` builds and passes its contrast check and 12 tests.
  Chat typechecks and passes 364 tests (five engine tests moved out). The web
  app typechecks and compiles in `next build`.

- **2026-09-13** — **`module-queuing-window` step 6: the staff console and the
  queue settings, on the web.** Staff can now start and stop queuing, call
  numbers, assign windows and manage lines from the app. The public board page
  is step 8.

  **What was built — all in the package, `@kwtech/module-queuing-window/react`:**
  - **`queueWebModule()`**, with two routes, both gated on `queue:read`:
    - `/organizations/:organizationId/workspaces/:workspaceId/queue` — the
      console, listed in the Workspace drawer group between Overview and
      Settings;
    - `…/queue/settings` — unlisted, reached from the console.

    The app's edit is one line in `modules.ts` plus the dependency.
  - **The console**, ordered by how often each part is touched:
    - Start and Stop. Continue numbering is off by default, and Stop asks for
      confirmation.
    - The code panel for holders of `queue:start`: the code, a QR code, Copy
      link, Open display, "N of M displays connected", and the too-many-wrong-
      codes message.
    - My window: Call next as the largest thing on the page, Recall, No-show,
      Done, and Call number…. A person with no window who holds
      `queue:assign_windows` gets "Take this window".
    - My nickname.
    - Every window, who is assigned to it, and what it is serving, with a seat
      whose holder can no longer serve flagged. Then the recent calls.
  - **Settings:** each section is shown only to the key that may change it.
    - Lines (`queue:manage_windows`): edit, archive, set the next number while
      running, and add.
    - Windows (`queue:manage_windows`): rename, choose the lines served,
      archive, and add.
    - Assignments (`queue:assign_windows`): assign, with a confirmation before
      replacing, free a window, and see a seat's nickname and clear it with
      `queue:manage_windows`.
    - Public displays (`queue:start`): show staff nicknames.
  - **`QUEUE_OPERATIONS`** at the package root. `web-server`'s
    `module-operations.test.ts` validates every document against the schema,
    including the two public ones step 8 will send.
  - **`useQueueConsole`** reads once, subscribes to `queueEvents`, and answers
    EVERY event with a debounced re-read, `sync` included. The screen never
    applies a call to its own copy of the queue: what a call completed by
    implication is the server's arithmetic, and a second implementation of it is
    a console that disagrees with the TV.

  **Server additions this step needed:**
  - `queueConsole.myUserId`, so "Take this window" can name the viewer.
  - `QueueSeat.nickname`, shown to staff only.
  - `queueDisplayCode.displayPath`, from a new optional `keysFor` on the
    locator port, which turns ids into keys. The app adapter scopes that read by
    both ids.

  **Decisions the plan did not contain:**
  - ⚠ **Space calls next ONLY when the line is unambiguous:** the line of the
    ticket the window is serving, or the only line the window serves. With two
    lines and nothing current it does nothing, because guessing between lines
    calls the wrong customer. It stands aside when focus is in a field, a
    select, a button or a link, and it ignores key repeat.
  - ⚠ **One action at a time per console.** `run()` refuses while another
    action is in flight, because a keyboard shortcut does not respect a
    disabled button, and two Call nexts in one tick are two numbers. Every Call
    next sends a fresh `clientRequestId`.
  - **The QR is drawn from `qrcode`'s matrix as one SVG path,** never from its
    SVG string injected as markup, and never by a QR web service. It is always
    dark on white regardless of theme, because scanners read contrast.
    `qrcode` is the module's own dependency (§9 rule 8).
  - **The display link uses the browser's own origin,** and the code goes in
    the fragment, undashed.
  - **The connected-display count is re-read every 15 seconds** while running,
    for holders of `queue:start` only. A TV opening publishes nothing, and
    publishing on every handshake would be a second event stream for a number
    nobody watches closely.
  - **The Workspace group name is a documented duplicate.** `'Workspace'` is
    `module-permissions`' string, which this module may not import, and a test
    pins the spelling.
  - **No `web-ui` Button.** It has none; the queue's `buttonClass` is local, with
    one consumer.

  **Verified:**
  - Package: 272 tests, including the view rules (Space's line,
    `sessionAge`, the fragment link, typing targets) and the descriptor.
  - App: `web-server` passes 160 tests with the regenerated schema, and
    `web-app` passes typecheck and a production `next build`.

  ⚠ **Not verified in a browser.** No signed-in session with the queue keys
  exists locally, and the local plans still lack them — see step 4. Trying the
  console needs an operator to add the six keys and two caps on `/admin/plans`,
  and a workspace role carrying them.

- **2026-09-13** — **`module-queuing-window` step 5: live. The staff console
  has a stream, and a TV admitted by its pass watches the board over
  `graphql-ws`.** Proven over a real socket against the local database.

  **What was built:**
  - **Events.** `QUEUE_EVENT` has three triggers: `queue.call`, `queue.session`
    and `queue.workspace`. `QueueEventPublisher` publishes each one AFTER the
    transaction commits, and a failed publish never fails the write. Every
    write in `QueueWriteService` announces itself.
    - ⚠ **A replayed `clientRequestId` announces nothing** — one call, one
      chime.
    - ⚠ **Payload dates are ISO strings.** With Redis behind the engine a
      payload is JSON, and a `Date` would arrive as a string.
  - **`Subscription.queueEvents(organizationId, workspaceId)`** for the
    console. It is bound as `graphql_subscription` to `queue:read`, and the
    resolver class's workspace scope applies to it. It sends `sync` first on
    every (re)subscribe, because the engine has no replay, then this
    workspace's events.
    - Filtered by workspace alone, as planned: a call event carries only what
      the public board shows.
  - **`Subscription.queueDisplay`** for TVs, on the public resolver. It takes
    no arguments: the workspace and session come from the pass the socket
    presented at the handshake. With no display admission it refuses before
    streaming.
  - **`QueueDisplayService.admit`**, the handshake hook, is wired in `AppModule`
    as step 2's `admitAnonymous`. The queue module is hoisted beside chat's,
    because `GraphQLModule.forRootAsync` must import the same dynamic module to
    resolve the service.
    - It takes `{ displayPass }`, refuses anything not shaped like a pass
      before querying, looks the pass up by hash, requires its session to be
      open, and records `lastSeenAt`.
    - The admission carries `kind: 'queue-display'`, and `readDisplayAdmission`
      checks it, so another module's admission is never read as a display's.
  - **`withCatchUp` moved from `module-chat` into `module-kit`** — §9 rule 8, now
    that it has a second consumer. Chat's `chat.catch-up.ts` re-exports it, so
    nothing in chat changed, and all 369 chat tests pass.

  **Decisions the plan did not contain:**
  - ⚠ **The board is SENT WHOLE, every time — snapshots, not deltas.** A TV
    receives the entire board rebuilt from the database, plus `announce` (the
    one call to chime for) when there is one.
    - A TV applying deltas needs every delta in order, and a board that missed
      one stays wrong until a reload — the "looks current and is not" failure
      this screen exists to prevent.
    - The cost is a few queries per display per call, bounded by
      `MAX_DISPLAYS_CEILING`.
  - ⚠ **The per-publish re-check is a primary-key read inside the snapshot, not
    a cache.** The plan said "cached, and invalidated by the stop event". Every
    redraw already reads the database, so the session check costs one lookup,
    and there is no cache to go stale. A session found stopped ends the stream
    with `stopped`, whether or not the stop event was seen — a test deletes the
    event and still gets `stopped`.
  - **What redraws a TV:** a call or a recall, a change of lines or windows, the
    show-nicknames setting, and a nickname. Done, No-show and seat changes do
    not: the board shows each window's latest CALL, and a customer being served
    is not news in a waiting room.
  - **The nickname on the board belongs to whoever CALLED the number** — "C-042
    → Window 3 · Ate Joy". It is read live on every snapshot, so clearing it, or
    turning names off, takes it off every TV at once, recent calls included.
  - **The staff subscription stays filtered by workspace alone.**
    `QueueTicketPayload` carries `calledById` for the board's nickname lookup.
    That is an account id, already visible on the console, and never a name.
    ⚠ The day a payload carries a customer's name or a phone number, chat's
    per-publish audience applies.

  **Verified live** against the local database: a session and a pass inserted
  directly, with the server built and booted.
  - A socket presenting the pass received `queueDisplay`'s first event: the
    board, with its line.
  - A guessed pass was closed 4403.
  - The same pass-admitted socket asking for `queueEvents` got `Not signed in`.
  - The pass's `lastSeenAt` was recorded.
  - After the session was stopped, the same pass was closed 4403.

  **Tests:** the package has 247, including a realtime suite over an in-memory
  engine that fans out with no replay. It covers:
  - what is announced, and when not;
  - admission and its refusals;
  - the opening board, and a call arriving as a fresh board plus `announce`;
  - no redraw for Done;
  - nicknames appearing and leaving with the setting;
  - `stopped` on stop, and again on the re-check;
  - another workspace ignored;
  - the console's `sync`-first stream.

  The app's 132 tests pass, and `schema.graphql` was regenerated by booting.

  **Not yet:** the web console and settings (step 6), the tone synthesiser move
  (step 7), and the board page itself (step 8). The client side of the
  handshake — a second socket opened with `{ displayPass }` — lands with step 8.

- **2026-09-13** — **`module-queuing-window` step 4: the server half, adopted by
  `web-server`, with the tables migrated.** Calling, windows, lines, seats,
  sessions and the display code exchange all work over GraphQL. There is no
  realtime yet; that is step 5.

  **What was built:**
  - **The package's `/server` subpath:**
    - `QueueService` handles reads.
    - `QueueWriteService` handles every write, each inside its own transaction.
    - `QueueDisplayService` exchanges a code for a pass.
    - A structural `QueueTransaction`, so the package has no `@prisma/client`.
    - `QueueResolver` covers the workspace surface; the public
      `QueueDisplayResolver` is separate.
    - `QueueModule` and `queueServerModule()`.
  - **The app:** one descriptor in `SERVER_MODULES`, a line in
    `seed/registry.ts`, and the Prisma providers plus `satisfies-modules`
    assertions. Three adapters sit in `src/queue/`:
    - `QueueStaffAccess` — `loadContext` plus `canAccessWorkspace` plus
      `effective` includes `queue:serve`, so the PLAN filter applies and a
      free-plan member cannot be seated;
    - `QueueStaffDirectoryAdapter`;
    - `QueueWorkspaceLocatorAdapter` — organization and workspace keys to ids,
      and null for anything archived.
  - **Migration `20260913132056_queuing_window`:** ten tables, one enum, and
    nothing that touches another module's tables. `schema.graphql` was
    regenerated by booting (+108 lines).
  - **Plans:** a `QUEUE` group of all six keys, plus `QUEUE_CAPS` (windows 10,
    displays 5), in Starter and Pro. Enterprise's features are derived, so it
    only needed the caps. ⚠ `createPlanIfAbsent` rewrites nothing, and the
    local database's plans predate this. Until an operator adds the keys on
    `/admin/plans`, every queue surface there answers `not_entitled`.

  **Two structural decisions:**
  - ⚠ **The workspace scope is declared on the resolver CLASS**, with
    `REQUIRED_SCOPE_METADATA`. `FeatureGuard` reads the handler, then the class,
    so an operation added later cannot forget it. The code exchange lives in a
    SEPARATE class, so no public marker can ever sit beside a scope.
    `test/surface-coverage.test.ts` fails if:
    - the class loses its scope;
    - anything on the workspace class is public;
    - anything on the public class is not public, not a credential surface, or
      has a scope or a binding;
    - an operation is neither bound nor listed as unbound;
    - a binding names an operation that does not exist.
  - ⚠ **A third shared key, `CREDENTIAL_SURFACE_METADATA`, in `module-kit`.**
    `openQueueDisplay` is somebody guessing a secret, and the module may not
    depend on `@nestjs/throttler`. So it marks the handler, and
    `CredentialThrottlerGuard` puts any marked handler on the tight
    `credential` bucket — the same bucket sign-in uses — beside `module-auth`'s
    `CREDENTIAL_ENDPOINTS`. **Verified live:** a burst of exchanges was refused
    `ThrottlerException: Too Many Requests` well inside the 120/min default
    bucket.

  **Decisions the plan did not contain:**
  - ⚠ **An unbound operation skips the workspace-membership check.**
    `FeatureGuard` returns before resolving any scope when no key is required.
    That is fine for the two operations left unbound: `releaseMyQueueSeat` and
    `clearMyQueueNickname` only DELETE the caller's own row. But
    `setMyQueueNickname` WRITES a row into whatever workspace the request
    names, so it is bound to `queue:read`, even though the plan said "no key".
    The key is what makes "a member of this workspace" true before the write.
  - ⚠ **Calling a new number completes the ticket the window was serving.** A
    window serves one customer at a time. Without this, a ticket nobody marked
    Done stays `called` for the whole session, and Call number… for that number
    from any other window is refused as "being served" forever. Done remains
    for "finished, and nobody next".
  - **The allocator's retry is OUTSIDE the transaction.** A unique violation
    aborts a Postgres transaction, so every statement after it would fail.
    - Call next reads the sequence, computes `nextToCall`, and moves the
      sequence with a compare-and-set `updateMany`. Zero rows means somebody
      else called first, and the transaction rolls back and runs again, up to
      5 times before answering `conflict`.
    - It reads only the numbers it might skip: those ahead in this cycle, and
      the next cycle. Reading the whole cycle would be up to 999 rows per press.
  - **Stop deletes every display pass** as well as clearing the code, so a
    stopped session holds no credential of any kind. Seats are untouched.
  - **Archiving a window frees its seat,** because a seat at an out-of-service
    window keeps its holder from being assigned elsewhere. Unarchiving counts
    against `queue:windows` again.
  - **A line's prefix is not editable.** It is on every slip in people's hands
    and every ticket's label; changing it means a new line. Immutable after
    creation, following the repo's pattern.
  - **`maxDisplays` is capped at `MAX_DISPLAYS_CEILING` (50)** whatever the plan
    says, "unlimited" included, with a floor of 1. A code on a public wall
    should not buy an unbounded number of held sockets.
  - **`openQueueDisplay` returns null for every refusal.** The wrong-code count
    is committed inside the transaction even though the answer is a refusal.
    Input longer than 32 characters is treated as a wrong code without being
    read.
    - ⚠ **Timing is not equalised:** an unknown organization answers after one
      lookup, a real one after a transaction. This is accepted and written
      down. The exchange is rate-limited per IP, which makes a timing probe
      slower than reading company names off the web.
  - **The pass is 32 random bytes as base64url;** only its SHA-256 hex is
    stored, and the raw value is returned once.
  - **The staff directory costs one permission context per workspace member,**
    capped at 200. It runs only when an assigner opens the picker.
  - **Role presets are exported, not seeded,** as chat's are: adopting the queue
    grants nobody anything.

  **Tests:**
  - **Package:** 222 in total; the server half adds 99 against an in-memory
    client. That client raises `P2002` where the schema would and ROLLS BACK a
    failed transaction, because the retry depends on it. They cover:
    - a lost compare-and-set retried to exactly one ticket;
    - skip-already-called;
    - idempotent `clientRequestId`;
    - Continue numbering;
    - replacing and moving seats;
    - an unknown organization, an unknown workspace and a stopped queue all
      answering identically, with nothing counted;
    - only the pass's hash being stored.
  - **App:** all 132 still pass.

  **Not yet:** pub/sub and `queueEvents`, the public display subscription, and
  `QueueDisplayService.admit` for the step-2 handshake hook (step 5). Then the
  console and settings (step 6).

  **Seen while smoke-testing, and not new:** a throttled GraphQL operation
  reports `INTERNAL_SERVER_ERROR` in its extensions, with the throttler's
  message. That is true of every GraphQL operation on the tight bucket, not
  just this one. A client that wants to say "slow down" needs a proper code.

- **2026-09-13** — **`module-queuing-window` step 3: the schema and the rules,
  with no database in sight.** A new package, `packages/module-queuing-window`,
  that depends on `@kwtech/module-kit` and nothing else. It has no Prisma
  client, no Nest and no React, and its `lib` has no DOM. 123 tests, none of
  them touching a database.

  ⚠ **No app has adopted the package yet.** `compose-schema.mjs` copies a
  fragment for every `@kwtech/module-*` dependency of `apps/web-server`, so
  adding the dependency is what creates the tables. That belongs with the
  migration and the server in step 4, as it did for chat. `prisma/queue.prisma`
  was checked with `prisma validate` and `prisma format` against the app's own
  generator and datasource header.

  **What is in it:**
  - **`prisma/queue.prisma`** — ten models, one enum:
    - `QueueSettings`, `QueueLine`, `QueueWindow`, `QueueWindowLine`,
      `QueueSeat`, `QueueSession`, `QueueDisplayPass`, `QueueSequence`,
      `QueueTicket` and `QueueStaffNickname`;
    - the enum is `QueueTicketStatus` (`called | done | no_show`);
    - every row carries `workspaceId` and `organizationId`.
  - **`domain/numbering.ts`** — the skip-already-called allocator
    (`nextToCall`), wrapping, setting a line's next number, and Continue
    numbering.
  - **`domain/tickets.ts`** — the state machine, plus what Call number… does
    with a number that is already called.
  - **`domain/seats.ts`** — assignment, replacing, moving, and releasing.
  - **`domain/session.ts`** — the session gate, the display code, the code
    exchange, and the shape of a pass.
  - **`domain/lines.ts`, `domain/windows.ts`, `domain/nicknames.ts`** — the
    text that reaches a public screen.
  - **`feature-keys.ts`** — the six keys, two caps and three presets.

  **Decisions the plan did not contain:**
  - ⚠ **The ticket's formatted number is `label`, not `displayCode`.** The
    original plan named it `displayCode` before the display-code entry gave
    that name to the session's code. Two columns called `displayCode` meaning a
    customer's number and a TV credential is a bug waiting in a `select`.
  - **`firstCalledAt` beside `calledAt`.** A Recall or a re-call moves
    `calledAt`. §12.65's wait-time report needs the first call, and it would be
    unrecoverable once overwritten.
  - **`clientRequestId` is unique per SESSION, not globally.** A global unique
    lets one tenant's id collide with another's, and turns a retry into a
    cross-tenant lookup the server would then have to guard.
  - **A ticket's `windowId` has no foreign key.** Windows are archived, never
    deleted, and history must not hang on a row an operator might one day
    remove. The name is snapshotted anyway.
  - **A prefix is unique per workspace including archived lines.** A new `C`
    line beside an archived one is refused; unarchive instead, so two lines'
    history never shares a prefix.
  - ⚠ **Call number… on a number already called:**
    - a no-show is called again, from ANY window, on the same row;
    - a ticket still called at this window is a recall;
    - one called at ANOTHER window is refused, because one customer sent to
      two windows is the confusion a queue exists to prevent;
    - a done ticket is refused.

    Recall, Done and No-show belong to the window the ticket was called to.
  - **A line must span at least two numbers.** With one, every Call next wraps,
    and skip-already-called would call the same number once per cycle forever.
  - **Setting the next number keeps the cycle.** Setting it back onto numbers
    already called still skips them. Reusing them takes a wrap or a new
    session. Recorded in the code, because a supervisor will try it.
  - **Continue numbering restarts the cycle at 0.** Tickets are unique per
    session, so nothing can collide. A previous position outside the line's
    current range starts fresh rather than calling a number the line no longer
    has.
  - **Code input follows Crockford's own decoding:** O is read as 0, I and L
    as 1, and U is refused. Those are the misreadings the alphabet exists to
    absorb, and they are exactly what somebody reading a code off a console
    across a room will type.
  - ⚠ **The exchange checks "locked" BEFORE comparing,** so a locked session
    refuses the right code too and stops confirming which code is right. A
    right code on a full session (`display_cap`) is not counted as a failed
    attempt, because the person typing it was told the code.
  - **With `QueueStaffCheck` bound, the check applies to the actor too.** A
    supervisor without `queue:serve` who seats themselves gets a window that
    looks staffed and is not. Unbound, only self-assignment is allowed, per
    answer 2.
  - **Text on a public screen:**
    - control and invisible formatting characters are REFUSED, not stripped;
    - whitespace is collapsed first, so a pasted tab becomes a space;
    - length counts code points;
    - window names are capped at 32, line names at 40, nicknames at 24;
    - a window name is unique on its NFKC, case-folded form, so a full-width
      "Ｗｉｎｄｏｗ ３" is Window 3.

    ⚠ The cost: `\p{Cf}` includes the zero-width joiner inside some emoji
    sequences, so a family emoji is refused in a name.
  - **Prefixes are A–Z and 0–9, at most three, stored upper case.** They are
    read aloud, and a character with no spoken name, or a dash read as "minus",
    is a customer who never hears their number.
  - **`boardNickname(showStaffNames, nickname)` takes no account name at
    all,** so the "no nickname means no name" rule cannot be broken by a caller
    passing one in. A test asserts the arity.
  - **`queue:start` is the one `isPrivileged` key** — the disclosure act that
    `queue:publish_display` was.
  - **`queue:displays` defaults to 5**, per the display-code entry, which
    supersedes answer 3's 3. `queue:windows` defaults to 10. Both are
    plan-sourced and counted over the workspace.
  - **The feature bindings are deliberately empty**, as chat's were at this
    step. A binding naming an operation that does not exist is a worse lie than
    none; step 4 fills them in with the resolvers.

- **2026-09-13** — **`module-queuing-window` step 2: a socket can be admitted
  WITHOUT a session, and then reaches only what is public.** Still no queue
  code. Proven over a real socket with a stand-in public subscription, so the
  security property is tested on its own.

  **What was built:**
  - `graphqlOptions(tokens, lifecycle, admitAnonymous?)`. The hook is the
    third argument, so `graphql.options.ts` still names no module. `AppModule`
    does NOT pass one yet, because no module implements it. Until step 4 wires
    the queue module's admit, a socket without a ticket is refused exactly as
    before.
  - `openConnection` in `ws-context.ts` decides: a ticket, or the hook's
    admission, or a refusal. An admitted socket carries the admission under
    `ANONYMOUS_ADMISSION_KEY` and **no principal**. The key and its reader,
    `anonymousAdmission(request)`, live in `module-kit`, because the module
    that implements the hook may not import the app (§9) — the step 1
    argument again.
  - **No presence.** Every lifecycle hook goes through `connectionUserId`,
    which is undefined for an anonymous socket. The old code read
    `req[PRINCIPAL_KEY].userId` directly and would have thrown inside
    `onConnect` — a 4500, which the client retries forever.
  - **A 12-hour maximum lifetime** (`ANONYMOUS_SOCKET_MAX_LIFETIME_SECONDS`),
    closed with the same 4499 as an expired ticket, so the client reconnects
    and catches up. ⚠ It is a backstop. Stopping a session must still reach a
    TV through the per-publish re-check in step 5.

  **Why an anonymous socket is safe, and why nothing new enforces it:**
  `JwtAuthGuard` already runs on every socket operation and refuses "Not
  signed in" when there is no principal, unless the handler is public.
  `test/anonymous-socket.test.ts` boots GraphQL with the real options and
  guard, and asserts both halves:
  - an admitted socket gets the public subscription, and its resolver reads
    the admission;
  - the same socket gets exactly `Not signed in` from a non-public one.

  The same suite covers a refused credential closing as 4403, no presence
  event either way, and a ticketed socket still working beside the new branch.

  **Two rules in the branch, each preventing a specific failure:**
  - ⚠ **A presented ticket is never downgraded.** If `connectionParams` has a
    `ticket` key at all, only the ticket path runs. Otherwise a signed-in tab
    with an expired ticket would be admitted anonymously and refused on every
    operation, instead of getting the 4403 that sends it to mint a fresh
    ticket. The hook is also never handed a session credential.
  - ⚠ **The hook returns null for a bad credential and throws only for a
    fault.** Null closes 4403, which a client treats as final. A throw closes
    4500, which it retries. Swallowing a database error as null would make a TV
    give up on a pass that was valid.

  **Rejected: a synthetic principal for a display** (say, scope `'display'`).
  Every non-public surface would then have to decide whether a display counts
  as signed in, and `resolvePrincipal` — the seam between auth and permissions
  — would learn a new word. An admission that is visibly NOT a principal
  needs no such decision anywhere.

  **Not built: the §12.59 socket caps.** A socket that drops without a close
  frame is not noticed until TCP gives up. So a per-pass cap of 2 would lock
  out a TV whose Wi-Fi blinked twice, and it needs a server-side liveness
  timeout first. §12.59 stays open. *(Built later the same day — see the
  socket caps entry above. The timeout already existed: graphql-ws' keepAlive.)*

  **Two notes for whoever touches this next:**
  - The test overrides `autoSchemaFile: true`. The real options WRITE
    `schema.graphql`, and a probe resolver's schema would overwrite the
    checked-in contract.
  - `ws` is now a web-server devDependency, pinned to the 8.21.3 that
    `graphql-ws` already resolves, so the workspace still holds one copy.

- **2026-09-13** — **`module-queuing-window` step 1: the enforcement metadata
  KEYS moved into `module-kit`, and a route can be `chrome: 'fullscreen'`.** No
  queue code yet, and no behaviour change.

  **The keys.** `packages/module-kit/src/metadata.ts` now owns
  `PUBLIC_SURFACE_METADATA` (`'kwtech:auth-public'`), `REQUIRED_SCOPE_METADATA`
  (`'kwtech:required-scope'`), the `ScopeDeclaration` shape and a
  `declareScope(level, args?)` builder. `module-auth`'s `IS_PUBLIC` and
  `module-permissions`' `REQUIRED_SCOPE` are now aliases of those constants.
  `ScopeSpec` extends `ScopeDeclaration`, re-typed as `RoleLevel` (the same union). The guards,
  `@Public` and `@RequireScope` are unchanged, and so is every reader.
  - **Why:** §9 forbids a module importing a module, so `module-queuing-window`
    could neither mark its display surface public nor declare that its
    resolvers are workspace level. The second gap fails SILENTLY (§12.13): a
    resolver with no declared scope resolves at app level, and every
    workspace-level key grants nothing. It is the fix `FeatureContribution`
    already got: move the vocabulary into the package every module depends on.
  - **Rejected: shared DECORATORS in `module-kit`.** They would make
    `module-kit` import Nest, and it has no framework dependency today. A
    string constant and one shape are enough, because a module applies them
    with its own `SetMetadata`.
  - ⚠ **The VALUES are pinned by a test** (`module-kit/test/metadata.test.ts`).
    The mechanism is that a writer and a guard read one string. Renaming the
    value would orphan metadata written under the old one. The same test
    requires the two keys to differ: `JwtAuthGuard` treats any truthy value
    under its key as public, so a shared string would make every scoped
    handler anonymous.
  - **Each enforcer has a test that the direct `SetMetadata` form and its own
    decorator write the same key** (`module-auth/test/public-surface.test.ts`,
    `module-permissions/test/require-scope.test.ts`). The existing suites of
    both packages pass unmodified, as step 1 required.
  - The `module-kit` README gained "Declaring scope and public surfaces". It
    warns that a module below app level must declare a scope on every
    resolver, and that a public reason must be a non-empty string.

  **`chrome: 'fullscreen'`** joins `'app' | 'bare'` on `ModuleRoute`. The
  catch-all page returns such a page with no shell at all: no header, no theme
  control, no status bar. It is for the public board on a TV. Nobody can reach
  a control drawn over a TV picture with a remote, and the page must report its
  own connection state, because a stale board that looks current is the
  failure it exists to prevent. Nothing declares it yet; step 8 is its first
  user.

- **2026-09-13** — **`module-queuing-window`: window assignments and display
  settings PERSIST across queuing runs, and Start shows a QR code.** The
  operator reviewed the display-code entry below. The URL by organization and
  workspace key, calling only while a session is open, and per-session
  numbering are confirmed. Two of its choices are reversed, and one feature is
  added.

  **Seats persist (reverses "Stopping releases every seat").**
  - A window assignment stays until a holder of `queue:assign_windows` changes
    or frees it, or its holder releases it. Stop queuing leaves every seat as it
    is, so the next Start opens with the same people at the same windows.
  - The operator's reason: staffing is mostly the same from one day to the next,
    and reassigning every window every morning is work that buys nothing.
  - **The cost is §12.62 at full strength again:** a seat can outlive its
    holder's membership, or their `queue:serve`.
    - The guard still refuses that person's Call next, so the harm stays "a
      window that looks occupied".
    - The console marks any seat whose holder can no longer serve. This is
      checked through `QueueStaffCheck` when the console loads, not on every
      event.
  - **Someone off today still occupies their window.** The console shows every
    seat, and freeing one takes an assigner a single click. The board shows only
    windows that have called a number this session, so a staffed-but-idle window
    never appears on a TV.

  **Display settings persist (reverses "a SESSION choice").**
  - **Show staff nicknames is a WORKSPACE setting**,
    `QueueSettings.showStaffNames`. A holder of `queue:start` sets it once on the
    queue settings page — the same people who chose it at every Start, now
    choosing once. It stays off until somebody turns it on. The Start dialog no
    longer asks about it and only offers Continue numbering.
  - ⚠ **Changing it mid-session reaches every TV at once**, published as a
    `queue.settings` event. Someone who asks to be taken off the board must not
    have to wait until tomorrow.
  - **A TV's line filter survives sessions.** It lives in the TV's
    `localStorage` under the organization and workspace keys, separate from the
    pass. Stop deletes the pass but keeps the filter, so after the next code the
    Cashier TV still shows only `C`.
  - ⚠ **The filter's limitation, stated up front:** clearing the TV browser's
    data, or opening a different browser on the same screen, loses it. Storing
    it server-side would need a durable identity for a TV across sessions —
    exactly the long-lived credential the display-code design removed.

  **A QR code at Start.** When a session starts, the console's code panel shows
  a **QR code** beside the code, plus **Copy link** and **Open display**.
  Scanning it on a phone, or opening the link in the TV's browser, reaches the
  display without typing either the URL or the code.
  - **It encodes the full display URL, with the code in the fragment:**
    `https://<app>/queue-display/acme/main-branch#code=K7QM4XHT`.
  - ⚠ **The fragment, never the query string.**
    - A browser never sends the fragment to the server, so the code does not land
      in Next's or a proxy's request logs, and never travels in a `Referer`
      header.
    - The page reads the code on the client and exchanges it through the same
      throttled `openQueueDisplay`.
    - It then **removes the code from the address bar** with
      `history.replaceState`, so a photo of the TV's address bar shows the URL
      and not the code.
  - **It lives exactly as long as the code.** A QR scanned after Stop opens the
    code prompt with the same single failure message as a wrong code. Printing it
    is pointless, and the panel says so: the next session has a different code.
  - ⚠ **Generated in the browser, never by a QR web service.**
    - A hosted QR API receives the URL it draws, which here contains a live
      code.
    - One small MIT library, `qrcode`, draws it to SVG in the module's react
      layer, with no network request.
    - It is the module's own dependency, not `web-ui`'s, because it has one
      consumer (§9 rule 8).
  - **Same visibility as the code:** holders of `queue:start` only.
  - ⚠ **Every device that opens the display takes a display pass.** A scanned
    phone counts toward the session's `maxDisplays` (default 5) exactly as a TV
    does, so a supervisor checking the board from their phone uses one of the
    five. The console's "3 displays connected" count is where that shows up.
  - **The link uses the browser's own origin**, not a server setting, so the QR
    points at whichever address the staff member is using. That is correct for
    the one web app this repo has. ⚠ If the console is ever served from an
    internal hostname the TVs cannot reach, the QR will be wrong, and the fix is
    `FRONTEND_URL`.

  **Keys, adjusted:**
  - `queue:start` — Start queuing (generates the code and QR, offers Continue
    numbering), sees the code and QR while the session runs, and sets whether
    TVs show nicknames.
  - `queue:stop` — Stop queuing, which takes every display dark. It no longer
    releases seats.

  **Schema:** `showStaffNames` moves from `QueueSession` to `QueueSettings`.
  `QueueSeat` is unchanged, and Stop never touches it.

  **Build order:**
  - **Step 3** drops "Stop releases seats".
  - **Step 6:** the code panel gains the QR, Copy link and Open display, and
    settings gains the nickname switch.
  - **Step 8:** the board reads a `#code=` fragment, strips it from the address
    bar, and keeps the line filter separate from the pass.

- **2026-09-13** — **`module-queuing-window`: a TV is admitted by a CODE THAT
  LIVES AND DIES WITH A QUEUING SESSION.** The operator's design, replacing the
  durable display links in both entries below. ⚠ Read this one first; the
  entries below are marked wherever it overrides them.

  **The operator's flow:**
  1. Someone whose workspace role carries `queue:start` presses **Start
     queuing**, and the system generates a random **display code**.
  2. A TV opens the public URL for the organization and workspace. On its own,
     that page shows nothing but a prompt for the code, and somebody types it
     in.
  3. From then on, the TV shows the workspace's queue, live.
  4. It stays that way until somebody holding `queue:stop` presses **Stop
     queuing**. Every TV then goes dark.
  5. The next Start generates a NEW code, so every TV has to be given the new
     code.

  **Why this beats the link it replaces** — written down so nobody undoes it
  out of nostalgia for the convenience. A durable display link was a credential
  shown on a screen in a public room, valid until somebody remembered to rotate
  it; a photo of the TV's address bar was access for months. Now the URL admits
  nothing on its own, a code works only until the session stops, and the daily
  routine of starting and stopping the queue is what rotates it. Rotation is no
  longer a chore nobody does.

  **New vocabulary:**

  | Term | Means |
  |---|---|
  | **session** | one run of the queue in a workspace, from Start queuing to Stop queuing |
  | **display code** | the short random value a person types into a TV — one per session |
  | **display pass** | what a TV holds once its code is accepted; its credential for the rest of the session |

  **The session is a row, and a workspace has at most ONE open.** `QueueSession`
  carries `startedAt`, `startedById`, `stoppedAt` and `stoppedById`.
  - ⚠ "At most one open" is naturally a partial unique index —
    `UNIQUE (workspaceId) WHERE stoppedAt IS NULL` — which Prisma cannot express
    (§12.19).
  - It needs no raw SQL, for the same reason chat's `directKey` needed none. An
    `openWorkspaceId String? @unique` column holds the workspace id while the
    session is open and is set to null when it stops. Postgres treats NULLs as
    distinct, so any number of stopped sessions can coexist, while a second open
    session is a constraint error.
  - Two supervisors pressing Start at the same moment get one session, not two
    codes.

  **The session gates the queue, not just the TV.** With no open session, Call
  next, Recall and Call number… are refused with "Queuing has not started", and
  the console says so above the button. Starting is the first act of the day,
  and stopping is the last.

  ⚠ **REVERSED: seats persist across sessions — see the persistence entry above.** **Stopping releases every seat.** This replaces "the end of the service day
  releases every seat", which depended on a service day that no longer exists.
  Tomorrow's staffing is assigned tomorrow. §12.62 narrows again: a removed
  member's seat lasts at most until the next Stop.

  **Numbering belongs to the SESSION; the service day and the workspace time
  zone are gone.**
  - `QueueSequence` is keyed `(lineId, sessionId)`, and a ticket is unique on
    `(lineId, sessionId, cycle, number)`. Every session starts each line at its
    `startNumber`.
  - That deletes `QueueSettings.timeZone`, the lazy date computation and the
    midnight edge case. The board's clock is simply the TV's own.
  - ⚠ **The cost is a mistaken restart.** A supervisor who stops and restarts at
    11am — to get a new code, say — would send the numbering back to 1 while
    the guard's slips are at 87. So the Start dialog offers **Continue numbering
    from the last session**, off by default. "Set a line's next number" (answer
    1 in the entry below) remains the repair.
  - ⚠ A session nobody stops runs overnight, and the next day's numbers carry
    on from yesterday's — §12.68.

  **The code: short enough to type with a TV remote, long enough not to be
  guessed.**
  - **Format:** eight characters of Crockford base32 — digits and letters minus
    I, L, O and U, the ones people misread — shown as `K7QM-4XHT`. Input is
    case-insensitive and the dash is ignored. That gives 32⁸ ≈ 2⁴⁰ possible
    codes.
  - ⚠ **Guessing happens over HTTP, never at the socket.**
    - The TV exchanges the code through a `@Public` mutation,
      `openQueueDisplay(organizationKey, workspaceKey, code)`, which passes
      `ThrottlerGuard`. The app points the TIGHT `credential` bucket at it — the
      one sign-in uses — because this too is somebody guessing a secret.
    - `ThrottlerGuard` skips WebSocket operations, so a code accepted at the
      handshake would be a guessing surface with no limit at all.
    - On top of the per-IP bucket, each session counts failed attempts and
      **stops accepting its code after 20 failures**. The console then says "Too
      many wrong codes — stop and restart to get a new one".
    - Why both limits: per-IP alone is defeated by a botnet, and a per-session
      count alone lets somebody lock the TVs out by guessing wrong on purpose.
      The console message makes that attack visible instead of mysterious.
  - **Stored in plain while the session is open, and CLEARED when it stops.**
    Staff must be able to read the code off the console again at 2pm for a TV
    that got unplugged, so it cannot be hashed. That is acceptable because a
    stopped session holds no live secret at all.
  - **Shown on the console to holders of `queue:start`.** The people who can
    authorise a display are the people who can see what authorises it.

  **The pass: why a TV does not simply keep the code.** A successful exchange
  returns a random 256-bit **display pass**, stored SHA-256-hashed in
  `QueueDisplayPass(sessionId, tokenHash, createdAt, lastSeenAt)`. The TV keeps
  it in `localStorage`.
  - **The socket handshake presents the pass, never the code.** A 256-bit value
    cannot be guessed, so the handshake needs no attempt limiter, which is what
    lets it stay unthrottled.
  - **A power cut or a reload needs nobody with a remote.** The TV reconnects
    with its pass for as long as the session is open.
  - ⚠ **The pass is hashed, the code is not.** A pass is a bearer credential
    sitting on a device in a public room, so it follows the invitation-token
    rule. Nobody ever needs to read a pass back, whereas staff do need to re-read
    the code.
  - **Each pass is one TV**, so the console can show "3 displays connected" —
    which is how somebody notices a fourth screen they never set up.
  - **Capped per session** by `queue:displays` (default 5). ⚠ The cap is resolved
    at START, from the starter's limits, and stored on the session as
    `maxDisplays`. The exchange has no actor, and `LimitChecker` reads the
    actor's limits. §12.35 hit exactly that on invitation accept; asking at Start
    means there is still somebody to ask about.

  **The URL names the organization and workspace by KEY:**
  `/queue-display/:organizationKey/:workspaceKey` — `acme/main-branch` rather
  than two cuids, because it gets typed on a TV remote.
  `PermOrganization.key` and `PermWorkspace.key` already exist and are unique.
  ⚠ Both belong to `module-permissions`, so resolving them needs a new port,
  `QueueWorkspaceLocator` (keys → ids plus the workspace name), filled app-side.
  Unbound means no display can open. ⚠ If either key ever becomes renamable,
  every TV URL for that tenant breaks.

  ⚠ **The public page must not become a tenant directory.** Organization keys
  are human-readable company names. A page that answered "no such organization"
  differently from "wrong code" would let anybody enumerate customers by
  guessing names. So every failure — unknown organization, unknown workspace, no
  session running, wrong code, too many attempts, display cap reached — returns
  ONE message ("That code is not valid here right now") with the same status.
  The code prompt renders identically for a workspace that exists and one that
  does not, and the workspace NAME appears only after a pass is issued. The
  console gets the specific reason; the TV never does.

  **When the session stops, each TV is told, not abandoned.**
  - Stop publishes a `queue.session` event. Every display stream receives a final
    `stopped` event and then ends. The TV shows "Queuing has stopped", deletes
    its pass and returns to the code prompt.
  - The per-publish re-check becomes "is this pass's session still open?" —
    cached, and invalidated by that same event. The handshake refuses any pass
    from a stopped session.
  - ⚠ A TV that missed the event — asleep, or off the network — finds out at its
    next reconnect, when the handshake refuses its pass. So the board's
    stale-dimming must also trigger on a refused reconnect. Otherwise a TV could
    show the last number of a stopped queue forever.

  ⚠ **REVERSED: a persistent workspace setting — see the persistence entry above.** **Staff nicknames on displays are now a SESSION choice**, because display rows
  no longer exist. The Start dialog carries "Show staff nicknames on displays",
  remembering the last session's choice, so whoever starts the queue decides
  what that session publishes. The nickname rules in answer 4 below are
  unchanged.

  ⚠ **Amended: the filter now persists across sessions — see the persistence entry above.** **The line filter moves onto the TV.** "The Cashier TV shows only `C`" is
  chosen on the TV after its code is accepted, and remembered in its
  `localStorage`. ⚠ This is a presentation filter, not a security boundary: the
  pass admits the whole workspace's board, and the TV merely hides lines.
  Nothing on the board is private (nicknames are opted into), so the difference
  does not matter today. If it ever does, the filter moves onto the pass.

  **What goes away:** `QueueDisplay` and its durable key,
  `queue:publish_display`, the rotate/revoke screen, per-display
  `showStaffNames`, the per-key connection cap, `QueueSettings.timeZone`, the
  service day, and the daily reset.

  **Keys — six, replacing the table in the entry below:**

  | Key | Admits |
  |---|---|
  | `queue:read` | the console, the live board inside the app, `queueEvents` |
  | `queue:serve` | work the window you are assigned: Call next, Recall, Done, No-show, Call number… — only while a session is open |
  | `queue:assign_windows` | assign a window to a member (yourself included), move someone, free a window |
  | `queue:manage_windows` | create, rename and archive windows; manage lines and set a line's next number; clear a nickname |
  | `queue:start` | Start queuing: generate the display code and QR, continue numbering; see the code and QR while the session runs; set whether TVs show nicknames (a persistent setting) |
  | `queue:stop` | Stop queuing: take every display dark (seats are kept) |

  Start and stop are separate keys because they are different risks. Starting
  publishes the queue to TVs; stopping takes every screen dark and every window
  out of service mid-shift. A role may carry both.
  - **Presets:** `queue-staff` (read + serve); `queue-supervisor` (read + serve +
    assign_windows + start + stop); `queue-admin` (all six).
  - **Plans:** all six go into `starter`, `pro` and `enterprise`. Answer 3 is
    unchanged; only the count is now six.

  **Schema changes against the plan below:**
  - **Add `QueueSession`:** `openWorkspaceId @unique`, a nullable `displayCode`,
    `failedCodeAttempts`, `maxDisplays`, and who started and
    stopped it, and when.
  - **Add `QueueDisplayPass`.**
  - **`QueueSequence`** is now keyed `(lineId, sessionId)`.
  - **`QueueTicket`** gains `sessionId` and loses `serviceDate`.
  - **Drop `QueueDisplay` and `QueueSettings.timeZone`.** `QueueSettings` keeps
    `enabled` and gains `showStaffNames` (persistence entry above).

  **Routes:** unchanged, except that the public route is now
  `/queue-display/:organizationKey/:workspaceKey` (fullscreen, no feature).
  Start and Stop live on the console, not in settings, because they are daily
  acts.

  **Build order changes:**
  - **Step 2:** the dummy public subscription is admitted by a pass-shaped token
    instead of a display key.
  - **Step 3** adds the session rules — one open per workspace, the session
    gates calling — plus code generation and
    normalisation.
  - **Step 4** adds:
    - `startQueue` / `stopQueue`;
    - `openQueueDisplay`, with the attempt counter and the single failure
      message;
    - the `QueueWorkspaceLocator` port and its app adapter;
    - the `credential` bucket binding.
  - **Step 5:** the per-publish re-check is "is the session still open".
  - **Step 6:** the console gains Start and Stop, plus a code panel with the
    count of connected displays and the QR (persistence entry above). Settings loses its displays
    section.
  - **Step 8:** the board gains the code prompt, pass storage and the "stopped"
    screen.

- **2026-09-13** — **`module-queuing-window`: the operator's four answers, and
  what each one changes.** Given the same day as the plan below, before any
  code. ⚠ Parts of that entry are superseded and marked in place; read this
  one first.

  **1. NUMBERS ARE ISSUED OUTSIDE THE SYSTEM, by a person (§12.58 closed).** A
  staff member or a guard at the entrance hands each arriving client a number —
  a paper slip, a card, a roll. The system never sees that hand-over.
  ⚠ **Corrected the same day.** This answer was first read as issuing INSIDE the
  app — an Issue page, a `queue:issue` key, tickets created `waiting` — and the
  operator corrected it. That reading is withdrawn in full, and the original
  plan's allocation stands. What this confirms, and what it adds:
  - **Call next allocates the next number AT THE CALL** and creates the ticket
    already `called`. The conditional `increment` on `QueueSequence`, the unique
    backstop and `clientRequestId` all stay on the call.
  - ⚠ **The system cannot know who is waiting.** No waiting count, no estimated
    wait, and no "nobody waiting" state. Call next always has a next number,
    whether or not anyone holds it; if nobody comes forward, staff mark No-show
    and call again. A waiting count on a screen would be an invented number.
  - **The paper and the system can drift, so a line's next number is
    SETTABLE.** The guard starts a fresh roll at 150, or throws away a torn
    slip. `queue:manage_windows` can set "next number" on a line, which writes
    the open session's `QueueSequence.lastNumber`. Without it, the only way to realign the
    board with the slips in people's hands is to press Call next again and again,
    marking each one a no-show.
  - **Call number… calls any number, ahead or behind** — the person who stepped
    out, or someone who arrives holding a number already passed. A number
    already called today is a RE-CALL of that ticket (`no_show → called`), not a
    second row.
  - ⚠ **Call next SKIPS numbers already called in the current cycle.** If 57 was
    called out of order, the sequence steps from 56 straight to 58, because
    calling 57 twice sends a second person looking for a turn that has already
    happened. The allocator retries against the unique
    `(lineId, sessionId, cycle, number)` constraint.
  - **The states are `called → done | no_show`, plus `no_show → called` for a
    re-call.** `waiting`, `serving` and `cancelled` are dropped. ⚠ The plan kept
    `waiting` so that a future kiosk would need no migration — exactly how
    `PermMembershipStatus.invited` became a value nothing writes. If in-system
    issuing ever arrives, adding an enum value is an additive migration, which
    is cheaper than carrying a misleading one now.
  - **No issue page, no `queue:issue` key, no printing question.** §12.66 is
    moot and closed.

  **2. WINDOWS ARE ASSIGNED THROUGH A ROLE, not opened by the person sitting
  there (§12.63 closed).** The operator's rule: someone whose workspace role
  carries the right assigns a window to a user. What that changes:
  - **Windows are created by `queue:manage_windows`**, and no longer by typing a
    name into the console. The "Windw 3" typo problem goes with it.
  - **New key `queue:assign_windows`**: assign a window to a workspace member
    (yourself included), move a person to another window, or free a window.
    Self-assignment is not a separate right. A role meant to let staff seat
    themselves carries both `queue:serve` and `queue:assign_windows`. The ROLE
    decides, which is the operator's point, and it needs no setting.
  - **`queue:serve` shrinks** to working the window you are assigned: Call next,
    Recall, Done, No-show, Call number…. Someone holding it with no seat sees "You
    are not assigned a window" on the console.
  - **Assigning an occupied window REPLACES the occupant**, after a confirmation
    ("Move X off Window 3?"). The person assigning has that authority, and
    refusing would only force them to free the window in a second step. Both
    constraints still stand — one person per window, one window per person — so
    assigning someone who already sits elsewhere moves them.
  - ⚠ **The assignee must be a workspace member who holds `queue:serve` there —
    and the module cannot check that**, because membership and grants live in
    `module-permissions`' tables. Two new ports, both filled app-side:
    - `QueueStaffCheck` — `canServe(organizationId, workspaceId, userId)`, built
      on `PermissionsService` the same way `ChatPlatformAdmin` is.
    - `QueueStaffDirectory` — the members who can serve, for the picker,
      composed from workspace membership and `auth_user` names.

    **Unbound means you can assign only yourself.** The guard has already proven
    you; anyone else is someone the module cannot vouch for. Fail closed.
  - ⚠ **Assignment is checked when it is made, and never re-checked.** Someone
    who later loses `queue:serve` keeps the seat, but the guard refuses their
    Call next. §12.62 narrows to "a window can look occupied by someone who
    cannot use it".
  - Releasing your OWN seat still needs no key. Ending a shift is not a
    permission.

  **3. `queue:*` IS SOLD IN EVERY TIER EXCEPT `free` (§12.61 closed).**
  `starter`, `pro` and `enterprise` carry all six keys in `seed/plans.ts` (six since the display-code entry), as one
  named group `QUEUE` beside `TEAMWORK`, so the tiers cannot drift apart key by
  key. The caps are the same in all three for now (`queue:windows` 10,
  `queue:displays` 3). Tiering them later is a product decision with no schema
  cost. ⚠ **Repeated because it bites:** `createPlanIfAbsent` never rewrites a
  plan that already exists, so every environment seeded before this ships needs
  an operator to add the six keys to those three plans on `/admin/plans`. A
  tenant on the free plan gets `not_entitled`. That is correct, and the screen
  should read it as an upgrade prompt, not as an error.

  **4. STAFF NAMES ON THE BOARD ARE OPTIONAL, AND ARE A NICKNAME (§12.60
  closed).**
  - ⚠ **SUPERSEDED: one persistent WORKSPACE setting, not per display — see the persistence entry above.** **Per display:** a `showStaffNames` setting, off by default, set by whoever
    holds `queue:publish_display`. The Cashier TV can show
    "C-042 → Window 3 · Ate Joy" while the lobby TV shows no names at all.
  - **The name shown is a NICKNAME the person sets themselves**, stored as
    `QueueStaffNickname(workspaceId, userId, nickname)`. It is per workspace,
    because the same person may go by different names at two branches. It is set
    from the console ("Shown on public displays as…") and needs no key, because
    it is the person's own row (the `leaveChat` rule).
  - ⚠ **NO NICKNAME MEANS NO NAME — never a fallback to the account's display
    name.** Only what a person typed for a public screen ever reaches one. A
    fallback would put a real name on a TV for everyone who never opened the
    setting, who are exactly the people least aware it exists. It is also what
    keeps the rest of the design true. The plan said a staff name on the board
    would make call events personal data and the display key a credential to
    hash. A nickname chosen for public display is neither, so the key stays plain
    and copyable, and the staff subscription stays filtered by workspace alone.
    ⚠ If a real-name fallback is ever added, both of those paragraphs become
    wrong on the same day.
  - **A nickname goes on a TV in a public room, so it is bounded:** trimmed,
    1–24 characters, no control or invisible formatting characters.
    `queue:manage_windows` can CLEAR a nickname but not set one — putting words
    on a public screen in somebody else's name is not an admin power.
  - **The nickname is read live, not snapshotted on the ticket.** Someone who
    clears their nickname wants off the board now, including today's
    recent-calls list. The window name IS snapshotted, because it records what
    the customer was told; a nickname records nothing the customer needs. A
    `queue.staff` event re-renders the boards when a nickname changes.
  - ⚠ **Now workspace-wide: every TV gets nicknames, or none does — see the persistence entry above.** **Board events carry a nickname only to displays that show names.** The
    per-publish loop that already re-checks each display key drops it, so a TV
    with names turned off never receives one.

  ⚠ **SUPERSEDED: six keys, with `queue:start` and `queue:stop` replacing `queue:publish_display` — see the display-code entry above.** **Keys, replacing the keys table in the plan below:**

  | Key | Admits |
  |---|---|
  | `queue:read` | the console, the live board inside the app, `queueEvents` |
  | `queue:serve` | work the window you are assigned: Call next, Recall, Done, No-show, Call number… |
  | `queue:assign_windows` | assign a window to a member (yourself included), move someone, free a window |
  | `queue:manage_windows` | create, rename and archive windows; manage lines and set a line's next number; clear a nickname; set the time zone |
  | `queue:publish_display` | create, rotate and revoke display links; turn staff nicknames on or off per display. `isPrivileged` |

  Presets: `queue-staff` (read + serve), `queue-supervisor` (read + serve +
  assign_windows), and `queue-admin` (all five).

  ⚠ **The public route is now keyed by organization and workspace KEY — see the display-code entry above.** **Routes, replacing the routes table below:**

  | Path | Feature | Drawer |
  |---|---|---|
  | `…/queue` | `queue:read` | Workspace group — the console |
  | `…/queue/settings` | `queue:read` | unlisted — windows, lines, assignments, displays |
  | `/queue-display/:displayKey` | none | none (public) |

  ⚠ **Revised again by the display-code entry above.** **Build order, replacing the one below — eight commits, and the first two
  still touch no queue code:**
  1. Unchanged: the shared metadata keys in `module-kit`, plus
     `chrome: 'fullscreen'`.
  2. Unchanged: the anonymous handshake, proven on its own.
  3. Schema and domain, now including the skip-already-called allocator,
     setting a line's next number, the assignment rules, and nickname
     validation.
  4. Server, now including the assign flow and the two new ports with their app
     adapters. Plans are seeded per answer 3.
  5. Realtime, with nicknames filtered per display.
  6. Web: the console, and settings with assignments and next-number.
  7. `web-ui`: the tone synthesiser, unchanged.
  8. The public display, with optional nicknames.

  The kiosk step is gone.

- **2026-09-13** — **`module-queuing-window`, planned: the first WORKSPACE-level
  module that is not permissions, and a public board that is live over
  `graphql-ws` with nobody signed in.** Not built yet. ⚠ **Revised the same day by the operator's four answers — the entry above. Superseded paragraphs are marked below.**

  **What it is.** A walk-in queue per workspace. A member takes a named
  **window** — counter, desk, booth, "Window 3" — for themselves, presses **Call
  next**, and the next number is assigned to their window. A **public display**
  — a TV in the waiting room, opened from a link, no sign-in — shows which
  number is being served at which window and changes **the instant it is
  called**, with a chime and an optional spoken announcement. The operator's
  requirements: one queue per workspace, members assign a window to themselves,
  staff step through the numbers, and the public display is realtime over
  `graphql-ws` exactly as `module-chat` is — no refresh, no polling.

  **Vocabulary, fixed before anything is named after it** — chat found "status"
  already taken four times over, and renaming after the schema exists is a
  migration:

  | Term | Means | Not |
  |---|---|---|
  | **line** | one numbered sequence with its own prefix — `C` Cashier, `E` Enrollment | "queue", which is the whole feature |
  | **window** | a named service point in a workspace | the person at it |
  | **seat** | a member occupying a window right now | a role |
  | **ticket** | one number, in one line, on one service day, and what happened to it | a support ticket |
  | **call** | a ticket being assigned to a window — the event the board exists for | |
  | **display** | a public, revocable link that renders the board | the staff console |
  | **service day** | the calendar day, in the workspace's time zone, a number belongs to | the UTC date |

  Package `packages/module-queuing-window` (`@kwtech/module-queuing-window`), as
  the operator named it. ⚠ The model PREFIX is shortened on purpose — `Queue*`
  classes, `queue_*` tables, `queue:*` keys — because `QueuingWindowTicket` in
  every query is a tax paid forever for a name read once.

  **WORKSPACE LEVEL, and the URL gives it that for free — but here the level
  comes with a trap chat never hit.** Per §12.13,
  `/organizations/:orgId/workspaces/:wsId/queue` resolves at workspace level, so
  `queue:*` are workspace-level keys and the guard runs `canAccessWorkspace`: a
  non-member cannot be seated, with no module code. ⚠ **But a GraphQL resolver
  has no path, and the module CANNOT declare its level.** `@RequireScope` belongs
  to `module-permissions`, and §9 forbids importing it. Chat got away with this
  only because app level needs no declaration. A workspace resolver with no
  declared scope resolves at APP level, where no workspace key applies — so
  **every `queue:*` key grants nothing to everybody, silently.** That is the
  failure that left organization-level roles granting nothing for weeks
  (§12.13), and the one `findUsersByIds` hit again this morning. Chat hit the
  same wall with `@RequireFeature`, and bindings were the answer there; nothing
  equivalent exists for scope.

  **The same wall, second door: `@Public`.** The board's query and subscription
  must be anonymous, and `Public` belongs to `module-auth`. Every `@Public`
  surface today is in `module-auth` or in the APP (health, invitations). A module
  cannot declare one.

  ⚠ Both are fixed the way `FeatureContribution` was: **the metadata KEYS move
  into `module-kit`**, which both enforcing modules already depend on.
  `module-kit` still imports no Nest — it exports two string constants and the
  `ScopeSpec` shape. A module applies them with its own `SetMetadata`, and
  `JwtAuthGuard` / `FeatureGuard` read the same constant they read today.
  `RequireScope` and `Public` keep their signatures, rebuilt on the shared keys,
  so no existing caller changes. Two alternatives were rejected:
  - An app-supplied `resolveScope` override that names queue operations. The
    app would be describing the module's surface — the drift bindings exist to
    close.
  - Hosting the public resolver in the app, like `InvitationsResolver`. That one
    is app-side because it composes TWO modules; this composes none, so it would
    split the module over a decorator.

  **THE PUBLIC BOARD IS LIVE OVER `graphql-ws` WITH NO SESSION — and the
  handshake refuses that today.** `onConnect` accepts one credential: a
  sixty-second ticket minted from a session cookie. A TV in a waiting room has
  neither. Three shapes were weighed:

  1. **A display ticket minted by the Next server** — a new `typ: 'display'`
     token from `module-auth`. Rejected: authentication would learn what a queue
     display is, and the ticket would be minted from a public route anyway. That
     adds a hop and proves nothing the display key does not.
  2. **Server-Sent Events from a `@Public` controller.** Rejected on the
     operator's instruction. It would also be a second realtime transport, and
     §7 prefers one.
  3. ⚠ **SUPERSEDED: admitted by a display PASS, obtained with a per-session code — see the display-code entry above.** ✅ **An ANONYMOUS connection, admitted by a DISPLAY KEY.** The client sends
     `connectionParams: { displayKey }` instead of `{ ticket }`. The app supplies
     an `admitAnonymous(params)` hook, and `app.module.ts` wires it to the queue
     module's `QueueDisplayService.admit`. `graphql.options.ts` stays free of
     module names, just as the presence callbacks keep it. A socket admitted
     this way carries **no principal**.

  ⚠ **An anonymous socket is safe without anything new to remember.**
  `JwtAuthGuard` already runs on every operation over a socket, and throws "Not
  signed in" when there is no principal unless the handler is public. So an
  anonymous socket reaches **exactly the operations marked public, and nothing
  else**, through the guard that already exists. There is no allowlist to
  maintain and no second path to a principal. The seam between auth and
  permissions stays two places wide: this socket has no principal for
  permissions to read.

  ⚠ **Four things the anonymous branch must do that the ticket branch gets for
  free:**
  - **No presence.** `lifecycle.opened` takes a userId. An anonymous socket must
    never call it, or chat's refcount counts a TV as a person.
  - ⚠ **Now the re-check is "is the session still open" — see the display-code entry above.** **No token expiry to close on, so revocation is checked on EVERY PUBLISH.**
    Each board event re-reads whether the display key is still live — cached,
    and invalidated by a `queue.display` event. A revoked or rotated key ENDS
    the stream. This is chat's rule (filter per publish, never once at
    subscribe) for the same reason: a leaked link on a TV must go dark when it is
    revoked, not keep streaming until somebody unplugs it.
  - **A maximum socket lifetime** (12 h), so a board running for a week
    reconnects and catches up, rather than trusting a connection nobody has
    checked since Monday.
  - ⚠ **Narrowed: the code is guessed over throttled HTTP, and the socket takes a 256-bit pass — see the display-code entry above.** **§12.29 becomes live, and sharper.** A ticketed socket is bounded by needing
    a session. An anonymous one is bounded only by knowing a display key, which
    is shown on a screen in a public room. Connections per display key are
    capped at the handshake (default 10); per-IP limits are §12.59.

  **Staff console realtime is chat's shape exactly.** Mutations go over HTTP, so
  `ThrottlerGuard` bounds a stuck Call next button for free — §12.29's bargain.
  One subscription rides the app's single socket:
  `Subscription.queueEvents(organizationId, workspaceId)`, bound as
  `graphql_subscription` to `queue:read`, with its workspace scope declared.
  **Catch-up runs on every (re)subscribe, for board and console alike.** The
  socket closes at token expiry by design and pub/sub has no replay, so a number
  called in the gap would otherwise never reach the TV. The socket is the fast
  path; `queueBoard` is the truth.

  ⚠ **Events are NOT membership-filtered per publish — a deliberate difference
  from chat.** Chat re-checks participation on every message because a message
  is private to its conversation. A call event carries exactly what the PUBLIC
  board shows: line, number, window name, time. So a member removed from the
  workspace keeps seeing what anybody in the waiting room can see, for at most
  `AUTH_ACCESS_TOKEN_TTL`, and filtering by workspace id is enough. ⚠ **This
  holds only while the event carries nothing private.** The day a call event
  carries a staff member's name, a customer's name or a phone number, chat's
  rule applies and this paragraph is wrong.

  ⚠ **SUPERSEDED: names are optional per display, and only a self-set nickname — see the operator's answers entry above.** ⚠ **No staff names on the public board.** It says "C-042 → Window 3", never who
  is sitting there. A name on a screen in a public room makes a person findable
  by anybody with a grievance, and the operator never asked for it. The console
  shows names; the display does not. §12.60.

  **A NUMBER IS ALLOCATED BY A CONDITIONAL UPDATE, never read-then-write.** Two
  staff pressing Call next in the same millisecond is the normal case at opening
  time, not an edge case. `QueueSequence(lineId, serviceDate)` holds
  `lastNumber`, and allocation is a single `increment` update inside the write
  transaction. `@@unique([lineId, serviceDate, cycle, number])` on the ticket is
  the backstop: a duplicate becomes a constraint error rather than two people
  walking to two windows holding one number. Refresh-token rotation already
  relies on the same discipline. ⚠ Prisma's `update` with `increment` is ONE
  statement, so no raw SQL is needed, and this is not a second caller for
  §12.19.

  **Idempotent by `clientRequestId`** — chat's `clientMessageId` again. Without
  it, a double-tap or a retry over flaky counter Wi-Fi SKIPS a number: the
  customer holding it is never called, and nothing on any screen says so.

  ⚠ **SUPERSEDED: numbering belongs to the session, and the service day and time zone are gone — see the display-code entry above.** **The daily reset needs no scheduler.** `web-server` has no job runner
  (§12.40 already paid for that discovery), so the reset is not an act at all.
  The sequence is keyed by `serviceDate`, computed in the workspace's time zone
  at allocation. The first call of a new day finds no row and starts at the
  line's `startNumber`. A reset that never runs cannot fail to run. ⚠ The time
  zone is the queue module's OWN setting (`QueueSettings.timeZone`), not a
  column on `perm_workspace`, which belongs to another module.

  **"Loop" means two things, and both are built.**
  - **Staff step through numbers:** Call next, Recall (re-announce the same
    ticket, counted), No-show, Done, and Call number… for the person who stepped
    out when they were called.
  - **A line wraps:** after `endNumber` (say 999) it returns to `startNumber` and
    `cycle` increments, so the morning's ticket 7 and ticket 7 after the wrap are
    different rows. Without the wrap, a two-digit display is showing a
    four-digit number by mid-afternoon.

  ⚠ **Confirmed by the operator, and extended with a settable next number and skip-already-called — see the answers entry above.** **v1 issues numbers OUTSIDE the system** — a paper roll, a dispenser, a
  receptionist — so Call next means "allocate the next number and assign it to
  my window". ⚠ **The ticket is still a ROW**, created at the moment of the
  call. That makes a kiosk ("take a number", which knows how many are waiting) a
  status value and a public route later, not a migration. An issued ticket is a
  row born `waiting` instead of `called`, and Call next then claims the oldest
  waiting ticket with the same conditional-update discipline. §12.58 is that
  decision.

  ⚠ **SUPERSEDED: windows are created by `queue:manage_windows` and assigned through a role — see the operator's answers entry above.** **Windows are named by the people who sit at them.** A member holding
  `queue:serve` either takes an existing free window or **opens a new one by
  typing its name** — the operator's "assign a window name for his unit".
  Names are unique per workspace, case-insensitively, so "window 3" cannot sit
  beside "Window 3". The `queue:windows` cap bounds how many exist. Renaming or
  archiving somebody else's window is `queue:manage_windows`. §12.63 covers
  whether opening a window should instead be admin-only.

  ⚠ **Constraints still hold; taking a seat is now ASSIGNMENT, and a seat persists until it is changed — nothing releases it at the end of a day or a session. See the entries above.** **Seats: one window per member, and one member per window.** `QueueSeat`
  carries both `@@unique([windowId])` AND `@@unique([workspaceId, userId])` —
  two constraints, following `PermWorkspaceMemberRole`'s pattern, because each
  one stops a different thing. The guard refuses someone not permitted to take a
  seat; the row refuses a window that is already occupied. Releasing your own
  seat needs no key: withholding it would be a lockout dressed as a permission
  (the `leaveChat` rule).
  ⚠ **A seat outlives the person's membership.** A member removed from the
  workspace still occupies Window 3 until somebody frees it.
  `queue:manage_windows` can force-release a seat, and the end of the service
  day releases every seat (lazily, at the next claim or read). §12.62.

  **Tickets snapshot the window NAME.** Renaming Window 3 to "Cashier 1" at noon
  must not rewrite the morning's history, and the board's recent-calls list must
  keep saying what the customer was told.

  ⚠ **SUPERSEDED: no durable display key exists; a per-session code and a hashed pass replace it — see the display-code entry above.** **The display key is a random value stored in plain, NOT hashed like an
  invitation token — and that difference is the point.** An invitation token is
  a credential that creates an account. A display key reveals ticket numbers and
  window names that are already on a wall in a public room. Hashing it would
  stop an administrator copying the link again from the settings page, to
  protect nothing secret. It is revocable and ROTATABLE, and rotating is the
  answer to "somebody posted a photo of the TV's URL". ⚠ If a board ever shows
  anything private, this paragraph is wrong and the key becomes a hashed
  credential.

  **Browsers refuse to play sound or speech before a user gesture** — chat's
  tone lesson, now on a TV. The board opens on a full-screen **Start display**
  button. Pressing it unlocks the chime and `speechSynthesis`, and acquires the
  Screen Wake Lock that stops the TV sleeping at 2pm. A board that silently
  never chimes looks exactly like a working one until a customer misses their
  number.

  ⚠ **The chime cannot import chat's tone engine**, because `module-chat/react`
  is another module (§9). The synthesiser moves to `@kwtech/web-ui`. That is
  rule 8 met exactly: code earns a shared home when a second consumer needs it,
  and this is the second.

  ⚠ **A stale board must LOOK stale.** A TV showing "Now serving C-041" from a
  socket that died ten minutes ago is this module's worst failure: people keep
  waiting for a number that has already been called. After 15 s disconnected,
  the board dims and says it is reconnecting. It is the `ConnectivityMonitor`
  argument made about sign-in, applied to the one screen nobody watches closely.

  ⚠ **SUPERSEDED: six keys, not four — see the operator's answers entry above.** **Keys — workspace level, atomic, split by risk:**

  | Key | Admits | Why it is separate |
  |---|---|---|
  | `queue:read` | the console, the live board inside the app, `queueEvents` | seeing the queue is not serving it |
  | `queue:serve` | take, open or release a window; Call next, Recall, No-show, Done, Call number… | the everyday staff right |
  | `queue:manage_windows` | rename or archive any window, manage lines, force-release a seat, set the time zone | it changes what everybody else does |
  | `queue:publish_display` | create, rotate and revoke display links | ⚠ **a DISCLOSURE act**: it publishes workspace data to anybody with the link, so it is not bundled with renaming a window. `isPrivileged` |

  No key for releasing your own seat (see above). Two presets are shipped —
  `queue-staff` (read + serve) and `queue-admin` (all four) — for the host to
  adopt into its own roles. As with chat, adopting the module grants nobody
  anything.

  ⚠ **WORKSPACE KEYS ARE FILTERED BY THE PLAN** — the second live-database trap
  of 2026-09-09. A `queue:*` key that no plan entitles is a key nobody can use,
  and the denial correctly reads `not_entitled`. `seed/plans.ts` must add the
  keys to the tiers that sell the queue (§12.61). **`createPlanIfAbsent` never
  rewrites an existing plan**, so every environment seeded before then needs an
  operator on `/admin/plans` before anyone can press Call next. That belongs in
  the release note, not in anybody's memory.

  ⚠ **`queue:displays` now counts TVs per session, resolved at Start — see the display-code entry above.** **Caps, plan-sourced and counted over the workspace:** `queue:windows`
  (default 10) and `queue:displays` (default 3), declared through
  `LimitContribution`. The floor is 1; omission never means unlimited.

  ⚠ **Changed: `QueueSession` and `QueueDisplayPass` added, `QueueDisplay` and the service day removed — see the display-code entry above.** **Schema — `queue.prisma`, with `workspaceId` AND `organizationId`
  denormalised onto every row.** This applies §12.34's lesson from the first
  migration instead of retrofitting it: a queue row that names only a workspace
  cannot be checked against a tenant without reading another module's table.

  | Model | Holds | Load-bearing constraint |
  |---|---|---|
  | `QueueSettings` | per workspace: time zone, enabled | PK `workspaceId` |
  | `QueueLine` | name, prefix, `startNumber`, `endNumber`, zero-padding, order, `archivedAt` | `@@unique([workspaceId, prefix])` |
  | `QueueWindow` | name, normalised name, order, `archivedAt`, `createdById` | `@@unique([workspaceId, nameKey])` |
  | `QueueWindowLine` | which lines a window serves; none means all | `@@id([windowId, lineId])` |
  | `QueueSeat` | who sits at a window now | `@@unique([windowId])`, `@@unique([workspaceId, userId])` |
  | `QueueSequence` | `lastNumber` and `cycle` for a line on a service day | `@@id([lineId, serviceDate])` |
  | `QueueTicket` | number, `displayCode`, status, `windowId`, `windowName` snapshot, `calledById`, `calledAt`, `recallCount`, `completedAt`, `clientRequestId` | `@@unique([lineId, serviceDate, cycle, number])`, `@@unique([clientRequestId])` |
  | `QueueDisplay` | `key`, title, which lines, voice on/off, `revokedAt` | `@@unique([key])` |

  `QueueTicketStatus`: `waiting → called → serving → done | no_show`, plus
  `cancelled`. v1 never writes `waiting`, because numbers are issued outside the
  system. ⚠ The enum's comment must say so, or it becomes another
  `PermMembershipStatus.invited` — a value nothing writes and everybody assumes
  something does. `userId`s are bare strings with no FK; this is the fourth
  module to hold them that way.

  ⚠ **Three more ports: two staff ports in the answers entry and `QueueWorkspaceLocator` in the display-code entry above.** **Ports.** Every one is optional, and each absence is documented as a MEANING,
  following chat's table:

  | Port | Unbound means |
  |---|---|
  | `prismaProvider` / `prismaWriteProvider` | no database — the module opens nothing |
  | `pubsubProvider` | it works over HTTP, but the console is not live and **the board never updates** — so the board says "live updates unavailable" rather than looking current |
  | `userDirectoryProvider` | the console shows "a member" at a seat instead of a name. ⚠ The app adapter must use the ORGANIZATION-scoped `findUsersByIds` fixed today, never an unscoped lookup |
  | `limitCheckerProvider` | no cap |
  | `resolveActorId` | nobody can be seated |

  `QueueDisplayService.admit` is exported for the app's handshake hook. It is
  not a port: the module implements it, and the app only wires it in.

  ⚠ **The public route is now `/queue-display/:organizationKey/:workspaceKey` — see the display-code entry above.** **Routes:**

  | Path | Chrome | Feature | Drawer |
  |---|---|---|---|
  | `/organizations/:organizationId/workspaces/:workspaceId/queue` | app | `queue:read` | Workspace group — the console |
  | `…/queue/settings` | app | `queue:read`; controls inside take `manage_windows` / `publish_display` | unlisted, reached from the console |
  | `/queue-display/:displayKey` | ⚠ **new: `'fullscreen'`** | none | none |

  ⚠ `'bare'` is not enough for the board: it pins a theme toggle and a status
  bar over a TV picture and assumes a centred card. A third `chrome` value in
  `module-kit` is better than a page fighting its frame.
  ⚠ The public route opens its OWN anonymous connection — the single documented
  exception to one socket per tab (§12.39). The app's connection mints its
  ticket from a session the TV does not have. `createRealtimeConnection` gains a
  `connectionParams` option, so it remains the one constructor.

  **The console**, ordered by how often each part is touched:
  1. My window: take one, open a new one, or change.
  2. The ticket at my window, with **Call next** as the largest thing on the
     page, and beside it Recall · No-show · Done · Call number….
  3. Every window and what it is serving, live.
  4. A link to open the public display.

  Space calls next, because counter staff do it three hundred times a day.

  **The board**: a Now serving list with one large row per window holding a
  ticket. The newest call pulses for ten seconds, with the chime and "Now
  serving C-042 at Window 3" spoken aloud. Below it are recent calls, a clock
  and the display's title. Each display filters by line, so the Cashier TV shows
  only `C`.

  ⚠ **SUPERSEDED: eight commits, no kiosk; steps 3–8 revised in the answers entry, and again in the display-code entry — see the operator's answers entry above.** **Build order — nine commits, and the first two touch no queue code:**
  1. `module-kit`: the shared `REQUIRED_SCOPE` and `PUBLIC_SURFACE` metadata
     keys, with `module-permissions` and `module-auth` rebuilt on them and no
     behaviour change — proven by their existing suites passing untouched. Plus
     `chrome: 'fullscreen'`.
  2. `web-server`: the anonymous handshake — the `admitAnonymous` hook, no
     presence, a maximum lifetime, a per-key connection cap. It ships with an
     app test that an anonymous socket asking for a non-public subscription gets
     "Not signed in". ⚠ Proven with a dummy public subscription BEFORE any queue
     code exists, so the security property is tested on its own.
  3. `module-queuing-window`: schema and pure domain — the service date in a time
     zone, wrapping, the ticket state machine, seat exclusivity, window-name
     normalisation, display-code formatting. No database and no framework.
  4. Server: repository, read and write services on separate clients, GraphQL
     with a scope declared on every resolver, the conditional-update allocator,
     and `clientRequestId`. The app adopts the package (which creates the
     tables) and seeds the keys and plan entitlements. ⚠ A `surface-coverage`
     test fails on any resolver without a declared scope or a public marker —
     the §12.13 trap turned into a red build.
  5. Realtime: `queueEvents`, the public `queueDisplay`, the per-publish
     display-key re-check, and catch-up on every (re)subscribe.
  6. Web: the console, plus settings — windows, lines, and displays with copy,
     rotate and revoke.
  7. `web-ui`: the tone synthesiser moved out of `module-chat`, with chat
     re-pointed at it.
  8. Web: `/queue-display/:displayKey` — the Start display unlock, chime, speech,
     wake lock and stale dimming.
  9. A kiosk / take-a-number page — ⚠ ONLY if §12.58 is answered that way.

- **2026-09-13** — **`findUsersByIds` is scoped to an ORGANIZATION, and answers
  only with that organization's members.**

  Reported from the product: a super administrator saw names on every roster,
  and an ordinary member of an organization saw raw user ids.

  **⚠ THE CAUSE WAS A MISSING `@RequireScope`.** `members:read` is an
  organization-level key. A GraphQL request has no organization in its URL, so
  without a declared scope the guard fell through to the path convention and
  resolved at APP level — where only a platform administrator holds the key.
  The lookup was refused, the client fails soft by design, and the id is the
  fallback. So the bug looked like missing data rather than a denial. The query
  now takes `organizationId`, the guard resolves that scope, and an
  organization-level grant applies. App-level grants still apply too
  (`composeContext` adds them to every scope), so platform administrators are
  unaffected.

  **⚠ THE SCOPE FIX MADE A SECOND CHANGE NECESSARY.** The original reasoning
  (§ below, "acceptable as a batch precisely because it is by id") said the
  caller already holds the ids, so the batch discloses nothing new. That holds
  for a SCREEN but not for an ENDPOINT, which accepts whatever ids it is sent.
  While the key was app-level, that gap was reachable only by platform
  administrators. Widening the key to every organization member without closing
  the gap would have made the query a directory harvester over the whole
  platform: send your own organization id plus guessed user ids, collect names
  and addresses. So the answer is INTERSECTED with `perm_membership` for the
  organization named.

  - **In the database, not filtered afterwards.** Reading every user and then
    dropping non-members would still read them, and a bug in the filter would
    leak data instead of returning an empty list. `auth_user` is queried only
    for ids already confirmed as members, and not at all when none are.
  - **Any membership status counts.** Suspended and invited members are on the
    roster the caller is already looking at. Showing their id without their name
    would leave half the screen unreadable for no reason anyone could see.

  Rejected: keeping the query app-scoped and granting `members:read` at app
  level to everyone. That fixes the symptom and leaves the harvester open to
  all of them.

  All four callers (`organization-detail-page`, `workspace-detail-page`,
  `useMyOrganization`, `useMyWorkspace`) already had the organization id in
  hand, so the client signature change costs nothing.

- **2026-09-13** — **A direct message gets its own settings page, and the
  viewer's own control stops living inside the group page's markup.**

  The operator's point: the quick emoji is a per-user customisation, so it
  should be reachable on a DM by anybody, and a direct conversation needs a
  settings surface of its own.

  **⚠ THE PREVIOUS FIX WAS ONLY HALF A FIX, and this is the second time the same
  comment has been wrong.** Linking the page from a DM did nothing, because the
  page RETURNED EARLY for a direct conversation:

  > *"A direct conversation has no settings. It is named by who is in it, and
  > only the two of you are ever in it."*

  True when written, and false from the moment the page gained a section
  belonging to the VIEWER rather than to the conversation. The five
  `isDirect ? null :` holes cut in the group layout in that same commit were
  DEAD CODE — the early return meant they were never reached. Fixing the link
  without reading what it led to is exactly the shape of mistake the entry above
  this one is about.

  **⚠ A LAYOUT THAT IS MOSTLY ABSENT IS A DIFFERENT LAYOUT.** A DM now renders
  its own short page — the quick emoji section, and one sentence saying there is
  nothing else to configure and why — rather than the group page with conditions
  threaded through it. Those conditions are deleted: rename, role labels and the
  varying description are gone, because the branch that needed them does not run
  the group layout at all.

  **⚠ `QuickEmojiSection` IS A SHARED COMPONENT, and that is the structural
  point.** It is the viewer's own preference: stored in their browser, never
  sent, invisible to the other participants. So it sits OUTSIDE every role
  check, and a member has exactly as much right to it as an owner — while a DM
  has no roles at all. Markup inside the group page could never satisfy both,
  which is precisely how it came to be unreachable. A test asserts the component
  mentions no `canManage`, `canInvite`, `canArchive` or `roleOf`, and that both
  layouts render it.

  ⚠ Recorded as a pattern now, because this is the third instance in two days:
  **a capability that lives inside one consumer is not shared, and the next
  surface does not inherit it.** The back link inside one page's private
  `Frame`; the wire-to-domain bridge inside `useConversationSettings`; this.
  Each shipped a gap that looked like an oversight and was really a scoping
  choice made silently.

- **2026-09-13** — **The quick emoji was unreachable in every DIRECT MESSAGE,
  and both settings screens offered a tenth of the catalogue.**

  Two corrections from the operator, and the first is a gap the previous commit
  created.

  **⚠ THE SETTINGS LINK WAS GROUPS-ONLY**, on reasoning that was sound when it
  was written: *"a direct chat has no settings at all — it is named by who is in
  it, cannot take a third person, and is not one person's to archive on the
  other's behalf."* True of everything on that page **at the time**. It stopped
  being true the moment the page gained the VIEWER'S OWN quick emoji, which is
  per-device, invisible to the other person, and exactly as applicable to a DM
  as to a group. So the per-conversation setting shipped unreachable in every
  direct conversation.

  ⚠ **The lesson is about the comment, not the link.** The justification was
  accurate and became false because the page's PURPOSE changed underneath it —
  from "settings the conversation has" to "settings about this conversation,
  some of them yours". A reason that holds for a page's contents is not a reason
  that holds for its contents forever, and nothing re-reads it.

  The link is now on every thread, labelled **Options** on a DM. ⚠ And the
  group-only controls stay group-only: rename is hidden entirely rather than
  falling back to "only an owner or an admin can rename this" — which on a DM
  describes a hierarchy that does not exist and a permission nobody has — and
  role labels are dropped, because printing "Member" under both names invites
  somebody to wonder who the owner is.

  **⚠ AND THE SETTINGS SCREENS OFFERED TEN EMOJI while the composer offered a
  hundred and sixty**, for what is the same choice. A shortlist is defensible
  for the one-tap reply itself and indefensible as the only thing you may pick
  it from. `QUICK_EMOJI_CHOICES` is deleted; `EmojiGrid` is split out of
  `EmojiPicker` — the grid, the tabs and the recents row with no positioning,
  no Escape handler and no click-outside — and all three surfaces render it.

  ⚠ The split is what makes "the same catalogue everywhere" structural rather
  than a promise: there is now one component, so a screen cannot come to offer a
  different set. A test asserts both settings pages use it and neither mentions
  a shortlist.

- **2026-09-13** — **The quick button is PER CONVERSATION, not one setting for
  everywhere.**

  Asked for by the operator, and it is the right correction: a thumbs-up is
  right for a standup group and wrong for the one conversation where somebody
  always replies ❤️ or 👀. Built first as a single global preference, which
  made the button a property of the PERSON when it is really a property of the
  RELATIONSHIP.

  **Two places, and the second is the one that matters.** `/chat/preferences`
  sets the default; a conversation's own settings page sets that thread's
  button. `resolveQuickEmoji` is the one place the fallback order is written
  down, so the composer and the settings screen cannot disagree about which
  emoji a given thread shows.

  **⚠ NOT ROLE-GATED, and that decides where it sits on the page.** Everything
  else on `/chat/:conversationId/settings` is about the CONVERSATION — its name,
  who is in it, who runs it — and is shared, server-side, and gated on what this
  person may do. This is about the VIEWER: stored in their browser, never sent,
  invisible to the other participants. A member has exactly as much right to it
  as an owner, so it is outside every `canManage` block. ⚠ Putting a personal
  per-device setting on a page of shared server-side ones needs the screen to
  SAY so, which it does in the blurb — otherwise it reads as something the group
  can see.

  **⚠ PER PERSON BY CONSTRUCTION, which is worth saying out loud.** It is
  `localStorage`. Two people in one group can have entirely different buttons
  and neither can see the other's, and no server change was needed for any of
  it.

  **⚠ THREE STATES, NOT TWO, and the last two are different answers.** *Use my
  default* FORGETS the override, so the conversation follows whatever the
  default becomes later. *No button here* is a choice to have none in this
  thread specifically — which somebody may want in exactly the conversation
  where a stray tap would be worst. Collapsing them would make one of the two
  unreachable.

  ⚠ **A test caught a real bug in exactly that distinction.** `''` is a
  legitimate stored override and `isPlausibleEmoji('')` is false — correctly,
  since an empty string is not an emoji — so the read path filtered it out and
  silently handed the default button back to somebody who had deliberately
  removed it. The filter now admits `''` explicitly, with the reason written
  beside it.

  **⚠ THE MAP IS CAPPED, because nothing ever deletes an entry.** A conversation
  can be archived, left, or never opened again and its id stays; without a bound
  this is a store that only grows on a device nobody clears. Fifty, dropping the
  OLDEST — objects preserve insertion order for string keys, so "oldest" is a
  real answer rather than an arbitrary one. Dropping an override is not
  destructive: that conversation falls back to the default, which is what it had
  before anybody chose.

  `QUICK_EMOJI_CHOICES` moved into `emoji.ts` rather than being declared on both
  screens, so the default and the override cannot come to offer different
  options for one setting.

- **2026-09-13** — **An emoji picker and a one-tap button, and the picker is
  160 strings rather than a megabyte.**

  Asked for by the operator. Emoji already worked — verified end to end against
  the live API, including a ZWJ family sequence — because they are Unicode text
  in a normal textarea. What was missing was a shortcut to the common ones.

  **⚠ CURATED, NOT A LIBRARY, which is the decision §9 deferred.** Every npm
  picker ships the full Unicode set with names, keywords and usually sprite
  sheets: 200KB to over 1MB hanging off a text box in a back-office
  application. This is **160 emoji in four groups — 967 bytes of plain
  strings** — plus a recents row, and a test fails if the catalogue grows past
  400, because at that point the trade that justified writing it by hand has
  quietly been lost.
  ⚠ What it gives up, stated: the complete catalogue, search by name, skin-tone
  variants beyond the few listed, flags. What it does NOT give up is access to
  any of them — the OS picker still works. This is a shortcut, not the only way
  in.

  **⚠ INSERTION IS AT THE CARET, and replaces a selection.** A naive picker
  appends to the end, which moves somebody's cursor without asking every time
  they pick one mid-sentence. `insertEmoji` is PURE so the rule is testable; the
  ten lines that genuinely need a textarea stay in the component.
  ⚠ The caret is measured in UTF-16 UNITS, not code points, because that is
  what `selectionStart` and `setSelectionRange` speak. Mixing the two puts an
  emoji INSIDE a previous one and produces a broken glyph — asserted.

  **⚠ `onMouseDown` WITH `preventDefault`, NOT `onClick`**, and this is the
  detail that would have shipped broken. A click moves focus to the button,
  which BLURS the textarea, and a blurred textarea reports a selection of 0 —
  so every emoji would land at the start of the message rather than at the
  caret. Preventing the default keeps focus where it is.

  **The picker stays OPEN after a pick.** People send several in a row, and a
  panel that closes after one is a panel somebody reopens four times.

  ## The quick button

  **⚠ IT DOES NOT TOUCH WHAT IS IN THE BOX.** The quick button is a REPLY, not a
  shortcut for typing one: appending to a half-written message and sending that
  would destroy the draft. Somebody mid-sentence who taps 👍 means "yes, and I
  am still writing".

  **⚠ IT DEFAULTS TO ON, which points the opposite way to the tone default —
  deliberately.** A sound plays without being asked for, in a room that may have
  other people in it, so silence is the polite default. A button sits there and
  does nothing until pressed, and it is the single most-sent message in any
  chat; defaulting it to absent would hide the feature from everybody who never
  opens preferences. The two defaults disagree because the two things are not
  alike.

  **⚠ THE STORED VALUE IS VALIDATED, AND THIS IS THE ONE THAT MATTERS.** It comes
  out of `localStorage`, which a person can edit by hand, and **one tap SENDS
  it** — so without a cap a hand-edited entry is an arbitrary message body one
  tap away. `isPlausibleEmoji` bounds the length at twelve code points (a
  four-person ZWJ family is seven, so it cannot be one) and refuses whitespace
  and control characters.
  ⚠ DELIBERATELY LOOSE beyond that, and pinned by a test so nobody "fixes" it:
  real emoji validation needs Unicode property tables, which is the thing this
  whole file exists to avoid shipping. Somebody can set their own button to
  "ok". That is their device and their button — it is a guard against a stored
  value rendering as something surprising, not a security property.

  **⚠ THREE OUTCOMES FOR A STORED `quickEmoji`, not two.** Absent means never
  chosen, so it takes the default; `''` means deliberately removed, so it stays
  empty; anything implausible falls back to NO BUTTON rather than to the
  default, because silently restoring a button somebody removed is the more
  surprising failure. Recents are filtered and capped for the same reason — a
  hand-edited array of a thousand strings must not become a thousand buttons.

  ⚠ **REACTIONS ARE STILL A DIFFERENT FEATURE** (§12.43's neighbour): an emoji
  attached TO a message, with its own table. None of this is that, and the two
  must not be conflated because one now exists.

- **2026-09-13** — **What adopting `module-chat` actually costs, measured — and
  one real redundancy removed.**

  The operator asked how the apps use the module, how many lines it takes, and
  whether it can be smaller. Measured rather than estimated, counting CODE lines
  with comments stripped (this repo's comment density makes raw `wc -l`
  meaningless):

  | | lines |
  |---|---|
  | `apps/web-app` — the whole frontend adoption | **2** |
  | `chatServerModule({…})` descriptor | 27 |
  | registry declaration | 9 |
  | the four PORTS the app must fill | 100 |
  | env + mail template | 1 + ~55 prose |
  | **web-server total** | **~137** |

  ⚠ **The frontend is genuinely two lines** — an import and an array entry —
  and that is the descriptor pattern working exactly as §9 intended: routes,
  navigation, the unread badge, three pages and the drawer entry all derive from
  `chatWebModule()`.

  **⚠ THE 100 LINES OF PORTS ARE NOT CEREMONY, AND MUST NOT BE REMOVED.** They
  are the price of §9's rule that a module may not import a module. Chat
  DECLARES `chat:manage_all`, `chat:group_chats` and two defaults and can check
  none of them, because all three are `module-permissions`' questions; and it
  cannot send mail, because that is the app's. Each adapter is the app answering
  a question only it can answer, and collapsing them would mean either chat
  importing the permissions module or the permissions module importing chat.
  The 100 lines buy a module that runs in an app with no permission model at
  all.

  **What WAS redundant, and is now gone.** `seed/registry.ts` had THREE arrays
  — `FEATURE_SOURCES`, `LIMIT_SOURCES`, `DEFAULT_SOURCES` — each listing the
  same modules again. `WebModuleDescriptor` already carries all four registries
  and every composer ignores a module that declares nothing for it, so one
  `MODULE_DECLARATIONS` feeds all four.

  ⚠ **The size was not the point; the SILENCE was.** Three lists is three
  chances to add a module to two of them, and every omission fails quietly:
  an unlisted module's feature BINDINGS never load, so its mutations are
  reachable by anybody signed in (chat cannot use `@RequireFeature` — the
  decorator belongs to another module — so that registry IS its guard); an
  undeclared cap resolves to UNLIMITED; an uncomposed default has no row on the
  screen and is never read. Adopting a module is now one entry that cannot be
  half-done.

  Verified the composed output is unchanged: 50 features (8 chat), 5 limits
  (1 chat), 11 defaults (2 chat), 8 moments.

  **What was considered and REJECTED as a simplification:** collapsing the four
  provider blocks in `app.module.ts` into `useClass`. Each is five lines of
  `{ provide, inject, useFactory }`, which looks like ceremony — but `useClass`
  would need `PermissionsService` and `PrismaService` resolvable inside the chat
  module's own injector, which means importing those modules INTO chat. That is
  the coupling the ports exist to avoid, traded for twelve lines.

- **2026-09-13** — **A control offered to people the server refuses, and the
  bridge that existed in only one place.**

  Found by the operator: the thread header's **"Add someone" was shown to every
  member of a group.** `canInviteToConversation` is owner-or-admin, so a member
  saw the button, opened the finder, found somebody, and had the invitation
  refused by the API — a control that exists to be denied.

  **⚠ THE SETTINGS PAGE HAD IT RIGHT THE WHOLE TIME**, which is the part worth
  recording. `/chat/:conversationId/settings` gated its own "Add someone" on
  exactly this rule from the day it shipped. The difference was not care: the
  BRIDGE from the wire shape to the domain's rules — narrowing a
  `ChatParticipantView` into a `ParticipantView` the rules accept — lived inside
  `useConversationSettings`, so the surface that did not use that hook had no
  way to ask the question at all.

  ⚠ **The same shape as the back-link bug two commits ago.** A capability
  living inside one consumer is not shared, and the next surface does not
  inherit it. So `viewerParticipant` / `viewerAuthority` moved to
  `view/conversation-view.ts`, where both read them, with tests over each role.

  **⚠ AND A SECOND ONE FOUND BY LOOKING**, which the operator asked for: the
  conversation list's **New** button was gated on nothing. `chat:read` opens the
  page and `chat:start` is a SEPARATE key — a role can hold the first without
  the second, somebody who may follow conversations they are added to and may
  not open new ones. Now `useHoldsFeature(CHAT_FEATURE.start)`, from
  `module-kit` rather than `module-permissions`, which this module may not
  import (§9).

  **⚠ HIDDEN, NOT DISABLED**, and the operator offered both. A greyed-out "Add
  someone" raises a question the screen cannot answer: a member has no way to
  discover that inviting is an owner-or-admin power, so the disabled control
  reads as a bug rather than a rule. Hiding is also the precedent every
  role-gated affordance in this module already followed.

  ⚠ **Hiding is not enforcing, and the direction of failure is what makes this
  safe.** Every one of these calls the SAME domain function the server enforces
  with — imported, never restated — so the worst a mistake here can do is hide
  a control the API would have allowed. It can never show one the API refuses.
  That is C1's lesson applied to affordances rather than to queries, and it is
  why `useHoldsFeature` returning an empty list in an app with no permission
  model HIDES rather than reveals.

  **The rest of the surface, audited rather than assumed:** message deletion is
  gated on authorship, which matches the server for a non-moderator — a
  moderator's delete is a MISSING affordance rather than a wrongly-shown one,
  and that is the safe direction. Leaving deliberately takes no key at all;
  withholding it would be a lockout dressed as a permission. Rename, roles,
  removal and archiving on the settings page were already gated on their own
  rules.

- **2026-09-13** — **Ten tones, and the engine grew to make them possible.**

  Asked for by the operator: more tones, "like Messenger and more". Four became
  ten, and the interesting part is that the catalogue could not simply be
  extended — **a pop is not a note.** It is a fast upward PITCH SWEEP under a
  percussive decay, and an engine of steady sine tones cannot express one at
  all. A steady tone of the same length is a beep.

  So `ChatToneNote` gained three fields, each of which unlocks a family of
  sounds: **`toHz`** (a sweep — pop, bubble), **`wave`** (`triangle` brightens,
  `square` is harsh and carries — ping, alert), and **`shape: 'decay'`** (struck
  rather than played — tap, marimba, ding). Plus `level`, so a quiet overtone
  can sit under a fundamental, which is what stops `ding` sounding like a test
  tone: a real bell has overtones and one sine never does.

  **⚠ EXPONENTIAL RAMPS, because pitch is perceived that way.** A linear sweep
  from 420Hz to 1180Hz spends most of its time already sounding high, and the
  fast rise that makes a pop a pop is gone. ⚠ And `exponentialRampToValueAtTime`
  THROWS on a non-positive target and cannot reach zero — so a decay ramps to an
  epsilon and then SETS zero, because stopping at the epsilon leaves exactly the
  click the envelope exists to remove. A test asserts every frequency in the
  catalogue is positive, since a `toHz: 0` typo would throw inside the
  try/catch that keeps a tone from breaking a render: silent, and the tone
  simply never plays again.

  **⚠ NAMED FOR WHAT THEY SOUND LIKE, NEVER FOR A PRODUCT.** "Pop", "Ding",
  "Ping" — not the name of any messenger that has one. Two reasons and the
  second is the real one: a real product's notification sound is a recorded
  asset somebody owns, so these are ORIGINAL sounds in a familiar genre rather
  than imitations of a specific one; and a tone named after another app sets an
  expectation this cannot meet, which reads as a bad copy rather than as its own
  sound. A test fails on a brand name in the catalogue.

  **Ten, and there is a ceiling for a reason.** A picker somebody scrolls is a
  picker somebody abandons, and every tone has to be auditioned one at a time to
  be chosen. ⚠ Which is also why **choosing one now PLAYS it** — with four
  options the Play button was enough; with ten, picking blind and then hunting
  for Play to discover what you chose is the actual experience. It doubles as
  the autoplay unlock.

  ## ⚠ A LINT AUTOFIX SILENTLY DISARMED A TEST

  Worth its own heading, because it is the most alarming thing found today and
  it will happen again.

  `tone-playback.test.ts` stubs `AudioContext` so the audio GRAPH can be
  asserted — nothing here runs a browser, so "does it sound right" is
  unanswerable, but "are the right calls made in the right order" is. The stub
  was `{ AudioContext: function () { return context; } }`. It passed.

  Then `biome check --write` ran and rewrote it to `() => context`. **`new` on
  an arrow function throws**, `playChatTone` swallows every exception by design,
  and all seven assertions started seeing zero oscillators — while the file
  still looked correct. The failure was caught only because the full suite ran
  after the autofix.

  ⚠ The lesson is not "distrust the formatter". It is that **a test whose
  subject swallows exceptions can be disabled without failing**, and the
  swallowing is deliberate and correct here. The fake is now a `class`, which is
  a real constructor Biome will not rewrite, with the reason written above it
  and a targeted `biome-ignore` for `noConstructorReturn` — returning the shared
  context IS the fake, and copying its fields onto `this` would detach `state`,
  which `resume()` mutates and the suspended-context test depends on.

- **2026-09-13** — **A sub-page with no way out, and the reason a private
  helper is not a convention.**

  Found by the operator using it: `/chat/preferences` had **no way back to
  chat**. Reported as "it's hard to go back", which is the accurate description
  — the drawer still had a Chat entry, so it was possible and unobvious.

  **⚠ THE CAUSE IS THE INTERESTING PART.** The back link lived in a PRIVATE
  `Frame` inside `chat-settings-page.tsx`. `/chat/preferences` was written as a
  new file and simply did not have one — **you cannot forget a component you
  never knew existed.** Nothing was skipped and no rule was broken; there was
  no rule, only a habit that happened to live in one file.

  So the frame became `ChatSubPage`, shared, with the link INSIDE it rather
  than passed to it, and `chat-sub-pages.test.ts` fails if any file under
  `pages/` other than the chat page itself does not render it. ⚠ A convention
  that lives in one file is a habit, and a habit is exactly what a new file
  does not inherit.

  **The audit the operator asked for, since one gap implies others.** Every
  other sub-page in the product already had a way back: `module-permissions`
  has `AdminPage`'s `backTo` with a `BackLink` that names its destination, and
  `module-auth`'s admin and settings shells carry their own. The pages showing
  no back link are all TOP-LEVEL drawer entries, which correctly have none, or
  are components rather than pages. **`/chat/preferences` was the only one**,
  and it was the newest thing in the repo — which is the shape this kind of
  defect takes.

  ⚠ **`backHref` was deleted rather than kept.** It was a prop defaulting to
  `/chat` that nobody ever passed anything else to — a configurable answer to a
  question with one answer, and it did not save the page that omitted the frame
  entirely. `ChatSubPage` owns the link and reads `CHAT_HREF`, so the route and
  the link to it cannot drift.

  **"← Back to chat", never "← Back."** A bare Back names the direction and not
  the destination, which is the wrong half for somebody who has forgotten how
  they arrived. `module-permissions`' `BackLink` already carried that argument
  in a comment; this is the second module to reach it.

  ⚠ **The browser's Back button is not an answer**, and neither is the drawer.
  Back works when the page was reached by a link and does not when it was
  reached from a URL or an email; the drawer collapses and is hidden entirely
  at narrow widths. A screen whose only exit is chrome traps whoever arrives
  another way.

- **2026-09-13** — **§12.50 and §12.51 closed: people are told with the tab
  shut, and an invitation is no longer a coin flip.**

  Both were operator decisions rather than defaults, and both were asked rather
  than assumed. Email over Web Push; sender only, no message text; the first
  message shown to an invitee.

  ## §12.50 — being told with the tab closed

  **⚠ `sendChatNotification` was described in this document as "the optional
  hook already in the design". It did not exist.** The third thing in this repo
  found to be documented and unbuilt, after the grouped unread query and the
  Redis swap. Written down because the pattern is now a pattern: a plan that
  describes a seam in the present tense is a plan somebody will believe.

  **THREE PIECES, and the split is the point.** `shouldNotify` is a pure rule in
  the DOMAIN — seven refusals, testable with no mail server. `ChatNotifier` is a
  port in the module. `ChatMailNotifier` is in the APP, the only layer that
  knows what an email address is. The same seam `module-auth` sits on, where the
  module hands over a raw reset token and `reset-mail.ts` owns delivery.

  ⚠ **Which is what keeps Web Push cheap rather than closed.** The port carries
  ids and a group flag; a push implementation replaces one provider in the app
  and changes nothing in the module. The expensive half — deciding who is owed a
  nudge — is already built and transport-blind.

  **⚠ NO MESSAGE TEXT, decided deliberately.** The email says who wrote, whether
  it was a group, and links to `/chat`. An inbox is a copy of the conversation
  outside anything `canAccessConversation` can reach: in a mail provider's logs,
  on a lock screen, and outliving the account. The port does not CARRY the body
  rather than carrying-and-not-using it, so a future template cannot quietly
  start including it — that would take a change in three files.
  ⚠ Not the group TITLE either. A group's name is content its members chose and
  travels exactly as a message body would.

  **⚠ THE SEVEN REFUSALS**, each an email somebody would otherwise have received
  and been annoyed by — which is the failure mode that gets a notification
  system switched off entirely, after which nobody is told anything. Your own
  message; a system message; not an active participant; **online**, because they
  hold a socket so the badge moved and the tone played; **`dnd`**; **muted**;
  and **inside the cooldown**.

  **⚠ `dnd` NOW SUPPRESSES DELIVERY**, which is the question §12.44 said would
  arrive with the first notification system. It has. And `mutedUntil` became
  load-bearing exactly as §12.50 predicted — it was a convenience while the only
  thing it could suppress was a tone in an open tab.

  **⚠ THE COOLDOWN IS A COLUMN, not a map.** `ChatParticipant.lastNotifiedAt`,
  fifteen minutes, per person per conversation. In memory it would re-notify
  everybody after a restart and keep a separate idea per replica — one mail per
  replica. ⚠ **Stamped BEFORE sending, not after:** a slow or retrying transport
  is exactly when the bound matters, and stamping after would let a second
  message read a stale mark. The cost is that a notification which then fails
  still consumes the window — one missed nudge against an unbounded flood, which
  is not a close call.
  ⚠ **Not a digest.** A digest needs a scheduler and there is none (§12.40);
  promising one would be promising something nothing keeps. A cooldown is read
  at the moment a message arrives, which is the only moment anything here runs.

  **⚠ Presence being UNBOUND must not read as "everybody is online"** — that
  would silence every notification in a host with no ephemeral tier, which looks
  exactly like the feature not working. Unbound means nobody holds a socket, so
  everybody is reachable: the safe direction.

  **⚠ IT CANNOT BREAK A SEND.** The message is committed and already on every
  open socket by the time this runs. The whole body is inside one try/catch that
  swallows, the app adapter swallows again, and a test asserts the send succeeds
  with a notifier that throws. Awaited rather than floated — a floating promise
  is an unhandled rejection in Node — which costs nothing because it cannot
  reject.

  ## §12.51 — the first message, and nothing else

  **⚠ `canAccessConversation` WAS NOT WIDENED.** It stays ACTIVE ONLY. The
  preview is a separate, narrow read with its own name, so anybody auditing
  "who can see message content" finds two call sites rather than one helper that
  quietly means two things. That helper is what C1 was missing and it is not
  being loosened to make a screen nicer.

  **The FIRST `kind: user` message, never the latest.** The latest would turn an
  unanswered invitation into a live feed of a conversation the viewer never
  joined. A system message is from nobody and tells an invitee nothing.

  **⚠ THE BLOCKED-SENDER REQUIREMENT, which this entry stated in advance**, is
  met by `previewsForInvitations` containing NO BLOCK CHECK AT ALL. A preview
  absent for a blocked inviter and present otherwise would answer "has this
  person blocked you" to anybody who could get themselves invited — the exact
  oracle the blocking design refuses everywhere else. A test asserts the two
  cases are byte-identical, and it is what fails if somebody adds a check.

  **⚠ A query per invitation, which is the shape the unread work just removed.**
  The difference is what N counts: there it was every conversation a person is
  in, growing without bound, each a COUNT over a whole conversation. Here it is
  their UNANSWERED INVITATIONS — a small set somebody else creates one at a
  time — each a `take: 1` down an index. Capped at twenty anyway, because
  "somebody else creates them one at a time" is an assumption about behaviour
  rather than a bound.

  A DELETED first message resolves and the UI drops it, rather than falling
  through to the second: the tombstone holds its place in the ordering, and the
  invitation is about the first message. The thread renders a removed message as
  a placeholder because its reader can ask what it was; somebody holding an
  unanswered invitation cannot.

  **Verified:** 1 478 tests, typecheck and lint green; the migration is one
  additive nullable column; `schema.graphql` regenerated by booting rather than
  hand-edited. ⚠ **No email was actually sent** — there is no SMTP server on
  this machine, so the template renders and the transport call is typed and
  unexercised. The module-operations test caught the stale schema, and the
  structural Prisma client caught the stale generated types, both before I did.

- **2026-09-13** — **STEP 9, the rest: the tone, and settings deliberately not
  on the server.**

  **⚠ SYNTHESISED, NOT FETCHED — a departure from the plan, recorded as one.**
  §9 said "three to five short self-hosted files, mp3 (Safari does not take
  ogg), mono, tiny". No audio file ships. The tones are an oscillator and a
  couple of notes each. Three reasons, in order: **a file has to arrive before
  it can play**, so the first message after a load races the download and the
  fix is preloading four files on every page so one might be used; the repo has
  no binary assets and `apps/web-app` has no `public/`, so this would add an
  asset pipeline — and a second one for any app adopting the module — to ship
  four blips; and a two-note blip is exactly describable in code, where four
  opaque binaries are not.
  ⚠ What it gives up, plainly: a designer cannot replace a sound without writing
  code, and nothing richer than a blip is available this way. The seam is one
  function wide if that changes — `play` takes a URL and the catalogue grows a
  `src`. (There is also no encoder on this machine, which is a reason to notice
  the question, not the reason for the answer.)
  ⚠ It does NOT dodge the autoplay problem: an `AudioContext` is created
  `suspended` in exactly the browsers that block `play()`.

  **⚠ THE PREVIEW BUTTON IS THE UNLOCK, exactly as the plan said.** A tone
  played into a context that was never unlocked is dropped SILENTLY — no error,
  nothing in the console worth reading, just a chat that never makes a sound and
  somebody concluding the setting is broken. Every control on the preferences
  page calls `unlockChatTones()`, from the event handler and never an effect: in
  an effect it runs outside the gesture and the browser refuses again. ⚠ And
  Play stays LIVE when sound is switched off — auditioning is how somebody
  decides whether to turn it on, and disabling it would mean the only way to
  unlock audio is to first enable a sound you have never heard.

  **The rule is a pure function in the DOMAIN**, not four conditions in a socket
  handler. `shouldPlayTone` refuses for: the setting being off, your own
  message, a system message, `dnd`, and the conversation being open AND the
  window focused. ⚠ Both halves of that last one are required — an open thread
  in a BACKGROUND tab must still sound, because you are not looking at it, which
  is exactly when being told matters. ⚠ `dnd` is checked PER ARRIVAL rather
  than by hiding the setting, because availability changes while the setting
  stays put.

  **⚠ Two stale-closure hazards, both real.** The subscription is built once and
  captures what it sees. Read from state, somebody who set themselves to `dnd`
  would keep hearing tones until the socket happened to be rebuilt — reported as
  "do not disturb does not work" and unreproducible for whoever picks it up. So
  availability and the viewer's id go through refs, as `selectedRef` already
  did. ⚠ The settings are read from localStorage PER ARRIVAL rather than held
  in state: muting in one tab means muted, not "muted in that tab".

  **⚠ The tone is decided for EVERY conversation, not the open one.** It sits
  outside the `selectedRef` check, which exists only to decide whether the
  thread on screen redraws. A message in a thread you are not looking at is
  precisely the one you need to hear about.

  **`localStorage`, one key, `{ enabled, tone }`.** The honest scope of "mute
  chat" is this machine. ⚠ The two values are kept APART rather than collapsed
  into a tone called "off", so muting and unmuting returns the sound you chose —
  a single field cannot remember that. ⚠ Every read validates: storage that
  THROWS (Safari private mode, blocked site data), absent, unparseable,
  parseable but wrong-shaped, and a tone id this build no longer ships. All five
  resolve to the default, because all five otherwise land at the moment a
  message arrives. ⚠ Sound is OFF by default: chat is one page inside a
  back-office application, and a tab that starts making noise because somebody
  navigated to the product is a setting people hunt for angrily rather than
  discover.

  **⚠ `/chat/preferences`, NOT `/chat/settings`.**
  `/chat/:conversationId/settings` already exists and means something else —
  what a group is called and who runs it. Two pages a segment apart, both called
  settings, one about a conversation and one about a browser, is a collision
  people resolve by opening the wrong one. A test asserts the static path cannot
  become ambiguous with the dynamic one (different lengths), which is what would
  break the day somebody adds `/chat/:id`.

  `CHAT_HREF` moved to its own `routes.ts`: the chat page needed it to link to
  preferences, and `module.tsx` imports the page, so that would have been a
  cycle — across a `'use client'` boundary, where the module is a
  client-reference proxy and initialisation order stops being something to
  reason about. Re-exported, so the public surface is unchanged.

  ⚠ **`shouldPlayTone` and the settings have tests; the PLAYER does not.**
  Nothing here runs a browser, so the oscillator graph, the fade envelope that
  stops the click at each end, and the suspended-context path are typed and
  reasoned about rather than exercised. The catalogue IS asserted — three to
  five tones, unique ids, every one under a third of a second — because that
  much is data rather than audio.

- **2026-09-13** — **STEP 10: Redis is a CONFIGURATION, not a migration — and
  that is the operator's call, not the plan's.**

  §12.28 had this as "three steps, one file": install the driver, return a
  `RedisPubSub` in `createEngine`, delete a branch. The operator asked for
  something better — *"can we make it not a one file swap but just an optional
  configuration? so that if ever we have redis user just need to configure redis
  and automatically it will be set to be used"* — and they are right.

  **Scaling out is an OPERATIONAL act, usually urgent.** It should not need a
  developer, a pull request and a release to complete. The person who
  provisions a Redis is the person who needed it, and they need it now. So the
  driver ships installed and **`REDIS_URL` alone decides**: set it and the
  process publishes and subscribes through Redis, leave it unset and it runs in
  memory. No rebuild, no second flag, no code change.

  It also deletes the only genuinely perverse state the old design had: a
  deployment carrying a `REDIS_URL` that nothing read FAILED THE BOOT. Loud,
  yes — and still an outage caused by configuring the thing correctly.

  ⚠ **The one refusal left is the one worth keeping.** `REALTIME_REPLICAS > 1`
  with no `REDIS_URL` still fails the boot, because that is the silent failure
  this whole file exists for: an event published on replica A never reaches a
  socket held by replica B, with nothing logged, and subscriptions look
  connected while delivering to a fraction of users. With Redis configured the
  replica count is not consulted at all — the distributed engine serves one
  replica perfectly well, and refusing a single-replica deployment that happens
  to have a Redis would punish the operator who configured it BEFORE scaling,
  which is the order everybody should do it in.

  **⚠ TWO CONNECTIONS, not one.** A Redis connection in subscriber mode accepts
  no other commands, so publishing down the same socket fails — `RedisPubSub`
  takes a separate `publisher` and `subscriber` for exactly that reason, and
  handing it one client twice is a bug that appears only on the first publish
  after the first subscribe.

  **⚠ `maxRetriesPerRequest: null`, not the default of 20.** That default fails
  a command once the connection has been down for twenty retries — sensible for
  a request with somebody waiting on it, wrong for a subscriber whose whole job
  is to still be there when the network comes back. A chat that stops delivering
  after a blip and never resumes is the failure the engine exists to prevent.

  **⚠ AN `error` LISTENER IS NOT OPTIONAL.** ioredis is an EventEmitter, and an
  emitter that emits `error` with nothing listening THROWS — so a briefly
  unreachable Redis would take the process down instead of reconnecting.

  **⚠ TWO COPIES OF `ioredis`, caught by the compiler, exactly as the catalog
  comment predicted.** `pnpm add ioredis` resolved 6.0.0 while
  `graphql-redis-subscriptions` depends on 5.x, and `tsc` refused the client:
  two `RedisOptions` from two installs are not the same type. Pinned to `^5`,
  and `pnpm why ioredis` now reports one version. This is the third time in this
  repo that a second copy of a package was a bug rather than a duplicate.
  (Also: the NAMED `Redis` export, not the default — ioredis is CJS and under
  NodeNext its default import is the module namespace, which is neither
  constructable nor usable as a type. And the options object is written inline
  rather than annotated `RedisOptions`, because `exactOptionalPropertyTypes`
  refuses the annotated one.)

  **VERIFIED BY RUNNING IT, both ways.** With `REDIS_URL` pointed at a port
  with nothing on it: the boot log says `pub/sub engine: redis`, both
  connections are opened, the error listener logs `ECONNREFUSED` instead of the
  process dying, and **the API still starts and serves**. With it unset:
  `pub/sub engine: memory`, no Redis client constructed. ⚠ What is NOT verified
  is delivery through a real Redis — there is none on this machine — so
  cross-replica publish/subscribe is typed, wired and unexercised.

  ⚠ **And that last point corrected a comment I had just written.** The first
  draft said a process that cannot reach its backend "should be visibly down
  rather than invisibly delivering to a fraction of its users" — which is not
  what it does. It starts and retries, and that is the right behaviour: failing
  the boot would mean a Redis blip during a deploy takes down every REST and
  GraphQL path in the product, none of which needs pub/sub. Degrading one
  feature beats losing all of them. The comment now says what actually happens,
  which is the same lesson as the entry above it.

  **`packages/module-chat/README.md` now exists**, which it did not — the only
  package without one. It documents the ports and what each one's ABSENCE
  means, the realtime decision above, participation-is-not-permission, the four
  registries it declares, and the unread rule.

- **2026-09-13** — **STEP 9, the server half: the grouped unread query, which
  two comments already claimed existed.**

  `listConversations` said "ONE GROUPED PASS — three queries total, whatever
  the number of conversations", and `chat-unread-badge.tsx` told the reader
  "the server already computes unread per conversation in one grouped pass, so
  the whole badge is one query rather than arithmetic that can drift". Neither
  was true. `unreadCount` ran a `findUnique` for the mark and a `count` for the
  tail, PER CONVERSATION, so the real cost was `3 + 2n` — forty round trips for
  somebody in twenty conversations.

  ⚠ **And it is the hottest path in the product**, which is what makes it worth
  its own commit rather than a line in step 9. The badge re-reads on EVERY event
  the socket delivers, coalesced but not counted locally on purpose, so the
  quadratic read runs again every time anybody sends this person a message — in
  every open tab.

  **What makes it groupable:** the three exclusions (`kind: 'user'`, no
  tombstone, not your own) are the same for every conversation; only the
  CUT-OFF differs, because each is counted from that viewer's own mark. So the
  marks are read in one `findMany` by id, the per-conversation boundaries become
  one `OR` of clauses, and the database groups. **Five queries now, for one
  conversation or two hundred** — and the comment says five rather than three,
  because a comment that rounds in its own favour is how this started.

  ⚠ **The keyset pair survived the rewrite, and it is the whole correctness of
  the badge.** `id: { gt }` alone would rely on ids sorting the way time does,
  and cuid only roughly does. A clause is `conversationId` AND (later timestamp
  OR same timestamp with a greater id) — the order the thread is paged in.

  ⚠ **The fake's `count` ignored the keyset clause entirely**, which is the
  same criticism its own `findMany` carries in a comment: a fake that cannot
  fail the way the database can. So the boundary could have been wrong in either
  direction with every test passing. `groupBy` in the fake honours the pair, and
  a test now forces a timestamp COLLISION — two messages at the same instant,
  which the database produces on its own inside a burst — and asserts the id
  breaks the tie.

  **`conversationFor` calls the same function with a single row.** A second
  implementation for the single case is how a detail view and the list beside it
  come to disagree about one number, and the rule it would restate — three
  exclusions and a keyset boundary — is exactly the kind that gets restated
  slightly wrong.

  ⚠ **An INVITED row is dropped inside the counter, not by its callers.** An
  invitation shows who sent it and not one word of what was said (§12.51), so
  counting its messages would put a number on a thread the viewer is refused.
  Doing it in one place means a third caller cannot forget.

  ⚠ **A mark that no longer resolves counts EVERYTHING.** An unknown boundary
  has to fail towards "there is something to read"; the other direction hides a
  message behind a badge saying nothing is waiting. That was the old behaviour
  too, and it is now asserted rather than incidental.

  **Eight tests, and the one that matters is the cost.** Every other assertion
  here passes just as well against the quadratic version — it returns the right
  numbers, it is simply slow, and nothing about the output says so. So a
  counting proxy wraps the client and asserts that six conversations cost the
  same five queries as two. That is the regression that is otherwise invisible
  in review.

- **2026-09-12** — **THE THIRD DECLARATION: a module can now say what happens
  when nobody said, and the screen stopped owning the list of moments.**

  Chat arrived with two default-shaped decisions — the role a group's CREATOR
  gets, the role somebody ADDED gets, exactly the pair `workspace.*` already had
  — and could declare neither. `APP_DEFAULT_REGISTRY` was a const inside
  `module-permissions`, so chat's two options were to hardcode them (offering
  the operator nothing) or to have the permissions module import chat, which §9
  forbids. The same place `LIMIT_REGISTRY` was in before step 1.

  **`DefaultContribution` in `module-kit`, and `composeDefaults` beside
  `composeFeatures` and `composeLimits`.** Three declarations now, answering
  three questions: may this be done, how many may exist, and what happens when
  nobody said. All three shapes live in `module-kit` for one reason — every
  module declares them and exactly one module answers them, and the answerer may
  not import its contributors. Duplicate keys throw, as they do for the other
  two: two modules defining `chat.creator_role` differently is an ambiguity no
  consumer can resolve, and the one that would resolve it silently is a screen
  somebody makes a decision on.

  **⚠ `AppDefaultSpec` had to be WIDENED, not extended.** `key` was the closed
  `AppDefaultKey` union and `moment` the closed `AppDefaultMoment` — both are
  plain strings now, because a contributed key is by definition not a member of
  a union in a package the contributor may not import, and because the
  permissions module cannot know that conversations get created. Both unions
  survive as the vocabulary for this module's own nine, where they still catch a
  typo. `module` became REQUIRED on the way through: the nine did not need it
  while the registry was closed — everything in it was permissions' by
  construction — and a default with no attribution is one nobody can trace back
  to the feature it belongs to.

  **⚠ A new `kind`, because a contributed default may point at nothing this
  module stores.** Every kind that shipped — `app_role`, `plan`,
  `subscription_status`, `days` — names either a row the screen can list or a
  shape it can check. Chat's two name one of three participant roles, which are
  an enum in *chat's* schema and not rows anybody can enumerate. So `choice`
  carries its own `choices` from the declaration, the screen renders those, and
  `isValidDefaultFor(spec, value)` validates against them. The old
  `isValidAppDefaultValue(kind, value)` could not: a choice's valid values are a
  property of the DECLARATION, not of its kind, so it fell through to "anything
  non-empty" and would have accepted a role name that does not exist — the exact
  failure a picker prevents and an API caller does not have. ⚠ A `choice` with
  no choices accepts NOTHING, deliberately: a declaration that forgot them is a
  default nobody can set, which is visible, where the alternative accepts
  anything, which is not.

  **⚠ BOTH HALVES READ THE COMPOSED REGISTRY, and that is not a detail.**
  `listDefaults` resolves it to build the screen; `setDefault` looks a key up in
  it to validate a write. A service left on its own nine while the app composed
  eleven would show a control for chat's default and then refuse to save it with
  "that is not a default this build has" — a screen arguing with itself. So
  `defaultRegistry` sits on the module options next to `limitRegistry`, the app
  composes it in `seed/registry.ts` beside the other two, and `ALL_DEFAULTS` is
  CHECKED rather than cast on the way through, exactly as `toFeatureSpec` is.

  **⚠ THE FIFTH PART, WHICH THE PLAN DID NOT NAME — the screen grouped by
  MOMENT and owned the list of moments.** §12.54 said four parts. A fifth was
  found by reading the page rather than the plan: `defaults-page.tsx` held a
  `MOMENTS` const of six headings and filtered the defaults into them, so a
  default whose moment was not among them had no section and therefore never
  rendered. Chat's two would have been declared, composed, validated, settable
  through the API — and invisible on the only screen anybody sets them from.
  That is the *same* silence `DefaultContribution` exists to end, one level up,
  and it would have looked like the feature working.

  So the headings became a contribution too. `DefaultMomentContribution` +
  `composeDefaultMoments` mirror `NavGroupContribution` + `composeNavGroups`,
  because a moment is the same kind of thing as a nav group: a shared namespace
  two modules may both have entries at, so the lowest order wins rather than a
  duplicate throwing, and disagreeing about the title is a wording problem
  rather than a boot failure. `listDefaults` now sends `momentTitle`,
  `momentBlurb` and `momentOrder` with each row and sorts by them, and the page
  builds its sections from the rows — the UI holds no second opinion about
  ordering. ⚠ **An undeclared moment renders an UNNAMED section, not nothing**:
  a module that declared a default and forgot the heading gets a section titled
  with the raw moment key, which an operator can act on. The failure that is
  visible instead of the one that is not.
  (`momentOrder` is a GraphQL `Float`, not an `Int`: an undeclared moment's
  order is `Number.MAX_SAFE_INTEGER`, which does not fit a signed 32-bit `Int` —
  it would have been a serialization error on the one row the field exists to
  keep visible.)

  **⚠ `readDefault`, because `listDefaults` is a SCREEN's answer.** The port was
  first wired to `listDefaults`, which reads every row, then both target tables,
  then resolves a label, an icon and an availability flag per default — three
  queries to describe a page. `startGroup` consults two keys, so creating one
  group ran that twice and threw away all but two strings. `readDefault(key)` is
  one row. It is deliberately UNGUARDED — there is no actor; the caller is chat
  creating a group, already inside a write the actor was permitted to make, and
  `perm_default` holds an operator's choices rather than anybody's data — and
  deliberately UNVALIDATED, because the module that declared the default is the
  one that knows what its values mean. The defaults screen's own read stays
  behind `defaults:manage`.

  **⚠ Chat VALIDATES what comes back, and falls back rather than failing.** The
  value is a string in another module's table: a role renamed out of existence,
  a typo, a key set before chat declared its choices. An unrecognised one falls
  back to the built-in answer, because a participant row carrying a role the
  enum does not have is a row every rule reads as `member` anyway, with no error
  to explain why. A read that THROWS falls back too and the group is still
  created — a default is a convenience and must never become a gate, which is
  the same reading `defaultRoleId` already made on the resolving side. Both
  reads happen BEFORE the transaction opens: holding one open across a call into
  another module's service is how one slow read becomes a lock somebody else is
  waiting on.

  **⚠ `owner` is not among the choices for the ADDED role, and the write path
  agrees.** `transferOwnership` is what mints an owner, in one act that demotes
  the previous one; an arrival silently becoming owner would take the group from
  whoever built it on the next invitation. The picker refusing it is the screen
  agreeing with the rule rather than the rule's only enforcement.
  The creator role is the opposite case: setting it to anything but Owner leaves
  a group with NO owner, because nothing else mints one — and that is the
  operator's decision to make, so the description says so in capitals and the
  write path applies it. Refusing it would make a configured platform unable to
  create a group at all.

  **⚠ Somebody coming BACK keeps the role they had.** `reviveParticipant` takes
  the default role as an argument that applies to a NEW row only: a
  re-invitation is not a demotion, and an admin removed by mistake and added
  again must not quietly return as whatever the default says today.

  Two implementations moved out of `app.module.ts` into `src/chat/` —
  `ChatPlatformAdmin` and `ChatDefaults`. That file composes modules; twenty
  lines of permission logic inside a descriptor is how a composition file stops
  being one, and `ChatUserDirectory` had already set the precedent.

  Also wired: `CHAT_DEFAULTS` is bound in `ChatModule.forRoot` — the token, the
  service's injection and the option existed with nothing connecting them, so
  every read would have returned undefined and the setting would have had no
  effect whatever an operator chose. Bound to `undefined` when the host says
  nothing, like every other optional token there, so "nobody answered" is a
  stated configuration rather than a property of the container.

  Cost paid: `pnpm typecheck`, `lint` and all 1 424 tests green, and
  `schema.graphql` regenerated by booting the server rather than hand-edited —
  the generated file came back byte-identical to the edit, which is the only way
  to know a hand-edit was right.

- **2026-09-12** — **Chat is granted to `normal-user`, and the control case it
  was is recorded as lost.**

  The operator asked for ordinary people to be able to use chat. The keys come
  from `module-chat`'s OWN `chat-user` preset rather than being restated here:
  the module ships the shape and seeds nothing — adopting chat grants nobody
  anything until a host says who may use it — and `app-roles.ts` is that host
  saying so. ⚠ Read from the preset rather than copied, so the day chat adds a
  key ordinary use needs, the role gets it without anybody remembering to come
  back; and it THROWS if the preset is ever gone, because a `find` returning
  undefined would seed a role granting nothing and the symptom would be every
  chat surface refusing everybody with no error anywhere.

  **⚠ `chat:moderate` AND `chat:remove_participant` ARE NOT AMONG THEM**, and
  the split is the point. Taking somebody out of a conversation and deleting
  what they said are powers over OTHER PEOPLE — exactly the kind of thing this
  role is defined by not having. They live in the `chat-moderator` preset, which
  no seeded role adopts.

  **⚠ WHAT THIS COSTS, written down rather than discovered later.**
  `normal-user` held nothing on purpose. Its comment said in capitals that it
  must stay empty, because a role that grants nothing is the only one that
  proves a denial is real rather than incidental — the control case for the
  route guard, the page gate, the component gate and the API guard at once.

  That rule was right for a registry in which every key was a right over the
  ADMIN APP. `chat:*` is the first vocabulary here that is not. So the rule is
  narrowed rather than abandoned: the role still holds no `admin:*`, no
  `roles:*`, no `members:*` and nothing at organization or workspace level, so
  it still proves ADMIN denials — and a genuinely empty app-level role no longer
  exists. §12.53 records that, and names `restricted-user` as the replacement
  the file has always anticipated. ⚠ It has NOT been created: inventing a role
  nobody asked for is the other way to get this wrong, and an operator's role
  catalogue is theirs.

  **Applied, not merely written:** `db:sync` ran, and `normal-user` now carries
  eight keys — the three `account:*` and the five `chat:*`. Verified by reading
  `perm_role_feature` back out of the database rather than trusting the seeder's
  own count.

- **2026-09-12** — **TWO BUGS FOUND BY ACTUALLY USING IT, which is the step no
  amount of asserting replaces.**

  ## ⚠ THE SENDER SAW THEIR OWN MESSAGE TWICE

  Two faults compounding, and the second is the one worth remembering.

  **Fault one: the published event carried no `clientMessageId`.** It was left
  off `ChatMessageType` on the grounds that it is the sender's own idea rather
  than the server's — true, and the wrong conclusion. The sender draws their
  message optimistically and reconciles the real one against that draft BY THAT
  VALUE, so an event without it cannot be matched and is appended beside the
  draft. Publishing it discloses nothing: a random value the sender minted,
  reaching the people who are receiving the message anyway.

  **Fault two: `applyMessage` could leave two rows with one id.** It mapped over
  the thread replacing matches and appended when nothing matched — so once the
  unmatched event had been appended, the mutation's response replaced BOTH the
  appended row and the draft with itself. Two identical rows, and a sort cannot
  collapse a duplicate. It now filters every earlier copy out and inserts one,
  which makes the invariant structural: an id appears once because everything
  else with that id is gone before the new one is added.

  ⚠ **IT ONLY HAPPENED WHEN THE SOCKET BEAT THE MUTATION**, which a real network
  produces routinely — the event is published the instant the transaction
  commits, often before the response has finished travelling back — and which
  one tab on a fast loopback almost never does. The test that reproduces it
  interleaves the two arrivals in that order; reverting either fix fails it.

  ## ⚠ IT LOOKED LIKE A FLOATING MODAL THAT NEVER OPENED

  The whole screen was one `rounded-lg border bg-card` block with no heading
  above it. In a shell whose own header is `bg-card`, that reads as a raised
  panel dropped onto the page rather than as the page.

  It now opens the way every other screen does — an `h1` at `text-2xl
  font-semibold tracking-tight`, a description under it, a body filling the rest
  — and the refusal banner uses the same shape as every other refusal in the
  app. ⚠ That is `AdminPage`'s 'fill' layout and deliberately NOT an import of
  it: `AdminPage` belongs to `module-permissions` and a module may not import a
  module (§9). It is the arrangement `module-auth`'s `SettingsPage` already
  has — three frames of one shape, each owned by the module rendering inside it.

  The two-pane region keeps its border and loses `bg-card`. The border is
  structure: the list and the thread are different things and the seam between
  them has to be visible. The fill was what made it float.

  **The lesson worth keeping:** everything this module ships was asserted —
  rules, audiences, documents validated against the live schema — and both of
  these were invisible to all of it. One needed two clients racing, the other
  needed eyes. ⚠ A screen nobody has opened is not a verified screen, however
  green the suite is.

- **2026-09-11** — **STEP 8, the UI: the dot, the picker and the indicator.**

  **⚠ NOTHING IS DRAWN FOR SOMEBODY THE SERVER DECLINED TO ANSWER ABOUT, and
  that is not the same as drawing "offline".** An absent entry means they are
  not somebody this viewer shares an active conversation with — a grey dot would
  assert they are away, which the server never said. A missing dot asserts
  nothing. It is also how an INVISIBLE person appears, and nothing on the client
  can tell the two apart, which is the point: the decision was made at the
  publish boundary and there is nothing left here to leak.

  **⚠ A DOT ON A DIRECT CHAT ROW, AND ONE PER NAME IN A GROUP HEADER.** "Who is
  online" in a group of nine is a row of dots on a list row that says nothing
  and takes the space the name needs. In the header each dot is attached to the
  person it describes, which is where the question is actually asked.

  **THE TYPING LINE SITS ABOVE THE COMPOSER AND OUTSIDE THE SCROLLING LIST.**
  Inside the thread it would push the newest message out of view as it appeared
  and disappeared, every few seconds, while somebody was trying to read. It
  occupies no height when nobody is writing — a permanently reserved line is a
  permanent gap — and three or more typists become a count rather than a
  paragraph of names nobody reads to the end of.

  **⚠ TYPING IS THROTTLED ON THE CLIENT AS WELL AS THE SERVER.** The composer
  calls on every keystroke. The server drops a repeat inside its own window, but
  only after a round trip, so the client holds the one timer that decides how
  often it is asked — and the component deliberately has no throttle of its own,
  because two would be two answers to one question. ⚠ The client's TTL and
  throttle mirror `DEFAULT_EPHEMERAL` and are both longer than the server's: the
  indicator must outlive the gap between pings or it flickers while somebody is
  still writing.

  **Three decisions in the picker**

  1. ⚠ **Nothing is drawn until the server has said what the current state is.**
     Rendering "Available" first and correcting it a moment later would tell
     somebody who chose to appear offline that they are visible.
  2. ⚠ **The duration is part of the same act.** "Busy" and "busy until 3pm" are
     one decision; a separate control would let somebody set a state they never
     meant to keep. And it is offered only once there is something to time —
     "available for 30 minutes" has nothing to revert to.
  3. **Two plain `<select>`s, not a styled dropdown.** A preference touched
     occasionally, keyboard- and screen-reader-correct for free, and on a phone
     it opens the OS picker.

  **A presence event is APPLIED, never re-queried.** The payload already went
  through the publish boundary, so there is nothing left to decide and a round
  trip would only make the dot late. A typing event is ⚠ explicitly NOT a reason
  to re-read the conversation list: typing changes nothing about a conversation,
  and re-reading on every keystroke-burst of every participant is the load the
  throttle exists to avoid. Somebody going offline clears whatever they were
  typing.

  **Verified:** `turbo run typecheck lint test build` green across 28 tasks. ⚠
  Still not seen on screen, and this is the step where that gap is widest — two
  browsers watching each other is the only real test of a dot, and it needs two
  signed-in sessions.

- **2026-09-11** — **STEP 8, the server: a socket's life now means something,
  and `graphql.options.ts` still names no module.**

  **⚠ THE SEAM IS CALLBACKS, NOT AN IMPORT.** `graphql.options.ts` opens with a
  promise — "nothing in this file names a module" — and presence is chat's. So
  it grew a `SocketLifecycle` of three optional hooks, and `app.module.ts`
  supplies them, because it is the layer that already knows what it composed.
  The same arrangement as `resolvePrincipal` and the user directory.

  **⚠ `onDisconnect`, NOT `onClose`.** It fires only for a connection that was
  ACKNOWLEDGED, which is exactly the set `onConnect` counted. `onClose` also
  fires for a refused handshake, and telling presence about a socket it never
  heard of would decrement a count nothing incremented.

  **⚠ A SOCKET NEEDED AN IDENTITY.** Presence is a refcount over sockets, so
  connect and disconnect have to name WHICH one — `WsConnectionContext` mints a
  `socketId` at the handshake and carries it on `extra`, which is also the only
  place the close hook can learn who was on it. The hook is handed `extra` and
  nothing else.

  **⚠ TWO THINGS THE BOOT FOUND, and both would have shipped silently**

  1. **`forRootAsync` resolves `inject` against the DYNAMIC MODULE'S OWN
     injector**, not the module registering it. `TokenService` resolved only
     because the auth module is global; `ChatPresenceService` failed at boot
     with "make sure the argument is available in the GraphQLModule module",
     which names the symptom. The fix is an explicit `imports` — and it must be
     the SAME dynamic module object `SERVER_MODULES` holds, so chat's descriptor
     is hoisted out of that array. A second `chatServerModule()` call there
     would have given the socket a presence store nothing else could read, and
     nothing would have reported it.
  2. **The structural client check caught the missing delegate.** Adding
     `chatAvailability` to the module's repository interface failed
     `module-clients.ts` to compile until the app bound it — which is exactly
     what `satisfies-modules.ts` and the `withTransaction` shape exist to do.

  **⚠ A CAST, DECLARED RATHER THAN HIDDEN.** Nest's `GraphQLWsSubscriptionsConfig`
  types a SUBSET of `graphql-ws`' `ServerOptions` and omits `onPing`, though it
  passes everything through to `useServer`. Without the heartbeat the presence
  TTL would expire a socket that is merely IDLE — showing somebody offline while
  they are connected and looking at the screen. So one property is cast, in a
  named function that says why, rather than the whole subscriptions block where
  it would hide a real mistake. The client pings on a 20s `keepAlive`, which is
  also what keeps a socket through a proxy that drops idle connections.

  The fallback if that ever breaks is bounded and worth stating:
  `closeWhenAuthorizationExpires` force-closes every socket when its token runs
  out and that DOES fire `onDisconnect`, so the worst staleness is one access
  token's lifetime. A minute and a half is a better answer than fifteen.

  **⚠ PRESENCE RESOLVES ONLY BETWEEN PEOPLE WHO SHARE AN ACTIVE CONVERSATION**,
  and the service filters — never the caller. A `chatPresence(userIds)` that
  answered for any id would undo what the directory is exact-email-only to
  avoid, and add surveillance of a named person by anybody who can guess an id.
  Ids that are not partners drop out SILENTLY rather than being refused, which
  tells a prober nothing either way.

  ⚠ **ACTIVE ON BOTH SIDES.** An invitation is not a relationship: somebody
  invited and not yet answered must not learn when the person who invited them
  is at their desk, which would turn an unanswered invitation into a tracking
  device.

  **Two more decisions**

  1. **Typing is a MUTATION, over HTTP.** It is the highest-frequency write in
     the product, and on the socket it would need rate limiting of its own —
     §12.29's open half. As a mutation it passes `ThrottlerGuard` like
     everything else. ⚠ And participation is re-asked in the resolver, because
     otherwise anybody holding `chat:send` could make an indicator appear in a
     thread they are not in.
  2. **Presence reads bind to `chat:read`, not a key of their own.** Who is here
     is only ever answered about people you already share a conversation with,
     which is the same question `chat:read` lets you ask by opening the thread. A
     separate key would suggest presence can be granted without chat, and there
     would be nobody it could resolve for.

  **The sweep interval is a FRACTION OF THE GRACE**, not a round number: offline
  is decided by time passing, so a tick longer than the grace would make the
  grace meaningless.

  **Verified:** the migration applied, the server boots with presence wired, the
  schema emitted `ChatPresence`, `ChatMyAvailability` and the four new
  operations, and all 17 client documents validate against it — the operations
  test now covers presence and typing too. ⚠ NOT verified end to end: two
  browsers watching each other needs two signed-in sessions.

- **2026-09-11** — **STEP 8, the rules first: the ephemeral tier, argued with
  before anything drives it.**

  The same shape step 3 took, and for the same reason — every trap below is a
  function over a number, so it is settled in a test rather than watched for in
  production. ⚠ **NO MIGRATION YET.** `ChatAvailability` is a fragment, not a
  table: the schema being written and the schema being APPLIED are different
  acts, and doing the second early leaves a database nobody has used.

  **⚠ PRESENCE AND AVAILABILITY ARE TWO FEATURES, kept apart by their STORES.**
  Presence is OBSERVED — derived from a socket, ephemeral, and it must not
  survive a restart, because a row reading `online` after the process died is a
  lie that persists. Availability is DECLARED: chosen by a person, durable until
  they change it. So presence is memory and availability is the one table, and
  no function takes both without saying which is which.

  **The three traps every hand-rolled presence system hits, each with a test**

  1. ⚠ **A REFCOUNT, NOT A BOOLEAN.** One person is several sockets, and closing
     one tab must not take them offline — the direction nobody notices while
     testing alone. Five tabs opening is ONE "came online", because the fan-out
     is per conversation partner and five would be five redraws on everybody
     else's screen.
  2. ⚠ **THE SOCKET CLOSES EVERY TIME A TOKEN TURNS OVER, BY DESIGN.**
     `closeWhenAuthorizationExpires` drops it on a timer nobody controls, so
     immediate-offline means every user in the system visibly flickers offline
     and back, forever. A grace period covers the reconnect, and a reconnect
     inside it produces NO events at all — asserted, because "no event" is the
     kind of correctness nothing notices when it breaks.
  3. ⚠ **AN UNGRACEFUL DISCONNECT NEVER FIRES.** A closed laptop lid delivers no
     goodbye. So presence EXPIRES on a TTL refreshed by a heartbeat rather than
     trusting a farewell — and one dead socket does not take a live one with it.

  Offline is decided in exactly ONE place, `sweep`, which both ways of leaving
  end at — a grace that ran out and a socket that stopped answering — so there
  is one rule and one publish site rather than two that can disagree. It reports
  a departure once, not on every tick.

  **TYPING EXPIRES; IT IS NEVER STOPPED.** A "stopped typing" event is the one a
  tab closing mid-word never sends, and the indicator would stick forever —
  which is the single most common way this is built wrong. The client pings
  while writing continues and the signal runs out. Throttled server-side,
  because it is the highest-frequency write in the product, and ⚠ the
  indicator's TTL must outlast the throttle or it flickers between pings — which
  is a test rather than a comment. Going offline FORGETS everything somebody was
  typing: an indicator that outlives the person it describes is the same bug as
  a presence row that outlives the process.

  **⚠ AUTO-CLEAR IS DERIVED ON READ, NEVER WRITTEN.** "Clears in an hour" is a
  promise something has to keep, and there is no scheduler here (§12.40) — a
  written `expired` would have nothing to write it and the row would read `busy`
  for the rest of the year. `clearAt` is stored; the comparison happens on every
  read. The lesson invitation expiry already learned with `isAcceptable`.

  **⚠ `invisible` IS APPLIED AT THE PUBLISH BOUNDARY, and it had to be.** A
  client that receives "she is online, but do not show it" has been told — the
  information is in a payload anybody can read, and the promise is already
  broken. So an invisible person is rendered INDISTINGUISHABLE from an offline
  one, which is asserted as exactly that: `publishedPresence('invisible', true)`
  equals `publishedPresence('available', false)`. It suppresses TYPING too, or
  it leaks through the side door — typing being the louder signal, since it says
  not only that somebody is there but that they are writing to you.

  ⚠ **`dnd` IS NOT A CLAIM TO BE ABSENT.** It quietens what reaches you, so it
  does not suppress typing. Only `invisible` hides.

  **One thing found and fixed on the way:** the typing keys are joined by NUL so
  a conversation id ending the way a user id does cannot be matched by
  `forget()` — and the separator is written as an ESCAPE rather than a literal
  control character, because a real NUL byte in a source file is invisible in
  every editor and makes the file binary to `grep`. Both have tests.

  **Verified:** 32 new tests (18 presence and typing, 14 availability), and
  `turbo run typecheck lint test` green across 26 tasks.

- **2026-09-11** — **STEP 7: `/chat` works end to end — the list, the thread,
  the composer, the invitations and the requests.**

  **⚠ NO ANCHORED PANEL, and §12.52 is closed rather than deferred.** It was a
  shortcut hanging off a header icon that no longer exists, and building a
  shortcut before the place it shortcuts to is how the shortcut becomes the only
  home: permanently cramped, with no room for a conversation anybody actually
  reads. It can return the day something exists to anchor it to, against a page
  that already works.

  **THE RULES ARE PURE AND THE COMPONENTS ARE WIRING.** `view/message-view.ts`
  and `view/conversation-view.ts` hold every decision this screen makes, as
  functions over literals with no React in them — so 27 of the tests here argue
  with an object rather than a rendered tree. They live in `react/` rather than
  `domain/` because they are view rules and a Nest server has no use for them;
  what they are not is buried in a component.

  **⚠ THE HARD PART IS `applyMessage`, and it is four cases.** Three streams land
  in one thread — the page the reader scrolled, the socket's live events, and
  the reader's own optimistic sends — and every ordering mistake between them is
  a message in the wrong place, twice, or never:

  1. ⚠ It REPLACES the sender's own pending copy, matched on `clientMessageId`.
     Appending shows the message twice and ONLY to the person who sent it —
     which is the version of this bug that reaches production, because it never
     happens to anybody testing with one browser.
  2. ⚠ It REPLACES an existing id rather than appending. Catch-up on
     reconnection deliberately overlaps what the thread already holds, and an
     edit or a delete arrives as the same id with different contents.
  3. It INSERTS IN ORDER, because a replayed gap arrives oldest-first after the
     reader already has newer live messages.
  4. A delete is a REPLACEMENT, never a removal: the tombstone is a position,
     and dropping the row shifts everything under somebody who is reading.

  **⚠ AN ARRIVING MESSAGE IS APPLIED, NOT RE-FETCHED**, which is what the
  server's decision to carry a body on the wire was for. The conversation LIST
  is re-read on every event instead — unread counts, ordering and participation
  are the server's arithmetic, and recomputing them client-side would be a
  second implementation of rules that already exist. Coalesced at 250ms, so a
  busy conversation is not one query per message.

  **Decisions made while building it**

  1. ⚠ **Requests are their OWN section, not rows sorted in.** An invitation is a
     question addressed to you and you cannot read a word of it until you answer
     — a row sorted in among threads would behave differently from every row
     around it, and clicking it would say there is nothing there. Sorted OLDEST
     first, the opposite of the list beside it: a queue is worked from the top,
     and newest-first sinks the invitation somebody has ignored longest.
  2. ⚠ **The composer counts CODE POINTS**, from the domain's own
     `MAX_BODY_CODE_POINTS`. `.length` counts UTF-16 units, so a 4000-unit cap
     halves a message of 2000 emoji — and the counter appears only near the cap,
     because a character count on an empty box is furniture.
  3. ⚠ **Enter sends, Shift+Enter breaks — and `isComposing` is checked.** While
     an IME is open, Enter COMMITS a candidate word; sending there cuts a
     Japanese or Chinese sentence off mid-word, every time.
  4. **One pane for both kinds of conversation**, decided by how many people are
     in it rather than by a toggle: one is a direct chat, two or more is a group
     and needs a name. The same distinction the schema makes.
  5. **A PANE, not a modal.** Finding somebody is a small search that can miss
     and be retried, and at phone width a modal over a 400px screen IS the
     screen.
  6. **The scroll-to-bottom is keyed on the NEWEST MESSAGE ID**, not on every
     render, so loading older history does not yank the reader back down from
     the thread they just scrolled up through.
  7. **`myUserId` was added to `ChatConversation`.** Every message carries an
     `authorId` and nothing said which of them was yours. ⚠ Not a separate
     `chatViewer` query: that would be a new operation needing its own binding,
     and a round trip for one string every list already implies.

  **⚠ THE CHECK THAT MAKES THIS TRUSTWORTHY WITHOUT A BROWSER:
  `apps/web-server/test/module-operations.test.ts`.** A GraphQL document is the
  one part of a typed client that nothing typechecks — the compiler sees a
  template literal, the schema is emitted from decorators in another package,
  and between them a renamed field is a refusal at runtime found by whoever
  opens that screen first. So every document chat sends now lives in
  `src/operations.ts`, framework-free and exported from the package root, and
  the APP validates all thirteen against its own emitted `schema.graphql` with
  `graphql`'s own validator. Proven to have teeth: a one-character typo in
  `myUserId` fails three cases with "Cannot query field". Adding the next module
  is one line in that file.

  **Verified:** 178 tests in `module-chat` and 102 in `web-server`,
  `turbo run typecheck lint test build` green across 28 tasks, the schema
  re-emitted with `myUserId`, and `/chat` answering 307 to the sign-in page like
  every other composed route. ⚠ THE SCREEN HAS NOT BEEN SEEN: rendering it needs
  a signed-in session, so what is asserted is every rule it draws by, every
  document it sends, and the route that reaches it.

- **2026-09-11** — **REVERSED: no chat icon in the top nav. The unread count
  moves onto the drawer entry.**

  Chat is already in the side drawer, so a header icon was a SECOND DOOR to one
  place. Two controls for one destination is how somebody learns to wonder which
  one is the real one, and the drawer is where this application says where you
  can go. The header slot built hours earlier is gone — the mechanism as well as
  chat's use of it.

  ⚠ **THE MECHANISM WENT TOO, rather than being left in place for the
  notification bell that might want it.** `WebModuleDescriptor.headerSlots`,
  `composeHeaderSlots` and the app's `buildHeaderSlots` had exactly one
  contributor and now have none, and an unused extension point in a published
  contract is a claim to have thought through a case nobody has made yet — the
  same argument that refused an empty `ChatAttachment` table (§12.45). It is one
  `git revert` of `03c944e` away the day a bell actually needs it, with its tests
  attached.

  **THE BADGE SURVIVED, and is still a COMPONENT rather than a number.**
  `ModuleRoute.nav` gains `badge?: ComponentType`, carried through `composeNav`
  onto the entry as `Badge`. The reason it could not be a number has not
  changed: everything else on a nav entry is a string resolved once on the
  server, which is right for exactly as long as it takes somebody else to send a
  message — and a drawer saying nothing while a message waits is a drawer people
  stop believing. So the module contributes something that can subscribe, and
  the shell draws it without learning what it counts.

  **This is strictly less machinery than the header slot was**, which is the
  other reason to prefer it:

  - No second compose function, no second descriptor field, no duplicate-key
    rule. A badge is one optional property on a nav entry that already exists.
  - ⚠ ONE FILTER. The badge hangs off the entry, so it is filtered by the
    route's own `feature` — there is no second key to keep in step, and a badge
    that outlived its entry's filter would be a LIVE SUBSCRIPTION running for
    somebody the API refuses. Its own test.
  - The drawer decides placement and the module decides content: pinned to the
    icon when the drawer is collapsed, pushed to the far edge when it is open,
    and the badge knows neither.

  **One accessibility correction made on the way.** The count was going to carry
  an `aria-label`, which a bare `<span>` does not support — it has no role, so a
  reader is free to ignore it. It is real text now, visually hidden, which also
  lands inside the drawer's link and becomes part of its accessible name: "Chat,
  3 unread messages". It still spells apart what the number deliberately merges,
  since unread messages and pending invitations share one figure.

  ⚠ **AND IT LEAVES STEP 7 A QUESTION.** The anchored panel was anchored to the
  header icon — `/chat` is the full page, and the panel was the shortcut hanging
  off the icon that no longer exists. Three honest answers, and it is a product
  decision rather than a technical one: `/chat` is the only home and the panel is
  dropped; the panel is re-anchored to the drawer entry; or it opens from
  somewhere new. Recorded as §12.52 rather than guessed at.

- **2026-09-11** — **STEP 6: the header is COMPOSED, and chat's icon is the
  first thing in it.**

  ⚠ **SUPERSEDED THE SAME DAY — see the entry above.** The header slot was built
  and then removed: chat is in the drawer, and putting it in the top nav as well
  was a second door to one place. What survives is the badge, moved onto the
  drawer entry. The rest of this entry is the reasoning as it stood, kept
  because the mechanism argument outlived the placement.

  The drawer has been `composeNav(WEB_MODULES, granted)` since `module-kit`
  existed; the header had not caught up. A module wanting a control there had to
  be hardcoded into the app's `header.tsx`, which is wrong three times over —
  unfiltered by the module's own key, so the icon appears for people the API
  refuses; absent from the descriptor, so "what does this module contribute" no
  longer has one answer; and it teaches the app shell what that module IS, which
  is the coupling `module-kit` exists to prevent. So `WebModuleDescriptor` gains
  `headerSlots`, and `composeHeaderSlots` filters them by held keys exactly as
  nav entries are.

  ⚠ **A COMPONENT REFERENCE, never a function prop.** The composing layer is a
  server component and a function cannot cross that boundary — `ModuleRoute`'s
  rule, and the 500 it was learned from. `header.tsx` RENDERS `<Component />`
  and names no module.

  ⚠ **Duplicate slot keys THROW, and they throw before the grant filter.** Two
  modules claiming one slot is a wiring bug, and both silent resolutions are
  wrong: rendering both puts two controls where one was meant, and taking the
  first makes the winner depend on the order `WEB_MODULES` happens to be written
  in. Refusing it only for readers who would have SEEN it would be a wiring bug
  that ships.

  **THE WIDGET SUBSCRIBES, because the badge has to be right before anybody
  opens anything.** A count rendered on the server is correct for exactly as
  long as it takes somebody else to send a message, and a person looking at a
  "0" while a message waits will not trust the number again. It reads once on
  mount and then follows the app's socket through `useRealtime()` — never one of
  its own.

  **⚠ AN EVENT MAKES IT RE-READ, never increment.** Counting locally would mean
  reimplementing `countsAsUnread` — deleted messages do not count, your own do
  not count, a system message does not count — in a second place, in a language
  the rule was not written in. Re-reading goes back through the GUARDED query,
  so one authorization path rather than two. ⚠ COALESCED at 250ms, because a
  busy conversation would otherwise be one query per message per open tab: the
  difference between a badge and a load generator.

  **Three smaller decisions**

  1. **The badge counts unread messages AND pending invitations, in one
     number.** Both are things waiting for you, and two indicators on one icon
     is how people learn to ignore both. The accessible label spells them apart,
     because a reader who cannot see the icon has no other way to tell an
     invitation from a message.
  2. **A failed read KEEPS the last known count** rather than showing zero. The
     API being unreachable is not the same as having nothing waiting, and a
     badge that empties during an outage tells people their messages went away.
  3. **`subscribe()` grew `variables`.** A subscription is a GraphQL operation
     like any other and chat's takes the cursor it wants replayed from; a
     connection that could not pass one would push every caller into
     interpolating values into a document string.

  **⚠ ONE READER FOR THE ONE SWITCH.** `chatIsEnabled` lives in the package root
  and BOTH halves use it: `ChatModule.forRoot` and `chatWebModule`. A disabled
  web descriptor contributes no route, no drawer entry and no icon — and KEEPS
  its feature registry, because dropping it would have the host's feature sync
  deprecate every `chat:*` row, and a deprecated feature grants nothing. A
  flag flipped for an afternoon would otherwise strip chat rights from every
  role holding them and not return them on the way back. Its own test.

  **`/chat` is contributed as a STUB**, which is the arrangement `/admin/roles`
  shipped under: listing the route now proves the path the icon depends on —
  descriptor → compose → grant filter → rendered route → `FeatureDenied` for
  somebody without the key — and step 7 fills the body. Building the panel first
  would have made it the only home, permanently cramped.

  **Verified:** `turbo run typecheck lint test build` green across 28 tasks, and
  `/chat` on the running app answers 307 to the sign-in page exactly as the
  existing `/admin/roles` does, where an unknown path answers 404 — so the route
  is composed rather than merely declared. ⚠ The icon itself has NOT been seen
  on screen: that needs a signed-in session, and what is asserted instead is the
  composition — the route and the slot carry the same key, neither survives an
  empty grant set, and both disappear when the module is disabled.

- **2026-09-11** — **STEP 5, the client half: ONE socket per tab, and it belongs
  to the application.**

  §12.39 is closed. `apps/web-app/src/app/providers.tsx` calls
  `createRealtimeConnection` once and is the only place in the repo that calls
  it at all; every module reaches the connection through `useRealtime()`.

  **⚠ THE CONTRACT MOVED OUT OF `module-permissions` INTO `module-kit`, and the
  move is the decision.** It was correct where it was while exactly one module
  subscribed to anything. `module-chat` made it wrong in a way that would never
  have surfaced as an error: each module would reach for its own
  `createRealtimeConnection`, and a tab would hold a socket per module — each
  with its own ticket, its own reconnect and its own share of the server's
  connection budget. Nothing fails. It simply costs N times what it should and
  gets worse with every module. A socket is a resource of the APPLICATION, so it
  now lives where an app composes things and no module has to import another to
  name one (§9).

  So: `RealtimeConnection` / `RealtimeOptions` / `DEFAULT_WS_TICKET_PATH` at
  `@kwtech/module-kit`, `createRealtimeConnection` behind
  `@kwtech/module-kit/realtime`, `RealtimeProvider` and `useRealtime()` in
  `@kwtech/module-kit/react`. `module-permissions` keeps only its DOCUMENT —
  `PLAN_CHANGED` is a string, and the file it lives in is now named for what it
  holds. `@kwtech/module-permissions/react/realtime` is GONE rather than left as
  a re-export: a module re-exporting another package's socket factory would let
  an app believe permissions owns the connection, which is the belief that put
  it there in the first place.

  **A CONTEXT, not a prop, and that is forced rather than chosen.** The module
  pages are rendered by the app's catch-all route, which is a SERVER component:
  it can pass `params` and `searchParams` and nothing else, because a live
  WebSocket is not serialisable. Pages keep their explicit `realtime` prop —
  clearer, and what a test supplies — and fall back to the context. The two
  cannot disagree, because whoever passes the prop passes the app's own
  connection.

  **⚠ THE FACTORY IS CALLED IN AN EFFECT, never during render**, because a
  client component still renders on the server and constructing a socket client
  there is at best wasted and at worst a reference to a `WebSocket` that does
  not exist. So `useRealtime()` answers null until mount — which every consumer
  already handles, since it is also the answer in an app that wires no socket.
  And the APP closes the connection, never a module: a module closing it on its
  own unmount would take every other module's subscription down with it.

  **The app passes a FACTORY rather than a connection**, so the `graphql-ws`
  import stays in the app's own file. `RealtimeProvider` lives in the `/react`
  barrel every module page reaches, and importing the client there would make a
  WebSocket a hard dependency of naming a provider — the mistake this repo has
  already made once, when a page imported a subscription document (a string) and
  pulled the whole client in with it.

  **What this makes live, today:** `PlansPage` has accepted a `realtime` prop
  since it was written and never received one. It now re-reads on `planChanged`
  through the app's connection, which closes the concurrent-edit gap on that
  screen — two administrators no longer see different truths until one reloads.

  **Verified:** `turbo run typecheck lint test` green across 26 tasks, the Next
  app builds, and the socket itself was handshaked — a `connection_init` with a
  forged ticket is closed with **4403**, the documented do-not-retry code, which
  exercises `onConnect` → `authenticateConnection` → `verifyWsTicket` end to
  end. ⚠ A SUBSCRIPTION CARRYING A REAL EVENT IS STILL UNVERIFIED: that needs a
  signed-in session to mint a genuine ticket.

- **2026-09-11** — **STEP 5, the server half: chat streams, and the stream does
  not lose mail.**

  **⚠ THE AUDIENCE IS COMPUTED PER PUBLISH, which is the entire security
  argument for carrying a message body over a socket.** A subscription is
  authorised ONCE, at subscribe, and then streams for as long as the socket
  lives — so nothing checked at subscribe can answer "is this person still in
  conversation 42". Every published event therefore carries the participant ids
  as they stand AT THAT INSTANT, read from the database by `ChatEventPublisher`,
  and each subscriber's filter asks only whether it is in that list. One query
  per event, not one per event per subscriber, and fresher than any
  subscribe-time check could be. A person removed at 10:00 stops receiving at
  10:00, not when their token expires.

  Message events reach ACTIVE participants only. An invited person may see that
  they were invited and never what was said, and the push path is the one place
  that rule could have been quietly skipped.

  **⚠ CATCH-UP, AND THE ORDERING THAT MAKES IT RACE-FREE.** The socket closes
  when its authorization runs out, so every client reconnects on a clock it does
  not control, and the in-memory pub/sub has no replay: an event published in
  that gap is gone, not late. So `chatEvents(since:)` replays the gap from the
  database before streaming anything live. The naive order — query, then
  subscribe — leaves a window exactly as long as the query, so `withCatchUp`
  PULLS FIRST (which is what subscribes), then runs the query, then emits the
  replay, then drains the live stream skipping what the replay already carried.
  There is a test that publishes DURING the catch-up query and asserts it
  arrives; reversing the two lines fails that test and nothing else, which is
  the only reason to trust the comment above them.

  **Four decisions made here**

  1. ⚠ **The dedupe key includes the CHANGE, not just the message id.** A replay
     carries the message as it stands now; a live `changed` for that same id a
     moment later would be swallowed as a duplicate, and the edit would stay
     invisible until the next reload. Its own test.
  2. ⚠ **`sync` is emitted on every (re)subscribe, always, even with no cursor
     and nothing missed.** It carries nothing and means "re-read your list". It
     is what covers everything a message replay cannot — an invitation, a
     removal, a rename, an archive have no rows to page — and it is why none of
     those needed a replay mechanism of their own.
  3. ⚠ **Past `MAX_CATCH_UP` (200) the replay is ABANDONED, not truncated.**
     Replaying the newest 200 of 400 leaves a hole in the middle that nothing
     ever fills. `sync` has already told the client to re-read, so abandoning is
     the complete answer and truncating is the broken one.
  4. **Messages carry their body; conversation events say "re-read".** The one
     place chat departs from `planChanged`'s "an event is a hint, the guarded
     query is the data" rule, and only for messages — a message that costs a
     round trip before it can be drawn is a chat that feels broken. What the
     departure costs is bounded and written down: entitlement (`chat:read`
     itself) is checked once at subscribe, so a role change mid-socket is
     honoured when the socket next closes, which token expiry guarantees within
     minutes. Participation is not on that clock; only the key is.

  **ONE SUBSCRIPTION PER SOCKET, which answers §12.29's open half.** Two
  triggers and one `chatEvents` field, not a topic per conversation — that would
  have a socket holding as many subscriptions as somebody has threads, growing
  as they talk to more people. The cost is that every subscriber's filter runs
  over every publish; the saving is that the count is one, forever.

  **⚠ THE PUBLISH IS ALWAYS OUTSIDE THE TRANSACTION.** Announcing from inside
  announces a message a rollback then un-sends, to clients that have already
  drawn it — so several write methods now assign and return on a second line
  rather than returning the `$transaction` call. A publish that throws is caught
  and logged: the message is saved, and turning a delivered message into a 500
  would make the client retry something that already happened. A RETRY of the
  same `clientMessageId` publishes nothing, because the first send already did.

  Two writes announce nothing, deliberately: `markRead` (nobody else's view
  changes) and `setBlocked` (telling the blocked person is exactly what the
  blocking design refuses to do). Written down so the silence reads as a
  decision.

  **The fake client learned the keyset.** It sorted descending and ignored the
  `OR` clause entirely, so a paging bug would have passed there and re-shown
  rows in production — and `missedSince` pages FORWARDS, so an ascending order
  that was never honoured would have delivered a replay backwards.

  **Verified:** 142 tests in `module-chat`, `turbo run test typecheck lint`
  green, the server boots with `ChatModule` and emits `chatEvents(since: String):
  ChatEvent!` into `schema.graphql`. ⚠ Still NOT verified over a real socket —
  that needs a signed-in session to mint a ws ticket, and the guard's half is
  asserted in `module-permissions` instead: a `graphql_subscription` binding
  refuses `Subscription.chatEvents` without `chat:read` and admits it with.

- **2026-09-11** — **STEP 4: the server half — chat has a database, a GraphQL
  surface, and participation re-asked on every path.**

  Step 3 left a package with rules and no tables. This is the step that makes
  `apps/web-server` depend on it, which is what CREATES them: `compose-schema.mjs`
  picked up `module-chat/prisma/chat.prisma` the moment the dependency appeared,
  and `20260911112722_chat_conversations` is applied. Four tables, two enums,
  keyset index on `(conversationId, createdAt, id)`.

  ⚠ **A BUG IN `FeatureGuard` HAD TO BE FIXED BEFORE ANY OF IT ENFORCED
  ANYTHING, and it had been there since bindings existed.** The guard built its
  binding index from a static `FEATURE_REGISTRY` — `module-permissions`' OWN —
  so a binding CONTRIBUTED by another module was seeded to the database, offered
  by the role editor, displayed as coverage, and enforced nowhere. It now builds
  lazily from `options.featureRegistry`, the composed one. This matters more
  than a one-line diff suggests: `module-chat` cannot use `@RequireFeature` (the
  decorator belongs to another module, §9), so for chat the BINDINGS ARE THE
  GUARD, and every `chat:*` mutation would have been reachable by anybody signed
  in. The exact class of drift bindings exist to close, reappearing one module
  over.

  **`test/surface-coverage.test.ts` is the parity check that stops it coming
  back.** It parses the resolver's own `@Query`/`@Mutation` declarations and
  asserts, both directions, that every published operation is bound to a key or
  named in `DELIBERATELY_UNBOUND`, and that no binding names an operation that
  does not exist. Three mutations are on that list and say why in it:
  `leaveChat`, `respondToChatInvitation`, `setChatBlocked` — each is the
  person's own remedy over their own participant row, and withholding it would
  be a lockout dressed as a permission.

  **PARTICIPATION IS NOT PERMISSION, enforced in the service and not the
  guard.** The key answers "may this person use chat"; the row answers "is this
  conversation somewhere they may be". Every method on `ChatWriteService`
  re-reads the participant row inside its transaction and runs it through the
  step-3 helpers — `canAccessConversation` is now a type predicate on three more
  of them, so a caller cannot reach `userId` without having asked. C1 was a
  helper that existed and was never called server-side; this is the shape that
  makes not calling it a type error.

  **Decisions made here, not in the plan**

  1. ⚠ **`directKey` is COMPUTED SERVER-SIDE, never accepted.** A
     client-supplied key forges a direct chat between two other people, and the
     only defence is never taking one.
  2. ⚠ **The cap is counted INSIDE the transaction**, by chat's own `count` over
     its own rows — the `LimitChecker` resolves the number and never learns what
     a conversation is, which is the port's rule from step 1. Outside a transaction the check is
     advisory: two simultaneous creates read the same number and both pass.
     Direct chats are excluded from the count, and archiving FREES a slot.
  3. **A blocked person and an unknown address get the SAME sentence.**
     `CONTACT_REFUSED_MESSAGE`, from the domain layer, on both paths. A distinct
     refusal is a notification that you have been blocked.
  4. **A conversation you are not in is NOT FOUND, not forbidden.** "You may not
     see this" confirms it exists.
  5. ⚠ **Sending is IDEMPOTENT on `clientMessageId`.** Optimistic insert plus a
     flaky network is a double-post otherwise, and it is the retry the client
     will do by itself.
  6. **`mayModerate` is passed IN to `delete`.** The module does not ask what
     keys the caller holds — the resolver reads the grant and hands down a
     boolean, so `chat:send` deletes your own and `chat:moderate` deletes
     somebody else's, which is why they are separate keys.

  **The one genuinely new port is the directory**, and it lives in the app:
  `src/chat/user-directory.ts` reads `auth_user`, which `module-auth` owns, for
  a feature `module-chat` owns, and neither module may import the other. Exact
  email match only, behind `chat:directory` — a prefix search over `auth_user`
  is a customer-list harvester — and suspended accounts are excluded, because an
  invitation nobody can answer is worse than no match. The app's total for
  adopting chat is one `chatServerModule({...})` call: two clients, the
  directory, the limit checker bound with `useExisting` to the permissions
  adapter, and `resolveActorId`.

  **Two clients, not one.** `CHAT_PRISMA` binds `useExisting` to `PrismaService`
  (reads fit outright); `CHAT_PRISMA_WRITE` is the four delegates behind
  `withTransaction`, and `satisfies-modules.ts` gains the two assertions that
  keep the structural fit honest.

  **Verified, not assumed:** 113 tests in `module-chat` (the write service
  against a fake client, not a mock), full `turbo run test typecheck` green, the
  migration applied to the local Postgres, and the server booted — `ChatModule
  dependencies initialized`, `chatConversations` refused with `UNAUTHENTICATED`
  before any chat code ran. ⚠ An authenticated end-to-end curl was NOT run: it
  needs credentials for a seeded account, and minting a token from the app
  secret is not a way to prove a guard works.

  **Not in this step, and deliberately:** no pub/sub anywhere in the module —
  there is not one `publish()` call — because per-publish filtering and
  catch-up-on-resubscribe are step 5's problem and half of it is worse than none
  (§12.28, §12.39).

- **2026-09-11** — **STEP 3: `packages/module-chat` EXISTS — the schema and the
  pure domain, with no database and no framework anywhere in it.**

  The first module that is not platform, and the first written rules-first:
  every decision below is a function taking a literal, because `canAccessConversation`
  gets tests before it gets a screen. ⚠ C1's exact failure was a helper that
  existed, was exported, was used by the React layer, and was never called
  server-side — so the helper lands first, tested, and the server that wraps it
  in step 4 imports it rather than restating it.

  **The package has no dependencies but `@kwtech/module-kit`.** No Prisma, no
  Nest, no React, no DOM in its `lib`. That is not minimalism for its own sake:
  it is what makes the state machine testable without a database, and it is the
  shape the rest of the module hangs off.

  **`prisma/chat.prisma` — four models, and the ten holes are columns now.**
  `ChatConversation` (nullable `title`/`icon`, `directKey String? @unique`,
  `createdById` that never moves, `archivedAt`, denormalised `lastMessageAt`,
  `metadata Json?`), `ChatParticipant` (the whole state machine as a `status`
  column, `lastReadMessageId`, `mutedUntil`, `exitedAt`), `ChatMessage`
  (`kind`, nullable `authorId`, ⚠ nullable `body`, `clientMessageId` unique per
  conversation, `replyToMessageId`, database-generated `createdAt`, `editedAt`,
  `deletedAt` + `deletedById`) and `ChatBlock`. No `ChatAttachment` — §12.45, and
  an empty table is a claim to have thought it through.

  ⚠ **The app does NOT adopt it yet.** `compose-schema.mjs` copies a fragment
  for every `@kwtech/module-*` dependency in `apps/web-server/package.json`, so
  adding the dependency is what creates the tables — and that belongs with the
  migration and the server that uses them, in step 4. The fragment being written
  and the fragment being APPLIED are different acts, and doing the second one
  early leaves a schema the database does not have.

  **Four decisions that were not in the plan, made here**

  1. ⚠ **`canAccessConversation` is ACTIVE ONLY, and `invited` gets its own,
     narrower question.** An invited person sees THAT they were invited — the
     requests inbox — and never the messages. Rendering somebody else's message
     content to a non-participant is exactly what the helper exists to prevent.
     The cost is recorded as an open decision: with no preview, accept-or-decline
     is close to a coin flip. Every product that solved this showed the first
     message, and that is a privacy decision rather than a UI one, so it is not
     being made by default here.
  2. **A type PREDICATE, not a boolean.** `canAccessConversation` narrows to an
     `ActiveParticipant`, so a caller cannot read `actor.userId` without having
     asked. Without it every call site re-tests for null, and the one that
     forgets compares `undefined` to a user id — which throws when somebody
     sends a message, not at review.
  3. **Refusals are REASONS, never booleans.** `refuseRemoval` answers
     `not_a_participant | target_not_present | self_removal | creator`, and
     `refuseDelete` answers three of its own. `self_removal` is the one that
     proves the shape: it is not an error to show, it means the person wanted
     `leave`.
  4. **The body cap counts CODE POINTS.** `.length` counts UTF-16 units, so a
     4000-unit cap cuts a message of 2000 emoji in half — and the first report
     of it comes from exactly the people most likely to use them. There is a
     test that a body of 4000 thumbs-up is 8000 units long and accepted.

  **`groupCapAllows` exists to say that DIRECT CHATS DO NOT COUNT**, which was
  implied and never written down. The cap bounds how many rooms one person can
  stand up, not who they may talk to: a direct chat is bounded by the other
  person, who can block, decline or leave, where a group is bounded by nothing.

  `CHAT_FEATURE_REGISTRY` and `CHAT_LIMIT_REGISTRY` are exported as module-kit
  contributions — the host spreads them into `seed/registry.ts`. ⚠ Their
  `bindings` are deliberately EMPTY: a key whose binding names a surface that
  does not exist yet is a worse lie than one with no binding, so they are filled
  in as steps 4 to 7 land and `auditRegistry()` reports them as unenforced until
  then.

  Sixty-six tests, no database.

- **2026-09-11** — **STEP 2 IS BUILT: a cap is now an OPERATOR decision instead
  of a deploy. Role-editor limits, end to end.**

  `perm_role_limit` had exactly one writer — `seed/app-roles.ts` — so every
  role-sourced cap in the system was set by shipping code. The table, the
  resolution and the checks all existed; the only missing piece was a person
  being able to type a number.

  **The whole vertical, and one new query.** `RoleDraft` gains
  `limits: Record<string, string>` (strings, for the reason `PlanDraft` uses
  them: `<input type="number">` yields `''` mid-edit, and a draft holding `NaN`
  saves and caps somebody at nothing). `validateRoleLimits` shares one rule set
  with the write path. `roleLimitValues`/`roleLimitFields` convert both ways.
  `replaceRoleLimits` writes them, delete-then-upsert like plans.
  `PermissionRoleDetail.limits` and `RoleDraftInput.limits` carry them over
  GraphQL as PAIRS, never a map — this schema has no untyped-object scalar.

  ⚠ And a new query, `permissionLimits`, because the editor could not otherwise
  see a cap it is supposed to set. The role form reads the registry as a PROP
  fetched from the API, exactly as it already reads features — the compiled
  `LIMIT_REGISTRY` in this package holds only this module's own, so
  `chat:group_chats` would have had no field. Guarded by `features:read` rather
  than a key of its own: it is the same kind of thing the feature catalogue is,
  and both editors already call `permissionFeatures` before they can render, so
  a second key would deny half a form whose other half had just loaded.

  **Four decisions that are not obvious**

  1. ⚠ **CAPS ONLY ON APP-LEVEL ROLES, refused rather than dropped.**
     `resolveLimits` reads `roles.filter((r) => r.level === 'app')`, so a number
     on an organization-level role is discarded before anything reads it — it
     would save, redisplay, and enforce nothing. The validator refuses it, the
     form HIDES the fields rather than disabling them (a greyed box invites "why
     can I not set this", and the honest answer is that the concept does not
     exist at that level), and `roleLimitValues` returns nothing below app level
     whatever the draft holds. Three doors on one room, because the failure is
     silent.
  2. **A blank is not a zero.** Blank means "this role says nothing about this
     cap" and contributes nothing to the max; a typed `0` means "this role
     grants none of it" — a contractor role that may use chat and create no
     group conversations, which is the configuration §12 named when it argued
     `chat:read` earns a key at all. Both are legitimate, so they are stored
     differently. ⚠ Zero is allowed here even though `LimitSpec.defaultValue`
     never uses it: that floor is about what an UNCONFIGURED person gets, where
     zero would stop an organization's founder being its first member. This is
     an operator naming a role.
  3. ⚠ **`EMPTY_ROLE_DRAFT.limits` is `{}`, NOT prefilled** — the opposite of
     `EMPTY_PLAN_DRAFT`, and the two cases look identical. A plan's required
     caps must be set or the plan is invalid. A role's caps resolve as the MAX
     across the roles somebody holds, so a prefilled default would make every
     new role silently RAISE its holders' allowance.
  4. **`updateRole` writes against the EXISTING level, never the draft's.** The
     level is locked on edit and validation already ran against the stored one;
     trusting the draft would let a form claiming 'app' write caps onto an
     organization-level role, where nothing would read them.

  **Two seams the host had to close**, both found by the compiler rather than by
  running anything: `apps/web-server` hands the module its Prisma delegates
  explicitly, so `permRoleLimit` had to be added to `module-clients.ts` — the
  structural client doing exactly its job — and `ALL_LIMITS` is now passed as
  `limitRegistry` beside `ALL_FEATURES`.

  Seventeen tests: ten on the domain rules, seven driving `createRole` and
  `updateRole` through the fake. The sharpest is that an emptied box CLEARS the
  cap — an update that wrote only what it was sent would leave the old number in
  force while the form showed a blank.

  Verified by booting: the server starts against Postgres and re-emits
  `schema.graphql` with the new types. No migration — `PermRoleLimit` has been
  in the schema since the first one; it simply had no writer.

- **2026-09-11** — **STEP 1 OF `module-chat` IS BUILT, and it touches no chat
  code: `LimitContribution` + the `LimitChecker` port, and the enforcement
  plumbing behind them.**

  The cap had no path (2026-09-10). Building the path found it was not one hole
  but THREE, stacked, each of which independently makes a configured cap
  enforce nothing — and none of which reports anything:

  1. `LIMIT_REGISTRY` was a const with no contribution mechanism. Known.
  2. ⚠ `composeContext` called `resolveLimits` with the DEFAULT registry, and
     `resolveLimits` builds its map by WALKING that registry. So a
     `perm_role_limit` row for an undeclared key was dropped BEFORE any checker
     could read it. Setting the number in the database would have changed
     nothing, with no error to explain why — the number visible in the role
     editor, the cap infinite. This was the one that would have wasted a day.
  3. ⚠ `checkCapacity` counts with a hardcoded if/else over `perm_membership`,
     `perm_workspace` and friends. A key it cannot count FELL THROUGH to
     `current = 0` — "none yet", therefore always allowed. A registered cap that
     never denies is worse than an unregistered one, because it looks enforced.

  **What was built**

  `@kwtech/module-kit` gains `limits.ts`: `LimitContribution` (the declaration,
  parallel to `FeatureContribution`, `countedOver` left a loose string because
  this package must not own the enforcer's vocabulary), `LimitChecker` with
  `LimitCheckInput`/`LimitDecision`, and `NULL_LIMIT_CHECKER`. Plus
  `composeLimits`, refusing duplicate keys the way `composeFeatures` does, and
  `limits?` on both descriptors.

  ⚠ **THE CALLER SUPPLIES THE COUNT.** `LimitCheckInput.current` is the single
  most consequential line: the checker resolves the CAP, the module that owns
  the rows counts them. It cannot run the other way — teaching permissions to
  count `chat_conversation` puts chat's tables inside the permissions module,
  which is the import §9 forbids and the thing portability depends on not
  happening. Hole 3 is what that decision looks like when it has not been made.

  `@kwtech/module-permissions` gains the enforcing half: a `limitRegistry`
  option (composed by the app, like `featureRegistry`), threaded through all
  three `composeContext` call sites; `checkDeclaredLimit(ctx, key, current)` and
  `checkLimitForActor({actorId, key, current})` for caps over rows it does not
  own; `PermissionsLimitChecker`, the adapter an app binds to any module's
  `LimitChecker` port; and `LIMIT_CONTRIBUTIONS`, its own four shaped for
  composition. `checkCapacity` now REFUSES a key outside `COUNTABLE_HERE`
  instead of answering zero, and names the method to call instead.

  ⚠ **No context means the FLOOR, not "no limit".** `loadContext` answers null
  for somebody holding no app-level role — a new account is exactly that — and
  reading null as unrestricted would give the completely ungranted user the only
  infinite allowance in the system. `checkLimitForActor` resolves the registry
  defaults instead.

  The app composes `ALL_LIMITS` beside `ALL_FEATURES` in `seed/registry.ts`,
  narrowed by a `toLimitSpec` that CHECKS `countedOver` rather than casting —
  `toFeatureSpec` one field over. Composed today even though one module
  declares caps, because the day a second one does the failure is hole 2.

  Nine tests, all on silences: a contributed cap resolving from a role, the same
  row DROPPED when the registry omits it, `checkCapacity` refusing what it
  cannot count, and the floor for an actor with no context.

  **Still open from step 1's premise**: `NULL_LIMIT_CHECKER` means a host that
  MEANT to enforce a cap and forgot the binding gets silence. That is the stated
  price of chat running in an app with no permission model at all — recorded
  here rather than discovered by whoever forgets.

- **2026-09-11** — **SINGLE REPLICA, CHOSEN AND ENFORCED — and the pub/sub
  engine now has ONE place to swap. `src/realtime/` is built.**

  The operator's call: run one server for now, prepare for Redis, and centralise
  the seam so the future move is not a hunt. §12.28 had been written twice as a
  future trigger and never as a present decision, which is how "we will do it
  before it matters" becomes "nobody noticed it started mattering".

  **What was actually wrong, and it was not Redis.** `new PubSub()` was
  constructed INLINE in `app.module.ts`, as the `pubsubProvider` for
  module-permissions. Correct for exactly as long as one module publishes. The
  second — `module-chat`, already designed — would have taken the same shape and
  constructed its own, and ⚠ **two engines in one process do not see each
  other's publishes.** A subscriber on B waits forever for an event sent on A,
  with no error, no log and nothing to grep for. That failure needed no second
  replica at all: it is available today, on one machine, and it is the same
  silence §12.28 describes arriving a deployment earlier than expected.

  So the engine is a MODULE-SCOPE SINGLETON behind `realtimePubSub()` in
  `src/realtime/realtime.pubsub.ts`, and the rule is that a module's pub/sub
  token binds to that call and never to a constructor. Not a Nest provider: each
  module's token is supplied as `useValue` into a dynamically-composed
  `forRoot()`, so a DI provider would have to be exported and imported per
  module — the per-module wiring the descriptor pattern exists to delete.

  **Single replica is now DECLARED and CHECKED, not assumed.**
  `REALTIME_REPLICAS` (default 1) is the operator saying what they deployed, and
  `assertRealtimeTopology` refuses to boot when it exceeds what the engine can
  serve. ⚠ Its limit is written into `.env.example` rather than discovered
  later: a process cannot count its siblings, so scaling the deployment WITHOUT
  raising the number passes the check while the product is broken. It catches
  the deliberate scale-up, which is the case that happens; nobody adds a replica
  by accident.

  ⚠ **A set `REDIS_URL` also fails the boot**, rather than being ignored.
  Setting it is somebody stating an intention — usually the same somebody about
  to add replicas — and starting anyway on the in-memory engine would report a
  migration that has not happened, whose first symptom is the silent one above.
  The error names the three steps that complete it.

  **The Redis migration is three steps, in one file**: add
  `graphql-redis-subscriptions` + `ioredis`, return a `RedisPubSub` from
  `createEngine`, delete the not-wired branch. No resolver, no module, no port
  changes — which is what the structural `PermissionsPubSub` bought, now
  actually collected. ⚠ If a future attempt needs a fourth step, that step is
  the engine having leaked somewhere it should not have reached.

  **`realtimeIsDistributed()` is the question a FUTURE feature asks**, and
  nothing asks it today. Presence is the known caller (§12.28): pub/sub across
  replicas fails silently, presence fails LOUDLY, with half of everybody shown
  permanently offline. A feature like that refuses to register rather than
  shipping broken — and now it has something to refuse on.

  Four tests on the two refusals, because both are failures that produce no
  runtime error at all; the test is the only place the silence is made visible.

- **2026-09-11** — **DELIVERY IS A REQUIREMENT, NOT AN ENHANCEMENT — and that
  moves three things that were deferred.**

  Stated by the operator: people must be told about a message, and get it, ON
  TIME. Every realtime decision in this repo so far was written the other way
  round. `realtime-contract.ts` says it out loud — realtime is an ENHANCEMENT,
  every screen that subscribes also reads over HTTP and works without a socket,
  and a failure is reported rather than thrown. That is the correct call for a
  plan badge. It is the wrong call for a message, and the difference is not a
  setting: it changes what has to exist before `/chat` can ship.

  **1. §12.28 (Redis) no longer gates on presence. It gates on CHAT.** The entry
  was hardened once already — from "before a second replica" to "before presence
  ships" — on the argument that pub/sub fails silently and presence fails
  loudly. Under a delivery promise that argument inverts: a message published on
  replica A that never reaches a socket held by replica B is a BROKEN PRODUCT,
  silent or not, and it is indistinguishable from the recipient ignoring you. So
  the gate is now: Redis before `/chat` is used by anyone, OR single-replica
  recorded as a deliberate operational constraint with something that FAILS THE
  BOOT if a second replica appears. A comment is not that something.

  **2. ⚠ THERE IS NO CATCH-UP ON RECONNECT, AND THE SOCKET CLOSES EVERY FIVE
  MINUTES.** The sharpest of the three, and it was missing from the ten steps
  entirely. `closeWhenAuthorizationExpires` drops the socket at
  `AUTH_ACCESS_TOKEN_TTL` — which this repo's `.env` sets to **5m**, not the
  library default of fifteen the presence section assumes — and the client
  reconnects with a fresh ticket. `graphql-subscriptions` is FIRE AND FORGET:
  there is no replay, no buffer and no offset, so every event published between
  the close and the resubscribe is gone. Today the symptom is a message that
  surfaces only when the recipient next opens that conversation, and an unread
  badge that is wrong until they do.

  So every `subscribe` — and every RE-subscribe, which is the one that matters —
  is followed by a READ of what was missed, keyed off `lastReadMessageId`. The
  socket is the fast path; the query is the truth. That is the same "one
  authorization path" the contract already argues for, applied to a case the
  contract did not anticipate. It lands in step 5 beside the per-publish filter,
  not in step 9 with the niceties.

  ⚠ And it is not only the five-minute cycle: a closed laptop lid delivers no
  close event either, so the gap can be hours. A reconnect must never be assumed
  to be short.

  **3. Being told with the tab CLOSED is §12.50, and it is now in scope.** The
  tone only plays in an open tab, which satisfies "on time" only for somebody
  already looking. Either Web Push comes forward from "after `/chat` is used in
  anger", or `sendChatNotification` — the optional hook already in the design —
  is WIRED AT V1 to something that reaches a closed tab, email being the
  cheapest. ⚠ Shipping neither means the requirement is not met, and it is the
  only one of the three that adds genuinely new surface (a service worker, a
  permission prompt, VAPID keys, a delivery path) rather than re-ordering work
  the plan already had.

  **Pinned while here: a chat event CARRIES THE MESSAGE.** The plan never said,
  and the obvious precedent points the wrong way — `planChanged` deliberately
  carries a key and not the row, because it fans out to every subscriber
  unfiltered and `PermissionPlanDetail` is not filtered per reader. Chat is the
  opposite case by construction: events are filtered PER PUBLISH, re-checking
  participation, so by the time one is sent the server has already established
  that this recipient may read it. Making them re-read anyway costs a round trip
  per message and makes "on time" worse for no safety gained. The thin-payload
  rule stands for `planChanged` and does not generalise.

- **2026-09-10** — **`module-chat` reviewed before it exists: ten holes, and the
  packaging rule that the module must be adoptable in one file.**

  ## The holes

  Found by reading the design adversarially rather than by building it. Each is
  cheap now and expensive once there are messages in a table.

  1. ⚠ **NOBODY COULD REFUSE CONTACT.** Chat is app level and the directory
     takes an email, so anyone who knows your address could open a DM, and
     declining only let them re-invite. A harassment vector with no remedy —
     and `chat:moderate` does not help, because §12.42 deliberately makes
     moderation require participation. **`ChatBlock(blockerId, blockedId)` is
     v1**, it blocks new conversations and messages, and a decline BOUNDS
     re-invitation rather than resetting it. ⚠ A blocked sender gets the SAME
     answer as an unknown address — one message, one status, the same timing —
     or the block becomes a notification that you have been blocked.
  2. ⚠ **Message bodies are rendered into other people's browsers**, which is a
     far larger surface than the availability text already ruled out. **Plain
     text, escaped on render, NO markdown and NO auto-linking.** Auto-linking is
     a phishing vector the moment display text and href may differ. Markdown
     later is additive; removing it is not.
  3. ⚠ **A retried send double-posts.** Optimistic insert plus a flaky network
     plus retry equals duplicates. One column fixes it: **`clientMessageId`,
     unique per conversation**, generated client-side as the idempotency key. It
     lands in step 3 — retrofitting means a backfill.
  4. **Who may remove whom was undefined**, and it touched the cap: a member
     removing the creator would free the creator's quota and orphan the group.
     Removal needs `chat:remove_participant` AND active participation, and **the
     creator cannot be removed by anybody else**.
  5. ⚠ **`directKey` is computed SERVER-SIDE, always.** A client-supplied one
     forges a DM between two other people. And **self-DM** was undefined —
     allowed deliberately as a notes-to-self thread, rather than left to produce
     a one-participant "direct" by accident.
  6. **A `left` or `removed` participant resolves NOTHING** — no messages, no
     presence, no typing. Silence on this is how history leaks.
  7. ⚠ **`createdAt` is DATABASE-generated.** App-set timestamps plus clock skew
     between replicas reorder messages under keyset pagination, and the symptom
     appears for SOME readers only, which is the worst kind to debug.
  8. **Caps, with numbers**: a body cap (~4000 code points, counted as code
     points per the emoji rule) and a MAXIMUM page size on message queries.
     Postgres `text` is unbounded and an unbounded page size is a request for a
     hundred thousand rows.
  9. **A moderated delete records who and when** on the tombstone. It is the
     sharpest instance of the review's open M7, and it costs two columns rather
     than an audit subsystem.
  10. **Edit rules**: author only, and ⚠ **an edit never touches `createdAt`**,
      or a message jumps position mid-conversation under keyset ordering.

  **Added to v1 because each is a column now and a migration later**:
  `lastMessageAt` on the conversation (or the list does a `max()` per row —
  the panel's slowest query), `replyToMessageId` nullable, `mutedUntil` on the
  participant (per-conversation mute is what people want more than global DND),
  group rename and icon (`title` existed and nothing edited it; `IconPicker` is
  already in `web-ui`), failed-send retry state, drafts in `localStorage`, and a
  `surface-coverage` test at parity with module-permissions.

  **Does `chat:read` earn a key?** §12.23 removed `account:*` on the rule that a
  surface gets a key only when it needs AUTHORISATION, not merely a session, and
  somebody will apply that here. **Yes, it earns one**: chat is genuinely
  deniable — a contractor account that may not message staff is a real
  configuration — where a settings page you would be locked out of is not. Said
  out loud because the precedent points the other way.

  ## The packaging rule

  **THE MODULE IS THE PRODUCT; THE APP IS A FILE.** The point of `module-chat`
  is to be dropped into another app, so the measure is how much the host has to
  write. The target is what module-auth already reached — "two lines per
  surface, defaults from a published env contract" — and the reference is
  `packages/module-chat/docs/USAGE.md`, written BEFORE the module rather than
  after, because a seam nobody can describe in a page is a seam that is wrong.

  ⚠ **Zero app code is not the goal and is not achievable.** The seams exist
  precisely BECAUSE modules may not import each other, and that prohibition is
  what makes chat portable at all. The goal is that every seam is a NAMED PORT
  with a documented default, and that the host's total comes to one file.

  What chat cannot own, and therefore takes as options:

  - **`ChatPrismaClient`** — structural, host-injected, never a connection the
    module opens. Established by permissions.
  - **`resolveActorId`** — principal → `userId`. §9 rule 6, established.
  - **`UserDirectory`** — ⚠ THE ONE GENUINELY NEW PORT.
    `{ findByEmail(email), describe(ids) }` returning `{ id, displayName }`.
    Chat needs to look somebody up to invite them and to render a name, and
    both read `auth_user`, which belongs to another module. Ten lines in the
    host — and an app on a different IdP implements the same interface, which
    is exactly the portability being bought.
  - **`LimitChecker`** — the module-kit port. ⚠ Its default is a NULL OBJECT
    meaning "no limit", so **`module-chat` runs in an app with no permissions
    module at all**: unguarded but functional. That is the real test of
    reusability, and it is a design goal rather than an accident.
  - **`ChatPubSub`** — structural, as `PermissionsPubSub` already is.
  - **`sendChatNotification`** — an optional hook, shaped like permissions'
    `sendInvitationEmail`, unused until §12.50.

  Everything else is DATA the host composes and does not write:
  `chatServerModule()` and `chatWebModule()` descriptors, the `/chat` routes
  through the §12.11 catch-all, the drawer entry through `composeNav`, and the
  header widget through the module-kit slot. Route handlers are one-line
  re-exports from `@kwtech/module-chat/next`, the way the auth proxy became one.

  **Extension — features and roles.** `CHAT_FEATURE_REGISTRY` is exported as
  `FeatureContribution[]`, exactly as `AUTH_FEATURE_REGISTRY` is, and the host
  composes it in `seed/registry.ts` and may APPEND its own keys there. ⚠ There
  is deliberately no second path — no `additionalFeatures` on `forRoot` — because
  two places to declare a right is two places to disagree, and the composition
  point already exists. The module also EXPORTS role presets ("Chat user",
  "Chat moderator") as data for the host's role seeder to use or ignore; it
  never seeds them itself, the `createPlanIfAbsent` lesson about an operator
  decision being preserved by the seed getting out of the way.

  ⚠ **Extending the DOMAIN is the harder half and is not solved by a hatch.** A
  `metadata Json?` on conversation and message is one column that buys a host
  somewhere to put "support ticket id" without a migration — offered on the
  understanding that it is a dumping ground, unqueryable and untyped, and that
  anything the module itself needs to read must become a real column. Prisma
  enums are not extensible, so a host wanting a third conversation KIND is
  asking for a module change, not a hatch.

  ## Seeding — the module exports DATA, the app owns the RUNNER

  **`module-chat` ships no seeder**, for the same reason it opens no database
  connection: a host may seed by a mechanism this repo has never seen. It
  exports arrays; `apps/web-server/src/seed/` decides what to do with them.

  ⚠ **And chat's features need NO NEW SEEDER FILE.** The existing
  `permissions-registry` seeder is generic — it seeds whatever the composed
  registry holds — so adopting chat is `CHAT_FEATURE_REGISTRY` spread into
  `seed/registry.ts`, one import and one line. That is the packaging target
  holding up under its first test, and it is the reason features compose in the
  app rather than being read from one module.

  Three things get seeded, none of them new machinery:

  - **The `chat:*` feature rows**, through the registry above. This is also what
    runs `auditRegistry()` and `assertRegistered()` over them, so a chat key
    that binds nothing is reported as "Not enforced anywhere" for free.
  - **The cap.** `chat:group_chats` at 20 goes on app-level roles in
    `app-roles.ts`, beside the `user:organizations` values already there — until
    step 2 lands the role-editor limits, after which it is operational rather
    than a deploy.
  - **Role presets**, optionally: "Chat user", "Chat moderator", exported as
    data and CREATED IF ABSENT, never rewritten. The `createPlanIfAbsent`
    rule — which products a platform offers is an operator decision, preserved
    by the seed getting out of the way rather than by there being no seed.

  ⚠ Two traps that do NOT apply here, noted because both have bitten this repo:
  a new key being invisible until a plan entitles it is an ORGANIZATION-level
  problem, and every `chat:*` key is app level, so no plan is involved. And
  `syncFeatureRegistry` deprecating rows absent from the registry (§12.22) is
  correct behaviour here rather than a hazard: an app that drops `module-chat`
  wants its chat keys deprecated.

  **No platform default is added.** `/admin/defaults` exists because four
  creation paths each ended with somebody holding nothing; chat has no such path
  — a conversation is opt-in per conversation, and a new account needs no chat
  state at all. Adding a default with no failure behind it is how a catalogue
  becomes noise.

  ## Switching it off — three different acts, deliberately not one

  - **NOT INSTALLED.** The host never composes `chatServerModule()` or
    `chatWebModule()`. Nothing to build, nothing to check, and it is the real
    answer for an app that does not want chat. This is what the packaging above
    buys.
  - **DISABLED.** Installed, switched off without a deploy-time removal:
    `forRoot({ enabled: false })` **returns a module that registers nothing** —
    no resolvers, no REST, no subscriptions, no routes, no nav entry, no header
    slot. ⚠ ONE place, on purpose. A flag consulted independently by each
    surface is a flag somebody forgets in one of them, and a "disabled" chat
    that still answers a GraphQL query is worse than no switch at all. The
    module exports the reader for that flag so the server and web descriptors
    cannot disagree about what "on" means.
  - **DELETED.** Not a thing. Disabling keeps every row; re-enabling restores
    the product exactly. ⚠ And a temporary disable KEEPS `CHAT_FEATURE_REGISTRY`
    composed in `seed/registry.ts` — dropping it makes `syncFeatureRegistry`
    deprecate the `chat:*` rows, and a deprecated feature does not grant (H2), so
    every role would silently lose its chat rights and get them back only on
    re-registration. Uninstalling SHOULD deprecate them. Disabling must not.

  ## Who sees it: one key, filtered in three places, enforced in a fourth

  A user whose app-level role lacks `chat:read` sees no drawer entry, no unread
  count and no route — the first two through `composeNav(WEB_MODULES, granted)`,
  which now carries the badge along with the entry it belongs to, and the pages
  through `ModuleRoute.feature`, which the catch-all already resolves and
  answers with `FeatureDenied`. ⚠ ONE FILTER RATHER THAN TWO, since the badge
  hangs off the entry: there is no second key and no second place for the two to
  drift apart. Both are decided SERVER-SIDE, in the shell composition, so there
  is no flash of an entry that then vanishes, and both fail closed when grants
  cannot be resolved, matching the `?? false` the nav filter already uses.

  ⚠ **AND HIDING IS NOT ENFORCING.** This is C1's lesson and it is worth
  restating because a hidden icon feels like a control: every resolver still
  declares its key, so `/chat` typed into the address bar is refused, the
  GraphQL endpoint is refused, and the socket topic is never opened. The
  navigation filter is an ergonomic — it stops people finding doors they cannot
  open. It is never the lock.

- **2026-09-10** — **`module-chat`, the second design turn: the header slot,
  presence, leaving, and everything that is ephemeral.**

  ⚠ **REVERSED 2026-09-11 — THERE IS NO HEADER ICON.** Chat is reachable from
  the side drawer, which already leads there, and the unread count hangs off
  that entry instead. The paragraph below is kept because the mechanism argument
  in it was right and outlived the placement: whatever a module contributes to
  the shell is a CONTRIBUTION filtered by its own key, never a line in
  `header.tsx`. See the entry dated 2026-09-11 in §13.

  **~~THE ICON IS A HEADER SLOT, NOT A LINE IN `header.tsx`.~~** Chat hangs off the
  main header, left of `UserMenu` — the right-hand cluster is things about YOU,
  the left is about this page, and a notification bell later joins the same
  cluster. ⚠ But the drawer is `composeNav(WEB_MODULES, granted)`: navigation is
  COMPOSED, never wired. An icon hardcoded into `header.tsx` would be unfiltered
  by `chat:read`, absent from the descriptor, and would teach the app shell what
  chat is — the coupling `module-kit` exists to prevent, duplicated by the
  second module that wants one. So `WebModuleDescriptor` gains a header-slot
  contribution, composed and grant-filtered exactly like nav entries. Route
  descriptors already carry a `ComponentType`, so a slot carrying one is not a
  new kind of thing. ⚠ It contributes a COMPONENT REFERENCE, never a function
  prop — the adapter renders on the server, and that is the `ModuleRoute` 500
  again. ⚠ And the widget must be a CLIENT component that subscribes, because
  the unread badge has to be right before anybody opens the panel.

  **ANCHORED PANEL, NOT DRAGGABLE.** Messenger's chat heads work because
  Facebook is a place you sit in while scrolling something else; this is a tool
  people arrive at to do a task. Draggable costs pointer capture, viewport
  clamping, per-viewer persisted position, z-index against every existing
  dropdown, and a resize handler for a restored position that lands off-screen —
  then a second full-screen implementation, because at 400px "bottom right" is
  the whole screen. ⚠ And it collides with something load-bearing:
  `app-shell.tsx` says of the status bar, "A flex ITEM after the scrolling main,
  not a fixed overlay… a fixed strip would hide content." A floating
  bottom-right panel is exactly that overlay, and what it would cover is
  `ConnectivityMonitor` — the one component that says the API is down. So: an
  anchored popover, fixed size, list ↔ thread inside it, and an "Open in Chat"
  link out. One panel, never several. `/chat` is NOT optional either way — the
  panel is a shortcut to the same data, and building it first makes it the only
  home, permanently cramped.

  **PRESENCE AND AVAILABILITY ARE TWO FEATURES**, and merging them is the
  standard way this goes wrong. Presence is OBSERVED — derived from the socket,
  ephemeral, must not survive a restart. Availability is DECLARED — chosen by
  the user, durable until changed. Different sources, different lifetimes,
  different stores.

  ⚠ **NOT CALLED `status`.** That word is taken four times already —
  `AuthUser.status`, `PermMembershipStatus`, `PermSubscriptionStatus`, and
  `ChatParticipant.status` — and a fifth meaning is a bug report nobody can
  read. It is **availability**.

  **Presence never goes in Postgres.** A row reading `online` after the process
  dies is a lie that persists, and it would be a write per socket event. Memory
  on one replica, Redis on more than one — which is what hardens §12.28: pub/sub
  across replicas fails silently, presence across replicas fails LOUDLY, with
  half of everybody permanently offline. Three traps, all of which every
  hand-rolled presence system hits:

  1. **A REFCOUNT, not a boolean.** Tabs and devices are several sockets per
     person; closing one must not go offline. Publish on TRANSITION only, or
     five tabs emit five "online" events.
  2. **The socket closes every fifteen minutes BY DESIGN.**
     `closeWhenAuthorizationExpires` drops it at `AUTH_ACCESS_TOKEN_TTL` and the
     client reconnects. Immediate-offline means every user in the system
     flickers offline every quarter hour, visibly, forever. Needs a grace period
     before offline is published.
  3. **Ungraceful disconnects never fire.** A closed lid delivers no close
     event, so presence expires on a TTL with a heartbeat rather than trusting a
     goodbye. ⚠ `graphql.options.ts` wires `onConnect` and NO `onDisconnect`
     today — that is new surface regardless.

  **Availability is an ENUM** — `available | busy | dnd | away | invisible` —
  not free text. Free text is user-generated content rendered into other
  people's browsers: escaping, a length cap and moderation, for something nobody
  asked for. Additive later. ⚠ **Auto-clear ("clears in an hour") is DERIVED,
  never written**: store `clearAt` and treat `clearAt < now` as unset ON READ.
  There is no scheduler in `web-server` (§12.40), so a written `expired` has
  nothing to write it — the lesson invitation expiry already learned with
  `isAcceptable`.

  ⚠ **PRESENCE IS A SURVEILLANCE SURFACE AND AN ENUMERATION ORACLE.** The
  directory is exact-email-only precisely to avoid the second; a
  `userPresence(userId)` answering for anybody undoes it and adds the first —
  when a named person works, readable by anyone. So presence resolves ONLY for
  people you share an active conversation with. `canAccessConversation`, third
  time. And `invisible` must exist or presence is mandatory surveillance of your
  own staff — suppressed at the PUBLISH boundary, never filtered client-side,
  and it suppresses TYPING too or it leaks through the side door.

  **Fan-out is bounded per publish**, not per subscriber: one `presenceChanged`
  topic filtered against the recipient's conversation partners. Naive presence
  is O(n²). Same mechanism as messages, no new machinery.

  **LEAVING — and the correction it forced.** `left` on the participant row, no
  feature key (withholding the exit is a lockout dressed as a permission, the
  `account:*` lesson). Your messages STAY: a departure is not a deletion, or
  leaving becomes a way to erase shared history for everybody else. The last
  active participant leaving ARCHIVES the group rather than deleting it, and
  coming back is by invitation — `left → invited → active`, which the row
  already expresses.

  ⚠ **A DIRECT CHAT CANNOT BE LEFT.** If it could, `directKey`'s unique index
  becomes a trap: message somebody, leave, message them again, and `startDirect`
  finds a row you are `left` in. So `left` is groups-only, and a DM gets a
  per-participant `hiddenAt` that the next message clears. One verb in the UI,
  two mechanics, and the index stays sound.

  ⚠ **This is what corrected the cap** to "created AND still active in" — see
  the entry above. Ownership transfer was the alternative and is worse: it hands
  a slot to somebody who never asked for it.

  **EMOJI NEED NO SCHEMA** — they are Unicode text. ⚠ But never cap or slice a
  message by `.length`: `'👨‍👩‍👧‍👦'.length` is 11, and a naive `slice()` halves a
  surrogate pair and emits invalid UTF-16 that breaks JSON far from the cause.
  Cap by CODE POINTS, never truncate mid-grapheme. The picker is the only real
  cost — most npm emoji pickers ship 200KB–1MB of data, which is a lot hanging
  off a nav-bar panel, so: the native OS picker plus a recents row. ⚠ REACTIONS
  are a different feature (emoji attached TO a message, its own table), not v1,
  and must not be conflated with emoji IN one.

  **TYPING is the highest-frequency write in the product**, and it expires
  rather than stopping. The client throttles to one ping every few seconds while
  typing continues; the server sets a TTL key of a few seconds; the indicator
  clears by EXPIRY. ⚠ Never rely on a "stopped typing" event — the tab closes
  mid-word and the indicator sticks forever. Ephemeral, so the same store as
  presence and never Postgres, and bounded naturally: it is per-conversation, to
  participants only. Transport is §12.46.

  **THE TONE, AND WHY IT IS THE ONLY THING `dnd` CAN HONESTLY DO.** ⚠ Browsers
  block autoplay until the page has been interacted with, so a tone on the first
  message after a fresh load silently fails and `play()` rejects — unlock on the
  first user gesture and handle the rejection rather than letting it throw. It
  must not play for YOUR OWN message, and not when that conversation is open and
  the window focused, or it beeps at you while you read.

  **Chat settings — on/off and a CHOICE of tone — live in `localStorage`, per
  device.** The precedent is already set: the theme preference is stored exactly
  there, for exactly this reason. Someone muting chat at a shared desk means on
  that machine, not on their phone. No schema, no migration, no sync. ⚠ **The
  preview button is not a nicety — it is the unlock**: previewing a tone in
  settings IS the user gesture that makes later playback work. Three to five
  short self-hosted files, mp3 (Safari does not take ogg), mono, tiny; no volume
  slider, because the OS has one. And `dnd` mutes the tone — §12.44 — which is
  the whole of what `dnd` can truthfully claim until a notification system
  exists.

  **UNREAD.** `lastReadMessageId` on `ChatParticipant`, monotonic with the
  keyset ordering `(createdAt, id)`. Counted as messages after it, excluding
  your own and excluding `kind: system` — a join notice is not addressed to
  anybody. ⚠ ONE GROUPED QUERY, never a COUNT per conversation per render, which
  is how the panel becomes the slowest thing in the app; the nav badge is the
  sum. Marked read when the thread is open AND the window focused — not on mount
  alone, or a background tab silently clears them. ⚠ The badge must be right
  BEFORE the panel is opened, which is what makes the header slot a subscribing
  client component rather than a static icon. Mentions ("unread" vs "mentions
  you") are not v1.

  **File preparation is three schema decisions and no code** — `body` nullable,
  `ChatMessage.kind` (`user | system`, `authorId` nullable, earning its place in
  v1 for "X left"), and NO `fileUrl`/`fileName` columns. §12.45 has the rest,
  including the signed URL that is a bearer token.

- **2026-09-10** — **`module-chat`, planned: the first module that is not
  platform, and the four things it breaks on the way in.**

  User-to-user and group messaging over `graphql-ws`. **A DIRECT CHAT IS A GROUP
  WITH TWO PARTICIPANTS** — one table, one state machine, one set of keys. A
  separate `ChatDirect` shape would duplicate every one of them to express a
  participant count, and the first feature to want "add somebody to this DM"
  would have to migrate between them.

  **App level, and it is free.** §12.13 settled that the level comes from the
  URL, so `/chat/*` is app level with no `@RequireScope` and no `getArgs` — the
  trap that made every organization-level key grant nothing for weeks cannot
  fire here, because it only fires below app level. ⚠ The COST is §12.41: an app
  key in a plan entitles nobody, so chat can never be a paid tier while it is
  app level. Accepted deliberately — chat is person-to-person, and two people
  with no organization in common must be able to reach each other. The cap is
  the commercial lever instead.

  **INVITATION IS TO AN EXISTING USER, so there is no token.** `PermInvitation`
  carries a SHA-256 hash, a seven-day expiry and an account-creating accept path
  because an organization invite is addressed to an EMAIL that may have no
  account behind it (§12.31). A chat invite is addressed to a USER who
  definitionally exists — you had to find them to invite them — so the entire
  state machine is a `status` column on `ChatParticipant`:
  `invited → active | declined`, plus `left` and `removed`. Declining KEEPS the
  row so a re-invite flips it back rather than inserting a second one.

  ⚠ **But "find them to invite them" is a user-enumeration oracle**, over
  `auth_user`, which is the exact surface §12.36 refused to expose on sign-up.
  So the lookup is EXACT-EMAIL-MATCH ONLY, behind its own `chat:directory` key,
  rate-limited: you must already know the address, and there is no way to
  harvest a list. Prefix search was rejected — it is a far better type-ahead and
  it is a full staff directory for anyone holding the key. Scoping search to
  shared organizations was rejected harder: it contradicts chat being app level.
  The lookup reads module-auth's table, so it composes APP-SIDE on the seam
  `apps/web-server/src/users/` already occupies. `module-chat` never learns what
  an account is; `userId` is a bare string with no FK, the third module to hold
  one that way.

  **THE CAP HAS NO PATH TODAY, AND SKIPPING IT FAILS SILENTLY.** Three findings,
  all verified against the code before any of this was designed:

  1. `LIMIT_REGISTRY` is a hardcoded const in `module-permissions/src/domain/
     limits.ts`. `FeatureContribution` lives in module-kit and composes in
     `seed/registry.ts`; limits have **no equivalent**. So chat cannot declare
     `chat:group_chats` without permissions importing chat, which §9 forbids.
  2. Skipping it is not an error anywhere. `resolveLimits` only emits keys the
     registry declares, and `checkLimit` fails **OPEN** on an undeclared one —
     "a limit nobody declared is not a limit". A `chat:group_chats` that never
     reached the registry is a cap of infinity that logs nothing.
  3. `assertCapacity` cannot count chat rows. It counts `permMembership` /
     `permWorkspace` inside the permissions transaction, and modules may sit in
     different databases by design. Chat must call the PURE
     `checkLimit(limits, key, current)` with a count it takes itself.

  So module-kit gains a `LimitContribution` (the declaration) and a structural
  `LimitChecker` port (the question), and the app binds the port to the
  permissions service — the same shape as `PermissionsPrismaClient` being
  host-injected and `resolvePrincipal` composing app-side.

  ⚠ **And the role editor cannot set limits at all.** `role-draft.ts` and
  `role-form.tsx` have no limits field, and `createRole`/`updateRole` never
  write `PermRoleLimit` — only plans do, via `replacePlanLimits`. So
  `user:organizations` is set by `upsertAppRole` in the seed and NOWHERE ELSE,
  and "the cap comes from the app-level role" would have meant "the cap comes
  from a deploy". The role editor grows a limits section BEFORE chat starts. It
  is the `/admin/defaults` argument again: what a limit MEANS belongs in a
  review diff, what it is SET to is an operational decision somebody makes at
  3am.

  **The cap counts LIVE CHATS YOU CREATED AND ARE STILL IN** — non-archived
  conversations where `createdById` is you AND your own participant row is
  `active`. Default 20. Archiving frees a slot, so the cap is something you can
  clear rather than a wall; and being invited to a chat costs you nothing,
  because a cap other people can spend on your behalf is a griefing tool, not a
  limit. Counting every chat ever created was rejected for the first reason,
  counting all participation for the second.

  ⚠ **The "and are still in" half was added later the same day, when leaving was
  designed** — see the entry below. Without it, create-twenty-and-leave-them-all
  is unlimited chats. It also means `createdById` never has to move: ownership
  transfer was the alternative and it is strictly worse, because it hands a slot
  to somebody who never asked for it.

  **`directKey` needs no raw SQL — the null works FOR us here.** A direct
  conversation carries a sorted `lowUserId:highUserId` string and a group
  carries null, under a plain Prisma `directKey String? @unique`. §12.19 is the
  case where Postgres treating NULLs as DISTINCT breaks the constraint, because
  there the null rows were the ones that had to be unique; here the null rows
  are groups, which must be free to repeat. So chat is NOT a second caller for
  §12.19, and two simultaneous "message Bob" clicks cannot produce two threads.

  **⚠ WHAT CHAT BREAKS IN THE REALTIME LAYER.** `planChanged` returns a bare
  `asyncIterableIterator` on a global topic: **every subscriber receives every
  event.** Harmless for a plan key that says nothing secret; a message leak for
  chat. And `ws-context.ts` is explicit that a subscription is authorised ONCE
  at subscribe and then streams, bounded only by the socket closing at
  `AUTH_ACCESS_TOKEN_TTL` — so somebody REMOVED from a group would keep
  receiving it for up to fifteen minutes. Both mean the same thing: **events are
  filtered per PUBLISH, re-checking participation each time**, never once at
  subscribe.

  That makes three deferred decisions live at once. §12.39 — the APP owns the
  ONE socket and passes it in, because a `createRealtimeConnection` per module
  is a socket per module per tab. §12.28 — in-memory `PubSub` means a message
  published on replica A never reaches a socket held by replica B, SILENTLY, and
  chat is the feature where that stops being survivable. §12.29 — narrowed by
  putting **mutations on HTTP and subscriptions on WS**: a send then passes
  `ThrottlerGuard`, which skips WebSocket operations, so message-rate limiting
  arrives for free and the open question shrinks to how many topics one socket
  may hold.

  **PARTICIPATION IS NOT PERMISSION**, and this is C1 one table over. All three
  critical findings in PERMISSIONS-REVIEW shared one shape: the guard answered
  "may this user do X" without asking "is X somewhere this user may be".
  `chat:send` says you may use chat; it says nothing about conversation 42. So
  `canAccessConversation` is enforced ON THE SERVER — every read, every send,
  every published event. ⚠ C1's exact failure was a helper that existed, was
  exported, was used by the React layer, and was never called server-side. It
  gets tests before it gets a screen.

  **Keys**, atomic and split by risk, per the vocabulary decision of 2026-09-09:
  `chat:read`, `chat:start` (where the cap is counted), `chat:invite`,
  `chat:remove_participant`, `chat:send`, `chat:moderate` (`isPrivileged` —
  deleting somebody else's message in a conversation you are IN), and
  `chat:directory`. Leaving a conversation yourself gets no key: withholding it
  would be a lockout dressed as a permission, the rule module-auth's `account:*`
  removal already established. No read-any-conversation key at all — §12.42.

  **Build order — seven commits, and the first two touch no chat code:**
  1. ✅ **DONE 2026-09-11.** `module-kit`: `LimitContribution` + the
     `LimitChecker` port — plus the enforcing half in `module-permissions`
     (`limitRegistry`, `checkDeclaredLimit`, `checkLimitForActor`,
     `PermissionsLimitChecker`), which the premise turned out to require.
  2. ✅ **DONE 2026-09-11.** `module-permissions`: role-editor limits — draft,
     form, write path, plus the `permissionLimits` query the form needs to see a
     contributed cap at all.
  3. ✅ **DONE 2026-09-11.** `module-chat`: schema + pure domain. The state
     machine, `canAccessConversation`, the cap rule. No database, no framework.
     ⚠ The app does not depend on the package yet — adopting it is what creates
     the tables, which belongs with step 4's migration.
  4. ✅ **DONE 2026-09-11.** Server: repository, read/write services on
     separate clients, GraphQL, participation enforced on every path — plus the
     app adopting the package, which is what created the tables.
  5. ✅ **DONE 2026-09-11**, in two commits. Realtime: per-publish filter, a
     `graphql_subscription` binding, CATCH-UP ON EVERY (RE)SUBSCRIBE — the
     socket closes when its authorization expires by design and the pub/sub has
     no replay, so a message published in the gap is lost without it — and the
     APP-OWNED CONNECTION (§12.39), one socket per tab rather than one per
     module.
  6. ✅ **DONE 2026-09-11.** `module-kit`: a nav BADGE a module hangs off its own
     drawer entry, plus the chat count that fills it — a subscribing client
     component, because the number must be right without a navigation. `/chat`
     is contributed as a STUB, so the whole path is proven before step 7 fills
     the page. ⚠ Built first as a HEADER SLOT and reversed the same day: chat is
     in the drawer, and the top nav would have been a second door to one place.
     That leaves §12.52 open — the panel had nothing else to anchor to.
  7. ✅ **DONE 2026-09-11.** Web: `/chat`, the list, the thread, the composer,
     the invite flow and the requests inbox. ⚠ NO ANCHORED PANEL — §12.52 is
     closed the way the header icon's removal pointed: `/chat` is the only home,
     and a panel can return the day something exists to anchor it to.
  8. ✅ **DONE 2026-09-11**, in three commits. The ephemeral tier: presence as a
     refcount with a grace period, availability as an enum with a derived
     `clearAt`, typing on a TTL — plus the `onDisconnect`/`onPing` seam
     `graphql.options.ts` did not wire, and the dot, the picker and the
     indicator on screen.
  8b. ✅ **DONE 2026-09-12**, in several commits, and NOT ON THIS LIST when it
     was written. Group roles: who runs a group as rules first, then enforced,
     then the app level reaching down into one (`chat:manage_all`), then a
     settings page, then — because roles created two default-shaped decisions
     — **the third declaration**, `DefaultContribution`, which is a
     `module-kit` port rather than a chat feature. Recorded here rather than
     folded into step 9: the list is the honest account of what was built, and
     a step that appeared because something earlier had a consequence is the
     most useful kind to write down. See §12.54 and the 2026-09-12 entries.
  9. ✅ **DONE 2026-09-13**, in two commits. Tone, chat settings in
     `localStorage`, and the grouped unread query — which was the bigger half,
     because two comments already claimed it existed.
  10. ✅ **DONE 2026-09-13.** Redis (§12.28), shipped as a CONFIGURATION rather
     than the planned code swap, at the operator's request: `REDIS_URL` alone
     chooses the engine, and nothing else changes.

  ⚠ Steps 8 and 9 are last for a reason: every one of them is a nicety over a
  conversation that has to work first, and each is cheap to add and expensive to
  retrofit UNDER something already shipped. The schema they need —
  `lastReadMessageId`, `kind`, nullable `body` — lands in step 3 with everything
  else.

  Steps 1 and 2 are their own commits for the reason §12.27 was left out of the
  commit that revealed it was possible: a change to what every role can express
  does not belong in the feature that wanted it.

  ⚠ Messages page by KEYSET on `(createdAt, id)`, not the `limit`/`offset` every
  grid in this repo uses. Offset paging over an append-heavy list re-shows rows
  every time somebody posts while you are scrolling.

- **2026-09-09** — **The tenant vocabulary is ATOMIC, and three keys narrowed to
  app level.**

  `/organizations/*` shipped on the coarse keys that already existed.
  `members:manage` carried NINE bindings — reading the roster, inviting,
  revoking, removing and re-roling — so an organization could not have anybody
  who invites without also letting them remove, or anybody who reads the roster
  without letting them empty it. Both are ordinary roles. Split by RISK, the
  argument `roles:manage` and `features:author` already made.

  | was | now |
  |---|---|
  | `members:manage` | `members:read` · `members:invite` · `members:remove` · `members:assign_role` |
  | `workspaces:manage` | `workspaces:read` · `workspaces:create` · `workspaces:update` · `workspaces:archive` |
  | `workspaces:share` | `workspace:read` · `workspace:members_add` · `workspace:members_remove` · `workspace:assign_role` |
  | `organization:manage` | `organization:update` |

  **Singular is inside one, plural is the tenant's list of them.**
  `workspace:read` is workspace level — the one you are standing in;
  `workspaces:read` is organization level — the list. The same convention as
  `organization:read` beside `organizations:read`, which now makes two pairs a
  letter apart. Safe because a role may only collect features its own level
  reaches: a workspace role is offered none of the plural keys and the draft
  validator refuses one that names them.

  **⚠ THREE KEYS MOVED TO APP LEVEL**, which narrows them to app-level roles and
  removes them from every plan:

  - `billing:manage` — a WRITE, and every other write of its kind is app level.
    None of its three mutations declares a scope, so all three resolve at app
    level and an organization grant participated in nothing. It was sold by
    every tier and exercisable through none.
  - `features:read`, `plans:read` — everything bound to them (`/admin/*`, the
    unscoped queries) resolves at app level too.

  That closes the "sold but unreachable" finding: the catalogue check now
  reports zero. `roles:read` and `subscriptions:read` stay at organization
  level, because `myOrganizationRoles` and `myOrganizationSubscriptions` are
  genuine tenant surfaces.

  **The rule that decides a level, stated once:** a key sits at the LOWEST level
  at which it has a surface. A right a tenant may exercise is declared where the
  tenant is; a right only staff may exercise is app level, and then no plan can
  carry it and no tenant role can hold it.

  **`free` gained the reads.** Withholding `members:manage` from it used to hide
  the member list, because reading was bundled with changing — invisible while
  it was one key and plainly wrong once they were separate. A tier with three
  seats must be able to see who is in them.

  **`workspace-user` stopped being empty.** It granted nothing because opening a
  workspace took no key; now that `workspace:read` exists, an empty role would
  mean somebody who is IN a workspace and cannot open it.

  Migration: the four retired keys are DEPRECATED rather than deleted —
  `syncFeatureRegistry` marks any row absent from the registry, and
  `loadContext` already refuses a deprecated key, so a role still holding one
  simply stops granting it, reversibly. The seeded presets are `isSystem` and
  `db:sync` REPLACES what they grant. ⚠ Live PLANS are not rewritten by
  `createPlanIfAbsent` (§12.26), so they had to be pushed through
  `updatePlan` — which is the operator path, and the one a fresh environment
  will not need.

  Verified against the live database: 95 plan and tenant-role rows, none
  carrying an app-level key and none carrying a deprecated one; the four
  presets re-seeded to 16/15/4/4 keys; and a super-admin resolving all 37.

- **2026-09-09** — **`/organizations/*` — the tenant-facing area, and the
  active-organization scope it needed. Closes §12.13.**

  Every screen a customer has of their OWN organization: a picker, an overview,
  members and invitations, workspaces, one workspace, the subscription, and
  settings. Plus an organization SWITCHER at the top of the drawer, which
  replaced the brand mark.

  **The active organization comes from the URL, and from nothing else.**
  `/organizations/:orgId/...` is organization level and
  `/organizations/:orgId/workspaces/:wsId/...` is workspace level — the
  convention `scope.ts` has defined since it was written, and which nothing
  used. Not a header (forgettable, and invisible in a bug report), not a
  subdomain (a DNS record per tenant), and NOT the token: baking the active
  tenant into a week-long credential makes switching organization require a new
  sign-in, which `resolve-principal.ts` already said.

  **What was actually broken, and it was not the screens.** `@RequireScope`
  existed, was tested, and was on no resolver. A GraphQL resolver has no path,
  so the guard fell back to `parseScope('/api/v1/graphql')` — app level, no
  organization, whatever the arguments said. So an ORGANIZATION-LEVEL ROLE
  GRANTED NOTHING ANYWHERE: `members:manage`, `workspaces:manage` and
  `subscriptions:read` had never once resolved for a customer, and the refusal
  read as an ordinary "requires members:manage" at somebody holding
  `members:manage`. Thirteen operations now declare their scope. Nothing
  changes for platform staff — an app-level grant unions in unfiltered
  whatever the scope (§12.14).

  **`myPermissions` gained an optional scope, for the same reason.** A context
  is always per (subject, organization) — the type says so — and the shell asked
  for one with no organization on every render, so a member whose only role is
  inside a tenant resolved to nothing: empty drawer, every `<FeatureGate>`
  closed, on pages the API would have served. Passing an organization you have
  no standing in is safe: `loadContext` returns null for a pair with none, so
  the answer is "you hold nothing", never anything about that tenant.

  **`resolveScope` had to learn that the DECLARED level decides which ids are
  read.** It inferred the level from whichever ids were present, so
  `updateWorkspace` — organization level, takes a workspaceId — resolved one
  level deeper than it declared and the consistency check refused it for
  disagreeing with itself. `workspaces:manage` is the right to manage a tenant's
  workspaces; renaming one is not entering it.

  **Two new keys, one letter apart, and that is deliberate.**
  `organization:read` and `organization:manage` are ORGANIZATION level, beside
  the APP-level `organizations:read` and `organizations:manage`. §12.13's own
  entry predicted the pair: "rename any tenant" and "rename mine" are different
  rights, and one key for both hands the first to every customer. The near
  collision is safe because a role may only collect features at its own level,
  so the plural is unofferable to an organization role — `assertRoleDefinable`
  refuses it, which is a check rather than a comment.

  Membership alone was considered and rejected as the gate. It is the smaller
  change and §12.23 argues for it — a key only where AUTHORISATION is needed —
  but enforcement here is opt-in, so "members only" would have to be
  re-implemented in every tenant query and the first one to forget would be
  readable by anyone signed in.

  **The first WORKSPACE-level surface in the codebase.** `Query.myWorkspace`
  declares `@RequireScope('workspace')`, so the guard runs `canAccessWorkspace`
  before any feature question — §12.33 ("membership is required, no role widens
  it") enforced rather than described. It had never run against a real caller.
  The visible consequence, which will look like a bug the first time: an
  organization administrator who is not IN a workspace is refused it, and
  renames it from the workspaces list instead.

  **A gap this surfaced rather than created: `createWorkspace` added no
  member.** Under required membership, a tenant administrator could create a
  workspace and be refused entry to their own, with the only way in being
  `workspaces:share` — itself a workspace-level key, so it resolves inside a
  workspace they may not enter. A tenant could reach a state it could not leave
  without platform staff. The creator is now added in the same transaction,
  with NO role — the same argument `createOrganization` makes for its founder,
  one level down. Platform staff join nothing: they hold no membership to hang
  it off, and enter by `platform:support_access`.

  **A ROLE ICON DRAWS THE PERSON, NOT THE PLACE** — and two seeded roles were
  breaking it, which showed up the moment the switchers started drawing role
  badges beside other things.

  `normal-user` was a `sprout`, which is also the FREE PLAN's icon, and the
  organization switcher puts a viewer's role and their organization's plan on
  one line separated by a middot: a normal user on the free plan rendered the
  same glyph twice. Worse than looking like a rendering fault, it invited the
  reading that a role and a plan are the same kind of thing — the distinction
  §9's twins rule spends real effort keeping. The growth metaphor stays with the
  free plan, where a tier legitimately has a bottom; the role became `id-card`,
  because a role holding nothing is an identity with no powers attached, not a
  tier.

  `workspace-admin` was the `workspace` glyph, which names the drawer's
  Workspace NAV GROUP — and the workspace selector draws this role's badge a few
  pixels above it, so one drawing meant "the place you are in" and "what you are
  in it" at once. It became `user-cog`, pairing with `user` for the workspace
  member: the same person, one of them able to change things.

  The rule was being followed everywhere else without having been written down —
  `user`, `users`, a crown — and these were the two exceptions. Icons are
  overwritten on every `db:sync` (`registry-sync` treats the definition as the
  whole truth about the role), so changing the seed is the whole change.

  ## `/admin/defaults` — what the platform does when nobody said what to do

  **One screen for a question that was being answered in four places.** The
  permission model is ADDITIVE, so there is no default-on, and four creation
  paths each ended with somebody holding nothing: an organization's founder was
  a member of it with no role, a workspace's creator could enter and do nothing,
  a new organization was on no plan and therefore entitled to nothing, and a new
  account held nothing at all. Each had been patched where it hurt — a module
  option here, a sentence on a screen there. This is the same question asked
  once.

  **A CATALOGUE in code, values in a table** — the same split `PermFeature`
  makes with the feature registry. What a default MEANS (what it applies to,
  what kind of thing it points at, what happens while it is unset) belongs in a
  review diff; what it is SET to is an operational decision somebody makes at
  3am. Adding a default is therefore a code change, never an inserted row.
  ⚠ A row whose key the catalogue does not declare is IGNORED, so a typo cannot
  become policy and a key retired in a later build stops applying the moment the
  code stops declaring it.

  ⚠ **`defaults:manage` IS THE ESCALATION DECISION, and no check can substitute
  for it.** `assignRole` refuses a role carrying features the granter does not
  hold, so nobody can mint somebody more powerful than themselves. Nothing
  equivalent can run for a default: the founder's role is granted by the
  PLATFORM, with no actor to compare against. Whoever holds this key decides,
  once, what every founder from then on will hold. It is `isPrivileged`, the
  screen says so above the first control, and the feature's own description says
  what it hands over rather than what it is called.

  **A default must never become a gate.** Every consumption is silent on
  failure — unset, a role since deleted or disabled, a plan since archived — and
  the account, organization or workspace is still created. Refusing to create a
  company because a default was renamed would be far worse than the state that
  existed before the feature, which is exactly what null falls back to. An
  archived plan is SKIPPED rather than refused on the way in, because an
  archived plan entitles nothing and a subscription to one would be a row that
  looks live and grants nothing.

  **It never overwrites a choice.** The organization member default applies only
  to somebody actually JOINING, never to an existing member — an invitation
  naming no role is not a request to change anything, and the inviter is looking
  at an address rather than at an account. That is the same lesson the app-role
  half of `acceptInvitation` had already learned the hard way.

  **Two constraints on what may be chosen**, both enforced on the write and
  mirrored in the picker so the screen cannot offer what the server refuses:
  `organizationId: null` (GLOBAL role definitions only — a tenant's own role as
  the founder default would try to grant every new organization a role belonging
  to another company), and the LEVEL implied by the slot (a role's level is
  immutable, and the wrong one would be granted and then filtered out by the
  resolution order, producing an account that holds nothing for a reason no
  screen could explain).

  **`defaultAppRoleKey` became the FALLBACK, not the answer.** The module option
  is consulted only when the stored default does not resolve, and it is kept
  rather than removed so a deployment that never opens the screen behaves
  exactly as it did — every default starts unset and the migration seeds
  nothing, so on the day this shipped nothing changed anywhere. Clearing on the
  screen hands the question back to the option rather than turning the baseline
  off: a null row and no row are the same answer, "nobody has decided".

  **Nine defaults across six moments**, grouped by the moment because somebody
  arrives asking "what happens when a workspace is created", not "which of these
  point at a role": the app role for a new account; the founder's role, the
  plan, that subscription's status and its first period for a new organization;
  the role for somebody joining an organization; how long an invitation stays
  valid; the creator's role and the member's role for a workspace. ⚠ The period length is INFORMATIONAL — an `active` row entitles
  regardless of `currentPeriodEnd` (§12.40) — so it records an intention for a
  billing provider and expires nothing on its own, which the screen says where
  somebody would otherwise read "first period length" as a trial that ends by
  itself. It is seeded all the same; see the seeder for why a recorded intention
  beats a null.

  The invitation lifetime arrived after the first eight and is what the
  catalogue shape was for: it needed no schema change, no mutation and no screen
  work — one registry entry and one call site.

  **A `permissions:defaults` SEEDER decides the ones nobody has**, so a fresh
  environment is not born with all of them blank — a working state, and a bad
  first impression: a founder who cannot administer the company they just
  created, on an organization entitled to nothing. It is 'sync' rather than
  'seed' because a deployment that never runs the fixtures still needs a sane
  answer to "what does a new account hold".

  ⚠ **It writes only a row that is ABSENT, never one whose value is null**, and
  that distinction is the whole reason `setDefault` clears by writing null
  rather than deleting. No row means nobody has decided, and the seeder decides;
  a null value means somebody deliberately turned it off from the screen, with
  `updatedByUserId` recording who — refilling that would overrule an operator
  with a hardcoded opinion on the next deploy. It is also what makes the seeder
  idempotent: a second run finds every row present and writes nothing.

  Its choices are the least-privileged ones that still make the process WORK,
  because a seeded default is an escalation decision nobody made deliberately.
  The founder is the exception and barely one — `organization-owner`, because
  they created the company, they are its only member, and the alternative is an
  organization nobody can administer. The plan is DERIVED (smallest public live
  one) rather than named, since the catalogue is a product decision the seeder
  does not own, and a role the presets do not include is skipped with a log line
  rather than failing a deploy.

  ⚠ The one seeded value whose meaning depends on something that does not exist
  is the FIRST PERIOD, at thirty days. Nothing compares a subscription to the
  clock (§12.40), so it writes a renewal date the guard ignores. It is seeded
  anyway, because the alternative is worse in the other direction: every
  subscription the platform creates would carry no period at all, and the day a
  billing provider is wired in it inherits a backlog of rows with nothing to
  bill from — no cycle start, no cycle length. A recorded intention is something
  to reconcile; a null is a gap somebody has to reconstruct.

  ⚠ **Invitation expiry is DERIVED**, not written into a status: `isAcceptable`
  compares the row's date to the clock on every read. So the lifetime written at
  send time is what that comparison uses for the life of the row, and shortening
  the default retires invitations already sent as well as future ones. That is
  the honest behaviour for a security window — the alternative would mean a
  shortened window not applying to the invitations somebody shortened it because
  of — and the screen says so. A value that cannot be read falls back to the
  built-in seven days rather than to zero, which is the one failure a fail-soft
  default must not have: every invitation would arrive already expired.

  **There is deliberately NO default plan for a workspace**, and the reason is
  that one would change nothing. A WORKSPACE INHERITS ITS ORGANIZATION'S PLAN
  already: the entitlement query reads
  `OR: [{ workspaceId: null }, { workspaceId }]`, so the organization-wide row
  applies to workspace-level requests without anything being set. A default
  subscribing every new workspace to a plan of its own would write a redundant
  row that entitles what the workspace was entitled to anyway — and a second
  place for entitlement to come from is a second place for it to disagree.

  Workspace-scoped subscriptions remain in the model, because selling one
  workspace something the rest of the organization does not have is a real thing
  to want. It is a deliberate act on the Subscriptions screen, not a default.

  The platform invite form needed no change. It already leaves the app role
  blank, and blank now means "use the configured default" — the form was right
  before the default existed and is right after it.

  **The page takes `defaults:read` and gates only its INPUTS on manage.**
  Working out why a customer's founder holds nothing is a support question, and
  a route keyed on the write would hide the answer from everybody who may not
  change it. Without the write key the value still shows as text — a disabled
  select makes a reader wonder what they are missing.

  **`leaveOrganization` is unguarded by any feature.** Walking out is the other
  end of the membership that put you there; a key for it would be one an
  administrator could withhold to keep somebody in. It takes no userId, like
  `acceptInvitation`. The LAST active member is refused — an organization with
  nobody in it is unreachable by anyone — checked BEFORE the delete rather than
  rolled back after it, so the rule does not depend on a transaction. A
  suspended member is exempt: they occupy no active seat, and leaving is
  exactly what somebody suspended wants.

  **The tenant presets are no longer empty.** `organization-owner`,
  `organization-admin`, `organization-user` and `workspace-admin` had carried
  nothing, each saying "EMPTY until the registry has features that are
  genuinely about running an organization". That condition is now met, and
  leaving them empty would have meant the screens existed and only
  `super-admin` could open them. `billing:manage` stays out — it is
  organization level and could go in, but there is no tenant-facing write
  surface for it and billing is unbuilt (§12.40), so it would be decorative
  coverage. The `account:*` keys are app level and were refused outright by
  `assertRoleDefinable` when first added, which is the model working.

  **The drawer gains an `Organization` section while one is SELECTED.** Its
  five entries — Overview, Members, Workspaces, Subscription, Settings —
  drill into whichever organization the switcher is on.

  The heading is the static word, not the tenant's name. It drew the name
  briefly and that was worse: the switcher sits directly above it and already
  says which organization you are in, so the name appeared twice within two rows
  and the second carried nothing the first had not. `NavGroup` grew a `label`
  beside its `group` for that substitution and lost it again with it — an
  abstraction kept for a case nobody has is worse than none.

  **The selection PERSISTS, so it is a cookie.** It used to come from the URL
  alone, so the section vanished the moment somebody opened the dashboard and
  came back changed; a switcher whose effect disappears when you navigate is a
  filter, not a switcher. `kwtech_active_organization` follows the sidebar
  width's precedent exactly — a cookie rather than localStorage because the
  shell is a Server Component, so a whole block of navigation is in the first
  paint instead of appearing a beat late on every page.

  **⚠ Naming the selection is not the same as resolving it.** The id followed
  the URL from the start; the switcher LABELLED it by finding it in the viewer's
  own organizations, which is right for a member and wrong for the one case that
  matters — platform staff drilling into a customer from `/admin/organizations`.
  There the Organization section rendered (their app-level grants resolve in any
  tenant) while the switcher above it fell back to the product name: the header
  contradicting the content. It now fetches that tenant's identity on that path
  only, and says "Not a member — viewing" rather than implying a membership. The
  detail query is reused rather than a lightweight one added, because a second
  `permOrganization.findFirst` shape means an overload the generated Prisma
  client cannot satisfy — the same wall `listWorkspaceDetail` hit.

  **Sign-out clears both selections; a refresh and a browser restart keep
  them.** They name a CUSTOMER, so leaving one behind on a shared machine after
  somebody signed out is residue nobody expects — unlike the sidebar width and
  the theme, which are facts about how a person likes their browser and survive.
  `signout-all` clears them too: somebody using it to secure a shared machine is
  the last person who should come back to a drawer still opened on their
  company. A session RENEWAL does not, which is the distinction that matters —
  renewing is not ending.

  The deletion lives in the APP's auth route, which stopped being a one-line
  re-export for it. `module-auth` clears what it owns and must not know that
  another module has a notion of a selected organization; `module-permissions`
  has no route and no opinion about when a session ends. Composing them is the
  app's job, the same as `resolvePrincipal` and `AppShell` already do.

  Order of resolution: **the URL wins** (you are looking at that tenant's page,
  so the drawer beside it must be that tenant's — including for platform staff
  inside a customer they do not belong to), then the cookie, and only if it
  names an organization the viewer is actually in. ⚠ **The cookie is not
  authorisation** and nothing treats it as such: a forged value is refused
  against the session's own organization list, and everything it reaches is
  authorised again server-side at its own scope.

  **One request serves the whole drawer.** `getNavContext` asks `myPermissions`
  three times under aliases — app level, the selected organization, the selected
  workspace — plus `myWorkspaces`, so every filter level and the selector's
  contents arrive together. Nothing extra is fetched when no organization is
  selected.

  The workspace id goes in RAW, before validation: validating it needs the
  `workspaces` list the same request returns, so asking first would be circular.
  That is safe for the reason the organization id is — `loadContext` returns
  null for a triple the caller has no standing in — and the id is checked
  against the list afterwards anyway.

  **⚠ THREE grant sets, because the drawer spans three levels**, and each is
  wrong for the others' entries. This was a real
  regression, caught by running it: filtering the whole drawer with the selected
  organization's context offered `/admin/roles` to an organization admin — whose
  `roles:read` is an ORGANIZATION-level key that also gates that app-level
  screen — and the page then rendered a denial. The drawer listed a link its own
  page refused, which is exactly the mismatch one shared feature key exists to
  prevent. Entries are now filtered at the level of the route they point at:
  app-level grants for `/admin/*` and the app's own pages, the selected
  organization's for the tenant section, the workspace's for the workspace
  section.

  The third exists for the OPPOSITE failure to the first: a workspace-level key
  hangs off a workspace membership, so an organization-scoped context does not
  carry it at all — filtering that section with the organization's grants would
  hide a page from exactly the people who hold the right to it. Nothing needs it
  today (the one route there takes `organization:read`), and the next page added
  beside it will.

  The organization-scoped grants are also kept OUT of `<PermissionsProvider>`.
  Every `<FeatureGate>` in the page reads that, and a gate evaluating against a
  tenant while the page is an admin screen would show controls the API refuses.
  The provider keeps the page's own context; the nav grants feed `buildNav` and
  stop there.

  **A workspace has an Overview and a Settings**, mirroring the organization.
  It was one page called "Overview" that held a rename form, the member list and
  an archive control — not an overview, and the label said something the page
  did not do. The editing moved; the member list stayed on the Overview, because
  members are not settings and "who is in this workspace" is the first thing
  somebody opening one wants. A workspace has too few people to earn a third
  page, so it earns the first one instead.

  Settings takes `organization:read` with `workspaces:manage` on the controls
  inside, so a bookmark followed without it shows what the workspace is called
  rather than a denial — the shape the organization's Settings already has. The
  Overview only offers the link to somebody holding the key.

  **Organizations and workspaces have a `description`.** Nullable, because
  inventing one for a row that has none is worse than an empty field, and
  backfilled from `name` in the migration so nothing reads blank on a screen
  that suddenly has the field. ⚠ It carries no information the name does not —
  that is what "initial" means here: a placeholder occupying the field, not
  something anybody wrote. Every create and update path defaults a blank one to
  the name through ONE function, so the four writes cannot disagree.

  ⚠ **It was briefly invisible on the overviews, and that was a mistake worth
  recording.** They showed the description as the page SUBTITLE, falling back to
  the key when it equalled the name — which is every row, because the backfill
  copies the name. So the field could not be seen on the one page somebody would
  look for it, and a value you cannot see is a value you cannot tell is a
  placeholder. Both overviews now give it a labelled block of its own, always
  rendered, saying so when it is still the name. The compact picker at
  `/organizations` keeps the fallback: a list row repeating its own title reads
  as a rendering fault, and the key is the more useful second line there.

  **The drawer has THREE scoped sections, one per level.** `Organization` while
  a tenant is selected, `Workspace` while a workspace is, `Administration` for
  platform staff. Neither tenant section lists the other's contents — each holds
  the pages scoped to that level, which is the split the URL already makes.

  The workspaces LIST is not a drawer entry. Entering a workspace is the
  selector's job; that screen is where workspaces are created, renamed and
  archived — administering the organization rather than working in one — so it
  is reached from the organization's overview instead. A drawer entry beside the
  selector would be a second route to the same place, and the two would drift.

  **A workspace with no role says "No role", not its key.** The key was the
  fallback and it answered a question nobody asked: a workspace named "Design"
  keyed `design` produced a row reading "Design" over "design", which looks like
  a rendering fault — and it left the ROLE invisible in the state where it is
  most worth saying. That state is the COMMON one: `createWorkspace` puts its
  creator in the workspace and grants no role, and `addWorkspaceMember` does the
  same, so somebody in three workspaces ordinarily holds a role in none of them
  until an administrator assigns one. Membership is what entry rests on (§12.33);
  a role is what you may DO there, and the two are separate on purpose.

  It is the wording `/organizations` already uses one level up for the same
  state. ⚠ Deliberately not "Member": platform support reaches every workspace
  while belonging to none, and their rows come back roleless too — "No role" is
  true for both, "Member" would be a claim about standing the selector cannot
  check.

  **Both selectors name the viewer's ROLE, icon first.** The organization one
  showed the label as plain text and the workspace one showed only a name, so
  "what am I in this place" was answered at one level and not the other. They
  read the same way now, which is what makes the pair legible as one control.

  The workspace role could not be read from the organization side at all: it
  hangs off `PermWorkspaceMember`, the schema making "a workspace role for
  somebody not in the workspace" impossible to express. `myWorkspaces` returns
  it, from a second small read joined by id rather than an `include` reaching
  workspace → members → roles and filtering to one person — a shape the
  structural client can only express by growing a clause every caller then has
  to satisfy. ⚠ That read is scoped by organization AND user, so the
  cross-tenant workspace-membership row §12.34 still permits cannot supply a
  badge; a test covers it.

  Platform support holds no role anywhere, so every row comes back roleless and
  the selectors fall back to the key — the honest answer for somebody visiting.

  **A WORKSPACE SELECTOR sits under the organization one**, indented with an
  elbow rule and drawn lighter, because a workspace only means something within
  an organization — the same key can exist in two tenants and they are different
  places. Two pickers at equal weight would invite exactly the wrong reading:
  two independent choices.

  It is a real `<button disabled>` with no organization selected, not a menu
  onto an empty list — the second is the shape that makes people click twice and
  then file a bug — and its tooltip says what to do rather than what went wrong.

  **It lists what the viewer may ENTER, not what the organization has.**
  `myWorkspaces(organizationId)` resolves their own `accessibleWorkspaceIds`
  into names, so §12.33 decides the contents: membership is required and no role
  widens it, and a picker offering the rest would list rows the guard refuses on
  arrival. Unguarded by any feature, like `myOrganizations` — the list cannot
  disclose a workspace they may not enter, and ⚠ requiring `organization:read`
  would have hidden a workspace from somebody who is IN it but holds nothing at
  organization level. Archived workspaces are excluded: they stop resolving, so
  offering one promises somewhere nobody can go.

  **The workspace selector offers "New workspace"**, mirroring the organization
  switcher's "New organization" and going to
  `/organizations/:organizationId/workspaces/new`. There is no app-level
  `/workspaces/new` and cannot be: a workspace is created INSIDE an
  organization, so the create screen lives on the tenant path where the guard
  reads the level from. It matters most in the empty state — an organization
  whose workspaces the viewer is in none of shows a menu with nothing in it, and
  a picker offering no way forward is where somebody stops.

  ⚠ It is GATED on `workspaces:create` where the organization one is ungated,
  and the asymmetry is the model's: creating an organization is bounded by the
  `user:organizations` LIMIT because there is no organization yet to grant the
  right, while creating a workspace is a right a tenant grants. The shell reads
  it from the ORGANIZATION-scoped half of the viewer's grants — the app-level
  reading carries no organization-level key, so filtering on that would hide the
  item from everybody who holds it.

  The screen does NOT replace the inline row on the workspaces grid. That one is
  for somebody already administering the list, who would be slowed by a page
  turn for two fields; this is for somebody in the selector, who is not on that
  screen and may not know it exists. They share the one write and no markup, and
  the description field — which does not fit on an inline row — is what the page
  adds.

  ⚠ `/organizations/:organizationId/workspaces/new` is the SECOND literal that
  collides with the scope convention, and it lands one level deeper than
  `/organizations/new`: `parseScope` reads the trailing `new` as a workspace id
  and calls it workspace level. That reading would be actively wrong rather than
  merely closed — the page is gated on `workspaces:create`, an
  ORGANIZATION-level key no workspace-level context can carry, so it would
  refuse everybody with a message about their roles. The router saves it, the
  catch-all reads the captured params, and the test that pins the two readings
  now exempts create screens explicitly and asserts which routes the exemption
  covers.

  **Changing organization unselects the workspace by ARITHMETIC.** Nothing
  clears the cookie. It is validated against the SELECTED organization's
  accessible workspaces, so one remembered from another tenant is simply not in
  the list — which also covers the cases a cleanup step would have missed: a
  workspace the viewer was removed from, and one since archived.

  **There is no `/organizations` drawer entry.** Switching organization is the
  switcher's job, and it already offers "All organizations" and "New
  organization"; a drawer entry beside it would be a second control for one act.
  The route still exists and is still reachable — it simply declares no `nav`.

  **The section appears by ARITHMETIC, not by a mode.** `composeNav` fills
  `:params` and DROPS an entry whose parameters it cannot fill — a link with
  `:organizationId` still in it 404s, one with the segment removed points at
  somebody else's page. So a route added to that section later behaves correctly
  just by having the parameter in its path.

  **The catch-all reads its scope from the MATCHED ROUTE, not by parsing the
  path again.** More correct on one path: `parseScope` knows nothing about which
  routes exist, so it reads `/organizations/new` as an organization whose id is
  "new". It fails closed, but the consequence was a create page whose drawer had
  quietly lost every keyed entry. A test pins the two readings together for
  every dynamic tenant route.

  **The mark draws the PLAN, not the initials.** The square at the head of the
  drawer used to hold two letters derived from the name printed immediately
  beside it — saying a second time what the label already said. It now holds the
  plan's icon and names the plan on hover, because that is a fact about the
  organization which appears nowhere else in the chrome and is the one that
  changes what the product will let you do.

  ⚠ The trade is real: COLLAPSED, that square is all that is left of the row, so
  two organizations on the same plan look identical there. The button keeps
  naming the tenant in that state and the card names the plan, so both facts are
  one hover apart. Falling back to the initials while collapsed is a one-line
  change if the at-a-glance answer turns out to matter more.

  **The hover is a CARD, not a `title`.** A native tooltip could say one line,
  could not draw the plan's icon, and — collapsed, where the square IS the
  button — won over the button's own tooltip and took the tenant's name off the
  screen. The card carries the plan's icon and label, its KEY (the handle that
  never changes, so "we are on the wrong plan" is answerable), how much the plan
  includes, and the organization it applies to.

  Hand-built rather than a component: `web-ui` ships no tooltip, and a Radix one
  would need a portal nested inside a dropdown TRIGGER, where the two fight over
  the same pointer events and the menu starts opening on hover. It is an
  absolutely positioned span revealed by `group-hover` on the mark and by
  `group-focus-visible` on the trigger, so it is reachable without a pointer,
  and `pointer-events-none` so it can never intercept the click that opens the
  menu. ⚠ Everything in it is PHRASING content — it renders inside a `<button>`,
  where a `<div>` or an `<a>` is invalid and gets hoisted out by the browser,
  which then looks like a CSS bug. That is also why the subscription line is a
  sentence rather than a link.

  **"How much it includes" has THREE states**, and the third is not a smaller
  second: a number, `0` for an organization on no plan — entitled to nothing,
  where every organization starts — and `null` for a deployment with no
  entitlement model at all, which entitles everything. Reporting that last one
  as "includes 0" would be flatly wrong, so the null is carried from
  `myPermissions` all the way to the card rather than defaulted on the way. One
  helper produces the sentence for both the card and the trigger's `sr-only`
  text, so the spoken and drawn versions cannot drift.

  The count comes from `entitled` on the ORGANIZATION-scoped reading, added to
  the drawer's existing query — the app-level context carries no entitlement for
  a customer at all. It needs no key for the same reason the plan's name does
  not: `myPermissions` answers only about the caller, and this is the fact the
  guard already acts on for every request they make. The line offering the
  Subscription screen appears only with `subscriptions:read`, because pointing
  everybody at a door half of them are refused is worse than not mentioning it.

  Null draws the initials and claims NOTHING. For a MEMBER it means one thing —
  "on no plan", where every organization starts — because the query it rides on
  cannot refuse. For staff VISITING a customer it also covers "may not read
  subscriptions", and the switcher does not tell the two apart: saying "No plan"
  at somebody who was merely refused would be a confident wrong answer, the same
  call the overview's em dash makes. A plan that chose no icon falls back too,
  because `iconFor` answers a generic circle for an unknown name and a circle
  there would decorate an absence. The plan is also said in the trigger's
  `sr-only` text, since the mark is `aria-hidden` and a `title` on a hidden
  element is announced by nobody.

  **EVERY ROW NAMES ITS ROLE AND ITS PLAN**, not just the selected one. The menu
  is where somebody chooses BETWEEN tenants, and "which of these is on
  Enterprise" was a question the list could not answer while the plan lived only
  on the trigger. One meta line per row — role, then plan, separated by a middot
  — so a row stays two lines tall whatever it has to say. The role falls back to
  the organization's KEY, matching the trigger and the workspace selector; the
  plan simply drops out when there is none, because "No plan" beside a role
  would read as a warning about a state that is normal for a new organization.

  ⚠ **The plan rides on `myOrganizations`, which is UNGATED** — a deliberate
  reading of the boundary, recorded here because it is the kind of decision that
  looks like a leak to whoever finds it next. `subscriptions:read` protects the
  commercial RECORD: status, renewal dates, ended rows, per-workspace
  subscriptions, and any of it for a tenant you are not in. The plan's key,
  label and icon are not that — `myPermissions` already publishes `entitled` to
  every member ungated, and the entitlements ARE what the plan grants, so
  withholding the plan's NAME while publishing its effects would protect nothing
  and would leave the switcher unable to say what a member is already told.
  `UserOrganization` therefore carries plan IDENTITY only; a commercial field
  added to that type belongs behind the key instead, and a test says so.

  It is ONE query for the whole list — `organizationId: { in: [...] }` on the
  subscription read, which is why `permSubscription.findMany`'s single signature
  gained a filter object rather than a second overload. Organization-wide,
  active, live plan, not ended: the same four clauses the entitlement path
  passes, so an icon in the drawer cannot disagree with what the reader is
  actually entitled to. A workspace's own subscription entitles that workspace,
  never the tenant.

  The one caller that still pays a second request is platform staff standing in
  a customer they are not a member of — the same rare path `getOrganizationIdentity`
  already exists for, and awaited alongside it. ⚠ That read is separate rather
  than a field on the drawer's query because `myOrganizationSubscriptions` is
  `[PermissionSubscription!]!` and guarded: a refusal nulls the field, and a
  null on a non-null field propagates to `data`, so "cannot read the plan" would
  have become "the whole drawer is empty" for exactly the people least able to
  explain why.

  **The switcher replaced the brand.** The product name is the one thing on the
  drawer that never changes, so it was spending the most valuable strip saying
  nothing, while the fact that every scoped link below now depends on had
  nowhere to be shown. With no active organization it draws the brand exactly as
  before, so nothing is lost in the state where there is nothing else to say.

  **Four sections were EXTRACTED rather than copied** — the members table,
  invitations, the role picker, the workspaces grid, and the workspace screen's
  four — into `organization-sections.tsx` and `workspace-sections.tsx`. A
  members list is a members list whoever is reading it; what differs is the key
  that opens the page and the level it resolves at, both settled before any of
  it renders. The same call this repo already made for `Person`, at four times
  the size.

  **Three things only running it against the live database found**, each
  invisible to the type checker and to every test:

  1. **`getArgs` was never wired in `app.module.ts`.** `@RequireScope` reads a
     resolver's arguments through that hook, so with it absent the decorator
     resolved nothing and every declaration failed the consistency check with
     "Handler declares organization scope but the request resolved as app". It
     is why the decorator had been written, tested, and used on nothing.
  2. **No plan entitled the new keys, so nobody could open their own
     organization.** `organization:read` is organization level, so it goes
     through the subscription filter; the seeded tiers predate it. Both keys are
     now in every tier — opening the company you belong to is the floor, not a
     paid feature. ⚠ `createPlanIfAbsent` never rewrites an existing plan
     (§12.26), so a database seeded before today needs an operator to add them
     on `/admin/plans`; that was done here through the real write path.
  3. **`OrganizationNewPage` took a `detailHref` FUNCTION.** A route adapter
     renders on the server and that page is `'use client'`, so pointing it at
     `/organizations` 500'd with "Functions cannot be passed directly to Client
     Components". The admin route passed nothing and took the defaults, which
     hid it. It takes one `basePath` string now.
  4. **The same boundary, from the other side: a CONSTANT in a client module.**
     `ORGANIZATION_NAV_GROUP` began in `tenant-page.tsx`, which is
     `'use client'`, and the app's server-side nav builder compares it —
     *"Cannot access ORGANIZATION_NAV_GROUP.localeCompare on the server. You
     cannot dot into a client module from a server component."* A constant is
     not exempt because it is "just a string": what crosses the boundary is the
     MODULE, not the value. The whole tenant URL and nav vocabulary moved to
     `react/tenant-nav.ts`, which has no `'use client'` and imports no React; a
     test asserts both, because that failure typechecks, lints and passes every
     other test.

  Verified end to end against the live database, as four different callers: an
  organization-user resolves `organization:read` when scoped to their tenant and
  NOT at app level; an org-admin who is not a workspace member is refused
  `myWorkspace` with `no_workspace_access`, which is §12.33 enforced for the
  first time; a cross-tenant organization id returns a refusal rather than data;
  and the drawer shows six tenant entries to an owner, three to a plain member,
  and none at all on `/`.

  ⚠ **One thing recorded rather than fixed:** the module reaches Postgres
  through a hand-written structural interface, and a generated Prisma delegate
  cannot satisfy an OVERLOAD set — TypeScript infers `T` as `any` and
  `SelectSubset` degrades to Prisma's own error type. A dedicated workspace
  query was written, broke `satisfies-modules.ts`, and was reverted;
  `listWorkspaceDetail` builds on `listOrganizationDetail` instead and
  over-fetches, which is the trade the admin workspace screen already makes.
  Where one delegate must answer two questions, do what
  `permSubscription.findMany` does: one signature, optional properties.

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
  ⚠ **Superseded 2026-09-13:** "the caller already holds those ids" is true of
  the screen, not of the endpoint. The query now takes `organizationId`, declares
  organization scope, and returns only that organization's members. See the
  decision log entry of that date.

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
