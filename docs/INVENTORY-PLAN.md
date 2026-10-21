# `module-basic-inventory` — plan

Status: **decided (operator, 2026-10-21, issue #10); being built.** I1–I17
(§9) are settled. This replaces the first draft, which kept stock
inside the POS (POS-PLAN §8, 2026-10-20). The operator moved it into a module of
its own on 2026-10-21 for two reasons: the shop also uses up **materials** it
never sells (paper, ink, lamination pouches, blank mugs), and a service it sells
should take its materials off stock when it is sold. Once built, the decision
goes to PLAN §13 and this file gets a "Built, and where it differs" section.

## 1. Why a module of its own

- **More than the till uses up stock.** A POS sale does, but so may a
  completed booking (`module-booking`), a print job relayed to a printer
  (`module-print`) and work done in-house. Materials have no `PosItem` to hang
  on, and forcing them into the POS catalogue would bend the till.
- **It is how multi-app suites do it.** In Odoo and ERPNext, Inventory is its
  own app and the POS writes to it. This repo has the same shape: one workspace
  running several sub-apps.
- **Not in the books.** The books count money and this counts things. They meet
  at a purchase and at cost of goods, through ports (§7).
- **What it costs.** A module never imports another (PLAN §9), so a sale and the
  stock it takes cannot be one transaction. The POS saves the sale, then tells
  inventory through a port. Inventory records each sale line once, as the books'
  POS import does, and a catch-up process repairs any message that was lost
  (§5). Moving stock out of the POS later would cost more than this.

## 2. What v1 is

A sub-app per workspace on the Apps page, titled **Stock** (app key `stock`).
One workspace is one store, as in the POS (POS-PLAN D1).

1. **Stock items**: everything the store counts. Each is either **for sale**
   (goods the till sells: a bottle of ink sold to a customer, a ready-made mug)
   or a **material** (used up making what is sold: 4R photo paper, 125-mic
   pouches, sublimation paper). A stock item has a name, an optional code, a
   **unit** (piece, sheet, pack, ml, l, g, kg, m), an optional unit cost, an
   optional low-stock level and an optional category. It is archived, never
   deleted.
2. **Uses** (the materials list): what one unit of something sold takes off
   stock. "1 × *Photo print 4R* (a POS service) uses 1 sheet of *4R photo
   paper*." "1 × *Mug print, 11 oz* (a POS variant) uses 1 *Blank mug 11 oz* and
   1 sheet of *Sublimation paper A4*." A POS product sold as it is links to its
   own stock item at 1 per unit ("*Ink bottle, black* uses 1 *Ink bottle,
   black*"). One mechanism covers goods and materials.
   - **On the item and on the variant** (I14). The item's list is what every
     variant uses; a variant's list adds what changes with it. *Sintraboard
     Photo Print* uses 1 *Hook* and 1.2 m of *Border protector* at any size;
     its variant *A4* adds 1 *Sintraboard A4*, 1 *Vinyl* and 1 *Photo top*,
     and *A3* adds 1 *Sintraboard A3*, 2 *Vinyl* and 2 *Photo top*. Selling
     an A3 uses both lists.
   - **An optional material is a variant** (I13), as POS-PLAN D9 already
     makes "pick exactly one" a variant: *Vinyl Sticker — Plain* uses 1
     *Vinyl*, *Vinyl Sticker — With photo top* uses 1 *Vinyl* and 1 *Photo
     top*, each at its own price. Until POS add-ons exist (D10), an extra
     can also be its own item ("*Photo top* add-on") with its own list.
   - **The list is fixed per item or variant.** A job that used more than its
     list (a misprint, a cracked board, a custom size) is recorded as waste
     (item 5). A per-order override is later.
3. **Receive stock**: stock item, quantity, unit cost, supplier (free text in
   v1), reference. The unit cost typed becomes the stock item's cost (latest
   cost, I16); every receipt keeps its own cost in the history.
4. **Adjust stock**: stock item, quantity in or out, and a reason (damaged in
   storage, lost, used in-house, found, correction, other with a note).
5. **Record waste** (I15): what was spoiled, a POS item or variant (a
   misprinted *Sintraboard Photo Print — A3*) or a single stock item (one
   sheet jammed in the printer), how many, and a reason (**misprint**,
   **damaged while making**, **damaged in storage**, **reprint for the
   customer**, other with a note). For a POS item the form fills in its
   materials from both its lists, and each quantity can be changed before
   confirming (the hook was not used yet). Confirming writes one `wasted`
   movement per material, all carrying the product and the reason, so waste is
   counted apart from corrections and stock-take differences.
6. **Stock take**: a count sheet by category. Type what is on the shelf, see
   each difference, then confirm.
7. **Stock list**: on hand, low and out of stock, stock value at cost. Opening
   an item shows its movements and what uses it.
8. **Create from POS products** (I17): offered when Stock has no items yet,
   and kept as an action afterwards. It lists the POS's products (and their
   variants) that no stock item uses yet; those picked become **for-sale**
   stock items linked 1-to-1, at quantity 0, ready for a first count. Services
   are never offered: they get materials lists by hand.
