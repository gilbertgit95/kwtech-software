# `module-jobs` — plan

Status: **planning, started 2026-10-05. Nothing is built.** The operator asked
whether a background service could check for what is due (an incoming booking,
a task due today), generic enough for any module to use; then asked for an
audit trail of it, and for it to be managed at app level like users and roles:
see every process, pause it, resume it, force a run. This file is the proposal
that came out of that conversation. What the operator asked for is in §2 and
what they decided in §9; no question is open. The rest (the contract, the
schema, the keys, the phases) is still to be reviewed before anything is
built. Once it is built the decision goes to
PLAN §13.

## 1. What it is

A runner for work that happens on a schedule rather than on a request, and the
app-level screens to watch and control it.

Nothing in `web-server` schedules anything today, and several known gaps wait
on exactly this: nobody is reminded when a task is due (PLAN §12.83), a cart
abandoned on a till stays for ever (§12.90), and booking is planned with
reminders and with requests that should lapse (`BOOKING-PLAN.md`). PLAN has
reserved `apps/worker` for "queue consumers, cron" since §5 and lists the job
platform as open (§12.10).

Three parts:

1. **A contract in `module-kit`.** A module declares its processes as data, as
   it declares its feature keys.
2. **`module-jobs`.** The runner, the record of every run, and the admin
   screens. An app-level module, like `module-permissions`' roles.
3. **The first process**, built with it so the contract is shaped by a real
   need (§10).

## 2. What the operator asked for (2026-10-05)

| # | Asked | Recorded as |
|---|---|---|
| R1 | A background service that checks for what is due, such as an incoming booking session or tasks due today | The runner, §4 |
| R2 | Generic: it runs each module's checks, whatever that module's process is | Modules declare processes through `module-kit`; the runner knows none of them, §3 |
| R3 | An audit trail of it | Every run and every control action is a row, never edited, §5 |
| R4 | Managed at app level, like users and roles | An app-level module with its own keys and a page in the drawer, §6 and §7 |
| R5 | Pause, run, and force a run | Pause, Resume and Run now, each behind a key, §6 and §7 |
| R6 | See the processes, such as the task module's background process | The page lists every declared process, grouped by module, §7 |
| R7 | Manage how often a process runs, or schedule when it should run | An admin sets a process's schedule: every so many minutes, or at set times of day. The module declares the default and the limits, §3 and §7 |

## 3. The contract (`module-kit`)

- **A process is declared as data on the module's server descriptor**: a key
  (`task.due_today`, `booking.upcoming_sessions`), a label and a description in
  plain words, its DEFAULT schedule, the limits an admin may change it within,
  and a handler. Prefixed by the module, as
  everything a module owns.
- **The runner knows no module, and no module knows the runner.** Modules
  import only `module-kit`; `module-jobs` receives the composed declarations
  from the app, as the seed registry receives the features. A module with no
  processes declares none.
- **The declarations are mirrored to the database by `db:sync`** (principle 4),
  so the admin page lists a process before it has ever run. A row nobody
  declares any more is deprecated, never deleted, and never run.
- **The schedule is the admin's to change, inside the module's limits (R7).**
  Two kinds: **every N minutes**, or **at set times of day** (one or more, on
  chosen weekdays). The module declares which kinds make sense for a process
  and the shortest interval it can bear: a sweep that reads every workspace
  must not be set to every ten seconds. The code's default is what runs until
  an admin changes it, and what "Reset to default" returns to. An override
  the declaration no longer allows (the limits were tightened in a release) is
  ignored in favour of the default, and the page says so.
- **A duplicate process key fails composition**, as a duplicate feature key
  does.
- **Telling people is not the runner's job.** A process that reminds somebody
  calls its module's own notifier port (`TASK_NOTIFIER`, `BOOKING_NOTIFIER`),
  which the app binds to `module-notification`. There is one way to notify.

## 4. The rules to keep from day one

- **⚠ A process SWEEPS; it never sets a timer per item.** "Find the sessions
  starting in the next 30 minutes that nobody was reminded of", not one timer
  per booking. A sweep survives a restart, a deploy and a pause; a timer is
  lost with the process that held it.
- **⚠ Every process is idempotent.** It records what it has done (a reminder
  sent, a request lapsed) in its own module's tables, so a second run, a
  restart or two servers never tell somebody twice.
- **One run at a time, per process.** The runner takes a database lock before
  a run, scheduled or forced. A second instance of the server, or a Run now
  pressed during a scheduled run, does not start another: it is refused, and
  the page says a run is under way.
- **Each process says how late is too late.** After a pause or an outage a
  sweep finds everything it missed. A reminder for a session that began two
  hours ago is worse than none, so the declaration carries the window past
  which an item is skipped, and the run counts what it skipped.
- **Days and times are the WORKSPACE's.** "Due today" is each workspace's
  today, in its own zone, not the server's (`.claude/rules/typescript.md`,
  "Days, times and time zones"). A process works workspace by workspace.
- **One failing process stops nothing else.** The runner catches, records the
  failure on the run, and carries on with the next process.
- **Fail closed.** A process that is paused, deprecated or unknown does not
  run. An unreadable pause state is read as paused.
- **Changing a schedule never changes what a process does.** How often and
  when are the admin's; which items are due, and how late is too late, stay
  the module's, in code. Running less often can only make a reminder later,
  never wrong or doubled, because a process sweeps and is idempotent.
- **Accurate to minutes, not seconds.** The schedule is a floor on how often,
  not a promise of when.

## 5. Schema (`prisma/jobs.prisma`)

