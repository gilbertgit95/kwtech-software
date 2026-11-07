# `module-platform-billing` — plan

Status: **planned, nothing built (2026-11-07).** Phase 1 (this document and
its decisions, issue #90) is the only phase done. The work is tracked by
issue #88 and its sub-issues #89 to #98; the plans it bills for were settled
in #89 (PLAN §13, 2026-11-07). Every decision below is the operator's, or
proposed in #88 and marked as such (§9); the questions still open are in §11 and
in PLAN §12.

## 1. What it is

Billing for the **whole application**: how an organization pays us for its
plan. It is our own point of sale and bookkeeping for our own revenue, not a
shop's. An organization asks for a plan, pays outside the app (cash, e-wallet,
bank transfer), platform staff confirm the payment, and the app applies the
plan, issues a receipt, and reports what has been collected.

Today nothing about plans is commercial (PLAN §12.40):

- a lapsed subscription keeps entitling, because nothing compares
  `currentPeriodEnd` with now;
- nobody is told a subscription is about to end;
- there is no price, bill, receipt or payment;
- subscriptions attach at two levels (organization, or one workspace);
- `/admin/subscriptions` and the platform defaults write subscriptions with
  no payment at all.

**This reverses §12.40's "not to be built before the provider is"** (D1).

## 2. What the operator asked for

| # | Asked | Recorded as |
|---|---|---|
| R1 | Monthly plans an organization subscribes to, approved by us once paid | Every month is a request we approve, §4 |
| R2 | Payment outside the app; we confirm it | Owner-entered payment details, checked by an approver, §4 |
| R3 | Expiry when not renewed | Grace, then expiry enforced by the entitlement check, §5 |
| R4 | Reports of what the app has earned | Platform reports, §7 |
| R5 | Fair usage when changing plan mid-month | Prorated changes with credit, §4 |
| R6 | The UI always says why something is refused, or why something unusual is allowed | One refusal union with a sentence per value; every decision stores its reason, §6 |
| R7 | As few roles as possible | One app-level approver role; owner and admin rights at organization level, §8 |

## 3. Shape

- **Its own module, `packages/module-platform-billing`**, laid out like
  `module-queuing-window`. Prefix: `PlatformBilling*` models,
  `platform_billing_*` tables, `platform-billing:*` keys,
  `PLATFORM_BILLING_NOTIFIER` and the other ports.
- **Not a sub-app.** It is never declared in `apps` and never on a
  workspace's Apps page. Its pages are drawer pages:
  - organization level, under `/organizations/:organizationId/…` (the
    Billing page, replacing `/organizations/:organizationId/subscription`);
  - app level, under `/admin/…` (the queue, settings, every organization's
    status, the reports).
- **Rows keyed by `organizationId`**, never `workspaceId`. `organizationId` and
  `planKey` are bare values with no foreign key into `perm_*`.
- **`perm_subscription` stays the single source of entitlement** (§12.24).
  Billing writes it only through `module-permissions`' write service, which
  the app composes. Approving, writing the subscription, the receipt, its
  number and any credit happen in one transaction or not at all. Phase 4
  starts with a spike that proves the app can give both one transaction.
- **Room for a provider later.** A card or online provider would confirm a
  request's payment in place of a person, and renewals could then be
  automatic. Nothing else changes shape.
- `module-basic-pos` and `module-basic-bookkeeping` are a shop's own sales and
  are not reused.

## 4. The rules

### Every subscription month is a request we approve

1. **Request.** On the Billing page an organization asks to **subscribe**,
   **renew** or **change plan**. The request issues a bill (§7) and is pending.
2. **Approvers are notified** (holders of the approve key, app level).
3. **The owner pays outside the app** and adds the payment details: method
   (`cash`, `e_wallet`, `bank_transfer`, a fixed list in code), amount, date,
   reference (required for e-wallet and bank transfer), sender, note.
   Editable while pending, every version kept, locked after.
4. **An approver checks and approves**, with the payment form pre-filled from
   the owner's details, or **rejects** with a reason. The owner may
   **withdraw** while pending.
