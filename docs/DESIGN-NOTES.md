# Design Notes — the reasoning behind the architecture

`PLAN.md` records **what** was decided and its current state. This records
**why**: the alternatives that were on the table, the arguments that settled
each choice, and the things that turned out to be wrong after they were built.

Read this when a decision looks arbitrary, when you are about to reverse one, or
when a new requirement seems to contradict the model. Most of what is here is
invisible in the final code — the code shows the shape that survived, not the
three that did not.

Written 2026-08-25, alongside the design conversation it describes.

---

## Part 1 — The monorepo

### 1.1 Turborepo + pnpm

Chosen because both sibling repos (`coseller-mono`, `masterdb-mgt-tool`) already
run that combination. Consistency across the portfolio was worth more than any
marginal advantage of an alternative: patterns, muscle memory and people transfer
between repos, and a third build system would have taxed all three.

### 1.2 The reference-repo switch

The first scaffold followed **`coseller-mono`**. It was then switched to
**`masterdb-mgt-tool`** on the grounds that masterdb is newer.

That was not a cosmetic change. It replaced most of the toolchain:

| | coseller-mono | masterdb-mgt-tool |
|---|---|---|
| package manager | pnpm 9 | **pnpm 11** (`catalog:`, `allowBuilds`, release-age quarantine) |
| lint/format | ESLint 8 + Prettier | **Biome 2.5** — one tool |
| tsconfig | a `typescript-config` package | root **`tsconfig.base.json`** |
| TypeScript | 5.5 | **7.0** in catalog (backend pinned to 6.0) |
| ORM | Prisma 6 | **Prisma 7** — TS client, driver adapters, no Rust engine |
| Next / React | 15 / 19.2 | **16.3 / 19.2.8** |
| Apollo Client | 3.14 | **4.2** |
| Tailwind | 3.4 (`tailwind.config.js`) | **4.3** (CSS-first `@theme`) |
| AG Grid | Enterprise 34 | **Community 36** |

Two packages were **deleted** as a result — `eslint-config` and
`typescript-config` — because Biome and a root tsconfig replace them. Adopting a
newer reference means deleting what it made redundant, not keeping both.

**What the switch cost.** masterdb has no GraphQL server: no `@nestjs/graphql`,
no `schema.graphql`, and its frontend `scripts/codegen.mjs` exists purely to
*skip* codegen until a schema appears. So the newest repo cannot be the reference
for the single most complex part of this stack. GraphQL server patterns have to
come from `coseller-mono` (Nest 11 + `@nestjs/graphql` 13 + Apollo Server 5,
proven there) paired with **Apollo Client 4** on the frontend, which coseller does
not run — it is on v3. That pairing exists in neither repo, which is why Phase 3
is flagged as the highest-risk phase.

It also cost the grid: masterdb runs AG Grid **Community**, coseller runs
**Enterprise**. Server-Side Row Model, row grouping, set filter, context menu and
Excel export are Enterprise-only, so grid code copied from coseller will not run
here. The mitigation is to wrap the grid in `@kwtech/web-ui` so an Enterprise
upgrade — or a swap to TanStack Table — stays a one-file change.

### 1.3 What was inherited deliberately

- **`turbo.json` as JSONC with comments.** masterdb comments the non-obvious
  cache decisions in place. Copied, because the reasoning for `passThroughEnv`
  versus `env` is exactly the kind of thing that gets silently "cleaned up".
- **Narrow env declarations.** `DATABASE_URL` is declared per task, never
  globally, so it cannot invalidate `build`/`lint`/`test`. masterdb's own comment
  records that listing `.env` globally once invalidated its entire cache universe.
- **`src/generated/**` in `build.outputs`.** Under Prisma 7 the client is
  TypeScript source; omit it and a cache restore yields a package that cannot
  compile.
- **`engine-strict=true`.** Fail the install rather than produce a subtly
  different one.

### 1.4 The Prisma-home question

The plan initially assumed one `packages/db`. That assumption broke when
modules turned out to be database-agnostic and apps may sit on **different**
databases: there is one schema per *database*, not one per repo. Left open
(§12.2) because the module is unaffected either way — which is the point of
having built it that way.

---

## Part 2 — Stack

### 2.1 The analysis that was superseded

