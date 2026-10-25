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

## Order reference (issue #24)

An order can carry one optional **reference**: free text, letters or numbers,
at most 40 characters (`POS_LABEL_MAX`), checked by `preparePosLabel`. A
restaurant puts the table number in it ("Table 5"); another store a pickup
tag or a job code. Nothing about it is restaurant-specific, and a store that
never uses it sees one muted "Add a reference" line under the customer.

- **It is the order's `label`**, the same column Hold has always asked for
  (D8). The GraphQL names (`label`, `setPosOrderLabel`) are unchanged; only
  the words on screen say "reference".
- **Set on the till** for any open order (the line under the customer), or
  when holding it. Setting it on a clear till starts the order, as adding a
  customer does.
- **Shown** in the cart's heading, the on-screen receipt and the order's
  details; **printed** on the receipt as "Order ref: …", apart from a
  payment's own "Reference"; **found** by the Orders search.

## Stock (issue #10)

Stock is its own module, `module-basic-inventory` (`docs/INVENTORY-PLAN.md`).
The POS meets it through two optional ports of its own, so a store without it
works exactly as before:

| Port (option) | Told / asks | Unbound means |
|---|---|---|
| `PosStockEvents` (`stockEventsProvider`, `POS_STOCK_EVENTS`) | after the commit: each line of an order paid from open or released unpaid (`finalised`), each line of a voided order (`voided`), each refund line marked "Put back in stock" (`returned`) | the store counts no stock |
| `PosStockLevels` (`stockLevelsProvider`, `POS_STOCK_LEVELS`) | how many of each live item and variant are left | the till shows no counts |

- ⚠ **Stock never stops a sale.** The events go after the commit and a failure
  is logged, never thrown; the till's counts are a warning, never a refusal.
- **`PosStockService`** (exported) holds the POS's side: `eventsSince(scope,
  since, limit)` reads the same events back from the orders and refunds, for the
  stock app's catch-up (inclusive of `since`, a sale before its void or refund
  at one instant); `catalogue(scope)` lists items and variants, archived ones
  too, for materials lists; `tillLevels(scope)` answers `posStockLevels`.
- **`posStockLevels`** (`pos:read`) gives the till `{ counts, levels }`; the
  till shows "3 left" / "Out of stock" on tiles, search and the variant picker,
  and a warning after a line goes past what is left. A `stock` event
  (`PosChange`) makes it read again.
- **Refunds by line** take `restock` per line (`pos_refund_line.restock`,
  default false). The dialog asks "Put back in stock" for product lines when the
  store counts stock, ticked unless the item came back damaged.
