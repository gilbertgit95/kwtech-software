# `module-basic-pos` — plan

Status: **planning, reset 2026-09-29 to a basic POS.** The module is still the
2026-09-27 placeholder (one key, `pos:read`, and a static screen with sample
data; see `packages/module-basic-pos/README.md`). The first draft of this plan
(stock layers, shifts, BIR, approvals) was set aside by the operator as too
much to start with. v1 is a plain till, and the rest arrives one piece at a
time **after** it works (§7). Once built, the decision goes to PLAN §13 and
this file gets a "Built, and where it differs" section.

## 1. What v1 is

A point of sale per workspace, run as a sub-app on the workspace's Apps page
(app key `pos`, kept: it is saved in people's layouts). One workspace is one
store.

1. **Items**: things the store sells, each a **product** or a **service**.
   Name, price, an optional category, and optionally a **code** (the store's
   own short code, for search) and a **cost** (what it costs the store). Archived, never deleted. An item may
   have **variants** (sizes or types, each with its own price): tapping it
   opens a picker. An item without variants goes straight into the cart.
2. **Orders**: tap items into a cart, change quantities, remove lines,
   add a short **note** to a line ("no ice", "for pickup"), set the
   **customer** (a walk-in, or a recorded customer, or save a new one from
   the order), give a **discount** (admin only), then take payment.
3. **Payment**: cash, GCash/e-wallet or card, **recorded only**. Cash shows the
   change due. For the others the cashier takes the money outside the app
   (store terminal, QR) and may type a reference number. When the customer
   leaves the change, **Keep as tip** records it (all or part of it).
   **Pay later** finalises the order as **unpaid** when the customer takes the
   items now and pays another day. **Change owed** records change the store
   could not hand over yet (no coins, the customer left), to give later.
4. **Receipt**: on screen, with the order number, printable from the browser.
5. **Pending orders**: **Hold** sets the current order aside and starts a
   new one, so a slow customer never blocks the line. Held orders wait in a
   list (with the customer name or a short label, the item count, the total
   and how long ago it started), and a tap resumes one at the till.
6. **Orders list**: today's orders, their total and the tips, and the
   **unpaid** orders (the customer owes the store) and **change owed** orders
   (the store owes the customer) apart, with who and since when. Open any
   order to see or reprint it.
7. **Keyboard**: the till runs from the keyboard as well as by tapping, with
   **hot keys** for actions (search, hold, pay …) and **item keys** that ring
   up a frequent item in one press. Defaults work on day one; the admin can
   change them per store.
8. **Dashboard and reports** (admin only): today's numbers at a glance, sales
   over time per day or month, busy hours, top items, payment methods, and
   six report tables with CSV export.
9. **Refunds** (admin only): items come back, or part of the money is given
   back. Recorded as its own record against the paid order, which never
   changes.

That is all. No stock, tax breakdown, automatic promotions or shifts in
v1. **Online only**: when the connection drops the till says it cannot save,
and never pretends to.

## 2. Decisions (operator, 2026-09-29)

| # | Question | Decision |
|---|---|---|
| D1 | What is a store | **One workspace = one store.** Every row is keyed by `workspaceId`, as every sub-app's is |
| D2 | Where items live | **Per workspace.** Each store has its own items and prices |
| D3 | Scope of v1 | **Basic POS**: items, orders, an optional customer reference, recorded payment, a receipt. Everything else waits (§7) |
| D4 | Products vs services | **One table, a `kind` column** (`product` / `service`). In v1 the kind is a label and a filter; it starts to matter when stock arrives (services are never counted) |
| D5 | Customer | **Revised the same day: walk-in by default, or a recorded customer, and a customer can be created from the order.** (1) **Walk-in**: no customer, a *Walk-in* tag, and an optional free-text name that lives on that order only ("Ate in blue shirt"). (2) **Recorded**: search the store's customers by name or contact and link one; the order then shows in their history. The name box is a **search-select** (2026-10-02): the matches drop down under it as it is typed, `↑` `↓` then `Enter`, or a click, links one, and `Enter` never links a match nobody chose, so a walk-in is not rung up to the first recorded customer with a similar name. (3) **Save as customer**: a first-time customer whose details are known is created from the name and contact typed on the order, and linked, in one step. A customer is a name, an optional **phone**, an optional **e-mail**, an optional **Facebook link** and an optional note — three fields since 2026-10-02, one free-text contact before (the store's main channel is its Facebook page's Messenger, and a link has to be kept as a link). The Facebook link is only ever Facebook's or Messenger's own `https` address (`preparePosFacebookUrl`, run on the server and again before the screen draws it as *Open in Facebook*), so nobody can plant another site behind it. The order **copies** the name and ONE contact line when linked — the phone, else the e-mail, else the Facebook link — so editing a customer never changes an old receipt; any one of the three is enough for pay later and change owed. The till keeps its single Contact line: *Save as customer* files it under e-mail when it has an `@`, otherwise phone. A walk-in order can be linked later while `open` or `unpaid`; a paid order keeps what it had. **Both roles** create and edit customers (`pos:sell`), because the till is where they are met. Loyalty, credit limits and merging duplicates are later (§7) |
| D6 | Payment | **Recorded, not processed.** No payment gateway |
| D7 | Name | **The package is `module-basic-pos`** (`@kwtech/module-basic-pos`), renamed from `module-pos`. **The prefix stays `pos`**: keys `pos:*`, app key `pos`, models `Pos*`, tables `pos_*`. A short prefix is normal (`module-queuing-window` uses `queue`), the app key is saved in people's layouts, and `pos:read` is already synced and granted |
| D8 | Pending orders | **Several open orders at once.** Hold sets one aside and a new one starts; any held order can be resumed. No extra status: a held order is `open` with the time Hold set it aside (`heldAt`). **Only Hold makes a pending order** (changed 2026-10-03; before, every open order was pending, so a cart that was only being tried was listed too): a cart still being built is listed nowhere, and the till remembers it across a reload. **Shared across the store**, so another cashier can finish it. A **label** (free text: "table 3", "blue shirt") tells them apart when there is no customer name |
| D9 | Variants | **In v1, as one flat list per item**, each variant with a name and its own price: "Lamination" → "125 mic · ID", "250 mic · A4" …; "Iced tea" → "Small", "Large". Two choices (thickness × size, size × paper) are written into the variant's name, not combined automatically, so a store lists only the combinations it sells (250 mic has no Medium). Suits print shops, groceries (250 ml / 1 L) and restaurants (1 pc / 2 pc) alike. A barcode per variant can come later, on the variant |
| D10 | Add-ons | **Later (§7).** Until then an add-on is its **own item**, in an "Add-ons" category, on its own line ("Extra rice ₱20"): the total is right, but it is not attached to its dish. The rule for which is which: **always pick exactly one** (size, thickness, paper) is a variant; **optional, maybe several** (extra rice, pearls, rush fee) is an add-on |
| D11 | Line note | **A short free-text note per line** ("no ice", "less sugar", "for pickup"). Covers most instructions until add-ons exist. Printed on the receipt; never priced |
| D12 | Tip | **In v1.** When a customer pays ₱10 for ₱7 and leaves the change, the cashier taps **Keep as tip** (all of it, or part: give ₱1 back, keep ₱2). The order total stays ₱7; the ₱3 is recorded as `tip`, apart from sales, so the day's money adds up (sales + tips = money received). Works for e-wallet and card as well as cash. The opposite of a discount: a discount lowers what is owed, a tip is extra the customer chose to give |
| D13 | Pay later | **A status, `unpaid`, not a credit ledger.** **Pay later** at payment finalises the order: it gets its number, is locked like a paid order, can be printed, and **requires the customer name and contact** (a recorded customer, or typed, with **Save as customer** offered). The orders list shows unpaid orders apart. When the customer returns, the order is paid in full as usual (method, tip) and becomes `paid`. **No partial payments**: the customer pays the whole balance at once; partial payments (a payments table, which also brings split payments) are later (§7). A day's **sales** count orders by when they were **paid**; unpaid orders are listed, not counted, until then |
| D14 | Change owed | **A flag on a paid order, the mirror of D13.** The customer paid ₱1,000 for ₱900 and the ₱100 change cannot be given now: **Change owed** at payment records it, and **requires the customer name and contact**. The order is `paid` (the sale counts that day), tagged "change owed ₱100", and listed apart. Later, **Change given** clears it (who and when are kept), or, if the customer then says keep it, it becomes a **tip**. Money still adds up: received = total + change given + change owed + tip. Owed change is given back **in full**, as unpaid orders are paid in full |
| D15 | Code and cost | **Two optional fields on items and on variants.** **Code** (SKU): the store's own short code ("LAM-A4"), found by the till's search; **unique per store** across items and variants, so a code finds exactly one thing. **Cost**: what one unit costs the store, in centavos, so profit reports later need no re-entry. A variant has its own, because an A4 sheet costs more than an ID one. **Cost is shown only to `pos:manage_items`**: a cashier sells without seeing the margin. Each order line **copies** the unit cost at the time of sale, as it copies the price. Photo, barcode, stock and tax class wait for their own features (§7) |
| D16 | Discounts | **In v1, manual, admin only.** A discount is **₱** (fixed amount) or **%**, on **one line** or on the **whole order**, with a **reason** ("suki", "damaged", "Senior"). A fixed ₱ on a line comes off the whole line, not each unit: ₱100 off 100 magnets at ₱15 is ₱1,400. The order discount applies after line discounts. A discount never takes a line or the order below ₱0, and a % rounds to the centavo in `computeOrderTotals` (half up), the one place that adds up an order. The receipt shows the price, the discount and its reason. Only while the order is `open`. **Only `pos:discount`** gives one, held by `pos-manager` and so by the **workspace admin**; a workspace user sells at the listed price. Senior/PWD (20% **and** VAT removed, ID recorded) waits for VAT; until then it is a manual 20% with the reason "Senior". Automatic promotions and coupon codes are later (§7) |
| D17 | Refunds | **In v1, simple, admin only (`pos:refund`).** A refund is **its own record** pointing at a **paid** order, which never changes: the day's figures read sales, then refunds. Refund **by line** (pick the line and how many: 1 of 2 laminations) or **by amount** (part of the money back, no item returned). A reason is required, and how the money went back (cash, e-wallet, card). It can **never exceed what was paid minus what was already refunded**, per line and per order. By line, the amount is what the customer actually paid for those units, after line and order discounts, worked out by the pure `refundAmounts` in `src/domain/` so that refunding every unit returns exactly the total, to the centavo. A **tip is not refunded** (it was not the sale). An order shows *Partly refunded* or *Refunded*, derived from its refunds, not stored as a status. **An unpaid order whose items come back** is **voided** by the same key with a reason: it keeps its number (so numbers stay gapless) and leaves the unpaid list. An **exchange** is a refund plus a new order. Counted on the day it is made. Refunds from stock, and a supervisor approving a cashier's refund, are later (§7) |
| D18 | Hot keys | **In v1, with defaults, configurable per store.** Cashiers in groceries and shops work from the keyboard, so every till action has a key. **Defaults**: `/` or `F2` item search; `Enter` in search adds the match (an **exact code** wins, so a barcode scanner, which types a code and presses Enter, works later with nothing new); `↑` `↓` select a line; `+` `−` its quantity; `Delete` removes it; `F4` hold; `F6` customer; `F8` pending orders; `F9` pay; on the payment screen `1` `2` `3` pick cash / e-wallet / card, the amount is typed, `T` keep as tip, `O` change owed, `L` pay later, and `Enter` confirms; after payment `P` prints and `Enter` starts the next order; the rest are in D20; `Esc` closes a picker or dialog and **never cancels an order**; `?` lists every key. Each button shows its key ("Hold · F4"). **Configurable**: the admin rebinds actions, and assigns **item keys** (a free key rings up an item or variant, e.g. `Shift+F1` → Plastic bag; `Shift+F1`–`Shift+F12` are left free for this). One keymap **per store**, so every till behaves the same. **Rules**, in the pure `validateKeymap` in `src/domain/`: one action per key; keys the browser must keep are **refused** (`F5`, `F11`, `F12`, and `Ctrl`+`P` / `R` / `W` / `T` / `N` / `L`, `Ctrl`/`Alt`+digits); a key bound to an archived item is shown as broken in settings and does nothing at the till. **Scope**: keys act only while the POS panel has focus, never page-wide, because the Apps page can show the queue beside it and the queue already takes `Space`; **except function keys** (2026-10-02), which act from anywhere on the page while Sell is on screen, unless focus is in another app's text field or dialog: with focus on the POS's header or on nothing, `F6` had gone to the browser's address bar, and no other app binds a function key; and never while typing in a text field (a note, a customer name), except `Enter` and `Esc`. Which browser keys can really be taken over (`F1`, `F3`, `F6`, `F7`, `F10`) is checked in phase 7, and the refused list follows what is found. Per-person keymaps are later (§7) |
| D19 | Item search | **Search as you type**, over item name, **variant name**, **code** and category, case-insensitive, words in any order and partial ("a4 lam", "lami 250"). **Variants are results of their own** ("Lamination — 250 mic · A4"), so a precise search skips the picker; a search matching only the item opens the picker as a tap does. Ranked: exact code, then names starting with the text, then names containing it; an exact code plus `Enter` adds at once (D18, and scanners later). `↑` `↓` in the search box move through the matches and `Enter` adds the highlighted one, the first until an arrow moves it (2026-10-02). Archived items never show; no match says so and guesses nothing. **Searched in the browser**: the till loads the store's items once (small, and capped by `pos:items`) and filters locally, so there is no request per keystroke and slow internet does not lag it. Open tills refresh **live** when an item changes (a pubsub event, as the queue's). The matching and ranking are one pure `searchItems` in `src/domain/`, with tests. Typo tolerance is later (§7) |
| D20 | Keyboard only | **A whole sale can be done without a mouse**, from the first item to the next order, and that is a requirement, not a nicety. **Focus always has a home**: after every action (a line added, a dialog closed, an order paid) it returns to search, and it is never left on the page body. Home is the receipt's *Next order* after a sale, the cart while a line is selected, otherwise search; a removed line and a click on a blank part of the till send focus home too, because the keys only fire while focus is inside the till (2026-10-02: focus had been falling to the page body, or onto a dialog's Close button, and the keys went dead until a click). In **any** text field, search included, only function keys act. **Two zones**: search and cart. `↑` from search enters the cart; `/` or `F2` returns. In the cart, `+` `−` `Delete`, `D` line discount, `N` line note act on the selected line; in search, letters type. `Shift+D` is the order discount. **Quantity first**: `100*` then the item adds 100 (the grocery habit); `+` `−` still work after, and a line's quantity is also **a box to type in** (2026-10-02), saved on `Enter` or on leaving it, so a big order already on the cart is not twenty presses; what is not a whole number from 1 to 9999 is refused in words and put back, never clamped. **Every picker and dialog** (variant, customer, discount, note, payment) runs on `↑` `↓` `Enter` `Tab` `Esc`, traps focus while open and gives it back when it closes. A dialog **opens on the box or choice used next** (the customer search, the amount, the reason, the first variant), never on its Close button; so do a blank form (New item, New customer, a variant row just added) and a section, on its search (2026-10-02: the dialogs had been opening on Close, because their content mounted before the dialog was open). **The lists** outside the till (pending orders, a variant, orders, customers and their history, items, unpaid orders in reports) take `↑` `↓` `Home` `End`, wrapping and skipping what is disabled, and `Enter` opens the row in focus; moving never opens one, and `↓` in a section's search box enters its list (2026-10-03, `list-keys` in `web-ui`). Pending orders opens on the first order that can be resumed, not the one already on the till. **Tab order** follows the screen, with a visible focus ring. Keys are printed on their buttons ("Pay · F9") and in the `?` list. **Tested**: a component test in phase 7 rings up a sale with key presses only, so the mouse-free path cannot break unnoticed. All of these are D18 defaults, and so rebindable |
| D21 | Shortcut bar | **A bar along the bottom of the till lists the keys that work right now.** It follows the zone: **search** (`F2` search, `100*` quantity, `↑` cart, `F6` customer, `F4` hold, `F8` pending, `F9` pay, `?` all), **cart** (`+` `−`, `Del`, `D` discount, `N` note, `Shift+D` order discount, `/` search), **payment** (`1` `2` `3`, `T` tip, `O` change owed, `L` pay later, `Enter`, `Esc`), **after payment** (`P` print, `Enter` next order), **a picker or dialog** (`↑` `↓`, `Enter`, `Esc`). It shows **the store's keymap** (a rebound key shows as rebound) and its **item keys**, and **only what the person may do** (no `D` without `pos:discount`), from the same keymap and `useHoldsFeature` as the keys themselves, so the bar and the keys cannot disagree. **Clicking** an entry does the action. In a **narrow panel** (a grid cell on the Apps page, by container query) it keeps the first few and folds the rest behind `?`. **Shown by default**; each person can hide it, remembered in their browser only (a convenience, not a setting) |
| D22 | Dashboard and reports | **In v1, admin only (`pos:reports`).** One **period picker** drives the page: a button that always names the period and its days, opening the presets (Today, Yesterday · This week, Last week, Last 7 days · This month, Last month, Last 30 days · This year · Custom range, two date fields), each listed with the days it means; and **arrows** either side that step to the period before or after (a day by a day, a whole week, month or year by one of the same, anything else by its own length; nothing after today). Widened from a plain select on 2026-10-01. Reports **open on This month** (the 1st to today), not Today. **Dashboard**: KPI cards (net sales, orders, average order, profit when costs exist), each compared with the **same weekday last week** for a day and the previous period otherwise, plus reminders of unpaid and change owed; **sales over time** (columns per day for a month, per month for a year, the previous period as a faint line, sales or orders, a column opens that day); **sales by hour**; **top 10 items** (bars, by ₱ or quantity); **payment methods** (bars, not a pie). **Report tables**, each with CSV export: (1) **daily summary**, printable: gross sales, discounts, refunds, net sales, tips, received by method, cash that should be in the drawer (cash in − cash change − cash refunds), unpaid made and collected, change owed outstanding; (2) by item and variant, with cost, profit and margin; (3) by category; (4) by staff (credited to **who took payment**); (5) by hour; (6) outstanding: every unpaid order and every change owed, and how long. **Counting**: a sale on the day it is **paid** (D13), a refund on the day it is **made** (D17), discounts and tips apart, voided and cancelled orders never. **The store's day** is the **workspace's time zone** (default `Asia/Manila`), so an 11:30 PM sale lands on the right day. It was a field of `PosSettings` until 2026-09-29, when the workspace got one zone for every app (PLAN §13). The sums are pure functions in `src/domain/reports.ts`, with tests; the server reads the rows for the period and the domain adds them up. A workspace user still sees today's orders list. The busy-times heatmap (weekday × hour), goals and forecasts are later (§7) |
| D23 | Navigation | **Sections inside the POS panel, never a page change.** A sub-app lives on the Apps page and must not navigate away (it would close the apps beside it), so, as `QueueApp` opens its settings in place, `PosApp` holds the current section in its own state. A **section bar** at the top: **Sell** (first; "the till" in these notes and the code) · **Orders** (tabs Today, Pending, Unpaid, Change owed, Cancelled, All; a badge counts pending + unpaid + change owed; under the list, a **quick total** of the orders showing, the tab narrowed by the search: how many and what they come to, with cancelled and voided orders left out and counted apart, refunds shown beside it, never taken off, and a note when the list was cut at 500. A glance, not a report: Reports is where a day is added up. Added 2026-10-02) · **Items** (tabs Items, Categories) · **Customers** (a customer opens as a **profile**: initials, what they owe, buttons that message them on Facebook, call or e-mail, three numbers — orders, spent, owes — then their orders; *Edit* opens the form, and a new customer opens on it. Redrawn 2026-10-02 from a bare form) · **Reports** (tabs Dashboard, Daily summary, By item, By category, By staff, By hour, Outstanding) · **Settings** (tabs Store, Hot keys). A section appears only if the person holds its key (`useHoldsFeature`): a workspace user sees Sell, Orders and Customers. **List, then detail**: a tab opens on its list alone, and a row opens its detail in a **drawer** from the right, inside the POS panel; it closes by its Close button, a press outside it or `Esc`, and *Previous* / *Next* walk the list as shown (changed 2026-10-03; before, the detail sat beside the list in a wide panel and replaced it in a narrow one). **Actions live on the thing**: an open order → *Resume* (to Sell, loaded); unpaid → *Take payment*; paid → *Refund*, *Change given*, *Reprint*; a customer → their orders; a report's day → that day's summary. **Leaving Sell loses nothing** (the order is saved as built, D8). In a **narrow panel** (container query) the bar folds into a menu. `Esc` at a section's top level returns to Sell; the keys that jump to a section are picked in phase 7 with the browser check (D18), and are rebindable |

