# @kwtech/module-task

Task **boards** per workspace, run as a **sub-app** on the workspace's Apps page
(`module-app-hub`). Anybody allowed may **create a board and own it**: the owner
makes its **columns** and decides whether it is **private** (only them) or
**shared with the workspace**. Tasks move through the columns on a **board** or
in a **list**; each has one assignee by default and may have several, who are
**notified**. Tasks carry an optional **scheduled** day and **due** day, a
priority, labels, a checklist and comments. Boards update **live**, and **My
tasks** gathers what is assigned to you across every board you can open. The
list view takes ↑ ↓ between tasks and Enter to open one (`LIST_KEYS` from
`@kwtech/web-ui/react`).

The plan and the review behind it: `docs/TASK-PLAN.md`. The decision: PLAN §13,
2026-09-28.

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
import { taskWebModule } from '@kwtech/module-task/react';
const FEATURE_MODULES = [..., taskWebModule()];
```

It contributes one sub-app (key `task`, "Tasks", icon `checklist`, order 30),
no routes and nothing in the drawer. The app key is saved in people's layouts:
never rename it.

It lays out by the width of its BOX, not the screen. The board's columns always
sit side by side at every width, in ONE scroll area that scrolls both ways
(columns grow with their cards), so no column is ever out of reach. A dragged
card floats above every column. The open task's panel sits beside the board from 64rem and slides over
it below that, the board still showing on its left; a bar on the panel's edge
collapses it to a labelled "Task" strip and expands it again at every width (as
the notes list does). Whether the title and description are saved shows in the
panel's header, beside *Close*. Which board and task are open is the
component's own state, never a URL — a link would leave the Apps page.

The header carries a chip counting YOUR unfinished tasks that need attention on
EVERY board in the workspace, whichever board is selected — *All my tasks ⚠ 2
overdue · 3 today · 1 soon* ("soon" is planned or due within
`TASK_SOON_DAYS`, three days) — which opens My tasks. It is absent when nothing
is pressing. On cards, a due day that is overdue is red and one due today or
soon is amber.

## In a NestJS app

```ts
taskServerModule({
  prismaProvider: taskPrismaProvider,
  prismaWriteProvider: taskWritePrismaProvider,
  limitCheckerProvider: { provide: TASK_LIMIT_CHECKER, useExisting: PermissionsLimitChecker },
  accessCheckProvider: { provide: TASK_ACCESS_CHECK, useFactory: … },
  memberDirectoryProvider: { provide: TASK_MEMBER_DIRECTORY, useFactory: … },
  imports: [NOTIFICATION_SERVER_MODULE.nestModule],
  notifierProvider: { provide: TASK_NOTIFIER, inject: [NotificationSender], useFactory: … },
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
  pubsubProvider: { provide: TASK_PUBSUB, useValue: realtimePubSub() },
});
```

Also: the fragment is composed by the schema script from `./prisma`; the keys
AND the caps go in the app's `seed/registry.ts` (the bindings are this module's
guard); the presets are read by `seed/app-roles.ts`.

| Port | Answers | Unbound means |
|---|---|---|
| `TASK_PRISMA`, `TASK_PRISMA_WRITE` | the client (`TaskTransaction`, checked by `satisfies-modules.ts`) | the module cannot start |
| `TASK_LIMIT_CHECKER` | `task:boards` and `task:tasks` from the plan | the DECLARED defaults (20 and 2,000), never unlimited |
| `TASK_ACCESS_CHECK` | does this person hold `task:assign` / `task:manage_all` here | neither: you assign only yourself and delete only your own |
| `TASK_MEMBER_DIRECTORY` | who may be assigned (active members holding `task:write`), who is still a member, names | you can assign only yourself; nobody has a name; no board is ever orphaned |
| `TASK_NOTIFIER` | telling people they were assigned, that a task they are on has a comment, or that a task is due today | nobody is told; tasks still work, and the due reminders mark nothing |
| `TASK_PUBSUB` | the app's one engine | not live: changes show on the next read |

The notifier is called **after the commit**, never fails the write, and never
tells the person who acted. This app's adapter (`apps/web-server/src/task/notifier.ts`)
sends `task.assigned`, `task.comment` and `task.due`, all mutable. `task.due`
has no actor: it is sent by the background process below.

## Realtime

- One trigger, `task.changed`, carrying **ids and a change kind, never content**
  (`board`, `task`, `comment`, `hidden`, `deleted`), the board's owner and its
  kind after the change.
- Filtered **per subscriber** by `taskEventFor`, which uses the same
  `canOpenBoard` every query uses: a private board's events reach its owner
  alone. `hidden` (a board just went private) tells everyone else to drop it.
- `sync` on every (re)subscribe. The client debounces and reads again; an event
  for the open task reads it again too, and the panel keeps unsaved typing
  (`onStoredTask`).

## Vocabulary

| | |
|---|---|
| **Board** | owned by one person; `private` (the owner alone, whatever keys anyone holds) or `workspace` (everyone holding `task:read`). There is no per-person access list |
| **Column** | the owner's own step, in the board's order. One or more are marked **done**: entering one sets `completedAt`, leaving clears it |
| **Order** | a board's order is SHARED — "top of To do" means the same to everybody. `rank` is a double between neighbours; a column that runs out of room is renumbered |
| **Assignee** | one by default, up to 10. On a private board, only its owner |
| **Scheduled / due** | optional DAYS (`YYYY-MM-DD`, Postgres `DATE`), never instants. Overdue is by the workspace's calendar (`useWorkspaceTimeZone`, PLAN §13 2026-09-29), the same for everyone in it; scheduled after due is a warning, not a refusal |
| **Archive** | hides a task or board, read-only and restorable. Delete forever only from the archive |
| **Label** | text on one task; no shared vocabulary. The filter lists labels on tasks the viewer can see |
| **Orphaned board** | its owner is no longer an active member. `task:manage_all` may hand it to a member, seeing its name and size only |

## The domain entry point

`@kwtech/module-task` is framework-free:

- `access.ts` — `canOpenBoard` (THE access rule), `checkConfigureBoard`,
  `checkBoardLifecycle`, `checkWorkWithTask`, `checkCreateTask`,
  `planTaskArchiveAct`, `checkEditComment`, `planRemoveComment`,
  `planSetAssignees`. ⚠ Somebody else's private board is `not_found` from every
  check, before any other reason.
- `boards.ts` — names, `TASK_DEFAULT_COLUMNS`, `prepareInitialColumns`,
  `checkAddColumn`, `checkRemoveColumn` (never the last column or the last done
  one), `columnNameKey`.
- `tasks.ts` — title, description, checklist and comment rules, priorities,
  `checkTaskVersion`, `completedAtAfterMove`, and the two messages the app
  matches: `TASK_NOT_FOUND_MESSAGE`, `TASK_CONFLICT_MESSAGE`.
- `dates.ts` — `prepareTaskDay`, `isTaskOverdue`, `isScheduledAfterDue`,
  `taskDayGroup`, `taskAttention` and `isTaskDueSoon` (`TASK_SOON_DAYS`), and the `DATE` boundary (`taskDayToDate` / `taskDayFromDate`).
- `rank.ts`, `labels.ts`, `text.ts`, `events.ts`.
- `TASK_OPERATIONS` — every document the app sends, validated against the
  served schema by `apps/web-server/test/module-operations.test.ts`.

## Keys, caps, presets

| Key | Grants |
|---|---|
| `task:read` | open the app; the boards you can open, their tasks and comments; My tasks; your own view settings |
| `task:write` | on boards you can open: create, edit, move and archive tasks; checklist, labels, dates, priority; comment; assign yourself |
| `task:create_boards` | create boards and configure the ones you OWN (every one of these also checks ownership) |
| `task:assign` | assign other people, and read who may be assigned |
| `task:manage_all` | privileged: delete other people's tasks and comments on boards you can open; take over an orphaned board. Never opens a private board |

Caps, plan-sourced and **per person**, archived included: `task:boards` (boards
owned, default 20) and `task:tasks` (tasks created, default 2,000). Presets:
`task-user` (all but `manage_all`) → `workspace-user`; `task-admin` →
`workspace-admin`.

⚠ Existing plans are never rewritten: an operator adds the new keys and the caps
on `/admin/plans`. Until then the app says why nothing can be done.

## Columns — the owner's own

A new board starts from To do · Doing · Done, which the creator renames,
removes, reorders and marks as done before saving — or *Start blank*. After
that, on the board itself: *Add column* at the end, and a column's menu has
*Rename*, *Mark as done*, *Move left / right* and *Remove* (choosing where its
tasks go); board settings has the same as a list. Every change is its own small
write (`addTaskColumn`, `updateTaskColumn`, `moveTaskColumn`,
`removeTaskColumn`), so two tabs never overwrite each other's column list.

## Processes

Work this module does on a schedule, declared in `TASK_PROCESS_REGISTRY`
(`src/processes.ts`) and run by `module-jobs`, which this module never imports.
The app must list the registry in `seed/registry.ts`, or the process is never
synced and never runs.

### `task.due_today` — task due reminders

On the day a task is due, tells the people **assigned** to it, or its
**creator** when nobody is assigned. Only people who could open the task today:
active members of the workspace (`TASK_MEMBER_DIRECTORY`) whom the board does
not shut out. Finished and archived tasks, and tasks on archived boards, are
left alone.

| | |
|---|---|
| Serves | `task:read`: it reaches only workspaces whose organization's plan includes tasks |
| Default schedule | every day at 08:00, **in each workspace's own time** |
| An admin may set | times of day and weekdays, or an interval of at least 15 minutes |
| One run | at most 120 seconds and 500 tasks; the rest wait for the next run |
| Too late | 10 hours after its time (18:00 by default). Skipped, and counted |

- **Idempotent.** A row in `task_due_reminder`, keyed by task and due day, is
  written BEFORE anybody is told, and a task with one no longer matches the
  sweep. Run twice, the second tells nobody. A task moved to a new due day is
  reminded on that day too.
- **At most once.** A server dying between the row and the notice loses that
  one reminder rather than risking two.
- **"Today" is the workspace's day**, from the run's clock and the workspace's
  zone (`processOccurrence`). A zone that cannot be read falls back to
  Asia/Manila, never UTC.
- **Paused**, nobody is reminded and nothing is marked. Resumed the same day
  within 10 hours of the time, the reminders go out then; later, they are
  skipped and counted.
- **Unbound ports:** no notifier, it does nothing and marks nothing; no member
  directory, nobody can be shown to be a member, so nobody is told.

## What it declares

`TASK_FEATURE_REGISTRY` (5 keys, 39 bound operations), `TASK_LIMIT_REGISTRY`
(2 caps), `TASK_ROLE_PRESETS`, `TASK_PROCESS_REGISTRY` (1 process),
`prisma/task.prisma` (`task_board`, `task_column`, `task_task`,
`task_assignee`, `task_checklist_item`, `task_comment`, `task_due_reminder`,
`task_preference`), and the sub-app `task`.
