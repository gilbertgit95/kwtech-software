# @kwtech/module-platform-billing

**Billing for the whole application** (issue #88): an organization requests a
plan, pays outside the app (cash, e-wallet, bank transfer), and platform staff
approve it. Plan changes are prorated with credit, a lapsed subscription gets
grace and then expires, and every month leaves a bill and a receipt. The design
and its decisions (D1 to D17) are in
[`docs/PLATFORM-BILLING-PLAN.md`](../../docs/PLATFORM-BILLING-PLAN.md).

**Not a sub-app.** Its keys are organization and app level, never workspace;
it is never on a workspace's Apps page.

**Status: phase 4b-1 (#110, part of #93).** The pure core (#91), the schema,
the services and the GraphQL API for requests, payment details, approvals and
rejections, voids, closing as credit, cancelling, the settings and the
prices; composed into the API. Still to come: plan archives, the audited
admin adjustments and the trial (4b-2), the daily check (#95), and the pages
(#96, #97).

## In a Next.js app

Nothing yet: the pages come in phases 6 (#96) and 7 (#97).

## In a NestJS app

```ts
platformBillingServerModule({
  prismaProvider,            // PLATFORM_BILLING_PRISMA: the read client
  prismaWriteProvider,       // PLATFORM_BILLING_PRISMA_WRITE: with $transaction
  subscriptionsProvider,     // ⚠ REQUIRED: PLATFORM_BILLING_SUBSCRIPTIONS
  plansProvider,             // ⚠ REQUIRED: PLATFORM_BILLING_PLANS
  peopleProvider,            // PLATFORM_BILLING_PEOPLE
  resolveActorId,            // principal → userId
});
```

| Port | What it answers | Unbound |
|---|---|---|
| `PLATFORM_BILLING_SUBSCRIPTIONS` | the organization's live subscription, and `module-permissions`' billed writes (`renew`, `changePlan`, `start`, `end`, `setAccessUntil`) **inside billing's transaction** | the module refuses to boot |
| `PLATFORM_BILLING_PLANS` | every plan (listing, archived, features, caps) and an organization's usage of the caps (D6) | the module refuses to boot |
| `PLATFORM_BILLING_PEOPLE` | whether an approver is a member of the organization (D15) | every approver is flagged as a member: the flag never blocks |

⚠ **The shared transaction.** An approval writes the decision, the
subscription, the bill's stamp, the receipt, its number and every credit
entry in ONE transaction. The app binds the write client with
`withTransaction`, whose callback receives Prisma's interactive transaction
client with every delegate on it, and its subscriptions adapter hands that
same transaction to `PermissionsWriteService` (`apps/web-server/src/platform-billing/subscriptions.ts`,
`sharedTransaction`, which refuses a transaction that could not be shared).

⚠ **Its organization keys skip the plan filter (D13).** Pass
`PLATFORM_BILLING_ORGANIZATION_KEYS` to permissions' `planExemptFeatures`, or
an expired organization cannot reach the page that renews it.

### The GraphQL surface

Organization scope (`PlatformBillingResolver`, declared on the class):

| Operation | Key |
|---|---|
| `platformBillingOverview`, `platformBillingPreview`, `platformBillingHistory`, `platformBillingRequest` | `read` |
| `requestPlatformBillingPlan` (subscribe, change plan, replace), `cancelPlatformBilling` | `change_plan` (the owner's, D8) |
| `renewPlatformBilling` | `renew` |
| `enterPlatformBillingPayment`, `withdrawPlatformBillingRequest` | `enter_payment` |

App level (`PlatformBillingAdminResolver`, no scope):

| Operation | Key |
|---|---|
| `platformBillingQueue`, `platformBillingReview`, `platformBillingSettings`, `platformBillingPrices` | `queue_read` |
| `approvePlatformBillingRequest`, `rejectPlatformBillingRequest`, `closePlatformBillingRequestAsCredit` | `approve` |
| `voidPlatformBillingRequest` | `void` |
| `setPlatformBillingSettings`, `setPlatformBillingPrice` | `manage_settings` |

Every document is in `src/operations.ts`. A refusal is a
`PlatformBillingWriteError` whose message is the reason's sentence and next
step; counts (short by, caps over) are in its `detail`. `platformBillingPreview`
returns the same refusal as a value, so a page explains a button before anyone
presses it.

### What the services do

- **Submit** checks the request as the preview does (`checkNewRequest`),
  prices it (`priceRequest`), and issues its bill, numbered in the same
  transaction. A downgrade's bill waits for approval (D12). **One pending
  request per organization**: `pendingOrganizationId` is unique.
- **Payment details** are a new version each time (`platform_billing_payment`,
  never edited), bumping `detailsVersion`. The first covering details of a
  renewal entered before grace ends **hold** access (D9); a renewal whose
  covering details arrive only after access ended is **not on time**: its bill
  is cancelled and a new one issued with the access used (D10).
- **Approval** is a compare-and-set while `pending` on the details version the
  approver saw, BEFORE anything is written: of two approvals at once, one
  applies and the other is refused `not_pending`. Short payments are refused;
  overpayments become credit (D7); an upgrade approved later than priced gets
  the lag back as credit; a change priced for a period that has ended is
  `quote_expired`. A self-approval and an approver who is a member are
  recorded, never blocked.
- **Withdraw and reject** cancel the bill (it keeps its number) and give back
  any hold.
- **Close as credit** (D12a) keeps a pending request's payment, whatever its
  amount: a receipt for exactly that ("Payment received, held as credit"),
  the credit added once, the bill CANCELLED (never paid on less than its
  total), the plan unchanged, any hold given back. The owner can then request
  again. Nothing received is `nothing_received`.
- **A void** reverses a mistaken approval, with a reason. The approval stored
  how it wrote the subscription (`applied`) and the live row just before
  (`subscriptionBefore`), and the void puts exactly that back (`planVoid`):
  a renewal's row on its old period, the old plan after a change, the started
  row ended (the organization falls back to Free), a cancel's access end
  restored. The receipt is stamped VOID, the bill goes back to unpaid and each
  of the receipt's credit entries gets a `void_reversal` (the balance may go
  negative). ⚠ **Newest first across the organization**
  (`void_not_latest`), and never over a subscription changed since
  (`subscription_changed`): the live row must be the approval's own (or the
  row a void of the next approval restored in its place,
  `restoredSubscriptionId`) and still carry the plan, period end and access
  end the approval wrote. That also refuses approvals made before #110,
  since they recorded nothing to reverse.
- **Cancel** applies at once, decided by the owner (`cancel_needs_no_approval`):
  no bill, no credit, access to the period's end without grace. Renewing
  opens at once after a cancel and undoes it.
- **One decision at a time per organization**: every write takes the
  organization's row in `platform_billing_lock` first, so a void and a cancel
  (or two approvals of different requests) never read the subscription at
  the same moment. Proved on Postgres: the second transaction waits for the
  first to commit.
- **Numbering has no gaps**: `platform_billing_counter`, one row per sequence,
  incremented in the issuing transaction. A rollback gives the number back.
- **Settings** (D16): the currency and the time zone are locked once any bill
  exists; grace may change (0 to 31), and reaches only periods written after.

## Tables

`platform_billing_request`, `_payment` (every version of the details),
`_bill` and `_receipt` (snapshots, never rewritten; only the stamp changes),
`_credit` (the ledger; the balance is its sum and may go negative), `_price`
(per plan, from a day on), `_settings` (one row, `id = 'platform'`),
`_counter`, `_event` (the timeline, each step with its reason code). Keyed by
`organizationId`; no foreign key leaves the module. Nothing is deleted.

## Vocabulary

- **Request:** what an organization asks for, one of `subscribe`, `renew`,
  `change_plan`, `replace` (the current plan was archived) or `cancel`. Every
  month of a subscription is a request we approve.
- **Period:** one calendar month from a start day (included) to an end day
  (excluded, the due date), keeping a **billing day** that a short month clamps
  and the next month restores (the 31st → the 28th → the 31st).
- **Grace:** the days after the due date with full access (7 by default).
- **Hold:** further days for a renewal whose covering payment details came in
  before grace ended, waiting for us. Once per period, none after a rejection.
- **`accessUntil`:** period end + grace + hold. The first day without access.
- **Credit:** value an organization is owed (a downgrade, an overpayment, an
  archived plan's lost days), spent on its next bills. Never paid out as cash.
  A negative balance is money owed, added to the next bill.
- **Money** is whole centavos, never a float; each prorated line is rounded
  once, half up.
- **Days** are platform days (`DayKey`, `YYYY-MM-DD`) in the one platform time
  zone, never a workspace's.

## The domain entry point

`@kwtech/module-platform-billing` imports only `@kwtech/module-kit`:

| File | What it decides |
|---|---|
| `domain/days.ts` | day keys, calendar arithmetic, an instant as a platform day (`platformDay`, `platformDayStart`) |
| `domain/periods.ts` | `periodFrom`, `nextPeriod`, `daysInPeriod`, `daysLeft` (the day of a change is the new plan's) |
| `domain/money.ts` | `prorate`: `amount × part ÷ whole` in integers, rounded once, half up |
| `domain/quotes.ts` | the bill's lines: `quoteMonth`, `quoteRenewal` (with the access used after a late renewal, D10), `quotePlanChange` (with a month paid ahead, D11), `approvalLagCredit` (D12), `archiveCredit` |
| `domain/access.ts` | `accessWindow`, `standingOn` (active, renewal open, overdue, held, expired), `planHold` (D9), `planRenewal` (continue, or restart on time or late), `isOnTime` |
| `domain/payments.ts` | payment methods, `normaliseReference`, `findReferenceReuse`, `checkAmount` (short, exact, over: D7) |
| `domain/requests.ts` | the state machine (`allowedActions`, `nextState`), `checkNewRequest` (owner only D8, renew first, over caps D6, archived and withdrawn plans), `checkApproval`, `checkVoid` (newest first) |
| `domain/plans.ts` | `planCovers`, `pickCoveringPlan` (the fold, D3), `capsBlockingDowngrade` |
| `domain/refusals.ts` | `PlatformBillingRefusal` and `PLATFORM_BILLING_REFUSALS`: a sentence and a next step for every reason |
| `domain/standing.ts` | `billingStanding` (the row's period, the current one, a month paid ahead, the access window), `requestStanding`, `priceOn` |
| `domain/pricing.ts` | `priceRequest`: one request priced on a day, for the preview, the bill at submission and a downgrade's bill at approval |
| `domain/documents.ts` | `BillSnapshot`, `ReceiptSnapshot`: what a document said when issued |
| `domain/voids.ts` | `planVoid`: what reversing an approval writes to the subscription, from what it recorded (D9a) |

Every refusal is a reason code with words (`refusalText(reason)`), shared by the
server, the pages and the tests. Counts and dates (short by 100, remove 2
members) travel beside the code, never inside the sentence.

## What it declares

- **Organization keys:** `platform-billing:read`, `:change_plan` (the owner's),
  `:renew`, `:enter_payment`. `PLATFORM_BILLING_ORGANIZATION_KEYS` lists them:
  they work without a plan (D13), so an expired organization can still renew.
- **App keys, split by risk:** `platform-billing:queue_read`, `:approve`,
  `:void`, `:manage_settings` (the last three privileged).
- **Bindings** for every operation above. `test/surface-coverage.test.ts`
  fails on an unbound operation.
- **Role presets** (`PLATFORM_BILLING_ROLE_PRESETS`), data only, read by the
  app's `seed/app-roles.ts`: `platform-billing-owner` (every organization key,
  added to `organization-owner`), `platform-billing-admin` (read, renew, enter
  payment; never choose the plan; added to `organization-admin`), and the
  app-level `platform-billing-approver` (queue, approve, void; never the
  settings), seeded as a role of its own.
- No limits, no processes yet (the daily check is phase 5b).