Before the stack was specified, three options were weighed. The conclusion was
overtaken by an explicit choice (NestJS + GraphQL), but the reasoning is recorded
because it still applies if the transport layer is ever revisited:

- **Next.js full-stack** was the *weakest* fit and would be again. With a worker
  and a CLI in the picture, they bypass the API entirely and hit the database
  directly, and server actions are not a callable API for non-browser clients.
- **tRPC** was the recommendation at the time: one typed surface for two
  frontends plus worker and CLI, no codegen, Vercel-native to start, extractable
  to a standalone server later.
- **GraphQL** wins the moment a non-TypeScript or third-party consumer is
  plausible — native mobile, a partner integration. Its schema is an explicit,
  introspectable contract; tRPC's is TypeScript-only.

The decision rule, if it comes up again: **non-TS consumer on the roadmap →
GraphQL; otherwise → tRPC.** The stack chosen is GraphQL, which is the
conservative answer.

### 2.2 Vercel cannot host the backend

This is the one hard incompatibility in the stack, and it contradicted an earlier
answer ("deploy to Vercel"), so it is worth stating precisely.

Vercel runs serverless functions: no always-on process, no persistent
connections. `graphql-ws` subscriptions therefore **cannot** work there, and the
failure mode is silent — connections simply never establish, so it presents as
"realtime doesn't work" rather than as an error.

Resulting split: Next apps on Vercel, `web-server` and `worker` on a container
host. That drags in three consequences that must be designed for, not discovered:
cross-origin auth (`SameSite=None; Secure` or bearer tokens, including on the WS
handshake), `NEXT_PUBLIC_*` being build-time inlined so a host change needs a
redeploy, and Postgres needing to tolerate connection churn (Neon, Supabase, or
PgBouncer in front of RDS).

### 2.3 The codegen cycle

Two contracts flow backend → frontend: `schema.graphql` from code-first
resolvers, `openapi.json` from `@nestjs/swagger`. Both are wired into
`turbo.json` so the task graph enforces ordering rather than a README.

A module that ships React components *and* resolvers cannot generate its own
typed hooks: its resolvers are part of the schema it would need in order to
generate. That is a genuine build cycle, not a tooling gap. Resolution: modules
ship `.graphql` documents and presentational components, and apps widen their
codegen glob. If hooks must live inside a module, splitting it into
`module-x` + `module-x-web` resolves the DAG cleanly. Recorded so nobody
rediscovers the cycle by fighting it.

---

## Part 3 — Module architecture

### 3.1 Naming, in three moves

`ui` → `web-ui` → and separately `permissions` → `web-permissions` →
`module-permissions`. The intermediate step was wrong and the reason is worth
keeping.

`web-`/`mobile-` is right for **platform-bound** packages: no line of a React DOM
component survives into React Native. It is wrong for a **domain module**, whose
core is platform-neutral by construction. `web-permissions` left two bad options
when mobile arrived: import a package whose name lies, or fork the registry — the
exact silent-divergence failure the shared package exists to prevent.

`module-` resolves it. A `module-*` package is platform-neutral at its core and
grows platform adapters behind subpaths (`/server`, `/react`, later `/native`),
so mobile is an added adapter rather than a second copy of the feature.

Three prefixes, three meanings: `web-`/`mobile-` = platform-bound, `module-` = a
whole feature vertically, no prefix = plumbing (`db`, `module-kit`).

### 3.2 One package, not three

`permissions-core` / `-nest` / `-react` would give stricter isolation. Rejected:
three version numbers and three changelogs for a boundary that optional
`peerDependencies` already enforce at install time. The isolation actually lost
is bundler-level only. Subpath exports keep the layers apart, and if a consumer
must not even *see* the other adapter, the subpaths become package names without
a single import statement changing shape.

### 3.3 Why `module-kit` was extracted

Once modules were expected to be indefinite in number, per-module registration
boilerplate would have been copied N times. `module-kit` holds the contract —
descriptors, `composeRoutes`, `composeNav`, `composeFeatures`, `matchRoute` — so
the tenth module is the same one-line edit as the second.

`FeatureContribution` lives there rather than in `module-permissions` because
**every module declares rights while only one enforces them**. Left in the
permissions module, module two would have had to import types out of module one.