## 3. The rules we keep from day one

They cost nothing now and are expensive to add later:

- **Money is whole centavos** (`Int`), never a float: ₱12.50 is `1250`. One pure
  `computeOrderTotals` in `src/domain/` adds up an order (lines, line
  discounts, order discount, total), with tests. The
  screen and the server call the same function, and the server's answer wins.
- **Open orders are saved as they are built**, so holding one loses nothing,
  and a refresh or a closed tab does not either. Open orders do not expire;
  one left over from yesterday stays in the pending list until someone pays or
  cancels it.
- **A paid or unpaid order is never edited.** An open order can be changed or
  cancelled; once paid, or released unpaid, its lines and total are final. An
  unpaid order only moves to paid, or to voided (D17). A refund is its own
  record, and all refunds of an order never add up to more than was paid.
- **A line keeps what it was sold as**: the item's name, kind, variant name,
  code, **category name**, unit price and unit cost are copied onto the line, so changing a price never changes an old receipt.
  The copy is taken **when the line is added**, so a held (open) order keeps
  the price the customer was told; if the item's price has changed since, the
  line shows "Price is now ₱50 · Update" and the cashier may update it. An
  unpaid or paid order never changes. Renaming, re-costing or archiving an
  item leaves old orders, receipts, reports and refunds as they were.
