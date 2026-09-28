# `module-task` — plan

Status: **built, 2026-09-28** (phases 1–8; the browser check is the
operator's). The contract is in `packages/module-task/README.md` and the
decision in PLAN §13. This file stays until that check is done, then is deleted
— as `NOTE-PLAN.md`.

## Built, and where it differs from this plan

- **The board-owning key is `task:create_boards`**, not `task:boards`: the
  limit is `task:boards`, and one name for two things is a support question.
- **`task:tasks` is counted per PERSON** (tasks they created), not per board:
  the permissions module counts over `user`, `organization` or `workspace`
  only, and per person keeps notes' reason — nobody can clear somebody else's
  private board.
- **`rank` is a number (double), not a string.** Postgres sorts text by the
  database's collation, so a string rank can read back in a different order
  than it was written. A double sorts the same everywhere; about fifty moves
  into one spot exhaust a gap, and that column is then renumbered.
- **`TaskAssignee` carries `boardId`**, kept in step when a task moves, so
  making a board private removes everyone else's assignments in one complete
  delete. **`Task.commentCount`** is kept in the comment's transaction, so a
  card shows its count without reading comments.
- **Column order is changed from menus** (*Move left / right* on the board,
  earlier/later in settings), not by dragging a column header. Cards drag.
- **Comments need `task:write`**, like every other act on a task; §3's first
  draft had them under `task:read`.
- **Removing a column moves its tasks to the END of the destination**, in their
  order, finished or not by where they land.
- **The Nest half is one resolver** (39 operations) over four services:
  `TaskBoardService`, `TaskService` (reads), `TaskWriteService`,
  `TaskCommentService`, with every lookup in `task.lookup.ts`.
- **Checked against the local Postgres** as well as the fake: `DATE`
  round-trips, float ranks, literal `%` in search, the column `NoAction`, and
  the board cascade.
- **No Playwright test**: the seed account has two-step verification, which the
  harness does not support (as for notes and the Apps page).

## 0. Settled while planning (operator, 2026-09-28)

Questions that came up while planning, each confirmed by the operator.

| # | Question | Decision |
|---|---|---|
| A | Does board visibility replace **per-task privacy**? | **Yes.** A private task is a task on your private board. One rule ("can you open the board") instead of two, and no task whose assignee cannot see it |
| C | Can a workspace admin see a board they were not given? | **No**, as notes: no key reads a private board. But `task:manage_all` may **transfer ownership** of a board whose owner has left the workspace, seeing only its name and size, so a team's board is never stranded |
| D | Are **comments** notified? | **Yes**, to the task's assignees and creator, minus the commenter, as their own source (`task.comment`) people can mute. Assignment is `task.assigned` |
| E | Are the two dates **days** or **moments**? | **Days, for now** (`DATE` columns). "Overdue" and "today" are by the viewer's own calendar date. ⚠ A day is NOT stored as UTC midnight: 5 Oct 00:00 UTC is 4 Oct in New York, so a day-only date would shift a day west of UTC. **When times are added** (operator's direction): a date may carry an optional time, and one with a time is stored as a UTC instant (`timestamptz`) and shown in the viewer's browser time zone; one without stays a `DATE` |
| F | May a task be scheduled **after** it is due? | **Yes, with a warning** on the card and in the panel ("scheduled after it is due"), not a refusal: plans slip, and refusing would block saving either date |

## 1. What it is

Tasks per workspace, run as a sub-app on the workspace's Apps page (app key
`task`, kept: it is saved in people's layouts). A workspace holds **boards**.
Anybody allowed may **create a board and own it**: the owner **configures its
columns** and makes it **private** (only them) or **shared with the
workspace** (everyone holding the task keys there). Tasks live on one board and
move through its columns on a **board** view or in a **list**. A task has **one
assignee by default and may have several**; a person is **notified** when
assigned. v1 also has two optional dates (a **scheduled** day and a **due**
day), priority, a checklist inside a task, comments, labels, search and
archive. Boards update **live**. A **My tasks** view gathers what is assigned
to you across every board you can open.

## 2. Decisions (from the operator, 2026-09-28)

