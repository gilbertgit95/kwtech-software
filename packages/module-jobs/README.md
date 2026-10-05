# @kwtech/module-jobs

The **background runner**. Modules declare work that happens on a schedule
rather than on a request ("remind people of what is due today"); this module
**queues** it, **runs** it a few at a time, and **records every run**.

It is **core, not a feature**: every application composes it, and it runs the
processes of whichever modules that application uses. With none composed it
boots and runs nothing. It imports no feature module and knows none: a process
is a declaration and a handler, both from `@kwtech/module-kit`.

The plan and the decisions behind it: `docs/JOBS-PLAN.md`. The decision log:
PLAN §13, 2026-10-05.

**Built so far (phases 1 and 2):** the contract, the sync, the queue, the
runner, its first process (`task.due_today`, in `module-task`), and the admin
page with its four keys, Pause, Resume, Run now, the schedule form and the
audit trail of control actions (`job_control`). **Not built yet (phase 3):**
the history clean-up and the failing-process notice (`JOBS_NOTIFIER`). Until
then a failing process is said on the page and nowhere else, and runs are kept
for good.

## In a Next.js app

```ts
const FEATURE_MODULES = [
  …,
  jobsWebModule({ moduleLabels: { task: 'Tasks' } }),
];
```

One page, `/admin/processes`, in the drawer's Administration group (order 60)
behind `jobs:read`. It is **core, not a sub-app**: nothing on a workspace's
Apps page, and no workspace-level key.

| Option | Default | Meaning |
|---|---|---|
| `moduleLabels` | none | what to head each module's processes with (`{ task: 'Tasks' }`). Only the app knows what it calls its modules. A module left out is headed by its key, in words |

## In a NestJS app

LAST in `SERVER_MODULES`, because it is handed the processes of every module
before it:

```ts
const DECLARING_MODULES = [taskServerModule({ … }), …];

const SERVER_MODULES = [
  ...DECLARING_MODULES,
  jobsServerModule({
    prismaProvider: jobsPrismaProvider,
    prismaWriteProvider: jobsWritePrismaProvider,
    processes: composeProcesses(DECLARING_MODULES),
    entitledWorkspacesProvider: { provide: JOBS_ENTITLED_WORKSPACES, useFactory: … },
    actorDirectoryProvider: { provide: JOBS_ACTOR_DIRECTORY, useFactory: … },
    resolveActorId: (request) => resolvePrincipal(request)?.userId,
    runner: env.JOBS_RUNNER === 'on',
  }),
];
```