Composition **throws** on duplicate route paths and duplicate feature keys. Two
modules quietly owning one path is precisely the failure the kit exists to catch,
and a silent winner is worse than a failed boot.

### 3.4 Registration: automatic on the server, not on the web

**Server — native.** Nest registers a module's `controllers` and resolver
`providers` on import. So importing the module *is* the registration; `module-kit`
only removes the boilerplate around it. A useful second-order effect:
`@nestjs/swagger` scans registered controllers, so module endpoints reach
`openapi.json` and then the generated frontend REST types with no app wiring.

**Web — not possible.** Next.js App Router discovers routes from the filesystem
and has no plugin API. A package cannot inject a route. Everything *except the
file* can still live in the module — component, path, title, required feature, nav
entry — and navigation plus middleware protection then genuinely are automatic and
derive from the same declaration, which is what stops a menu linking somewhere the
guard refuses. Three ways to get the file there (catch-all, thin re-export,
generated stub) differ only in how the file arrives; the module is identical
across all three, so switching later is mechanical.

### 3.5 Database independence

A module never opens a connection: no `@prisma/client` dependency, no
`DATABASE_URL`, no client of its own. `PermissionsService` depends on a
*structural* `PermissionsPrismaClient` interface and the host injects whatever
satisfies it.

Three things follow, all wanted. Two apps can consume the module on two different
databases. The implementation need not be Prisma at all, so the service is
testable against a literal object. And structural typing breaks what would
otherwise be a **cycle** — an app's db package composes the module's schema
fragment, so a package-level import in the other direction would close the loop.
Schema composition is a file-level build step, not a package dependency.

What each app owes the module: its database must have the module's tables.
Models are prefixed `Perm` / `perm_*` so a fragment drops into any schema without
colliding, and `userId` carries no foreign key so identity may live anywhere.

---

## Part 4 — The permissions model

The model was built incrementally over one conversation, each step adding a
constraint the previous shape could not express. The order matters, because
several later steps invalidated earlier ones.

### 4.1 What a feature is

**The smallest thing a user can be given access to**, with a *binding* naming
where it is enforced. Eight surfaces, expanded from an initial four:

`rest_endpoint`, `graphql_operation`, `graphql_subscription`, `graphql_field`,
`job`, `cli_command`, `ui_route`, `ui_component`.

The test for adding a surface is **a genuinely different enforcement moment**:

- `graphql_subscription` is separate from `graphql_operation` because it is
  enforced at the WebSocket handshake, not per request. A key guarding a mutation
  does not automatically guard the subscription, and with `graphql-ws` in the
  stack, conflating them leaves a real hole.
- `graphql_field` earns its place because field-level checks are what let one
  query serve users who may see different columns, instead of forking the whole
  operation per role.
- `ui_action` was **rejected**: the button and the action it triggers are gated
  at the same point, so it would be a second name for one surface.

Bindings are load-bearing, not decorative. `auditRegistry()` reports keys that
guard nothing and surfaces claimed by two keys; `assertRegistered()` catches keys
used in code but missing from the registry — those can never be granted, so every
check behind them silently fails. `ui_route` bindings are **derived** from route
descriptors rather than written twice.

Record-level access ("may I edit *this* document") is deliberately **not** a
feature. It depends on ownership, sharing and state, not on a grantable key, and
forcing it into the registry yields a key per record.

### 4.2 Three levels

All three are **roles held by a user** — that framing is what keeps the model
comprehensible:

| Level | What it is | Stored as |
|---|---|---|
| app | the user's role on the application, global | `PermUserRole` |
| organization | the user's role in one organization they belong to | `PermMembershipRole` |
| workspace | the user's role in one workspace, for granularity | `PermWorkspaceMemberRole` |

A role is **nothing but a named collection of features**. No inheritance, no
implied rights, no precedence — everything a role means is the list it carries,
which is what makes "what can this person do" answerable by reading rows instead
of simulating a hierarchy.

App-level roles needed their **own grant table** because a membership is (user,
organization) and an app-level role has neither an organization nor a workspace
to hang from. Routing it through a membership would have meant inventing a fake
organization for staff, which then appears in every organization list anyone
queries. Consequence handled: a staff user has *no membership at all*, so
`loadContext` must still return a usable context for them — returning null there
would have locked support out of every organization.