- **Order numbers count up per workspace** (1, 2, 3 …), taken in the
  transaction that finalises the order (paid, or unpaid).
- **Money received adds up**: received = total + change given + change owed +
  tip, checked by the server. A tip or owed change never changes the order
  total, and settling owed change (given, or turned into a tip) keeps the sum.
- **Paying twice is harmless**: the client sends an id with the payment, so a
  double click or a retry does not record a second payment.

### Guard rules (from the loophole check, 2026-09-29)

Simple rules, not features: each closes a way the numbers could go wrong.

- **Editing a discounted order drops fixed discounts.** If someone without
  `pos:discount` changes a line's quantity, or adds or removes lines, the
  fixed-₱ discounts it affects are removed (a ₱100 discount must not end up
  covering 7 magnets instead of 100). %-discounts stay; they scale.
- **Every discount records who gave it and when.**
- **Cancelling an order that has lines needs a reason.** The cancelled order
  keeps its lines, who cancelled it and when; the daily summary shows
  "Cancelled: 3 orders, ₱1,240", and Orders has a *Cancelled* tab.
- **Pay later records who released the order**, shown on the Unpaid tab and in
  the Outstanding report.
- **Two people on one order**: every order has a `version`; an edit or payment
  made on an old version is refused ("changed by someone else, reloaded"), and
  payment only succeeds while the order is still `open`.
