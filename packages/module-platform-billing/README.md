# @kwtech/module-platform-billing

**Billing for the whole application** (issue #88): an organization requests a
plan, pays outside the app (cash, e-wallet, bank transfer), and platform staff
approve it. Plan changes are prorated with credit, a lapsed subscription gets
grace and then expires, and every month leaves a bill and a receipt. The design
and its decisions (D1 to D17) are in
[`docs/PLATFORM-BILLING-PLAN.md`](../../docs/PLATFORM-BILLING-PLAN.md).

**Not a sub-app.** Its keys are organization and app level, never workspace;
it is never on a workspace's Apps page.

**Status: phase 2 of 8 (#91), the pure core only.** No schema, no Nest module,
no pages yet, and the module is not composed into either app: nothing syncs or
grants its keys until phase 4 (#93) binds them to operations.

## In a Next.js app

Nothing yet: the pages come in phases 6 (#96) and 7 (#97).

## In a NestJS app

Nothing yet: the schema, services and resolvers come in phase 4 (#93), the
entitlement change in `module-permissions` in phase 3 (#92), and the daily
check in phase 5b (#95).

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

Every refusal is a reason code with words (`refusalText(reason)`), shared by the
server, the pages and the tests. Counts and dates (short by 100, remove 2
members) travel beside the code, never inside the sentence.

## What it declares

- **Organization keys:** `platform-billing:read`, `:change_plan` (the owner's),
  `:renew`, `:enter_payment`. `PLATFORM_BILLING_ORGANIZATION_KEYS` lists them:
  phase 3 lets them work without a plan (D13), so an expired organization can
  still renew.
- **App keys, split by risk:** `platform-billing:queue_read`, `:approve`,
  `:void`, `:manage_settings` (the last three privileged).
- **No bindings yet.** Each key binds its operations in phase 4.
- **Role presets** (`PLATFORM_BILLING_ROLE_PRESETS`), data only:
  `platform-billing-owner` (every organization key), `platform-billing-admin`
  (read, renew, enter payment; never choose the plan), and the app-level
  `platform-billing-approver` (queue, approve, void; never the settings).
- No limits, no processes yet (the daily check is phase 5b).
