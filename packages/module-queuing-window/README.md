# @kwtech/module-queuing-window

A walk-in queue per workspace. Staff are assigned named **windows**, press
**Call next**, and the number appears on a **public display** — a TV in the
waiting room, admitted by a per-session code, live over `graphql-ws`.

> **Status: server, realtime and the staff console built (steps 4–6).** Both
> apps have adopted it. The public board page is step 8.

## In a Next.js app

```ts
// src/modules.ts
import { queueWebModule } from '@kwtech/module-queuing-window/react';
export const WEB_MODULES = [/* … */ queueWebModule()];
```

That contributes `…/workspaces/:workspaceId/queue` (the console, in the
Workspace drawer group) and the unlisted `…/queue/settings`, both gated on
`queue:read`. Controls inside each page show only to the key that may use them;
the API refuses again regardless. The design, and every decision behind it, is in
> `docs/PLAN.md` §13 under the 2026-09-13 `module-queuing-window` entries. Read
> the newest first.

## In a NestJS app

```ts
// src/app.module.ts — one entry in SERVER_MODULES
queueServerModule({
  prismaProvider: queuePrismaProvider,
  prismaWriteProvider: queueWritePrismaProvider,
  limitCheckerProvider: { provide: QUEUE_LIMIT_CHECKER, useExisting: PermissionsLimitChecker },
  staffCheckProvider: { provide: QUEUE_STAFF_CHECK, /* … */ },
  staffDirectoryProvider: { provide: QUEUE_STAFF_DIRECTORY, /* … */ },
  workspaceLocatorProvider: { provide: QUEUE_WORKSPACE_LOCATOR, /* … */ },
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
}),
```

⚠ **Also compose `QUEUE_FEATURE_REGISTRY` and `QUEUE_LIMIT_REGISTRY` in the
seed registry.** The bindings ARE the guard, since this module cannot use
`@RequireFeature`. An uncomposed registry leaves every mutation reachable by
anybody signed in, and both caps unlimited.

⚠ **Put the six keys in a plan.** They are workspace level, so the plan filter
applies: a key no plan sells is a key nobody can use.

Every port is optional, and each absence means something specific:

| Port | Unbound means |
|---|---|
| `prismaProvider` / `prismaWriteProvider` | no database — the module opens nothing |
| `limitCheckerProvider` | no cap on windows; displays held to `MAX_DISPLAYS_CEILING` |
| `staffCheckProvider` | a window can be assigned only to yourself |
| `staffDirectoryProvider` | no picker, and seats read "A member" |
| `workspaceLocatorProvider` | no display can ever open |
| `pubsubProvider` | NOT LIVE: writes work, the console updates only when re-read, and a TV draws its board once and stops. ⚠ Bind the app's one engine |

## Realtime

- **`queueEvents(organizationId, workspaceId)`** is the staff console's stream,
  bound to `queue:read`. It sends `sync` first on every (re)subscribe (re-read
  the console), then this workspace's calls and changes.
- **`queueDisplay`** is the public board. It is reachable only on a socket
  admitted at the handshake by a display pass: the app passes
  `QueueDisplayService.admit` as `admitAnonymous`, and the TV sends
  `{ displayPass }` in `connectionParams`. Every event is the whole board, with
  `announce` set when there is a call to chime for. The last event is
  `stopped`.

⚠ **A TV must also treat a refused reconnect (4403) as stopped.** A TV that
was asleep when queuing stopped never received the event.
| `resolveActorId` | every operation that needs an actor refuses |

The app's adapters live in `apps/web-server/src/queue/`, because each reads
another module's tables.

## Vocabulary

| Term | Means | Not |
|---|---|---|
| **line** | one numbered sequence with its own prefix — `C` Cashier, `E` Enrollment | "queue", which is the whole feature |
| **window** | a named service point in a workspace | the person at it |
| **seat** | a member assigned to a window | a role |
| **ticket** | one number called in one line, in one session, and what happened to it | a support ticket |
| **session** | one run of the queue, from Start queuing to Stop queuing | a sign-in session |
| **display code** | the short code typed into a TV, one per session | the pass |
| **display pass** | what a TV holds once its code is accepted | a durable link |

Models are `Queue*` and tables `queue_*`, shorter than the package name on
purpose.

## The entry point is pure domain

`@kwtech/module-queuing-window` exports decisions only: no Prisma, no Nest, no
React. Each is a function over plain values, tested without a database.

| File | Decides |
|---|---|
| `domain/numbering.ts` | what Call next calls: wrapping, **skipping numbers already called**, setting a line's next number, continuing numbering |
| `domain/tickets.ts` | `called → done \| no_show`, `no_show → called`, and what Call number… does with a number already called |
| `domain/seats.ts` | assigning a window: replacing an occupant, moving a person, who may free a seat |
| `domain/session.ts` | calling only while a session is open, the display code, and the code exchange |
| `domain/lines.ts`, `domain/windows.ts` | prefixes, ranges, labels (`C-042`), window names |
| `domain/nicknames.ts` | what may appear on a public screen, and **no name without a nickname** |
| `feature-keys.ts` | the six workspace-level `queue:*` keys, two plan-sourced caps, three role presets |

Refusals are reasons, never booleans, so a caller can say which rule refused.
