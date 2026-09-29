# @kwtech/module-basic-pos

A point of sale per workspace, run as a **sub-app** on the workspace's Apps page
(`module-app-hub`).

> **Placeholder.** This package is the initial drop: one feature key and a
> static screen with sample products and a cart, so the Apps page and the module wiring can be
> tested with more than one app. Nothing is read or saved. There is no schema,
> no server half and no API yet.

## What it contributes

| | |
|---|---|
| Feature key | `pos:read` (workspace level): offers the app on the Apps page |
| Sub-app | `pos`, label "Point of sale", icon `store`, order 40, component `PosApp` |
| Routes, nav | none. A sub-app has no drawer entry |
| Role preset | `pos-cashier` (`pos:read`), exported as data, never seeded by the module |

```ts
// apps/web-app/src/modules.ts
import { posWebModule } from '@kwtech/module-basic-pos/react';
const FEATURE_MODULES = [..., posWebModule()];
```

The web server only needs the registry, for `db:sync`:

```ts
// apps/web-server/src/seed/registry.ts
{ key: 'pos', features: POS_FEATURE_REGISTRY },
```

## Entry points

| Import | Contents |
|---|---|
| `@kwtech/module-basic-pos` | `POS_FEATURE`, `POS_FEATURE_REGISTRY`, `POS_ROLE_PRESETS`. No framework |
| `@kwtech/module-basic-pos/react` | `posWebModule()`, `PosApp` |

## Growing it into the real app

The plan (a basic till first: items, orders, an optional customer reference,
recorded payment): `docs/POS-PLAN.md`. The package is `module-basic-pos`, but
its prefix is `pos` (`pos:*` keys, app key `pos`, `Pos*` models).

Follow `module-queuing-window`, file for file:

1. `prisma/pos.prisma` with `Pos*` models and `pos_*` tables keyed by
   `workspaceId`, and a `"./prisma"` export. The schema compose script picks up
   the folder on its own.
2. `src/server/` (a `"./server"` export, Nest peers, decorators in `tsconfig`
   and `jest.config.mjs`), with `REQUIRED_SCOPE_METADATA` on every resolver.
3. `src/operations.ts`, and **bind every operation** in `POS_FEATURE_REGISTRY`.
   The bindings are this module's guard: an unbound operation is reachable by
   anybody signed in. Split keys by risk (`pos:sell`, `pos:manage_items`).
4. Keep the app key `pos`. It is saved in people's layouts.