9. **In the POS**: the till shows "3 left" or "Out of stock" for items that use
   stock, and a refund by line asks "Put back in stock?" (§6).

## 3. The rules

- **On hand is added up from movements, never stored**, as cash on hand is in
  the books (principle 5): Σ quantity over a stock item's `StockMove` rows. A
  count cannot disagree with its history, and every change carries who, when
  and why.
- **Nothing is edited or deleted.** A wrong movement is corrected by another one
  (an adjustment), with its reason.
- **Quantities are whole thousandths of the unit (`Int`)**, as money is whole
  centavos: 0.5 m of film is `500`, 2 ml of ink is `2000`, 1 sheet is `1000`. A
  quantity is never a float. One pure `formatQuantity` / `parseQuantity` in
  `src/domain/` is the only place that converts. Pieces and sheets stay whole in
  the UI (I6).
- **Tracking is per stock item, not per POS item.** A POS item that nothing
  links to takes nothing off stock, so a store that never opens Stock sees no
  change. The first receipt or count of a new stock item can be marked
  `opening`.
- **A sale takes stock once.** Every movement from another module carries that
  module's key for the event: `pos:line:<orderLineId>`,
  `pos:void:<orderLineId>`, `pos:refund:<refundLineId>`. The key is unique per
  stock item (`@@unique([workspaceId, sourceKey, stockItemId])`). A retried or
  replayed message writes nothing new.
- **What a line takes is fixed when it is first recorded**: its uses as they
  were then, times the quantity. Editing a materials list later never rewrites
  history. A void or a refund return puts back exactly what that line took, read
  from its own movements, not from today's materials list.
- **Selling past zero is never refused here.** On hand can go below zero and
  shows as a warning (I5). A count that was wrong must not stop a sale in
  another module, and inventory cannot refuse a sale it hears about only after
  it is saved.
- **Materials do not come back on a refund.** "Put back in stock?" returns the
  **for-sale** stock items the line took; the paper a print used stays used.
- **A stock take compares against on hand at confirmation**, not when the sheet
  was opened, so a sale in between is not lost. Confirming writes one `count`
  movement per item that differs.
- **The workspace's time zone** dates everything: the history, "received this
  month", the reports (`.claude/rules/typescript.md`).

## 4. Schema (`prisma/stock.prisma`, prefix `Stock*` / `stock_*`)

- **`StockItem`**: `organizationId`, `workspaceId`, `categoryId?`, `kind`
  (`for_sale` | `material`), `name`, `code?` (unique per workspace), `unit`,
  `unitCost?` (centavos per **whole** unit), `lowStockAt?` (thousandths, null
  means no alert), `archivedAt?`, who and when.
- **`StockCategory`**: name and sort order, as `PosCategory`.
- **`StockUse`**: one line of a materials list. `source` (`pos` in v1), `refId`
  (the POS item or variant id, a bare string with no foreign key, principle 10),
  `refKind` (`item` | `variant`, I14), `refLabel` (the name copied for
  display, refreshed when the POS says it changed), `stockItemId`,
  `quantityPerUnit` (thousandths).
  `@@unique([workspaceId, source, refId, stockItemId])`. A sold line uses
  the rows for its item **and** for its variant; a stock item on both
  lists adds up, and the form says so when it is entered twice.
