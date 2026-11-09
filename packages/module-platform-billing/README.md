# @kwtech/module-platform-billing

**Billing for the whole application** (issue #88): an organization requests a
plan, pays outside the app (cash, e-wallet, bank transfer), and platform staff
approve it. Plan changes are prorated with credit, a lapsed subscription gets
grace and then expires, and every month leaves a bill and a receipt. The design
and its decisions (D1 to D17) are in
[`docs/PLATFORM-BILLING-PLAN.md`](../../docs/PLATFORM-BILLING-PLAN.md).

**Not a sub-app.** Its keys are organization and app level, never workspace;
it is never on a workspace's Apps page.

**Status: released (#98, 2026-11-08); every phase of #88 built.** The pure
core (#91); the schema, the services and the GraphQL API for requests,
payment details, approvals and rejections, voids, closing as credit,
cancelling, plan archives, the trial, the audited admin adjustments, the
settings and the prices (#93); the daily check with every notification
(#95); the organization's Billing page with printing, the statement of
account and its CSV (#117, #119); the platform's queue, request page,
reprints, settings and prices (#121), and every organization's standing and
the reports (#123). The end-to-end pass is in PLAN §13, 2026-11-08. Paying
several months at once and renewing from credit (#129). The operator's check
in the running app (#96, #97) may still bring changes.

## In a Next.js app

```ts
import { permissionsWebModuleWith } from '@kwtech/module-permissions/react';
import { platformBillingWebModule } from '@kwtech/module-platform-billing/react';
// WEB_MODULES: [permissionsWebModuleWith({ planPage: { section: 'billing', feature: 'platform-billing:read', … } }),
//               platformBillingWebModule, …]
```

**The Billing page**, `/organizations/:organizationId/billing`
(`platform-billing:read`, in the Organization group). Not a sub-app: a
drawer page, never on a workspace's Apps page. ⚠ It replaces
`module-permissions`' read-only `/organizations/:organizationId/subscription`:
the app hands permissions this page as its `planPage`, which drops that route
and points the organization overview's card here (`apps/web-app/src/modules.ts`).

- **The status** (`billingStatus`): the plan, the due date, the credit, and
  the rule behind every date (grace, a hold, a trial, a cancel, an archived
  plan, an expiry), in words.
- **One main button that follows the status** (`mainAction`): choose a plan,
  renew, replace an archived plan, or, with a request waiting, the request
  itself. Change plan and Cancel beside it, off with the reason when the
  status or the role does not allow them (`changePlanControl`,
  `cancelControl`; D8: choosing the plan is the owner's).
- **A request before it is made**: the server's price for today
  (`platformBillingPreview`), its lines and credit, or its refusal with the
  next step and the caps a downgrade would break.
- **The pending request**: its bill, where to pay (the settings' payment
  accounts), the payment details form (`checkPaymentDraft`: the server's
  rules, said before sending), and Withdraw.
- **The history**: one row per request, its bills, receipts and every step in
  words (`eventSentence`), each instant shown as its day in the billing time
  zone. Filtered on the server by year and state (or with withdrawn and
  rejected hidden), with the count and, for a year, what was received, over
  every page (`historyWhere`).
- **Printing** (`chrome: 'fullscreen'`, so the browser prints the document
  alone): `/organizations/:organizationId/billing/documents/:requestId?kind=bill|receipt&number=…`
  prints a bill or a receipt from its own snapshot (issuer, lines, period,
  the receipt's title and "not an official receipt" notice), with today's
  stamp (`documentStamp`: UNPAID, PAYMENT SUBMITTED PENDING VERIFICATION,
  PAID with its receipt, CANCELLED, VOID).
- **The statement of account**, `/organizations/:organizationId/billing/statement?from=&to=`
  (at most two years): every bill, receipt and credit entry, the credit
  balance running beside them, opening and closing credit, what was billed
  and received (`buildStatement`); printable, and downloadable as CSV
  (`statementCsv`). No "amount owed" column: an overpayment is a receipt and
  a credit entry, and netting them would count it twice.
- **An expired organization's denials link here**: the app passes the Billing
  page as `FeatureDenied`'s `nextStep` for `subscription_expired`.
- **Compare plans**, `/organizations/:organizationId/billing/plans` (#101,
  `platform-billing:read`, linked from the Billing page): every public,
  unarchived plan and the organization's own, cheapest first at today's price,
  each plan cap ("How many", a missing number read as the declared default)
  and each feature some listed plan includes (`platformBillingPlanComparison`,
  `buildPlanComparison`). Built from the plan rows the app enforces, so the page
  cannot promise what the app refuses. Choosing stays on the Billing page.
- **A feature the plan lacks says which plan has it**: the app's denial for
  `not_entitled` carries `notEntitledText` ("Point of sale is in Basic and Pro.
  You are on Free.") and a link here, for those who can open billing.

**The platform's pages** (phase 7a, #121), app level, in the Administration
group. All are read with `queue_read`; inside them the decisions hide without
`approve` or `void`, and the settings changes without `manage_settings`
(`useHoldsFeature`; the API refuses again).

- **The billing queue**, `/admin/billing`: Waiting (ready to check first,
  then the oldest, `sortQueue`) and Decided (newest first,
  `platformBillingDecided`), each card with the organization's name, the bill
  and how many checks flag.
- **One request**, `/admin/billing/requests/:requestId`: the checks in words,
  each naming what triggered it (`queueChecks`: short or over the bill, a
  reference used elsewhere, a self-request, a member approving, a hold in
  force), the bill, every version of the organization's payment details, the
  timeline. Approve starts from the latest details (`approvalDraft`) and
  sends the details version reviewed, so details changed since are refused;
  Reject and Void need a reason, Close as credit takes the payment and an
  optional one (`checkDecisionReason`). Void shows only on an approved
  request.
- **A reprint**, `/admin/billing/requests/:requestId/document?kind=&number=`
  (`chrome: 'fullscreen'`): the organization's own printed document
  (`PrintedDocument`), read through the review query, so staff need no
  membership.
- **Billing settings**, `/admin/billing/settings`: currency and time zone
  (fixed once anything is billed, D16), grace days (`BILLING_GRACE_MAX`), the
  issuer, the accounts organizations pay into; and every plan with today's
  price, its price history, and a form to set a price from a day
  (`platformBillingPlanList`, `checkSettingsDraft`, `settingsChange` sends
  only what changed, `checkPriceDraft`).
- **Organizations' billing**, `/admin/billing/organizations?filter=` (phase
  7b, #123): every organization's standing, plan, the day it turns on, its
  credit or what it owes, and a waiting request to open. Filters: needs
  attention (overdue, held or expired), overdue, expired, credit or owed,
  request waiting (`matchesStanding`). Paged by organization: a filtered
  page reads at most `STANDINGS_SCAN_MAX` organizations and may come back
  short, and Show more goes on from the last one read.
- **Billing reports**, `/admin/billing/reports?from=&to=` (at most two
  years): money collected by month and by day, a column per method, and per
  plan, payments kept as credit apart (`buildCollectionsReport`,
  `collectedTable`); printable and as CSV (`collectionsCsv`). Money counts on
  the day its receipt was issued in the billing time zone, so a closed month
  never changes; a voided receipt never counts. With it, today's standings
  counted: how many overdue and expired, requests waiting, credit held and
  owed kept apart (`summariseStandings`), over at most
  `STANDINGS_SUMMARY_MAX` organizations, and says so past that (PLAN §12.134).

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
| `PLATFORM_BILLING_SUBSCRIPTIONS` | the organization's live subscription (and every live row on a plan, for an archive), and `module-permissions`' billed writes (`renew`, `changePlan`, `start`, `end`, `setAccessUntil`) **inside billing's transaction** | the module refuses to boot |
| `PLATFORM_BILLING_PLANS` | every plan (listing, archived, features, caps), an organization's usage of the caps (D6), and, optionally, what each feature and cap is called (`labels()`, the plan comparison, #101) | the module refuses to boot; without `labels()` the comparison lists plans and prices with no rows |
| `PLATFORM_BILLING_PEOPLE` | whether an approver is a member of the organization (D15), the organization's name for documents, and a page of every organization by id (the platform's standings and reports) | every approver is flagged as a member: the flag never blocks; documents print the id; the standings and the counts say they are unavailable |
| `PLATFORM_BILLING_NOTIFIER` | the reminders, the approvers' digest and each request's steps, as notifications; each answers whether it was delivered | nobody is told, and the daily check writes nothing, so binding it later still delivers that day's reminders |

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
| `platformBillingOverview`, `platformBillingPreview`, `platformBillingHistory`, `platformBillingRequest`, `platformBillingStatement`, `platformBillingPlanComparison` | `read` |
| `requestPlatformBillingPlan` (subscribe, change plan, replace; `months` for the first and last), `cancelPlatformBilling`, `setPlatformBillingAutoRenew` | `change_plan` (the owner's, D8) |
| `renewPlatformBilling` (`months`) | `renew` |
| `enterPlatformBillingPayment`, `withdrawPlatformBillingRequest` | `enter_payment` |

App level (`PlatformBillingAdminResolver`, no scope):

| Operation | Key |
|---|---|
| `platformBillingQueue`, `platformBillingDecided`, `platformBillingReview`, `platformBillingSettings`, `platformBillingPrices`, `platformBillingPlanList`, `platformBillingOrganizations`, `platformBillingReport` | `queue_read` |
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
- **Paying several months at once** (#129): a subscribe, a replacement or a
  renewal takes `months` (1 to 12, `isMonths`; a plan change runs to the end
  of its period, so it is refused with more). The bill is the month as
  usual plus a `paid_ahead` line for the rest, after the credit lines, so a
  balance already held pays this month and is never spent on months being
  bought. Approval applies one period, as always, and adds the `paid_ahead`
  amount to the credit ledger, pointing at its receipt; later renewals spend
  it. A void of that approval reverses it with the rest of the receipt's
  entries.
- **Renewing from credit** (#129, `autoRenew`, run by the daily check): with
  the owner's switch on (`platform_billing_auto_renew`, `setAutoRenew`, the
  `change_plan` key), on the due date or a grace day after it, when the
  credit balance pays the whole renewal (`planAutoRenew`), a renewal is
  made, billed and approved in ONE transaction under the organization's
  lock, through the same `approveLocked` an approver's approval runs: the
  period continues, the bill (total 0) is paid, a receipt of kind
  `paid_from_credit` (method `credit`, amount 0) is issued, the credit used
  is a ledger entry. `automatic` is set, `requestedById`/`decidedById` are
  `PLATFORM_BILLING_SYSTEM_ACTOR`, and it is neither a self-approval nor a
  member's. Credit short, a request waiting, an archived plan, no price, or
  access already ended: nothing is written and the reason is returned
  (`AutoRenewSkip`). A cancel stops it silently. It is voided like any
  renewal. The collections report counts no cash for it: the money was
  counted when it came in.
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
- **A plan archive** (D12b) reaches billing through `module-permissions`'
  `PERMISSIONS_PLAN_ARCHIVE_HOOK`, inside the archive's own transaction
  (`planArchiveChanged`). First, every pending request naming the plan (for
  it, or a change away from it) is withdrawn by the system (`plan_archived`),
  except that ⚠ **one with payment details refuses the archive**
  (`archive_pending_payments`) until an approver rejects it or closes it as
  credit: only an approver confirms money arrived. Then every organization
  on the plan is credited, once per subscription row, for its paid days from
  the archive day to the period end and any month paid ahead
  (`planArchiveCredit`), with the sentence on the ledger line. Bringing the
  plan back reverses that credit for the rows still on it.
- **An adjustment** (D5): a subscription written by hand on
  `/admin/subscriptions` reaches billing through `module-permissions`'
  `PERMISSIONS_SUBSCRIPTION_AUDIT`, inside the write's transaction
  (`recordAdjustment`), and is recorded as an approved request of kind
  `adjustment`: decided by the admin, the required reason as its decision,
  no bill, receipt or credit, and an `adjusted` step ("adjusted by X, no
  payment") carrying the row before and after. It never takes the pending
  slot, is never voided (`adjustment_not_voidable`), and is not "the later
  approval" a void waits on: an approval with any adjustment after it, even
  one that left the dates as they were, is refused as `subscription_changed`.
- **A trial** (D2, `perm_subscription.trialUserId`) reads as unpaid: there is
  nothing to renew, change, cancel or credit, and the owner subscribes, which
  ends the trial row.
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

## Realtime

None. Billing changes slowly and every decision is seen on the next read;
people hear about it through `PLATFORM_BILLING_NOTIFIER` (the bell), not a
live subscription.

## Vocabulary

- **Request:** what an organization asks for, one of `subscribe`, `renew`,
  `change_plan`, `replace` (the current plan was archived) or `cancel`; or an
  `adjustment`, recorded for a subscription an admin wrote by hand. Every
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
| `domain/quotes.ts` | the bill's lines: `quoteMonth`, `quoteRenewal` (with the access used after a late renewal, D10), `quotePlanChange` (with a month paid ahead, D11), `approvalLagCredit` (D12), `archiveCredit`; `withPaidAhead`, `paidAheadOf`, `isMonths` (#129) |
| `domain/auto-renew.ts` | `planAutoRenew`: whether the daily check renews from credit today, or why not; `paidUpTo`: the credit as a date; `paidUpToMoved`: a price rise that shortens it (#129) |
| `domain/access.ts` | `accessWindow`, `standingOn` (active, renewal open, overdue, held, expired), `planHold` (D9), `planRenewal` (continue, or restart on time or late), `isOnTime` |
| `domain/payments.ts` | payment methods, `normaliseReference`, `findReferenceReuse`, `checkAmount` (short, exact, over: D7) |
| `domain/requests.ts` | the state machine (`allowedActions`, `nextState`), `checkNewRequest` (owner only D8, renew first, over caps D6, archived and withdrawn plans), `checkApproval`, `checkVoid` (newest first) |
| `domain/plans.ts` | `planCovers`, `pickCoveringPlan` (the fold, D3), `capsBlockingDowngrade` |
| `domain/refusals.ts` | `PlatformBillingRefusal` and `PLATFORM_BILLING_REFUSALS`: a sentence and a next step for every reason |
| `domain/standing.ts` | `billingStanding` (the row's period, the current one, a month paid ahead, the access window), `requestStanding`, `priceOn` |
| `domain/pricing.ts` | `priceRequest`: one request priced on a day, for the preview, the bill at submission and a downgrade's bill at approval |
| `domain/documents.ts` | `BillSnapshot`, `ReceiptSnapshot`: what a document said when issued |
| `domain/archives.ts` | `planArchiveCredit`: the paid days an archive takes away, and the ledger's sentence (D12b) |
| `domain/comparison.ts` | `buildPlanComparison`, `notEntitledText`: the plans side by side, and which plans include a feature (#101) |
| `domain/voids.ts` | `planVoid`: what reversing an approval writes to the subscription, from what it recorded (D9a) |
| `domain/notices.ts` | `planReminders`: which reminders a day owes an organization, and the approvers' digest (the daily check) |
| `domain/statement.ts` | `buildStatement`: the statement of account for a date range, its running credit (`statementCsv` is the page's, in `react/view`) |
| `domain/reports.ts` | `buildCollectionsReport`, `summariseStandings`, `matchesStanding`: the platform's reports and standings (`collectionsCsv` is the page's, in `react/view`) |

Every refusal is a reason code with words (`refusalText(reason)`), shared by the
server, the pages and the tests. Counts and dates (short by 100, remove 2
members) travel beside the code, never inside the sentence.

## Tables

`platform_billing_request`, `_payment` (every version of the details),
`_bill` and `_receipt` (snapshots, never rewritten; only the stamp changes),
`_credit` (the ledger; the balance is its sum and may go negative), `_price`
(per plan, from a day on), `_settings` (one row, `id = 'platform'`),
`_counter`, `_event` (the timeline, each step with its reason code),
`_notice` (the daily check's), `_auto_renew` (the owner's switch, one row per
organization, kept when turned off, #129). Keyed by
`organizationId`; no foreign key leaves the module. Nothing is deleted.

## Processes

**`platform_billing.daily_check`** ("Billing reminders"), run by `module-jobs`
with `reach: 'organizations'` and `serves: null`: it reaches every
organization, an expired one included, with no plan gate (#94).

- **Daily at 08:00 in the billing time zone** (every day of the week), at
  least an hour apart if an admin changes it. At most 300 seconds and 2000
  notices a run; past that the rest wait for the next run (a quiet
  organization costs nothing, so a capped run reaches further each time). A
  run more than 12 hours late is skipped and counted.
- **First it renews from credit** (#129), before any notice and with or
  without a notifier: every organization whose owner turned auto-renew on
  (`platform_billing_auto_renew`, a page at a time), through `autoRenew`
  (above). ⚠ On a budget of its own (`maxItems` renewals a run), so a day of
  reminders elsewhere can never use up the run and leave a due renewal
  untried until access ends. A failure is logged and the sweep goes on.
  Then, when the plan was due and did not renew, the owner hears why once a
  period (`auto_renew_skipped`, keyed by the due date), beside the usual
  notices. A price rise that moves the credit's paid-up-to date earlier is
  said once (`paid_up_to_moved`, `paidUpToMoved`), within a week of the day
  it took effect.
- **What it says** (`planReminders`): 7, 3 and 1 days before the due date and
  on it; each overdue day with the days of access left; the last day; the
  day access ended. Daily while a request waits with no payment details. A
  request whose details cover the bill silences the "please pay" notices; a
  cancelled organization hears none of them; a trial is not a paid plan and
  hears nothing. With auto-renew on and the credit paying the next renewal,
  the countdown is one notice a week before that it renews by itself
  (`auto_renew_upcoming`), never "renew it". Once a day, billing approvers hear how many requests have
  waited more than a day (a count, never names).
- **⚠ Once, by a row of its own** (`platform_billing_notice`, unique per
  organization, kind, period and day): written BEFORE the send, `sentAt` set
  after it, both on the run's own clock. Each run first retries rows never
  sent from the last day and a half; older ones would say something stale
  ("5 days left") and are left unsent, counted in the log. Keyed by the
  notice's own day, so a second run that day creates nothing and a missed
  milestone is caught up once. One organization's failure is logged and the
  run goes on to the next.
- **⚠ It never decides access.** Access ends by itself at `accessUntil`
  (D14). It does not mark expired subscriptions `canceled` either: the live
  row is what explains "your plan ended on <date>", what charges a late
  renewal for the access used (D10), and what keeps it a renewal.
- **Paused:** nobody is reminded and nobody hears about waiting requests;
  access still ends on time. Request notices (approved, rejected, …) are not
  the process: they are sent after each decision commits.

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
- No limits. One process, `platform_billing.daily_check` (above).