5. **Approval applies the plan**, issues a receipt and notifies the owner.
   Rejected or withdrawn requests change nothing, and their bill is cancelled.

Rules around it:

- **One pending request per organization.**
- **Approval is race-safe:** a conditional update while still `pending`,
  carrying the version of the payment details the approver saw ("details
  changed, review again").
- **A requester who holds the approve key approves their own request**,
  recorded as self-approved, but only on the same terms as any approval: the
  payment received is entered and covers the bill (D7). Until it does, the
  request waits like any other ("Enter the payment received to apply it").
- **The approve, void, queue and settings keys are app level**, so the
  registry refuses them in an organization role or a plan.
- **Short payments cannot be approved; overpayments become credit** (D7).
- **A mistaken approval is voided**, with a reason: the receipt keeps its
  number stamped VOID, the bill returns to unpaid, its credit is reversed
  (the balance may go negative, owed on the next bill), and the period it paid
  for is ended or shortened. A voided plan change puts the previous plan back
  for the rest of the period. **Only the latest approved request of a period
  can be voided:** with A → B → C in one period, voiding A → B would restore
  A over the paid C, so it is refused ("Void the later change to C first")
  until the later ones are voided, newest first. Nothing is deleted.
- **No cash refunds.** Unused value is credit, never money.
- **Checks the approver sees, never deciding alone:** a reference already used
  (normalised: spaces removed, case ignored), an amount different from the
  bill, missing details, a hold in force, self-approval, an approver who is a
  member of the organization (D15).

### Periods

- **Organization level only, one active subscription per organization**,
  made impossible by a partial unique index on `perm_subscription
  (organizationId) WHERE "endedAt" IS NULL AND "workspaceId" IS NULL`, after a
  data step that resolves organizations with several live rows (D3, D4).
- **Monthly, with a fixed billing day.** A period is one calendar month from
  its start; a start on the 31st ends on the last day of shorter months and
  returns to the 31st. The day never moves for a plan change, a late payment
  or an early renewal. `perm_subscription` gains `periodStart`, `billingDay`
  and `accessUntil`.
- **Subscribe:** starts at approval; that day becomes the billing day.
- **Renew before expiry** (open from 7 days before the due date, and through
  grace): moves `currentPeriodEnd` forward **on the same row**, starting at
  the current period's end, so the one-active index never sees two rows.
- **Renew after expiry:** a new period starts at approval and the billing day
  resets, **and the bill charges the access used past the period end** (grace
  and any hold) at the old plan's daily rate (D10). That line is known when
  the request is submitted, because access has already ended.
- **A renewal submitted before expiry is priced as on time, and its bill
  never changes.** If approval comes after access has ended (past the hold),
  the delay was ours: the month starts at approval instead of at the old
  period end, the billing day resets, and no access line is added. The bill
  stays as issued, so no revised bill is needed and payment is checked
  against the amount the owner saw.
- **Change plan:** the old row ends and the new one starts at approval,
  running to the end of the current period, prorated. Offered only while the
  subscription is active and not overdue ("Renew first, then you can change
  plan"). A paid-ahead month on the old plan becomes credit (D11).
  **Approval checks the quote is still for the current period.** If the
  period it was priced for has ended, the change cannot be approved
  (`quote_expired`, "This change was priced for the period ending <date>.
  Request it again"). Payment already received for it is not lost: the
  approver records it, a receipt is issued for it, and it becomes credit,
  which the owner's next request uses.
- **Cancel:** ends at the period's end, with no credit.
- **What can be requested.** Anyone may request a public plan
  (`isPublic`). A plan withdrawn from sale (`isPublic: false`, such as
  Custom or an old tier) can be renewed by organizations already on it, and
  given to others only by an approver or an adjustment. **An archived plan
  cannot be renewed**: `module-permissions` makes it entitle nothing and
  refuses new subscriptions to it, so a renewal would take payment for no
  access. Its organizations are told to change plan ("Basic (2025) is no
  longer offered; choose a plan to renew"). Stop selling a plan with
  `isPublic`; archive it only to cut it off.
- **A downgrade is refused while the organization is over the new plan's
  caps** (D6).

### Prorated plan changes

- Credit for the old plan's unused days: old price × days left ÷ days in the
  period. Charge for the new plan: new price × days left ÷ days in the period.
- **To pay = charge − credit − credit balance**, never below zero; the rest
  stays as credit.
- Basic 1,000 and Pro 1,500, 30-day period, changed on day 15: Basic → Pro
  pays **250**; Pro → Basic pays **0** and leaves **250** credit, which lowers
  the next renewal to 750.
- **An upgrade's amount is locked at submission**, because the owner pays
  that amount before approval. If approval comes on a later day, the
  difference for the days between (new price − old price, per day) is added
  as credit at approval, so the owner never pays for days on the new plan
  they did not have. **A downgrade's credit is worked out at approval**, and
  its bill is issued then (§7), since nothing is paid before (D12).
- A zero-amount change still needs approval and issues a bill and receipt for
  0. It counts as ready in the queue.
- Money is integers in centavos; each line rounded once, half up. Days are
  counted in the platform time zone; the day of the change belongs to the new
  plan.
- **A credit ledger per organization:** every entry points at its bill, the
  balance is their sum, and credit outlives an expired subscription.

### Grace, hold and expiry

- **7 days of grace** after the due date, a platform default (the defaults
  table) a super admin can change. The row stays `active`; "overdue, N days
  left" is derived, never stored as `past_due`, which would block at once.
- **The hold:** a pending renewal whose payment details were entered before
  grace ended keeps access until an approver decides, for at most a further 7
  days (the same setting). **Once per period, and never after a rejection**
  (D9).
- **`accessUntil` = period end + grace + hold**, written by billing on the
  subscription row. **The entitlement check compares only `accessUntil` with
  now**, so access never depends on the daily job (D14).
- **Expiry** sets `status: canceled` and `endedAt`; what the organization
  falls back to is open (§11, PLAN §12.131). Sub-app data is kept, never
  deleted. Role-sourced and app-level access behave as `module-permissions`
  documents.
- **The billing keys work without a plan** (D13): an expired or new
  organization can always reach its Billing page.

### The daily check

A process in `src/processes.ts`, run by `module-jobs` at **app level**
(phase 5a: today a process only reaches workspaces of entitled organizations,
JOBS-PLAN D12). It writes `canceled`/`endedAt` past `accessUntil` and
notifies:

- the organization's billing-key holders: day −7, −3, −1, the due date, daily
  while overdue, the last warning, expiry;
- **still while a pending request has no payment details** (loophole 14);
- approvers, about requests pending for more than a day.

Each notice is a row under `@@unique`, written before it is sent, with a
separate `sentAt` set only after the send succeeds. Each run first retries
rows without `sentAt`, so a failure between writing and sending never
silences a warning; a crash after sending but before `sentAt` may send one
twice, which is better than a missed expiry warning. The process works from
dates, so a missed run catches up once and a second run creates nothing
new. Every notice goes through `PLATFORM_BILLING_NOTIFIER`, bound to
`module-notification`; its app adapter resolves the user ids holding a key.

### Settings that would rewrite the past (D16)

- **Currency** is locked once any bill exists.
- **Time zone:** a change applies to new periods only.
- **Grace days:** a lower value applies to periods ending after the change,
  so no setting change expires anybody.

Each lock or effective date is shown beside the setting.

## 5. Back doors closed

- **`/admin/subscriptions` writes** stay, as **manual adjustments that require
  a reason**, shown in the organization's history as "adjusted by X, no
  payment" (D5). Nothing writes a subscription without a billing record. The
  existing `billing:manage` key and `billing` tag are reconciled with the
  `platform-billing:*` keys so there are not two "billing"s.
- **New organizations** start on Free, with one Basic trial (D2).
- **On release**, every live organization subscription is given a period end
  (30 days after release) and its owners are notified, so the new check
  expires nobody at once (phase 3).
- **Workspace-level subscriptions** are folded into a new organization row,
  then ended (D3).

## 6. Every outcome explains itself

- **One refusal union, `PlatformBillingRefusal`** (snake_case, as
  `QueueRefusal`), each value mapped to one plain sentence and a next step in
  the module's root, so server, pages and tests read the same words. A test
  fails on a value without a message.
- **Gated pages tell three cases apart:** `not_granted` (your role),
  `not_entitled` (your plan) and `subscription_expired` (your plan ended on
  <date>), each with its own next step.
- **Surprising allowances say which rule allowed them:** access past the due
  date ("Access until <date>: period ended <date> + 7 grace days + held 3
  days"), a hold, a self-approval, the Billing page of an expired organization.
- **Every decision stores its reason code and inputs** (days, amounts, dates)
  on the request's timeline, so the history explains itself later.
- **Refusals name the role they need:** "Only the organization's owner can
  change plan", "Approving payments needs the billing approver role".

## 7. Documents and views

- **Bill**, issued at submission, stamped UNPAID, PAYMENT SUBMITTED PENDING
  VERIFICATION, PAID (with its receipt number) or CANCELLED, with the line
  items of the calculation. **A downgrade's bill is issued at approval**, with
  the final credit: until then the request shows an estimate ("Credit is
  worked out on the day the change is approved. Today's estimate: 250"), and
  no number is taken, so the issued bill never disagrees with its credit and
  numbering keeps no gap.
- **Payment receipt**, issued only on approval, with the payment as the
  approver confirmed it; VOID when reversed. Titled "Acknowledgement receipt"
  and marked "This is not an official receipt" until PLAN §12.128 is settled.
- **Both are snapshots**, never changed after issue, never deleted with an
  organization.
- **Numbering without gaps:** a counter row per sequence, locked and
  incremented in the creating transaction. A Postgres `SEQUENCE` skips numbers
  on rollback.
- **Organization Billing page** (phase 6): status and countdown with one main
  button, the change-plan preview with its limits effect, the pending request,
  and the history as **one row per request** with its timeline, filters,
  totals, printing, a statement of account and CSV export.
- **Platform pages** (phase 7): the queue (ready to check first), settings,
  every organization's status and credit, and reports (cash collected by day,
  month and method, revenue per plan, credit outstanding, overdue and expired
  organizations).

## 8. Keys and roles

- **Organization level:** request, add payment details, read billing.
  Exempt from the plan filter (D13). `organization-owner` holds all;
  `organization-admin` holds renew, payment details and read, but not
  subscribe, change plan or cancel (D8). `organization-user` and every
  workspace role hold none.
- **App level, split by risk:** read the queue and reports, approve, void,
  edit settings. `PLATFORM_BILLING_ROLE_PRESETS` declares an app-level
  **billing approver** role, read by `app-roles.ts`, so approvers need not be
  super admins.
- The roles screens show why a key is held or missing, including whether it
  is one of the billing keys that work without a plan (#99).

## 9. Decisions (2026-11-07)

D3, D6, D8 and D11 are the operator's answers (2026-11-07). The rest were
proposed in #88 and its review comment; three are defaults chosen while
writing this, open to change before phase 2: D2's 14 days, D10 and D15. The
decisions #90 lists each have a PLAN §13 entry.

| # | Question | Decision |
|---|---|---|
| D1 | Build before a payment provider? | **Yes, manual payment first.** Reverses §12.40: payment outside the app is how these customers pay today, and a provider later only replaces who confirms a payment |
| D2 | New organizations | **Free, plus one trial of Basic for 14 days, once per owner account.** The trial expires like any subscription, back to Free. Repeating it with a new sign-up is a known risk (PLAN §12.130) |
| D3 | Existing workspace-level subscriptions | **Fold, then end, and no workspace loses access.** For each organization with live workspace rows, the strongest plan among them and the organization's own row is chosen (more features, then larger caps). If that is a workspace row's plan, a NEW organization-wide row is written with that plan and the latest period end, and the organization's old row, if any, is ended; otherwise the organization's row stays as it is. Every workspace row is then ended and kept as history, its target unchanged (the write service keeps a subscription's target immutable, so past entitlement still reads true). The organization's other workspaces may gain access by this; none loses any. Owners are told what changed and until when |
| D4 | Two active subscriptions | **Impossible**, by the partial unique index and a check in the write service that names the conflict |
| D5 | `/admin/subscriptions` write screens | **Kept, as audited manual adjustments that require a reason** |
| D6 | Over the caps after a downgrade | **The downgrade is refused** until the organization is within the new plan's caps ("Basic allows 3 members and you have 5. Remove 2 before downgrading"). An operator editing a live plan, and expiry, remove nothing: what is over a cap stays and only additions are refused, with the reason |
| D7 | Short and over payments | **Short cannot be approved; over becomes credit** |
| D8 | Who may change plan | **The owner only** (subscribe, change plan, cancel). Admins may renew and add payment details, so a lapse never waits on the owner |
| D9 | The hold | **Once per period, none after a rejection, at most the grace days** |
| D9a | Voiding inside a period with later changes | **Only the latest approved request of a period can be voided**; earlier ones wait until the later are voided, newest first |
| D10 | Renewing after expiry | **A new period from approval, with a bill line for the access used past the period end.** Proposed in #90 as "keep the old period end within N days", which would charge for days the organization had no access; charging the days actually used closes loophole 9 exactly |
| D11 | A paid-ahead month when the plan changes | **Becomes credit**, shown as a line in the change-plan preview |
| D12 | When a change's amount is fixed | **Upgrade at submission, with the approval lag returned as credit; downgrade at approval, its bill issued then** (loophole 11) |
| D13 | Billing keys and the plan filter | **Exempt**, one narrow named exemption in `grants.ts` with a test |
| D14 | What decides expiry | **`accessUntil` on the subscription row**, compared with now in the entitlement check |
| D15 | An approver who belongs to the organization | **Flagged, not blocked**, in the queue and the audit: a small platform may have one approver |
| D16 | Settings changing the past | **Currency locked once billed; time zone and lower grace apply forward only** |
| D17 | Time and money | **One platform time zone and one currency**, from the platform settings |

## 10. Phases

| Phase | Issue | Needs | What |
|---|---|---|---|
| P1 | #90 | — | This document and the PLAN §13 / §12 entries. Docs only |
| — | #89 | — | Plans by size. **Done** 2026-11-07 |
| P2 | #91 | P1 | The package, its keys, the refusal union, and every rule above as pure functions with tests |
| P3 | #92 | P2 | ⚠ `module-permissions`: `periodStart`, `billingDay`, `accessUntil`; one active subscription; the expired reason; billing keys exempt; the release migration |
| P4 | #93 | P3 | Schema, services, API, wiring, roles, the back doors. Starts with the transaction spike |
| P5a | #94 | P1 | `module-jobs` runs app-level processes. Alongside P2 to P4 |
| P5b | #95 | P4, P5a | The daily check and every notification |
| P6 | #96 | P4 (P5b) | The organization's Billing page |
| P7 | #97 | P4 | The platform queue, settings and reports |
| P8 | #98 | all | README, end-to-end pass, release; close #88 |

## 11. Risks and open questions

- **P3 changes who may use what.** A wrong `accessUntil` or migration would
  lock organizations out, so P3 is run against a copy of the dev data before
  it merges, and the release migration gives every live subscription a period
  end first.
- **The shared transaction** (P4's spike). If the app cannot give billing and
  permissions one transaction, stop and decide before building on it.
- **Notifications to platform staff** outside any organization must be
  checked against `module-notification` before P5b.
- **Open, blocking P3: what an expired organization falls back to** — Free,
  or nothing (PLAN §12.131).
- **Open: official tax receipts** (PLAN §12.128) and **proof uploads** once
  file storage exists (PLAN §12.129).
- **Open: a trial repeated with a new sign-up** (PLAN §12.130).
