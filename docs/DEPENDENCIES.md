# How the packages depend on each other

One page for "what may import what", and how features that may not import
each other still work together. The rules come from PLAN §9 and `CLAUDE.md`;
**`pnpm check:boundaries` enforces them** (it is also the last step of
`pnpm lint`), so this page and the code cannot quietly drift apart.

## The graph

```
                 @kwtech/web-ui        @kwtech/module-kit
                 (no @kwtech deps)     (no @kwtech deps)
                        ▲                     ▲
          optional peer │                     │ dependency
                        │                     │
   ┌────────────────────┴─────────────────────┴───────────────────┐
   │  module-auth   module-permissions   module-chat               │
   │  module-queuing-window   module-notification   module-app-hub │
   │  module-note   module-task   module-basic-pos                 │
   │  module-basic-bookkeeping   module-jobs                       │
   │                                                               │
   │  Each depends on module-kit ONLY, with web-ui, React and      │
   │  Nest as OPTIONAL peers. None imports another module.         │
   └──────────────────────────────▲────────────────────────────────┘
                                  │ dependency (all of them)
                  apps/web-server  ·  apps/web-app
                  the ONLY place modules meet
```

Peers are listed as each `package.json` has them; "Nest" is `@nestjs/common`,
`@nestjs/graphql` and `reflect-metadata`.

| Package | `@kwtech` dependencies | Peers | Imported by |
|---|---|---|---|
| `web-ui` | none | react, react-dom, tailwindcss, lucide-react, AG Grid, Radix dropdown | modules' `/react`, web-app |
| `module-kit` | none | react, graphql-ws | every module, both apps |
| `module-auth` | module-kit | web-ui, Nest, React, Next, jsonwebtoken | both apps |
| `module-permissions` | module-kit | web-ui, Nest, React, read-excel-file | both apps |
| `module-chat` | module-kit | web-ui, Nest, React, react-dom | both apps |
| `module-queuing-window` | module-kit | web-ui, Nest, React | both apps |
| `module-notification` | module-kit | web-ui, Nest, React, react-dom | both apps |
| `module-app-hub` | module-kit (and `@dnd-kit/*`) | web-ui, Nest, React | both apps |
| `module-note` | module-kit | web-ui, Nest, React | both apps |
| `module-task` | module-kit (and `@dnd-kit/*`) | web-ui, Nest, React | both apps |
| `module-basic-pos` | module-kit | web-ui, Nest, React | both apps |
| `module-basic-bookkeeping` | module-kit | web-ui, Nest, React | both apps |
| `module-jobs` | module-kit | Nest (`@nestjs/common`, `@nestjs/core`) | web-server (no React half yet) |
| `web-server` | every module, module-kit | — | nothing |
| `web-app` | every module, module-kit, web-ui | — | nothing |

⚠ **Nothing depends on `module-auth` except the apps.** Chat, the queue and
notifications do not know what a session is: the app tells each of them who
is calling (`resolveActorId`). Switch any feature module off — or leave it out
of an app — and the others still build and run.

## Inside a module

```
src/index.ts, src/domain/, types.ts,      the pure core: no framework at all
feature-keys.ts, operations.ts            (no Nest, React, Next, Prisma)
        ▲                    ▲
src/server/  (→ /server)     src/react/  (→ /react)
Nest, GraphQL                React, web-ui
        ✗ /react never imports /server — server code stays out of the browser
```

## How modules work together anyway: ports the app answers

A module that needs something another module knows DECLARES a port (a small
interface and a DI token). The app, which depends on both, implements it in
`apps/web-server/src/<module>/` and binds it in `app.module.ts`. An unbound port
has a documented, fail-closed meaning — see each module's README.

