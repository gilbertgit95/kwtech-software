# @kwtech/module-basic-inventory

A store's stock per workspace, run as a **sub-app** on the workspace's Apps
page (`module-app-hub`): the goods it sells and the **materials** it uses up,
what each product sold takes off stock (its **materials list**), deliveries,
corrections, waste and stock takes. The package is `module-basic-inventory`;
its prefix is `stock` (`stock:*` keys, app key `stock`, `Stock*` models,
`stock_*` tables).

The plan and its decisions (I1–I17): `docs/INVENTORY-PLAN.md`. The decision:
PLAN §13, 2026-10-21. Issue #10.

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
import { stockWebModule } from '@kwtech/module-basic-inventory/react';
const FEATURE_MODULES = [..., stockWebModule()];
```

One sub-app, `stock` ("Stock", icon `boxes`, order 45, gated on `stock:read`),
component `StockApp`. No routes and no drawer entry. Sections:

- **Stock** — every item with on hand, its level and its worth at cost;
  filtered by low and out, by kind and by category, searched by name or code.
  An item opens what uses it and its history (newest first, a page at a time).
  Receive, Adjust and Record waste for `stock:receive`; New item and
  "Create from POS products" for `stock:manage`.
- **Products** — the point of sale's items, each with its own materials list
  and one per variant, how many the shelf can still make, and what one sale's
  materials cost. Lists are edited here (`stock:manage`); waste of a product
  starts here, its materials filled in from both lists (`stock:receive`).
- **Stock takes** (`stock:manage`) — a count sheet by category, saved as it is
  typed, confirmed against on hand at that moment.
- **Categories** (`stock:manage`).

The lists take ↑ ↓ and Enter (`LIST_KEYS`), and a list's detail opens in
`web-ui`'s `ListDrawer`. Every form checks its draft with the server's own
rules (`src/react/view/forms.ts`, tested in `test/views.test.ts`).

## In a NestJS app

```ts
stockServerModule({
  prismaProvider, prismaWriteProvider,          // STOCK_PRISMA, STOCK_PRISMA_WRITE
  limitCheckerProvider,                         // STOCK_LIMIT_CHECKER
  memberDirectoryProvider,                      // STOCK_MEMBER_DIRECTORY
  imports: [POS_SERVER_MODULE.nestModule],      // for the three POS ports below
  sourceCatalogueProvider,                      // STOCK_SOURCE_CATALOGUE
  saleFeedProvider,                             // STOCK_SALE_FEED
  changeListenerProvider,                       // STOCK_CHANGE_LISTENER
  pubsubProvider,                               // STOCK_PUBSUB
  resolveActorId,
})
```

Add `STOCK_FEATURE_REGISTRY`, `STOCK_LIMIT_REGISTRY` and
`STOCK_PROCESS_REGISTRY` to `MODULE_DECLARATIONS` in `seed/registry.ts`: **the
bindings are the guard**, and an unsynced process never runs.

| Port | Asks | Unbound means |
|---|---|---|
| `LimitChecker` | the `stock:items` cap from the plan | the declared default, 1000 |
| `StockMemberDirectory` | names for who received, adjusted, wasted or counted | nobody has a name ("a team member") |
| `StockSourceCatalogue` | the POS's items and variants, archived ones too | there is no POS: no list can be hung on a product, "Create from POS products" is refused |
| `StockSaleFeed` | the POS's finalised, voided and refunded lines at or after a time | nothing is caught up: a lost push is found by the next stock take |
| `StockChangeListener` | told after a commit that stock moved | the till re-reads its counts only on its own |
| `StockPubSub` | the app's one engine | not live: screens see others' changes on reload |

**The other direction.** The POS tells this module what left the store, and asks
it how many are left, through ports of the POS's own (`POS_STOCK_EVENTS`,
`POS_STOCK_LEVELS`, see `packages/module-basic-pos/README.md`). The app binds
both to `StockIntakeService` (exported): `apply(scope, events)` and
`levelsFor(scope, refs)`. ⚠ Because this module imports the POS's, the POS's
adapter finds the intake through `ModuleRef` the first time it is needed
(`apps/web-server/src/stock/pos-stock-bridge.ts`); importing this module into
the POS's would be a cycle Nest refuses.

The web server's adapters are in `apps/web-server/src/stock/`.

## Realtime

One trigger, `stock.changed`, carrying `{ organizationId, workspaceId, change,
actorId }` with `change` one of `stock` (on hand moved), `setup` (items, lists,
categories), `take`. No content. Published after the commit, never failing the
write; a `stock` change also goes to the change listener, which the app relays
as the POS's own `stock` event so open tills re-read "3 left". `stockEvents`
sends `sync` first.

## Vocabulary

| Term | Means |
|---|---|
| stock item | something counted: `for_sale` (sold as it is; a refund may put it back) or `material` (used up making what is sold; never comes back) |
| unit | what it is counted in: piece, sheet, pack (whole in the UI), ml, l, g, kg, m. Fixed once stock has moved |
| quantity | an integer number of **thousandths** of the unit: 1 sheet is `1000`, 0.5 m is `500` |
| on hand | Σ an item's movements. Never stored |
| materials list | the `StockUse` lines of one POS item (what every variant uses) or one variant (what changes with it). A sale takes both |
| movement | one change to on hand (`StockMove`): `opening`, `received`, `used`, `returned`, `adjustment`, `wasted`, `count`. Never edited or deleted |
| source key | `pos:line:<id>`, `pos:void:<id>`, `pos:refund:<id>`: the POS event a movement came from, unique per stock item |
| stock take | a count sheet; confirming writes a `count` movement per counted line that differs from on hand then |

## The domain entry point

`@kwtech/module-basic-inventory` is pure: `parseStockQuantity` /
`formatStockQuantity` (the only conversion between text and thousandths),
`stockValueAtCost` (BigInt, half up), `onHand`, `stockLevel`, `planLineTakes`
(what a sold line takes from both lists), `canStillMake` (the till's "3 left"),
`checkUseList`, `overlappingUses`, `planVoidReturn`, `planRefundReturn`,
`planTakeDifferences`, `takeMoves`, `prepareAdjustment`, `proposeWaste`,
`prepareWaste`, `costAfterReceipt`, the source keys, the registry, presets,
`STOCK_PROCESS_REGISTRY` and `STOCK_OPERATIONS`.

## The rules that keep the count honest

- **On hand is added up from movements**, summed in the database; nothing holds
  a count that could disagree with its history.
- **A POS event takes stock once.** Its movements carry its source key under
  `@@unique([workspaceId, sourceKey, stockItemId])`, and an event whose key is
  already written is skipped whole, so a list edited between two deliveries
  cannot add a line the first one did not take. The push and the catch-up can
  both deliver it, in any order.
- **What a line took is fixed when it is recorded.** A void or a refund puts
  back what that line's own movements took, never what today's list says.
- **A void puts everything back; a refund puts back only for-sale stock**, and
  only for lines the cashier marked "Put back in stock".
- **Selling past zero is never refused** (I5). On hand goes negative and the
  item shows "Count is off" until a stock take or a delivery.
- **A press records once**: every move made here carries the client's id
  (`@@unique([workspaceId, clientId, stockItemId])`); a clash answers with the
  first move.
- **A stock take compares at confirmation**, closed first and guarded on
  `open`, so two confirms cannot both write. One open take per store.
- **The latest receipt's cost becomes the item's** (I16); each receipt keeps its
  own on its movement.
- **An archived item is still taken** by a list that names it, so the history
  stays true; the archive dialog says to take it off those lists first.

## Processes

`stock.catch_up` — every 15 minutes (interval only, at least 5), for workspaces
whose plan includes `stock:read` and that have hung a list on a product (the
cursor starts then). Reads the POS's feed from ten minutes before its cursor,
a page of 200 at a time, at most 2000 events a run, and records any event the
push missed; one already recorded is skipped by its key. `maxRunSeconds` 120.
Never skips a sale as late (`tooLateAfterMinutes` is declared, a week, and
unused). Paused, sales still take stock through the push; only a lost push
waits.

## What it declares

| | |
|---|---|
| Feature keys (workspace level) | `stock:read`, `stock:receive` (receive, adjust, waste), `stock:manage` (items, categories, lists, create from POS, stock takes) |
| Limits | `stock:items` (plan, per workspace, active items, default 1000) |
| Role presets | `stock-keeper` (read, receive), `stock-manager` (all three) |
| Process | `stock.catch_up` |
| Sub-app | `stock`, "Stock", icon `boxes`, order 45 |
| Tables | `stock_category`, `stock_item`, `stock_use`, `stock_move`, `stock_take`, `stock_take_line`, `stock_feed_cursor` |
| Events | `stock.changed` |

The web server grants `stock-manager` to `workspace-admin` and `stock-keeper`
to `workspace-user`, and sells the keys and the cap in Starter, Pro and
Enterprise. ⚠ `createPlanIfAbsent` never rewrites a plan that exists: an
environment seeded before stock has none of its keys, and an operator adds
them and the cap on `/admin/plans`. Until then the app is not on the Apps page
(`not_entitled`) and the till shows no counts.