**A role may only collect features at its own level** (`assertRoleFeatureLevels`).
Without it a workspace-level role could contain `billing:manage`, and creating
workspace roles is a routine, widely delegated right — so that would be a direct
path to granting yourself organization-wide power. It throws rather than
filtering silently.

### 4.3 Membership, and the restructure

First shape: workspace roles were `PermMembershipRole` rows with a nullable
`workspaceId`. Replaced once it was clear that **workspaces have members**, each
with workspace-level roles:

```
PermMembership (user ↔ organization)
  └── PermMembershipRole            organization-level roles
  └── PermWorkspaceMember (↔ workspace)
        └── PermWorkspaceMemberRole workspace-level roles
```

Three improvements fell out:

1. Holding a role in a workspace you cannot enter became **impossible to
   express** rather than merely wrong. It had been reachable — see Part 5.
2. Both grant tables got honest composite primary keys. The nullable shape
   needed a surrogate key (Postgres forbids a nullable column in a primary key)
   and its unique index could not prevent duplicate organization-wide grants,
   because Postgres treats NULLs as **distinct**. That required a hand-written
   partial index, now unnecessary.
3. Workspace roles load only for the workspace in hand. A user in fifty
   workspaces does not pay for forty-nine on every request.

Workspace membership keys off the organization membership, not the user, so
belonging to a workspace of an organization you are not in cannot be represented.

### 4.4 Grants versus entitlements

A plan is also a collection of features, answering a different question: a **role**
says the *person* may, a **plan** says the organization *bought it*.

The two are tracked separately all the way through and never collapsed into one
boolean, because they fail for different reasons and need different advice — "ask
your administrator" versus "upgrade your plan". Conflating them makes billing bugs
present as permission bugs, which is how they end up debugged by the wrong team.

Subscriptions attach at organization **or** workspace level and are **additive**,
like role grants. An override rule was rejected: a downgraded workspace plan
silently revoking an organization-wide entitlement is the failure that follows,
and precedence is the part teams get wrong.

**Three subscription states, not two:** no plan model (`entitled: null`), no
active plan (`entitled: []`), active plans (their union). Collapsing the middle
into the first silently grants everything to an organization that stopped paying.

### 4.5 The resolution pipeline

```
1. combine    the role features at or below the triggered level
2. filter     ∩ organization subscription
3. union      + app-level features — NOT filtered
              ▼  effective
```

**Order is the design.** Filtering before the app-level union is what makes step
3 an *exemption* rather than just another grant; running it after would strip
staff rights along with everyone else's, and a lapsed organization is exactly
when support is needed. That app-level bypass is the one path in the system that
ignores billing state — flagged for explicit sign-off (§12.14) rather than buried.

**The trigger level decides which levels participate at all.** An app-level
request is answered by app-level roles alone; an organization role is not "also
true" there, it is *unasked*, because the request named no organization for it to
be true about. At app level step 1 is empty by construction, so the same three
lines produce "app features only" with no special case to drift out of sync.

`composeContext` computes `effective` once per request; checks are then a set
lookup, not a re-derivation — which matters when one GraphQL operation asks fifty
times. The three inputs are kept alongside the result so a denial can name which
step dropped the feature. `explainFeature()` returns that trace, because the
answer is otherwise spread across a role, a plan and a scope with nowhere to see
all three at once.

Denial reasons follow pipeline order: `not_granted` before `not_entitled`. A
member with no role grant is not told to buy a plan they may not control, and the
organization's billing state is not disclosed to every member.

### 4.6 Scope comes from the URL

```
server  /api/v1/*                                          app
        /api/v1/organizations/:orgId/*                      organization
        /api/v1/organizations/:orgId/workspaces/:wsId/*     workspace
web     the same, without the prefix
```

`parseScope()` lives in the dependency-free core so the Nest guard, the Next
middleware, the nav builder and the tests share one implementation — **two
implementations of a convention is one implementation plus a future incident.**
An unrecognised path is app level with no ids: the most restrictive reading, and
never a throw, since a parser that threw would turn a typo'd URL into a 500
instead of a 403.

REST needs no annotation. **GraphQL resolvers do** — they have no path — so
`@RequireScope(level)` names the args carrying the ids, and the app supplies
`getArgs` so the module never imports `@nestjs/graphql`.