- **`StockMove`**: `stockItemId`, `kind`, `quantity` (signed thousandths),
  `unitCost?` (received only), `sourceKey?` (another module's event), `takeId?`,
  `wasteRefId?` / `wasteRefLabel?` (the POS item or variant a waste was of),
  `reason?`, `reference?`, `supplier?`, `clientId?` (manual moves:
  `@@unique([workspaceId, clientId])`, so a double press records once), who and
  when. Indexed by `[workspaceId, stockItemId, createdAt]` and
  `[workspaceId, createdAt]`.
- **`StockTake`**: a count's header: who, when, which categories, `open` |
  `confirmed` | `abandoned`. Its lines, `StockTakeLine`: the item, the count
  typed, on hand when confirmed.
- **`StockSettings`**: per workspace. The catch-up cursor per source (§5), and
  whether the till shows counts to cashiers (I8).

| Movement kind | Quantity | Made by |
|---|---|---|
| `opening` | + | the first receipt or count of a new item, marked opening |
| `received` | + | Receive stock (unit cost, supplier, reference) |
| `used` | − | another module's event: a POS line finalised |
| `returned` | + | that event reversed: a void, or a refund line put back |
| `adjustment` | ± | Adjust stock (reason required) |
| `wasted` | − | Record waste (reason required) |
| `count` | ± | confirming a stock take |

## 5. How other modules take stock

The POS never imports this module, and this module never imports the POS.
Each side declares ports and `apps/web-server` joins them (`src/stock/*`, as
`src/books/*` joins the books to the POS).

**Push, after the commit.** The POS declares an optional port, `POS_STOCK_EVENTS`:

```ts
interface PosStockEvents {
  linesFinalised(scope, lines: { key; itemId; variantId?; quantity }[]): Promise<void>;
  linesVoided(scope, lines: { key; finalisedKey }[]): Promise<void>;
  linesReturned(scope, lines: { key; finalisedKey; quantity }[]): Promise<void>;
}
```

The POS calls it **after** `pay()`, `payLater()`, `void()` or a refund commits,
and a failure there never fails the sale (as `sendSafely` does for
notifications). The app binds it to this module's `StockIntake` service, which
looks up the uses of each item or variant and writes the movements in one
transaction, keyed as in §3. **Unbound means no stock**: the POS works as it
does today.

**Catch-up, on a schedule.** A message can be lost if the server stops between
the commit and the call. A `module-jobs` process, `stock.catch_up`, asks the POS
through a second port (`StockSaleFeed.linesSince(cursor)`: finalised, voided
and refunded lines after a time, oldest first, a page at a time) and replays
them. Replaying is harmless because of the unique key, so the process can safely
read back a few minutes before its cursor. (I3)

**When stock leaves**: when the POS numbers the order, paid or released unpaid
with pay later (POS-PLAN D13), because the goods have left the store either way.
Cancelling an open order sends nothing. (I4)

**Later sources, each its own decision** (I9):

- **`module-booking`**: a booking marked done uses its service's materials
  (`source: 'booking'`, `booking:<appointmentId>`).
- **`module-print`**: a job relayed to a printer uses sheets by paper size and
  page count (`print:<jobId>`). `module-print` keeps no job rows, so the key
  is the relay's id, and the catch-up feed would have to come from what the
  agent reports.

## 6. What the POS shows and sends

- **Till**: "3 left" and "Out of stock" on the tiles and in search, from a POS
  port `POS_STOCK_LEVELS` (`levelsFor(itemIds)`, answered by this module).
  For an item with several uses, the count is the fewest it can still make
  ("12 left": 12 blank mugs, 300 sheets). Counts refresh live (a pubsub event
  on each movement). Selling past zero shows a warning, never a refusal (I5).
  Unbound means the till shows no counts.
- **Refund by line**: "Put back in stock?" per line, default yes, with a note
  that materials are not returned. Only shown when the line took for-sale stock.
- **Items**: nothing in v1. Uses are set in the Stock app (I2), which lists the
  POS's items through a port (`StockSourceCatalogue.itemsOf(workspace)`: id,
  variant id, name, kind, archived).
- **Settings, Orders, Reports**: nothing in v1.

## 7. The books

**Nothing in phase 1.** Cost of goods still comes from the unit cost each POS
line copies (POS-PLAN D15). Follow-ups, each its own decision:

- **Receiving records the purchase in the books** through a port (supplies, or
  stock for resale), so it is not entered twice. (I10)
- **A service's cost from its materials**: the POS item's cost proposed from Σ
  uses × unit cost, so service profit counts the paper. (I7)

## 8. Keys (all workspace level)

| Key | Grants |
|---|---|
| `stock:read` | the Stock app: on hand, movements, what uses what |
| `stock:receive` | receive stock, adjust it, record waste |
| `stock:manage` | stock items, categories, uses, stock takes, settings |