- **Reprints say "REPRINT"** and the date.
- **Cost stays on the server.** Cost, profit and margin (on items, variants
  and order lines) are left out of every API answer unless the person holds
  `pos:manage_items` or `pos:reports`; a test proves a workspace user never
  receives them. Hiding them on screen is not enough.
- **Input limits**: quantity is a whole number ≥ 1; prices ≥ ₱0; notes,
  labels and names have length caps.
- **Payment checks**: cash received ≥ total; e-wallet and card received =
  total + tip, never with change; change owed is cash only; an order
  discounted to ₱0 completes with ₱0.
- **Codes** are unique per store, checked across items and variants when
  saved. Two admins saving the same code at the same instant is accepted as
  a rare race, not engineered away.

## 4. Keys (all workspace level)

| Key | Grants |
|---|---|
| `pos:read` | open the app (exists today); see items and orders |
| `pos:sell` | create orders, add lines and notes, set the customer (and create or edit a recorded customer), take payment (and record a tip), release an order unpaid and later take its payment, record change owed and later settle it, cancel an open order |
| `pos:discount` | give a discount (₱ or %) on a line or the whole order |
| `pos:refund` | refund a paid order (by line or by amount); void an unpaid order whose items came back |
| `pos:manage_items` | add, edit and archive items, their variants, and categories; **see costs** |
| `pos:reports` | the dashboard and the reports, with profit and CSV export (D22) |
| `pos:manage_settings` | store settings: the hot keys and item keys (D18) |