`@RequireScope` is worth adding to REST handlers anyway: the guard compares
declared against parsed and refuses on mismatch, catching a controller mounted a
level from where it thinks it is. That is otherwise a **silent under-check** —
the wrong scope still resolves a perfectly valid-looking context, for the wrong
organization. For the same reason the per-request context cache is keyed on
scope, not just the request.

### 4.7 Enforcement is opt-in

Only registered features are checked. `/auth/signin` is a route, not a feature —
no key, no gate, no check, and no context is even loaded. Same at every surface.

Deliberate: most surfaces are not access-controlled, and a registry forced to
name every one would be mostly noise, which is how the entries that matter stop
being read.

Two corollaries kept explicit. **An empty gate is not the same as no gate** — not
wrapping a control is how it stays public, while a `<FeatureGate>` declaring no
keys is a mistake and renders its fallback, because one that rendered would look
guarded while guarding nothing. And **the cost**: an endpoint that should be
guarded looks exactly like one deliberately public. Nothing in the module can
tell them apart. The mitigation — surfaces declaring themselves public rather
than being public by omission — is left as an open decision (§12.15) because it
changes how much annotation every surface carries.

### 4.8 Limits — how many, not what

Kept separate from features throughout: a feature is checked when someone **reads
or acts**, a limit when someone **writes one more row**. Merging them makes a full
organization indistinguishable from an unauthorised one — "access denied" when the
truth is "buy more seats", and the ticket goes to the wrong team.

**Two sources**, because one does not fit both questions:

| Limit | Source |
|---|---|
| `user:organizations` | the user's **app-level role** (`PermRoleLimit`) |
| `organization:members`, `organization:workspaces`, `workspace:members` | the **plan** (`PermPlanLimit`) |

`user:organizations` cannot be plan-sourced: the question is asked *before* any
organization exists, so there is no subscription to ask. That is also why
`ctx.limits` is always present — a null map at app level would make the question
unanswerable exactly where it is asked. A null *value* means unrestricted.

Key/value rows rather than typed columns, so a new limit is a row and not a
migration — the same reasoning that makes features keys.

**The floor is 1, and it moved.** It was first 0, on the logic that an unset cap
must never mean infinite. Zero turned out to be wrong in the other direction: an
organization is created before it is subscribed, so a cap of zero stopped its
founder from being its own first member, and sign-up failed before billing was
ever reached. One admits exactly the owner — the smallest coherent organization.
The same floor now serves the unconfigured and the lapsed, since both behave
identically (`current < limit` refuses additions and never removes existing rows).

Plan-sourced limits are `required`, so `assertPlanLimits()` refuses at seed time
a plan that omits one and no configured plan ever reaches the floor. Role-sourced
limits are not: most roles say nothing about how many organizations a person may
have, and one each is the right answer for them.

---

## Part 5 — Corrections

Things that were built, then found wrong. Each is invisible in the final code:
the shape looks deliberate, and only this record explains why it is that shape.

**Organization roles leaked into app-level requests.** The role filter excluded
workspace roles by scope but let organization roles through everywhere. An
app-level request therefore answered with organization features the request had
never named an organization for. Fixed by making participation depend on the
trigger level (§4.5).

**A role in a workspace you could not enter.** `accessibleWorkspaceIds` was built
only from explicit workspace-share rows, while workspace-scoped role grants
applied regardless. A user could hold a role in a workspace the UI told them they
could not enter — while the API served its data. The dangerous direction of an
inconsistency. Fixed first by unioning role-granted workspaces into the accessible
set, then structurally in §4.3, where it became impossible to express.

**`Infinity` serialized to `null`.** `LimitDecision.remaining` used
`Number.POSITIVE_INFINITY` for unrestricted. `JSON.stringify(Infinity)` is
`null`, so across a REST or GraphQL boundary a client could not distinguish
"unlimited" from "unknown". Now explicitly `number | null`.

**Absent limit meant unlimited.** A plan that omitted `workspace:members` granted
infinite workspace members. Fixed by making `LIMIT_REGISTRY` the source of truth
with a floor and a `required` flag, plus a seed-time guard. Then the floor itself
was corrected from 0 to 1 (§4.8).