Presets: `stock-keeper` (`read`, `receive`) and `stock-manager` (all three).
`app-roles.ts` gives the workspace admin `stock-manager` and the workspace user
`stock-keeper` (operator, 2026-10-21: staff record deliveries and waste at the
counter; the admin sets up items, lists and stock takes), and combined roles
follow `.claude/rules/database.md`, "Combined workspace roles". Organization
plans gain the keys in `plans.ts`, every tier except free, as the POS and the
books. Limit: `stock:items` (how many stock items).
Every operation is bound (`surface-coverage.test.ts`).

## 9. Decisions (operator, 2026-10-21)

| # | Question | Decision |
|---|---|---|
| I1 | Name and prefix | Package `module-basic-inventory`; app title **Stock**; prefix `stock` (keys `stock:*`, app key `stock`, models `Stock*`, tables `stock_*`). Shorter than `inventory`, as the queue's is `queue` |
| I2 | Where materials lists are set | In the Stock app, on the stock item ("Used by") and from a POS item picker. The POS's item form stays as it is, because `/react` of one module cannot show another's |
| I3 | How the POS tells inventory | Push after the commit, plus a catch-up process reading a POS feed (§5). Pull only would make "3 left" lag by a run |
| I4 | When stock leaves | When the order is numbered: paid, or released unpaid with pay later |
| I5 | Selling past zero | Warn, never refuse. Refusing would need the till to ask before paying and could still race |
| I6 | Fractional quantities | Thousandths everywhere. The UI keeps piece, sheet and pack whole, and allows decimals for ml, l, g, kg, m |
| I7 | A service's cost from its materials | Later. Shown in Stock as "materials cost ₱4.20 per sale", not written into the POS yet |
| I8 | May cashiers see counts on the till? | Yes, with `pos:read`. The count comes through the POS's own port, so it needs no `stock:*` key |
| I9 | Phase 1 sources | POS only. Bookings and print jobs are phase 2, one at a time |
| I10 | Receiving records the purchase in the books | Not in phase 1; a port later |
| I11 | Phase 1 scope | Stock items, categories, uses, receive, adjust, stock takes, the till's counts, refund returns, catch-up. Phase 2: low-stock alerts (`module-jobs` + `module-notification`), suppliers, purchase orders, reports |
| I12 | Opening quantities | Typed as a stock take on the first day, or as the first receipt marked "opening". No import from a file in v1 |
| I13 | Optional materials (a photo top on a vinyl sticker) | A variant per choice, each with its own list and price (POS-PLAN D9). An add-on item with its own list until add-ons are attached to their item (D10) |
| I14 | Where a list sits on an item with variants | On both: the item's list for what every variant uses (hook, border), the variant's for what changes with size. A sale uses both |
| I15 | Spoiled work (a misprint, a board cracked while making) | **Record waste** by product: its materials filled in from its lists, editable, written as `wasted` movements with a reason; or a single stock item. `stock:receive`, so staff record it at the counter |
| I16 | A receipt at a new cost | The latest cost becomes the stock item's cost. Average cost is later |
| I17 | The POS's existing products | **Create from POS products**: picked products and variants become for-sale stock items linked 1-to-1 at quantity 0. Services are left out |

## 10. Phases, one commit each

1. `feat(module-basic-inventory)`: the package; `src/domain/` (quantities,
   on hand, low stock, a take's differences, what a line takes from its uses,
   what a waste of a product takes, how many a till can still make), with
   tests; keys, presets and limits.
2. `feat(module-basic-inventory)`: the schema; `db:migrate`.
3. `feat(module-basic-inventory)`: the services and resolvers (items, uses,
   receive, adjust, waste, takes, create from POS products, `StockIntake`, the catch-up process); service tests
   against a fake client: a line takes stock once, a replay writes nothing, a
   void returns what was taken, a refund returns only for-sale stock.
4. `feat(module-basic-pos)`: the `POS_STOCK_EVENTS`, `POS_STOCK_LEVELS` and
   feed ports, called after the commit; "3 left" on the till; "Put back in
   stock?" on refunds. Tests: an unbound port changes nothing, and a failing
   port never fails a sale.
5. `feat(web-server)`: the module wired in, `src/stock/*` joining the ports,
   grants, `db:sync`, boot.
6. `feat(module-basic-inventory)`: the Stock app: the list, items and uses,
   the dialogs, stock takes.
7. `docs`: both READMEs, PLAN §13, POS-PLAN §8, and "Built, and where it
   differs".