| # | Question | Decision |
|---|---|---|
| 1 | Who sees a task | Team work, with private work possible. Now: **whoever can open its board** (A) |
| 2 | Boards | **Several per workspace**, each with an **owner** who configures it |
| 2a | Board visibility | **Two kinds only** (operator, simplifying 2): **private** (the owner alone) or **shared with the workspace**. No per-person access list, no viewer/editor roles: on a shared board, what a person may do is what their keys say |
| 3 | Views | **Board and list** per board, drag between columns |
| 4 | Assignees | **One by default, optionally several**, per task. Each newly assigned person is **notified** |
| 5 | Extras in v1 | An optional due date and an optional scheduled (target) date; priority; a checklist inside a task; comments; labels, search and archive |

Decided while planning:

| # | Question | Decision |
|---|---|---|
| 6 | Columns (steps) | **The board's creator makes their own** (operator, 2026-09-28): add, rename, reorder and remove, at creation and at any time after. Creating a board offers **To do · Doing · Done** as a starting point the creator edits before saving, or a blank board with one column. Names are unique on a board (ignoring case), at most 12 columns. One or more columns are marked **done**: entering one sets `completedAt`, leaving clears it. Renaming or reordering never touches the tasks in it |
| 7 | Removing a column with tasks | The owner picks where its tasks go. Removing the **last** column, or the last done column, is refused and says why |
| 8 | Changing a board's kind | The owner's alone. **Making a shared board private unassigns everyone but the owner** from its tasks, in the same transaction, after a confirm saying how many; others' comments stay. Making a private board shared needs nothing |
| 10 | Who may be assigned | On a **private** board, only its owner. On a **shared** board, active workspace members holding `task:write` there. Assigning somebody else needs `task:assign`; anyone with `task:write` may assign **themselves** |
| 11 | Several assignees in the UI | The picker assigns one person; **Add another** appears once one is set. At most 10 |
| 11a | Dates | Two, **both optional**: **scheduled** (`scheduledOn`, the target day someone plans to work on it) and **due** (`dueOn`, the deadline). Either, both or neither. Only an unfinished task is ever overdue |
| 12 | Priority | `low`, `normal` (default), `high`, `urgent` |
| 13 | Board order | **Shared** within a board: "top of To do" means the same to everybody on it. Moving a task to another board you can open is v1; moving it onto a private board unassigns everyone but that board's owner, after a confirm |
| 14 | Archive and delete | A task archives and restores; **delete forever only from the archive**, by its creator, the board's owner, or `task:manage_all`. A board archives too (its owner), and is deleted forever only from the archive, with its tasks |
| 15 | Labels | Like note tags: a label on one task, no vocabulary. The filter lists labels on tasks the viewer can see |
| 16 | Limits | `task:boards` **per person** (boards they own, archived included, default 20) and `task:tasks` **per person** (tasks they created, archived included, default 2,000). Both plan-sourced |
| 17 | Concurrency | Title and description are a compare-and-set on `version` (notes' rule). Column, order, assignees, checklist, dates, priority and labels are **their own small writes**, so dragging a card never conflicts with somebody typing its description |
| 18 | Comments | Plain text (links clickable), needing `task:write`; editable and deletable by their author; the board's owner and `task:manage_all` delete anyone's |

## 3. Keys, limit and presets (`src/feature-keys.ts`)

All workspace level. The keys say what a person may do **in this workspace**;
the board's kind says **which boards**: a shared board is open to everyone
holding `task:read`, a private board to its owner only. Both must agree — no
key opens somebody else's private board.
**The bindings are the guard**: every operation is bound, and
`surface-coverage.test.ts` (notes' shape) fails on one that is not.

| Key | Grants | Bound operations |
|---|---|---|
| `task:read` | open the app; boards you can open, their tasks, checklists and comments; My tasks; your own view settings | `Query.taskBoards`, `Query.taskBoard`, `Query.tasks`, `Query.task`, `Query.myTasks`, `Query.taskComments`, `Query.myTaskSettings`, `Mutation.setMyTaskSettings`, `Subscription.taskEvents` |
| `task:write` | on boards you can open: create, edit, move, archive tasks; checklist, labels, dates, priority; comment; assign **yourself** | `Mutation.createTask`, `updateTask`, `moveTask`, `setTaskDates`, `setTaskPriority`, `setTaskLabels`, `addTaskChecklistItem`, `updateTaskChecklistItem`, `moveTaskChecklistItem`, `removeTaskChecklistItem`, `setTaskAssignees`, `archiveTask`, `restoreTask`, `deleteTaskForever`, `addTaskComment`, `updateTaskComment`, `removeTaskComment` |
| `task:create_boards` | create boards and own them: columns, private or shared, rename, archive, delete | `Mutation.createTaskBoard`, `updateTaskBoard`, `addTaskColumn`, `updateTaskColumn`, `moveTaskColumn`, `removeTaskColumn`, `setTaskBoardVisibility`, `archiveTaskBoard`, `restoreTaskBoard`, `deleteTaskBoardForever` |
| `task:assign` | assign **other people** | `Query.taskAssignableMembers`; otherwise checked inside `setTaskAssignees` / `createTask` through `TaskAccessCheck` |
| `task:manage_all` | delete other people's tasks and comments on boards you can open; **transfer** a board whose owner has left (C) | `Mutation.transferTaskBoard`, `Query.orphanedTaskBoards`; otherwise through `TaskAccessCheck` |

- ⚠ **Every board-owner operation also checks ownership** in the service. The key
  says "may own boards here"; it does not make you the owner of this one.
- `setMyTaskSettings` writes the person's own row and is still bound (the
  `setMyQueueNickname` rule: the key proves membership before a row is written).
- **`TaskAccessCheck`** answers "does this person hold `task:assign` /
  `task:manage_all` here". **Unbound means neither.**
- **Limits**: `task:boards` and `task:tasks`, both `countedOver: 'user'`, each counted in the same transaction as the insert. Unbound
  checker: the declared defaults, never unlimited.
- **Caps in code**: 12 columns, 10 assignees, 50 checklist
  items, 20 labels, 500 comments per task; board name 80, column name 40, title
  200, description 20,000, comment 4,000 characters.
- **Presets**: `task-user` (read, write, boards, assign) → `workspace-user`;
  `task-admin` (+ `manage_all`) → `workspace-admin`. Read by
  `apps/web-server/src/seed/app-roles.ts`, never restated.
- ⚠ Existing plans are never rewritten: an operator adds the new keys and caps
  on `/admin/plans`. Until then the app says why (§6).

## 4. Schema (`prisma/task.prisma`)

Every row carries `organizationId` and `workspaceId`; `userId`s are bare
strings. Children cascade from their board or task.

- **`TaskBoard`** → `task_board`: `id`, `organizationId`, `workspaceId`,
  `ownerId`, `name`, `visibility` (enum `private | workspace`, default
  `workspace`), `version`, `archivedAt?`, `createdAt`, `updatedAt`.
  Indexes `(workspaceId, ownerId)`, `(workspaceId, visibility, archivedAt)`.
- **`TaskColumn`** → `task_column`: `id`, `boardId`, `name`, `nameKey`
  (lower-cased, for uniqueness), `rank`, `done` (bool).
  `@@unique([boardId, nameKey])`.
  Column edits are **one operation each** (`addTaskColumn`, `updateTaskColumn`,
  `moveTaskColumn`, `removeTaskColumn` with a destination), so two people's
  edits never replace each other's whole list.
- **`Task`** → `task_task`: `id`, `organizationId`, `workspaceId`, `boardId`,
  `columnId`, `rank`, `creatorId`, `title`, `description`, `priority` (enum),
  `scheduledOn?` and `dueOn?` (both `@db.Date`), `labels` (`String[]`), `version`,
  `completedAt?`, `archivedAt?`, `updatedById`, `createdAt`, `updatedAt`.
  Index `(boardId, archivedAt, columnId, rank)`.
  `setTaskDates` writes both dates together, and either may be null.
- **`TaskAssignee`** → `task_assignee`: `@@id([taskId, userId])`, `workspaceId`,
  `assignedById`, `createdAt`; index `(workspaceId, userId)` for My tasks.
- **`TaskChecklistItem`** → `task_checklist_item`: `id`, `taskId`, `text`,
  `done`, `rank`, `doneById?`.
- **`TaskComment`** → `task_comment`: `id`, `taskId`, `authorId`, `body`,
  `editedAt?`, `createdAt`; index `(taskId, createdAt)`.
- **`TaskPreference`** → `task_preference`: `@@id([userId, workspaceId])`,
  `lastBoardId?`, `view` (`board | list`). No row means the defaults.

**`rank` is a number between its neighbours** (a double), unlike the notes
list's id array (PLAN §12.81): a move writes one row and the database sorts the
board, so there is no in-memory cap. Pure domain code with tests
(`domain/rank.ts`); a rare rebalance rewrites one column's ranks.

## 5. Server (`src/server/`)

Mirrors `module-note`: `task.module.ts`, `task.options.ts`, `task.tokens.ts`
(`TASK_PRISMA`, `TASK_WRITE_PRISMA`, `TASK_PUBSUB`, `TASK_ACCESS`,
`TASK_MEMBERS`, `TASK_NOTIFIER`, `TASK_LIMITS`), `ports.ts`,
`task.repository.ts`, `board.service.ts`, `board-write.service.ts`,
`task.service.ts`, `task-write.service.ts`, `task-comment.service.ts`,
`task.errors.ts`, `task.pubsub.ts`, `graphql/`, `server-module.ts`.

**Board access is ONE pure function** (`domain/access.ts`,
`canOpenBoard(board, userId)`: shared, or you own it), used by every service,
every `where` and the event filter. Two copies of it would be an
incident.

Rules the services keep (each has a test):

- **Every lookup is `{ id, workspaceId, organizationId }`**; a column, task,
  checklist item or comment is found **through its board** (the board lookup
  first, then `{ id, boardId }` / `{ id, taskId }`), never by its own id alone.
- **One `TASK_NOT_FOUND`** for a board or task that does not exist, is in
  another workspace, or is on a board the viewer cannot open — before any other
  check.
- **A move's target column must be on the same board**; a move to another board
  needs to open both.
- **Assignees are validated** against the board's kind (private: the owner
  only) and the directory port, every id. An unknown id refuses the whole request (`not_assignable`),
  never silently dropped. Unbound directory: only yourself.
