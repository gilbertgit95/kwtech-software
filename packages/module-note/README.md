# @kwtech/module-note

Notes per workspace, run as a **sub-app** on the workspace's Apps page
(`module-app-hub`).

> **Placeholder.** This package is the initial drop: one feature key and a
> static screen with sample notes, so the Apps page and the module wiring can be
> tested with more than one app. Nothing is read or saved. There is no schema,
> no server half and no API yet.

## What it contributes

| | |
|---|---|
| Feature key | `note:read` (workspace level): offers the app on the Apps page |
| Sub-app | `note`, label "Notes", icon `pen`, order 20, component `NoteApp` |
| Routes, nav | none. A sub-app has no drawer entry |
| Role preset | `note-user` (`note:read`), exported as data, never seeded by the module |

```ts
// apps/web-app/src/modules.ts
import { noteWebModule } from '@kwtech/module-note/react';
const FEATURE_MODULES = [..., noteWebModule()];
```

The web server only needs the registry, for `db:sync`:

```ts
// apps/web-server/src/seed/registry.ts
{ key: 'note', features: NOTE_FEATURE_REGISTRY },
```

## Entry points

| Import | Contents |
|---|---|
| `@kwtech/module-note` | `NOTE_FEATURE`, `NOTE_FEATURE_REGISTRY`, `NOTE_ROLE_PRESETS`. No framework |
| `@kwtech/module-note/react` | `noteWebModule()`, `NoteApp` |

## Growing it into the real app

Follow `module-queuing-window`, file for file:

1. `prisma/note.prisma` with `Note*` models and `note_*` tables keyed by
   `workspaceId`, and a `"./prisma"` export. The schema compose script picks up
   the folder on its own.
2. `src/server/` (a `"./server"` export, Nest peers, decorators in `tsconfig`
   and `jest.config.mjs`), with `REQUIRED_SCOPE_METADATA` on every resolver.
3. `src/operations.ts`, and **bind every operation** in `NOTE_FEATURE_REGISTRY`.
   The bindings are this module's guard: an unbound operation is reachable by
   anybody signed in. Split keys by risk (`note:write`, `note:delete_any`).
4. Keep the app key `note`. It is saved in people's layouts.
