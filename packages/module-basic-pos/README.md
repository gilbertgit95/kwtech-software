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

## On a phone (issue #22)

`@kwtech/module-basic-pos/mobile` offers the phone layout the **Point of sale**
app, gated by `pos:read` as on the Apps page, with its parts as SECTIONS in the
phone frame's strip. Today there is one, **Sell** (`pos:sell`), the operator's
choice for the phone; Orders, Items, Customers, Reports and Settings stay on
the full site and join as sections when they come to the phone, each gated by
its own key, without the app or its address (`?screen=pos&section=…`)
changing. The frame offers the app only while its holder has at least one
section, so somebody who may not sell is not shown an empty point of sale.

Sell is the same `useTill` and `Till`, in `Till`'s `phone` mode: the item grid
fills the screen and the order waits in a summary bar at the foot ("2 items ·
₱250 · View order"), opening over the items with "‹ Items" and opening by
itself to show the receipt. No shortcut bar and no shortcut help (a phone has
no function keys), and the search does not take focus on arrival, which would
raise the keyboard before anybody asked to type. `useTill` sits above the
sections (`PosMobileApp`), so a later section never costs the order being
built.

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

## The order panel's width

On the full screen, where the order sits beside the items, the order panel's
LEFT edge is a handle: drag it to give the order or the items more room
(288–720 px, never more than 65% of the till), or focus it and use ← → (Shift
for bigger steps), Home and End; double-click puts back the default 352 px
(22rem). Remembered per viewer and per device in localStorage
(`kwtech:pos-order-panel-width`), not as a store setting, since how wide it
should be depends on the screen. The rules are `view/order-panel.ts`. The
phone has no handle: its order opens over the items.

## Order reference (issue #24)

An order can carry one optional **reference**: free text, letters or numbers,
at most 40 characters (`POS_LABEL_MAX`), checked by `preparePosLabel`. A
restaurant puts the table number in it ("Table 5"); another store a pickup
tag or a job code. Nothing about it is restaurant-specific, and a store that
never uses it sees "No reference — add one" under the customer. It is the
same dashed box as the customer's, not a quieter line: optional, but what
tells held orders and tables apart (the operator, 2026-10-29).

- **It is the order's `label`**, the same column Hold has always asked for
  (D8). The GraphQL names (`label`, `setPosOrderLabel`) are unchanged; only
  the words on screen say "reference".
- **Set on the till** for any open order (the line under the customer), or
  when holding it. Setting it on a clear till starts the order, as adding a
  customer does.
- **Shown** in the cart's heading, the on-screen receipt and the order's
  details; **printed** on the receipt as "Order ref: …", apart from a
  payment's own "Reference"; **found** by the Orders search.

### Reference options (issue #30)

A store can set up the references its cashiers reuse all day ("Table 1" …
"Table 12", "Take-out", "Pickup"), so they take one tap and are spelled the
same every time. Optional: with none, both dialogs are the plain text box.

- **Kept on `PosSettings.referenceOptions`**, a JSON list in the store's
  order, at most 50 (`POS_REFERENCE_OPTIONS_MAX`), each a valid label, no two
  the same after `posReferenceKey` (case and spacing folded). Checked by
  `validateReferenceOptions` on write; re-read by `readReferenceOptions`,
  which drops what no longer passes rather than the whole list.
- **Edited in Settings → Order references** (add, rename, move up and down,
  remove), saved with `savePosReferenceOptions` under `pos:manage_settings`.
  ⚠ It is a mutation of its own: `savePosSettings` writes the keymap it is
  given or the defaults, so a list sent through it would reset every hot key.
  Every till reads the options with `posSettings`.
- **On the till, the Reference and Hold dialogs are a combobox**
  (`ReferenceDialog`): under the box, a **Quick select** grid of equal tiles,
  one per option, in the store's order (as many columns as fit at 7rem: two
  or three on a phone, four on the full till). Typing filters the tiles, and
  a click, a tap, or ↑ ↓ and Enter picks one and saves it at once. The one on
  the order is filled in. Esc hides the grid, not the dialog. The keys are
  `useOptionList`, the same hook as the customer picker. Text typed that is
  an option but for case or spacing is saved in the option's spelling
  (`snapToReferenceOption`); anything else is saved as typed.
- **On a phone** the tiles are taller (`min-h-14`, a thumb's target), and the
  box does not take focus, so the keyboard does not come up over the tiles;
  a tap on the box brings it.
- **"On hold" is a hint, never a lock.** An option carried by an order on
  hold (the till's Pending list) is flagged and stays pickable; the order on
  the till is never flagged against itself, even a resumed held one
  (`heldReferenceKeys`). The server does not refuse duplicate references.
- **Stored as text.** A picked option is the order's `label`, like a typed
  one, so receipts, the Orders list and search need nothing new. Recently
  used references that are not options are not suggested.

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