| A module needs… | Declared as | The app answers with |
|---|---|---|
| Who is calling | `resolveActorId` / `resolvePrincipal` option | `auth/resolve-principal.ts` — where auth and permissions meet |
| May this caller do it (feature keys) | the registry's `bindings` | `FeatureGuard` from module-permissions, fed by `seed/registry.ts` |
| How many may there be (caps) | `CHAT_LIMIT_CHECKER`, `QUEUE_LIMIT_CHECKER`, `NOTE_LIMIT_CHECKER`, `TASK_LIMIT_CHECKER`, `POS_LIMIT_CHECKER` | `PermissionsLimitChecker` |
| People's names / emails | `CHAT_USER_DIRECTORY`, `QUEUE_STAFF_DIRECTORY`, `NOTIFICATION_USER_DIRECTORY`, `NOTE_AUTHOR_DIRECTORY`, `TASK_MEMBER_DIRECTORY` (also who may be assigned, and who has left), `POS_MEMBER_DIRECTORY` (names for "by staff"), `BOOKS_MEMBER_DIRECTORY` (who recorded and voided each entry) | adapters reading `auth_user` (and permissions, for tasks' members) |
| Is this person staff here | `QUEUE_STAFF_CHECK` | `queue/staff-check.ts` (permissions) |
| Does this person hold a key the module checks itself | `NOTE_ACCESS_CHECK` (`note:manage_all`), `TASK_ACCESS_CHECK` (`task:assign`, `task:manage_all`), `POS_ACCESS_CHECK` (who sees costs; whose edit keeps a fixed discount), `BOOKS_ACCESS_CHECK` (who may void an investor's entry) | `note/access-check.ts`, `task/access-check.ts`, `pos/access-check.ts`, `books/access-check.ts` (permissions) |
| A workspace's time zone (which day a sale belongs to; the TV board's clock) | `POS_WORKSPACE_TIME_ZONE`, `BOOKS_WORKSPACE_TIME_ZONE`; `QueueWorkspaceLocation.timeZone`; in the browser, `useWorkspaceTimeZone()` from module-kit | `pos/workspace-time-zone.ts` and `queue/workspace-locator.ts` (read `perm_workspace`); the shell's `WorkspaceTimeZoneProvider` |
| A point of sale's takings for some days (the books' sales and cost of goods) | `BOOKS_SALES_SOURCE` | `books/sales-source.ts`, calling the POS's own `PosReportService.takings` (the books import the POS's Nest module instance) |
| Live events | `CHAT_PUBSUB`, `QUEUE_PUBSUB`, `PERMISSIONS_PUBSUB`, `NOTIFICATION_PUBSUB`, `NOTE_PUBSUB`, `TASK_PUBSUB`, `POS_PUBSUB`, `BOOKS_PUBSUB` | ONE `realtimePubSub()` engine for all |
| A database | `X_PRISMA`, `X_PRISMA_WRITE` | `prisma/module-clients.ts`, checked by `satisfies-modules.ts` |
| Email a person | `CHAT_NOTIFIER`, auth's and permissions' mail callbacks | `chat/notify-mail.ts`, `auth/*-mail.ts`, `permissions/invitation-mail.ts` |
| Tell a person something (in the app) | `X_NOTIFIER` declared by the producing module — the first is `TASK_NOTIFIER` (`task/notifier.ts`) | an adapter calling module-notification's `NotificationSender` — see its README |

| Run something on a schedule | `processes` on the module's server descriptor (`ProcessContribution`, module-kit) — the first is `task.due_today` | `composeProcesses(…)` handed to `jobsServerModule` in `app.module.ts`; the declarations again in `seed/registry.ts` for `db:sync` |
| Which workspaces a background process may reach (the organization's plan) | `JOBS_ENTITLED_WORKSPACES` | `jobs/entitled-workspaces.ts` (reads permissions' plans and subscriptions) |

Shared shapes (a pub/sub port, a directory entry) are COPIED structurally in
each module, not imported — a duplicate interface is cheaper than a coupling.
Something moves into `module-kit` only when a second module needs the same
code, not just the same shape (PLAN §9 rule 8).

## What `check:boundaries` enforces

1. A `module-*` package imports only `@kwtech/module-kit` and `@kwtech/web-ui`
   from `@kwtech/*` (and itself).
2. `module-kit` and `web-ui` import no other `@kwtech` package.
3. No package imports an app, or reaches into another package's `src/` —
   public entry points only.
4. A module's `/react` never imports its `/server`.
5. A module's pure core imports no framework.
6. A module's `package.json` lists only `module-kit` and `web-ui` among
   `@kwtech/*`.

Imports inside comments are ignored, because doc comments quote imports as
examples. A failure names the file, the line and the rule.