Presets, read by `seed/app-roles.ts`: `pos-cashier` (read, sell) and
`pos-manager` (read, sell, discount, refund, manage_items, reports, manage_settings). The manager holds every cashier
key, so a store with no cashier runs the till with the manager role alone.

**Who gets them (operator, 2026-09-29):** the stores using this have no
cashiers yet, so the POS keys fold into the two workspace roles that exist,
with no new roles (a member holds one workspace role, PLAN §12.85):

| Workspace role | Gets | Can |
|---|---|---|
| Workspace admin | `pos-manager`'s keys | sell, give discounts, refund, manage items, see reports, and change settings |
| Workspace user | `pos-cashier`'s keys | sell |

A store that later needs members who may **not** sell gets a combined role
then (`.claude/rules/database.md`, "Combined workspace roles").

Limit: `pos:items`, counting **active items plus active variants** in the
workspace (so 300 variants on one item do not dodge it, and archiving frees
room). Which plans sell `pos:*` is
settled in phase 5 (§6), following the queue's (PLAN §12.61).

## 5. Schema (`prisma/pos.prisma`)

Every row carries `organizationId` and `workspaceId`. `userId`s are bare
strings with no foreign key.

- `PosCategory` — name, sort order.
- `PosItem` — name, kind (`product` / `service`), price (centavos), code
  (optional), description (optional, one line of up to 500 characters, shown
  on the till's tile and never printed; a save that omits it leaves it as it
  is), cost (centavos, optional), category (optional), `archivedAt`.
  With variants, the item's own price is unused and the till asks for a
  variant.