**`admin:access` was classified app-level.** Wrong: organization admins reaching
their own dashboard is an organization-level right. Genuine app-level examples are
`platform:support_access` and `platform:impersonate`.

**`myPermissions` returned a bare feature list.** Insufficient once denials had to
explain themselves — it now returns `effective` plus the three inputs that
produced it.

**Bindings were empty placeholders.** Every registry entry had `bindings: []`,
which reads as coverage in a role editor while guarding nothing. Made
load-bearing with an audit in both directions (§4.1).

**A cache keyed on the request alone.** The per-request permission cache would
have served a workspace-scoped answer to an organization-scoped field inside one
GraphQL operation. Now keyed on scope as well.

---

## Part 6 — Rejected alternatives, indexed

| Rejected | In favour of | Why |
|---|---|---|
| Next.js full-stack | a real API layer | worker and CLI would bypass it and hit the database directly |
| tRPC | GraphQL | an explicit, introspectable contract for non-TS consumers |
| Vercel for the backend | a container host | serverless cannot hold a WebSocket; subscriptions fail *silently* |
| `axios` on the client | `openapi-fetch` | bundle weight, and it discards the type inference that is the point |
| `@tanstack/react-query` up front | plain `openapi-fetch` | alongside GraphQL, REST becomes uploads/exports/webhooks; a second cache is dead weight |
| three packages per module | one with subpath exports | optional peers already enforce the boundary; three changelogs do not pay |
| `web-permissions` | `module-permissions` | a platform prefix on a platform-neutral domain module |
| separate `permissions-core` for `FeatureContribution` | `module-kit` owns it | every module declares rights; only one enforces them |
| generating GraphQL hooks inside a module | app-side codegen | the module's resolvers are part of the schema it would need — a build cycle |
| `ui_action` as a surface | folded into `ui_component` | same enforcement moment, so it is a second name for one thing |
| record-level access as a feature | a separate data policy | depends on ownership and state; would yield a key per record |
| subscription override semantics | additive | a downgraded workspace plan would silently revoke an org-wide entitlement |
| a deny rule on roles | additive only | subtractive grants turn every question into an ordering question |
| limit floor of 0 | floor of 1 | zero stopped a founder from being their own organization's first member |
| `PermMembershipRole.workspaceId` | `PermWorkspaceMemberRole` | nullable column blocks a real primary key; NULLs are distinct in unique indexes |

---

## Part 7 — Principles that kept recurring

These were not decided up front. They emerged because the same argument settled
several unrelated questions, and they are the fastest way to predict what this
codebase will do.

1. **No precedence, anywhere.** Levels filter, they do not override. Grants are
   additive. Subscriptions are additive. There is no deny rule. Every time
   precedence was available it was declined, because "which wins" is the part
   teams get wrong, and a system with no ordering rule cannot get the ordering
   wrong.

2. **Fail closed, but explain.** Absent context denies; an empty gate denies; an
   unset cap falls to a floor rather than to infinity. But a denial always
   carries *why* — `not_granted` versus `not_entitled`, `no_role_grant` versus
   `subscription_filter`. "Access denied" with no reason is the ticket that takes
   a day to close.

3. **A registry is the source; the database is the mirror.** True of features and
   of limits. Seeds upsert and deprecate, never delete, because grants and audit
   trails must stay readable.

4. **One implementation of a convention.** Scope parsing, feature keys, role
   composition — each exists once, in the dependency-free core, shared by guard,
   middleware, nav builder and tests. Two implementations of a convention is one
   implementation plus a future incident.

5. **Make the wrong state unrepresentable, not merely forbidden.** Workspace
   roles moved onto workspace membership; identity kept out of the module;
   structural typing to break a package cycle. A rule someone must remember is a
   rule that will eventually be forgotten.

6. **Separate questions stay separate.** Grants versus entitlements. Features
   versus limits. Access versus capacity. Authentication versus authorisation.
   Every merge of two questions was rejected on the same grounds: the answers
   fail for different reasons and need different advice, and merged answers send
   the ticket to the wrong team.

7. **Name the cost.** Opt-in enforcement cannot distinguish an unguarded endpoint
   from a deliberately public one. App-level roles bypass billing state. Both are
   written down rather than papered over, with the mitigation recorded as an open
   decision the reader can take or leave.
