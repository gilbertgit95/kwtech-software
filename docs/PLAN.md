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

Last updated: 2026-08-25

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
6. **Apps configure; modules do not guess.** `forRoot({ resolveSubjectId })` —
   say where the caller's id lives and the module does the rest.
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
  closed the other way (below). `PermissionsProvider` and a real feature
  end to end still to come.
- **Phase 5 — first grid.** `<DataGrid>` in `@kwtech/web-ui`, Infinite Row Model
  over a paginated GraphQL query, shared theme.
- **Phase 6 — permissions for real.** ~~Grants persisted~~ (done: the write path
  exists and is tested), seed task upserting the registry — which is what finally
  calls `auditRegistry()`, `assertRegistered()` and `assertPlanLimits()` —
  `<FeatureGate>` on a live control, navigation filtered by the same keys.
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
| 14 | Confirm app-level roles should bypass plan entitlement | Phase 2 | the default: staff must be able to help a lapsed organization. It is the one path that ignores billing state, so it needs a deliberate yes |
| 15 | Should surfaces declare themselves **public**, rather than being public by omission? | Phase 6 | enforcement is opt-in, so an endpoint that should be guarded looks identical to one deliberately open. A `@Public('reason')` marker plus a coverage report would close it, at the cost of annotating every surface |
| 16 | ~~Does `PermWorkspaceMember` earn its place?~~ **Closed** | — | yes: workspaces have members, and workspace roles hang off that membership |

Decisions 1, 2, 3 and 5 gate the next step.


## 13. Decision log

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