All `Job*` models and `job_*` tables. App level: no `workspaceId` on the
process or the control rows.

| Model | Holds |
|---|---|
| `JobProcess` | the mirror of a declared process: key, module, label, description, the default schedule and its limits, whether it is deprecated; the admin's schedule if one is set (by whom and when); and its pause state (paused or not, by whom, when, why) |
| `JobRun` | one run: the process, how it started (`scheduled` or `forced`), who forced it, when it started and finished, the result (`succeeded`, `failed`, `skipped`), how many items it handled and how many it skipped as too late, and the error if it failed |
| `JobControl` | one control action: paused, resumed, forced, rescheduled or reset to default, on which process, by whom, when, the reason given, and for a schedule the one it changed from and to |

**A run records counts and errors, never names.** App-level staff see across
every organization, so a run says "12 reminders sent, 1 skipped", not whose.
An error message is the process's own, written with that in mind.

## 6. Keys (all app level)

Split by risk, so seeing does not grant control, and pausing, forcing and
rescheduling are each granted apart.

| Key | May |
|---|---|
| `jobs:read` | see the processes and their history |
| `jobs:pause` | pause and resume a process, with a reason |
| `jobs:run` | force a run now |
| `jobs:schedule` | change how often or when a process runs, and reset it to its default |

`super-admin` would hold all four. They are app-level keys, so they bypass
the plan filter and no organization's plan includes them.

## 7. The admin page

One page in the drawer, beside users and roles, behind `jobs:read`.

- **The list**, grouped by module (Tasks, Booking, Point of sale): the
  process and what it does, how often it runs, its state (running, paused by
  whom and since when, or failing), the last run and its result, and when the
  next is due.
- **Pause, Resume and Run now** on each row, each shown only to who holds its
  key (`useHoldsFeature`; the API authorises again). Pausing asks for a
  reason. Run now is a `ConfirmDialog`.
- **Schedule** on each row, behind `jobs:schedule`: a small form with "Every
  … minutes" or "At these times", showing the module's limits and its default
  beside it, and Reset to default. A value outside the limits is refused with
  the limit said ("This process can run at most every 5 minutes").
- **A row opens its history** in the list drawer (`ListDrawer`): its runs,
  newest first, and its control actions among them, so "why did reminders
  stop on Tuesday" reads off one screen.
- **A failing process is said plainly**, with its last error, and tells the
  people who can act through `module-notification` (a port, `JOBS_NOTIFIER`;
  unbound, nobody is told and the page is the only sign).

## 8. Where it runs

- **Proposed: inside `web-server`, guarded by a Postgres lock.** No new
  infrastructure and no second deploy. The lock is what makes it safe when
  the API runs as more than one instance.
- **Later: `apps/worker`,** the same image started for its processes alone
  (PLAN §5). Because the processes are declared through `module-kit` and the
  runner is one Nest module, the move is wiring, not a rewrite.
- **Not proposed: an outside job platform** (Inngest, as coseller uses,
  §12.10). It earns its place for long-running jobs and fan-out at scale, and
  it puts the audit trail and the controls in somebody else's dashboard,
  which is the opposite of R3 and R4.
- **It needs a host that stays up.** A container host does; a host that only
  runs on a request does not.

## 9. Decisions (operator, 2026-10-05)

Each was a proposal put to the operator, who accepted all of them. No
question is open.

| # | Question | Decision |
|---|---|---|
| D1 | After a pause or an outage, what is sent late | **Each process declares its "too late" window** (§4). Anything past it is skipped, and the run counts what it skipped |
| D2 | Run now while a run is under way | **Refused**, and the page says a run is under way. Not queued to run next: that would send nothing sooner |
| D3 | Is a pause global, or per organization | **Global, at app level.** Whether one workspace wants task reminders at all is that module's own setting, not a job control |
| D4 | How long history is kept | **90 days of runs**, cleaned by a process of the module's own. **Control actions are kept for good**: there are few, and they are the audit trail proper |
| D5 | What a run may record | **Counts and errors only, never names** (§5): app-level staff see across every organization |
| D6 | "At 8:00" in whose time | **Each WORKSPACE's own time.** "Tasks due today, at 8:00" reaches a workspace at its 8:00. The runner wakes often, and the process takes the workspaces whose time has come. One app-wide zone was the alternative: simpler, and it sends a workspace abroad its morning reminder at night |
| D7 | A schedule per organization or workspace | **No: one schedule, app level**, as for the pause (D3). A workspace wanting its reminder at another hour is a setting of that module |
| D8 | What is built first, this or booking | **`module-jobs` first, with task due reminders as its first process; then booking's phase 1.** Booking's reminders and lapsed requests depend on the runner, so it comes first rather than being fitted in afterwards |

## 10. Phases

1. **The contract and the runner.** The `module-kit` declaration, the sync,
   the lock, `JobRun`, with **task due reminders** as the first process
   (§12.83): the smallest real consumer that exists today.
2. **The admin page.** The list, the history, Pause, Resume, Run now and
   the schedule form, `JobControl`.
3. **History clean-up**, as a process of the module's own, and the failing
   process notice.
4. **The other consumers as they are built:** booking's reminders and lapsed
   requests, the point of sale's abandoned carts (§12.90), and later
   subscription expiry and messages to customers.

Built with its first process, not ahead of one: a runner with nothing to run
would have its contract guessed (principle 9).

**Order against booking (operator, 2026-10-05): this module first.** Phases 1
and 2 here, then booking's phase 1 (`BOOKING-PLAN.md` §10). Booking's
reminders and lapsed requests are processes of this runner, so building the
runner first means booking is not gone back to. D8 below.