- `PosItemVariant` — item, name, price (centavos), code (optional), cost
  (centavos, optional), sort order, `archivedAt`. A code is unique per
  workspace across items **and** variants: two tables, so the service checks
  it in the write's transaction, with `@@unique([workspaceId, code])` on each.
  Archived, never deleted: old lines point at it.
- `PosCustomer` — name, phone, e-mail, Facebook link and note (all optional), `archivedAt`.
  Archived, never deleted: old orders point at it.
- `PosOrder`
  - `version` (guard rules);
  - status (`open` / `unpaid` / `paid` / `cancelled` / `voided`), label (optional),
    number (set when finalised, `@@unique([workspaceId, number])`);
  - customer id (optional, a recorded customer) and a **copy** of the customer
    name and contact (optional; for a walk-in, the free text);
  - subtotal, discount (as on a line, with who and when; optional), total;
  - payment: method (`cash` / `ewallet` / `card`), amount tendered, change,
    tip, reference, client id (`@@unique`);
  - change owed, and when and by whom it was settled (given or tipped);
  - created by, finalised at and by, paid by, paid at; cancelled or voided
    by, at, and why.
- `PosOrderLine` — order, item id, variant id (optional), **copy** of name,
  kind, variant name, code, category name, unit price and unit cost; quantity; note
  (optional); discount (kind `amount` / `percent`, value, the amount it came
  to, reason, given by and at; optional); line total.
