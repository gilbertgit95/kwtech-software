# @kwtech/module-queuing-window

A walk-in queue per workspace. Staff are assigned named **windows**, press
**Call next**, and the number appears on a **public display** — a TV in the
waiting room, admitted by a per-session code, live over `graphql-ws`.

> **Status: schema and rules only (build step 3).** No server, no React, and no
> app has adopted the package yet. Adding it as a dependency of
> `apps/web-server` is what creates the tables, so that happens with the server
> in step 4. The design, and every decision behind it, is in `docs/PLAN.md` §13
> under the 2026-09-13 `module-queuing-window` entries. Read the newest first.

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
