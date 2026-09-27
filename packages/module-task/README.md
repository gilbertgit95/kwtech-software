# @kwtech/module-task

Tasks per workspace, run as a **sub-app** on the workspace's Apps page
(`module-app-hub`).

> **Placeholder.** This package is the initial drop: one feature key and a
> static screen with sample tasks, so the Apps page and the module wiring can be
> tested with more than one app. Nothing is read or saved. There is no schema,
> no server half and no API yet.

## What it contributes

| | |
|---|---|
| Feature key | `task:read` (workspace level): offers the app on the Apps page |
| Sub-app | `task`, label "Tasks", icon `checklist`, order 30, component `TaskApp` |
| Routes, nav | none. A sub-app has no drawer entry |
| Role preset | `task-user` (`task:read`), exported as data, never seeded by the module |

```ts
// apps/web-app/src/modules.ts
import { taskWebModule } from '@kwtech/module-task/react';
const FEATURE_MODULES = [..., taskWebModule()];
```

The web server only needs the registry, for `db:sync`:

```ts
// apps/web-server/src/seed/registry.ts
{ key: 'task', features: TASK_FEATURE_REGISTRY },
```

## Entry points

| Import | Contents |
|---|---|
| `@kwtech/module-task` | `TASK_FEATURE`, `TASK_FEATURE_REGISTRY`, `TASK_ROLE_PRESETS`. No framework |
| `@kwtech/module-task/react` | `taskWebModule()`, `TaskApp` |

## Growing it into the real app

Follow `module-queuing-window`, file for file:

1. `prisma/task.prisma` with `Task*` models and `task_*` tables keyed by
   `workspaceId`, and a `"./prisma"` export. The schema compose script picks up
   the folder on its own.
2. `src/server/` (a `"./server"` export, Nest peers, decorators in `tsconfig`
   and `jest.config.mjs`), with `REQUIRED_SCOPE_METADATA` on every resolver.
3. `src/operations.ts`, and **bind every operation** in `TASK_FEATURE_REGISTRY`.
   The bindings are this module's guard: an unbound operation is reachable by
   anybody signed in. Split keys by risk (`task:write`, `task:assign`).
4. Keep the app key `task`. It is saved in people's layouts.