- **Making a board private unassigns in the same transaction** (decision 8),
  and sends `removed` for the board to everyone else.
- **Notify after the commit**, never inside the transaction, never failing the
  write: only people **newly** assigned, never the actor. Comments notify
  assignees and creator minus the commenter (D).
- **Search** escapes `%`, `_` and `\` and runs `ILIKE` over title and
  description, board access in the same `where`. ⚠ `escapeLikePattern` now has a
  second consumer: it moves from `module-note` to `@kwtech/module-kit`
  (principle 9), and notes import it from there.
- **Events carry ids and a change kind, never content**, filtered **per
  subscriber** by `canOpenBoard`. `sync` on every (re)subscribe.

Ports (`ports.ts`), each implemented in `apps/web-server/src/task/`:

- `TaskAccessCheck` — `task:assign`, `task:manage_all` (notes' `access-check.ts`).
- `TaskMemberDirectory` — `listAssignable(org, ws)` (active, holding
  `task:write`), `isAssignable(org, ws, userIds)` and `describe(ids)`; the queue's
  `QueueStaffDirectory` shape, capped at 200. A former member reads "a former
  member", and is what makes a board **orphaned** (C).
- `TaskNotifier` — `assigned(...)`, `commented(...)`; the app binds it to
  `NotificationSender.sendSafely` and declares `task.assigned` and
  `task.comment` in `notifications/sources.ts`, both `mutable: true`.
- `LimitChecker` from `@kwtech/module-kit`.

## 6. Web (`src/react/`)

- **`TaskApp`**: a board switcher (boards you can open, grouped *Mine* ·
  *Shared with me*, plus **My tasks**), a toolbar (Board · List, search,
  filters: *Assigned to me*, label, priority, dates; *Archive*), the view, and a
  **detail panel** for the open task. `@container` throughout: columns sit side
  by side and scroll sideways at every width; the panel sits beside the view
  when wide and slides over it when narrow, with a bar on its edge that
  collapses and expands it (changed 2026-09-28, PLAN §13). It never navigates away; the last board opened is remembered.
- **Creating a board**: a name, private or shared, and its **columns** —
  To do · Doing · Done filled in, each renamable and removable, *Add column*,
  drag to reorder, tick which mean done — or *Start blank*.
- **Columns on the board itself** (owner): *Add column* at the end of the
  board; a column's header menu has *Rename*, *Mark as done*, *Move left /
  right* and *Remove* (choosing where its tasks go); dragging a column header
  reorders. Others see the columns without these controls.
- **Board settings** (owner): name; the same column editing as a list; **Private / Shared with the
  workspace** (a lock on private boards everywhere); archive, delete. Making a
  shared board private confirms how many assignments it removes.
- **Board**: drag within and between columns with `@dnd-kit` from the catalog,
  as the notes list; the card stays where it was dropped while the server
  answers. Keyboard: a card's menu has *Move to*, and Ctrl+Shift+arrows move it
  (notes' shortcut). Without `task:write` the board is shown with dragging off,
  and a line saying why.
- **List**: grouped by column, sortable by scheduled day, due day or priority,
  for the viewer only.
- **My tasks**: assigned to you across every board you can open, grouped by
  day (overdue, today, this week, later, no date), each showing its board. A
  task is placed by its **scheduled** day, or its due day when it has none;
  overdue is always by the due day.
- **Attention chip** (added 2026-09-28): in the header, your own unfinished
  tasks counted as *overdue · today · soon* (`taskAttention`, on My tasks'
  groups; soon = planned or due within three days). Opens My tasks; absent when
  all three are zero. Workspace-wide (every board, whichever is selected), and
  labelled *All my tasks* so it is not read as the selected board's count.
- **Card**: title, priority (icon and word, not colour alone), the scheduled
  day and the due day when set (overdue in `--destructive`, scheduled-after-due
  warned, F), assignee avatars, checklist progress `3/5`, comment count,
  labels.
- **Detail panel**: title and description (autosave with notes' rules: one save
  in flight, flush on blur/unmount/hide, a conflict offers reload or overwrite),
  column, assignees (one picker, then *Add another*), scheduled and due (each
  with a clear button), priority, labels,
  board (move), checklist, comments (live), created/updated by.
- **Say why**: an empty app explains whether you have no boards or cannot
  create one (`not_granted` / `not_entitled`), with `useHoldsFeature`; without `task:assign` the picker offers only
  yourself and says so.
- Theme tokens only; priority colours from the theme, never raw colours.

## 7. Phases (one commit each)

1. `refactor(module-kit)` + `refactor(module-note)`: `escapeLikePattern` moves
   to module-kit.
2. `feat(module-task)`: keys, limits, presets; domain (`access`, `boards`,
   `columns`, `tasks`, `rank`, `labels`, `checklist`, `dates`), with tests.
3. `feat(module-task)`: the Prisma fragment; `db:migrate`, commit the migration.
4. `feat(module-task)`: the server half — boards and access first, then tasks;
   service tests against a fake client, surface coverage.
5. `feat(web-server)`: adapters (access, members, notifier), providers,
   notification sources, seed grants and plans; `db:sync`; boot the API.
6. `feat(module-task)`: the app — board switcher, board settings, board and
   list views, detail panel, replacing the sample board.
7. `feat(module-task)`: checklist, comments, My tasks, live updates.
8. `docs`: README, PLAN §13 entry, §12 items; this file's "Built" section.

## 8. Not in v1 (→ PLAN §12 when built)

Board templates and copying a board; per-column WIP limits; co-owners (several
people configuring one board); **sharing a board with chosen people** rather
than the whole workspace, and viewer/editor roles per board (set aside by the
operator to keep v1 simple);
subtasks as tasks; recurring tasks; **date reminders** (scheduled or due; need the job
runner, PLAN §12.40); times on the dates (stored as UTC instants, shown in the
browser's zone, E); attachments;
@mentions; Markdown comments (a shared renderer — extract only with a third
consumer); dependencies; a calendar view; time tracking; a link to one task or
board (the same problem as notes, §12.80).

## 9. Review (2026-09-28): the holes this plan closes

Security: a board, column, task, checklist item or comment id from another
workspace or board (lookups through the board); a move into a column of
another board; errors confirming a private board exists (one
`TASK_NOT_FOUND`); a key mistaken for access to a private board (both must
agree, §3); assigning a stranger (directory port, fail closed); an assignee who
lost access still being notified (unassigned when a board goes private,
decision 8); labels leaking private boards (decision 15); live events to the
wrong people (per-subscriber filter with the same `canOpenBoard`).

Data loss: removing a column with tasks in it (the owner picks a destination);
a card drag conflicting with a description edit (decision 17); autosave
conflicting with itself (one save in flight); losing the last second (flush on
blur, unmount, hide); deleting by accident (archive first, delete only from the
archive); a board stranded when its owner leaves (transfer, C).

Gaps: private boards filling a workspace's quota (per-person board cap); an
empty app with no reason (say why); a whole-board re-sort on every move
(fractional rank); two copies of the LIKE-escaping rule (moved to module-kit);
a notification storm from self-assignment (never notify the actor).