Also: the fragment is composed by the schema script from `./prisma`; the same
declarations (without handlers) go in the app's `seed/registry.ts`, and
`seeders/jobs-processes.ts` mirrors them with `syncJobProcesses`. **A process
that was never synced has no row and does not run**; the runner names it in the
log at its first wake-up, and the admin page shows it as "Not synced". The
module's keys go in `seed/registry.ts` too (`{ key: 'jobs', features:
JOBS_FEATURE_REGISTRY }`): **the bindings are the guard**, so without that line
Pause and Run now are reachable by anybody signed in.

| Option | Default | Meaning |
|---|---|---|
| `processes` | none | every process to run: `composeProcesses(…)` over the app's descriptors |
| `runner` | `true` | whether THIS server takes runs off the queue. `false` everywhere means nothing runs |
| `maxConcurrentRuns` | 2 | how many runs may be under way at once, across every server |
| `tickSeconds` | 30 | how often the runner wakes |
| `maxRunSecondsCeiling` | 300 | the longest any process may declare for a run. One above it fails the boot |
| `expose.graphql` | `true` | whether this server publishes the admin page's operations. `false` on a worker that serves no page: it then needs no read client |
| `resolveActorId` | none | principal → `userId`, for who paused, forced or rescheduled. Absent, every admin operation is refused as not signed in |

| Port | Answers | Unbound means |
|---|---|---|
| `JOBS_PRISMA` | the read client, for the admin page | with `expose.graphql` on, the boot fails naming it |
| `JOBS_PRISMA_WRITE` | the client (`JobsTransaction`, checked by `satisfies-modules.ts`) | the module cannot start |
| `JOBS_ACTOR_DIRECTORY` | names for user ids the module already holds: who paused, forced or set a schedule | no names: the page says "an administrator". A look-up that throws is treated the same, and never fails the page |
| `JOBS_ENTITLED_WORKSPACES` | which workspaces belong to an organization whose plan includes a feature, a page at a time, with each one's time zone | a process serving a feature reaches NO workspace; its run is recorded as `skipped`, saying so |

A handler is resolved from the whole container by its class, so a process's
module must list the handler in its Nest module's providers. One that cannot be
resolved fails the boot.

### Where it runs

Inside `web-server` (operator, 2026-10-05). Several instances with the runner
on are safe, because every promise below is kept in Postgres. Moving it to a
separate worker later is `runner: false` on the API and the same modules booted
there with `runner: true`. It needs a host that stays up: one that only wakes
on a request never ticks.

## The queue

A table (`job_run`), so the backlog is in the same audit trail as everything
else and there is no new infrastructure.

- **A process is queued at most once.** Queueing is a compare-and-set on
  `job_process.activeRunId`. Already queued or running, a second request (the
  schedule coming round, or a forced run) is refused as `already_queued`.
- **At most N run at once**, counted in the database. Every claim first updates
  the one row of `job_queue_lock` inside its transaction, so claims wait on each
  other. More servers do not raise the limit.
- **First in, first out.** Runs queued by one wake-up share an instant; the
  process key breaks the tie.
- **A run has a time limit**: its process's `maxRunSeconds`. Past it the handler
  is told to stop (`context.signal`), the run is marked `failed`, and the queue
  moves on.
- **A run is held on a lease**: its time limit plus 30 seconds. A server that
  dies leaves a `running` row; once the lease lapses the next wake-up marks it
  `interrupted` and frees the process. A result arriving after that is dropped.
- **Fail closed.** A process that is paused, deprecated, unsynced or not in
  this build does not run. A run already queued when its process was paused is
  recorded as `skipped`. With no `job_queue_lock` row (never synced), nothing is
  claimed.

One wake-up: let go of lapsed runs, queue what is due, start what is queued
while a slot is free. A run ending asks the queue again at once.

## The admin page

`/admin/processes` lists every process **this build declares**, under its
module's heading: what it does, its schedule, how it stands, its last run and
when it is next checked. A row opens a drawer with the controls, the schedule
form and the history.

| It stands | Means |
|---|---|
| On schedule | nothing to say: it is waiting for its schedule to come round |
| Queued | a run is waiting its turn, and where it is in the queue |
| Running | a run is under way |
| Paused | an admin paused it: by whom, since when, and why |
| Failing | its last finished run failed, with the error. `skipped` and `interrupted` runs say nothing about the process and neither start nor end this |
| Not synced | declared in code with no row: it cannot run until `db:sync` |

- **Pause** asks for a reason (required, up to 300 characters) and stops the
  process **for every organization** (D3). Nothing more is queued, a run
  already queued is skipped at its turn, and a run under way finishes.
- **Resume** makes it due again at once if its cadence passed meanwhile. What
  it finds past its "too late" window it skips and counts, so resuming never
  sends a backlog (D1).
- **Run now** joins the same queue. It is refused while a run of that process
  is queued or under way (D2), and while it is paused; the page says which.
- **Schedule**: "every … minutes" or "at these times, on these days", inside
  the limits the module declares. The form and the server run the same check
  and say the same sentence ("This process can run at most every 15
  minutes"). **Reset to default** returns to the module's own.
- **History** is the process's runs and its control actions as ONE list, newest
  first, paged by a keyset cursor. A run shows counts and errors, never names.
- **Every control action is a row in `job_control`**, written in the same
  transaction as the change: who, when, why, and for a schedule from what to
  what. Never edited and never cleaned up (D4).
- **Each control is shown only to who holds its key** (`useHoldsFeature`); the
  API authorises again by the operation's binding.
- **It is not live.** The module publishes no events; the page re-reads every
  ten seconds while its tab is in front, and after every action.
- **Times are in the viewer's own zone**: it is an app-level screen, outside
  any workspace. A `daily` schedule's times are each WORKSPACE's own (D6), and
  the page says so beside them.

⚠ **An admin's schedule is in force only while `job_process.scheduleSetAt` is
set.** Reset clears `scheduleSetAt` and leaves the `schedule` column as it was,
because writing SQL NULL into a Json column needs a sentinel from the generated
Prisma client, which a module may not import. Every reader goes through
`adminSchedule` (`src/domain/schedule.ts`); never read the column directly.

## Vocabulary

| Word | Means |
|---|---|
| process | one piece of scheduled work, declared by a module: `task.due_today` |
| run | one time a process was queued: a row in `job_run`, never edited once finished |
| state | `queued`, `running`, then one of `succeeded`, `failed`, `skipped`, `interrupted` |
| trigger | `scheduled`, or `forced` (Run now) |
| control action | one thing an admin did: `paused`, `resumed`, `forced`, `rescheduled`, `reset_schedule`. A row in `job_control` |
| standing | how a process is, in one word, for the page: `unsynced`, `paused`, `running`, `queued`, `failing`, `idle` |
| cadence | how often a process is started: its interval, or for a `daily` schedule its `minEveryMinutes` |

A run records **counts and errors, never names**: `handled`, `skippedLate`,
`leftForNext`, and `note` or `error`. App-level staff read these across every
organization.

## The domain entry point

`@kwtech/module-jobs` is pure. The queue: `checkEnqueue`, `isRunDue`,
`runLeaseExpiry`, `runErrorText`, `runCount`, and the defaults
(`JOBS_MAX_CONCURRENT_RUNS`, `JOBS_TICK_SECONDS`,
`JOBS_MAX_RUN_SECONDS_CEILING`, `JOBS_LEASE_GRACE_SECONDS`). The controls:
`checkPause`, `checkResume`, `checkReschedule`, `preparePauseReason`,
`processStanding`, `nextCheckAt`, `controlRefusalMessage`. Schedules in words:
`adminSchedule`, `describeSchedule`, `normalizeSchedule`, `isSameSchedule`,
`scheduleRefusalMessage`. The history: `mergeHistory` and its cursor. Also the
keys (`JOBS_FEATURE`, `JOBS_FEATURE_REGISTRY`) and every GraphQL document the
page sends (`JOBS_OPERATIONS`). What a process IS (the declaration, the
schedule, `processOccurrence`) is in `@kwtech/module-kit`; see its README,
"Background processes".

## What it declares

`prisma/jobs.prisma`: `job_process`, `job_run`, `job_control`,
`job_queue_lock`.

Four feature keys, **all app level**, so they bypass the plan filter and no
organization's plan includes them. `super-admin` holds them by derivation; no
role preset is exported, because nobody else has been decided.

| Key | May | Guards |
|---|---|---|
| `jobs:read` | see the processes and their history | `jobProcesses`, `jobProcessHistory` |
| `jobs:pause` (privileged) | pause a process, with a reason, and resume it | `pauseJobProcess`, `resumeJobProcess` |
| `jobs:run` | force a run now | `runJobProcessNow` |
| `jobs:schedule` (privileged) | change a schedule within its limits, and reset it | `setJobProcessSchedule`, `resetJobProcessSchedule` |

One route, `/admin/processes`. No limits, and no processes of its own yet (the
history clean-up is phase 3).