- `PosRefund` — order, amount (centavos), method (how it went back), reason,
  refunded by, refunded at, client id (`@@unique`, so a double click does not
  refund twice).
- `PosRefundLine` — refund, order line, quantity, amount. None for a refund
  by amount.
- `PosCounter` — per workspace, the next order number.
- `PosSettings` — one per workspace (`@@unique([workspaceId])`): the time
  zone (IANA name, default `Asia/Manila`, D22), and the keymap
  (JSON, `{ key → action or item/variant id }`, checked by `validateKeymap` on
  write; missing means the defaults). Later store options go here too.

One payment per order in v1. Split payments (part cash, part GCash) would move
payment into its own table; that is a later change (§7).

## 6. Phases (one commit each)

1. `feat(module-basic-pos)`: keys, limit, presets; in `src/domain/`, with
   tests: `computeOrderTotals` (lines, discounts, tip, change owed),
   `refundAmounts`, `searchItems`, the default keymap and `validateKeymap`,
   the report sums (`reports.ts`), and the order rules (which status may move
   to which).
2. `feat(module-basic-pos)`: the Prisma fragment; `db:migrate`.
3. `feat(module-basic-pos)`: the server half for the catalogue and settings:
   items, variants, categories, customers, `PosSettings`; service tests
   against a fake client.
