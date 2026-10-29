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
   │  module-basic-bookkeeping   module-basic-inventory            │
   │  module-jobs   module-booking   module-print-studio           │
   │  module-backup                                                │
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
| `module-basic-pos` | module-kit (and `pdf-lib`, for the price list on a printer, browser only) | web-ui, Nest, React | both apps |
| `module-basic-bookkeeping` | module-kit | web-ui, Nest, React | both apps |
| `module-basic-inventory` | module-kit | web-ui, Nest, React | both apps |
| `module-jobs` | module-kit | web-ui, Nest, React | both apps |
| `module-booking` | module-kit | web-ui, Nest, React | both apps |
| `module-print-studio` | module-kit (and `pdf-lib`, `pdfjs-dist`, `heic2any`, all used in the browser only) | web-ui, Nest, React | both apps |
| `module-backup` | module-kit | web-ui, Nest, React, lucide-react | both apps |
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
src/server/  (→ /server)     src/react/  (→ /react)    src/mobile/  (→ /mobile, optional)
Nest, GraphQL                React, web-ui             the phone layout; may use its own /react
        ✗ /react and /mobile never import /server — server code stays out of the browser
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
| How many may there be (caps) | `CHAT_LIMIT_CHECKER`, `QUEUE_LIMIT_CHECKER`, `NOTE_LIMIT_CHECKER`, `TASK_LIMIT_CHECKER`, `POS_LIMIT_CHECKER`, `STOCK_LIMIT_CHECKER`, `BOOKING_LIMIT_CHECKER`, `STUDIO_LIMIT_CHECKER` | `PermissionsLimitChecker` |
| People's names / emails | `CHAT_USER_DIRECTORY`, `QUEUE_STAFF_DIRECTORY`, `NOTIFICATION_USER_DIRECTORY`, `NOTE_AUTHOR_DIRECTORY`, `TASK_MEMBER_DIRECTORY` (also who may be assigned, and who has left), `POS_MEMBER_DIRECTORY` (names for "by staff"), `BOOKS_MEMBER_DIRECTORY` (who recorded and voided each entry), `STOCK_MEMBER_DIRECTORY` (who received, adjusted, wasted or counted), `BOOKING_MEMBER_DIRECTORY` (also who works the desk: who a staff resource may be, and who is reminded), `STUDIO_MEMBER_DIRECTORY` (who owns a shared layout, who printed what) | adapters reading `auth_user` (and permissions, for tasks' members) |
| Is this person staff here | `QUEUE_STAFF_CHECK` | `queue/staff-check.ts` (permissions) |
| Does this person hold a key the module checks itself | `NOTE_ACCESS_CHECK` (`note:manage_all`), `TASK_ACCESS_CHECK` (`task:assign`, `task:manage_all`), `POS_ACCESS_CHECK` (who sees costs; whose edit keeps a fixed discount), `BOOKS_ACCESS_CHECK` (who may void an investor's entry), `STUDIO_ACCESS_CHECK` (`studio:manage_all`: change somebody else's shared layout, read everybody's print history) | `note/access-check.ts`, `task/access-check.ts`, `pos/access-check.ts`, `books/access-check.ts`, `studio/access-check.ts` (permissions) |
| A workspace's time zone (which day a sale belongs to; the TV board's clock) | `POS_WORKSPACE_TIME_ZONE`, `BOOKS_WORKSPACE_TIME_ZONE`, `BOOKING_WORKSPACE_TIME_ZONE` (what 9:00 means there); `QueueWorkspaceLocation.timeZone`; in the browser, `useWorkspaceTimeZone()` from module-kit | `pos/workspace-time-zone.ts` and `queue/workspace-locator.ts` (read `perm_workspace`); the shell's `WorkspaceTimeZoneProvider` |
| A point of sale's takings for some days (the books' sales and cost of goods) | `BOOKS_SALES_SOURCE` | `books/sales-source.ts`, calling the POS's own `PosReportService.takings` (the books import the POS's Nest module instance) |
| What the point of sale sells, and what it did since a time (stock's materials lists and catch-up) | `STOCK_SOURCE_CATALOGUE`, `STOCK_SALE_FEED` | `stock/pos-source.ts`, calling the POS's own `PosStockService` (stock imports the POS's Nest module instance) |
| What left the store or came back, after the POS's commit, and how many are left for the till | `POS_STOCK_EVENTS`, `POS_STOCK_LEVELS` (the POS's own ports) | `stock/pos-stock-bridge.ts`, finding stock's `StockIntakeService` through `ModuleRef` — stock already imports the POS, so the POS cannot import stock |
| Stock moved, so open tills re-read their counts | `STOCK_CHANGE_LISTENER` | `stock/change-listener.ts`, publishing the POS's own `stock` event |
| Live events | `CHAT_PUBSUB`, `QUEUE_PUBSUB`, `PERMISSIONS_PUBSUB`, `NOTIFICATION_PUBSUB`, `NOTE_PUBSUB`, `TASK_PUBSUB`, `POS_PUBSUB`, `STOCK_PUBSUB`, `BOOKS_PUBSUB`, `BOOKING_PUBSUB` | ONE `realtimePubSub()` engine for all |
| A database | `X_PRISMA`, `X_PRISMA_WRITE` | `prisma/module-clients.ts`, checked by `satisfies-modules.ts` |
| Email a person | `CHAT_NOTIFIER`, auth's and permissions' mail callbacks | `chat/notify-mail.ts`, `auth/*-mail.ts`, `permissions/invitation-mail.ts` |
| Tell a person something (in the app) | `X_NOTIFIER` declared by the producing module — the first is `TASK_NOTIFIER` (`task/notifier.ts`), then `BOOKING_NOTIFIER` (`booking/notifier.ts`) | an adapter calling module-notification's `NotificationSender` — see its README |

| Print a PDF on one of the workspace's printers (browser) | module-kit's ONE `PrinterPort`, read with `usePrinters(scope)` and shown with web-ui's `PrinterMenu` — the print studio, the POS's price list | `PrinterProvider` in `apps/web-app/src/app/providers.tsx`, bound to `module-print`'s `createPrintTarget()` |
| Run something on a schedule | `processes` on the module's server descriptor (`ProcessContribution`, module-kit) — the first is `task.due_today`, then `booking.upcoming_sessions`, then `studio.prune_logs`, then `stock.catch_up` | `composeProcesses(…)` handed to `jobsServerModule` in `app.module.ts`; the declarations again in `seed/registry.ts` for `db:sync` |
| Which workspaces a background process may reach (the organization's plan) | `JOBS_ENTITLED_WORKSPACES` | `jobs/entitled-workspaces.ts` (reads permissions' plans and subscriptions) |
| Who paused, forced or rescheduled a background process, by name | `JOBS_ACTOR_DIRECTORY` | `jobs/actor-directory.ts` (reads `auth_user`) |
| The backup folder and pg_dump / pg_restore (a module never opens a connection) | `BACKUP_STORE` | `backup/pg-backup-store.ts`, shared with the command line (`backup/cli.ts`) |
| Re-check the restorer's password; sign everybody out after a restore | `BACKUP_PASSWORD_CHECK`, `BACKUP_END_SESSIONS` | module-auth's `AuthService.confirmPassword` and `AuthAdminService.endEverySession`, bound in `app.module.ts` |
| Hold every request off while a restore runs | `BackupMaintenanceGuard`, exported by module-backup | the app's FIRST `APP_GUARD` in `app.module.ts` |

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
4. A module's `/react` and `/mobile` never import its `/server`.
5. A module's pure core imports no framework.
6. A module's `package.json` lists only `module-kit` and `web-ui` among
   `@kwtech/*`.

Imports inside comments are ignored, because doc comments quote imports as
examples. A failure names the file, the line and the rule.
