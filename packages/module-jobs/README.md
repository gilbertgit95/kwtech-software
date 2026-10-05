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

**Built so far (phase 1):** the contract, the sync, the queue, the runner, and
its first process, `task.due_today` (in `module-task`). **Not built yet:** the
admin page and its keys (`jobs:read`, `jobs:pause`, `jobs:run`,
`jobs:schedule`), `JobControl`, the history clean-up and the failing-process
notice. Until the page exists, the runner is watched in the server log and in
`job_run`. So there is no `/react` entry point and no "In a Next.js app" yet.

## In a NestJS app

LAST in `SERVER_MODULES`, because it is handed the processes of every module
before it:

```ts
const DECLARING_MODULES = [taskServerModule({ … }), …];

const SERVER_MODULES = [
  ...DECLARING_MODULES,
  jobsServerModule({
    prismaWriteProvider: jobsWritePrismaProvider,
    processes: composeProcesses(DECLARING_MODULES),
    entitledWorkspacesProvider: { provide: JOBS_ENTITLED_WORKSPACES, useFactory: … },
    runner: env.JOBS_RUNNER === 'on',
  }),
];
```

Also: the fragment is composed by the schema script from `./prisma`; the same
declarations (without handlers) go in the app's `seed/registry.ts`, and
`seeders/jobs-processes.ts` mirrors them with `syncJobProcesses`. **A process
that was never synced has no row and does not run**; the runner names it in the
log at its first wake-up.

| Option | Default | Meaning |
|---|---|---|
| `processes` | none | every process to run: `composeProcesses(…)` over the app's descriptors |
| `runner` | `true` | whether THIS server takes runs off the queue. `false` everywhere means nothing runs |
| `maxConcurrentRuns` | 2 | how many runs may be under way at once, across every server |
| `tickSeconds` | 30 | how often the runner wakes |
| `maxRunSecondsCeiling` | 300 | the longest any process may declare for a run. One above it fails the boot |

| Port | Answers | Unbound means |
|---|---|---|
| `JOBS_PRISMA_WRITE` | the client (`JobsTransaction`, checked by `satisfies-modules.ts`) | the module cannot start |
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

## Vocabulary

| Word | Means |
|---|---|
| process | one piece of scheduled work, declared by a module: `task.due_today` |
| run | one time a process was queued: a row in `job_run`, never edited once finished |
| state | `queued`, `running`, then one of `succeeded`, `failed`, `skipped`, `interrupted` |
| trigger | `scheduled`, or `forced` (Run now, phase 2) |
| cadence | how often a process is started: its interval, or for a `daily` schedule its `minEveryMinutes` |

A run records **counts and errors, never names**: `handled`, `skippedLate`,
`leftForNext`, and `note` or `error`. App-level staff read these across every
organization.

## The domain entry point

`@kwtech/module-jobs` is pure: `checkEnqueue`, `isRunDue`, `runLeaseExpiry`,
`runErrorText`, `runCount`, and the defaults (`JOBS_MAX_CONCURRENT_RUNS`,
`JOBS_TICK_SECONDS`, `JOBS_MAX_RUN_SECONDS_CEILING`,
`JOBS_LEASE_GRACE_SECONDS`). What a process IS (the declaration, the schedule,
`processOccurrence`) is in `@kwtech/module-kit`; see its README, "Background
processes".

## What it declares

`prisma/jobs.prisma` (`job_process`, `job_run`, `job_queue_lock`). No feature
keys, limits, routes or processes of its own yet.