4. `feat(module-basic-pos)`: the server half for selling: orders, hold,
   payment, unpaid, change owed, refunds and voids, reports; service tests.
5. `feat(web-server)`: providers, seed grants and plans; `db:sync`; boot.
6. `feat(module-basic-pos)`: the section bar (D23) and the till: search and item grid, variant picker,
   cart, line notes, discounts, customer (walk-in, search, save as customer),
   hold and resume, payment, receipt.
7. `feat(module-basic-pos)`: the keyboard: hot keys, item keys, focus rules,
   the shortcut bar and the `?` list, and the keyboard-only sale test (D18–D21).
8. `feat(module-basic-pos)`: management: items and variants, customers and
   their orders, the orders list, refunds, and settings (store, hot keys; the
   time zone is the workspace's since 2026-09-29, PLAN §13).
9. `feat(module-basic-pos)`: the dashboard and the report tables, CSV export
   (D22).
10. `docs`: the module README, PLAN §13, and this file's "Built, and where it
    differs".

The app can be tried in the browser after phase 6.

## 7. Later, one at a time

Not planned yet; each gets its own short plan when it is wanted.

**Capital, reinvestment, expenses, investors and their payouts** are not POS:
they are a separate bookkeeping app, drafted in `docs/BOOKKEEPING-PLAN.md`,
which reads POS's sales and profit (the unit cost each line keeps, D15)
through a port.

Add-ons (groups per item, pick rules, priced or free, attached to their line;
D10); automatic promotions and coupon codes; tax (VAT breakdown, senior/PWD); a supervisor approving a cashier's refund or discount; refunds returning stock; partial and split payments (D13); loyalty, credit limits and merging duplicate customers; stock
(counts, receiving, suppliers); shifts and cash counts; the busy-times heatmap, goals and forecasts; barcodes;
open-price items (a custom job typed with its own price); printer and cash drawer; per-person keymaps; typo-tolerant search; offline selling; payment gateway; BIR.
