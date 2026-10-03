# @kwtech/module-basic-bookkeeping

A business's money per workspace, run as a **sub-app** on the workspace's Apps
page (`module-app-hub`): cash on hand, investors and their capital, profit
shares and payouts, money the business lends, and sales brought in from the
point of sale. The package is `module-basic-bookkeeping`; its prefix is `books`
(`books:*` keys, app key `books`, `Books*` models, `books_*` tables).

The plan and what v1 decided: `docs/BOOKKEEPING-PLAN.md` (§7). The decision:
PLAN §13, 2026-10-03.

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
import { booksWebModule } from '@kwtech/module-basic-bookkeeping/react';
const FEATURE_MODULES = [..., booksWebModule()];
```

One sub-app, `books` ("Books", icon `wallet`, order 50, gated on `books:read`),
component `BooksApp`. No routes and no drawer entry. Sections: Overview, Money,
Investors, Loans, and Settings for `books:manage_investors`. The investors and
loans lists take ↑ ↓ and Enter (`LIST_KEYS` from `@kwtech/web-ui/react`, on the
list; `RowButton` is its choice).

## In a NestJS app

```ts
booksServerModule({
  prismaProvider, prismaWriteProvider,          // BOOKS_PRISMA, BOOKS_PRISMA_WRITE
  accessCheckProvider,                          // BOOKS_ACCESS_CHECK
  memberDirectoryProvider,                      // BOOKS_MEMBER_DIRECTORY
  workspaceTimeZoneProvider,                    // BOOKS_WORKSPACE_TIME_ZONE
  imports: [POS_SERVER_MODULE.nestModule],      // for the sales source below
  salesSourceProvider,                          // BOOKS_SALES_SOURCE
  pubsubProvider,                               // BOOKS_PUBSUB
  resolveActorId,
})
```

Add `BOOKS_FEATURE_REGISTRY` to `MODULE_DECLARATIONS` in `seed/registry.ts`:
**the bindings are the guard.**

| Port | Asks | Unbound means |
|---|---|---|
| `BooksAccessCheck` | does this person hold a key (after the plan filter) | no: nobody may void an investor's entry |
| `BooksMemberDirectory` | names for who recorded and voided | nobody has a name ("a former member") |
| `BooksWorkspaceTimeZone` | the workspace's zone, for "today" | Asia/Manila, never UTC |
| `BooksSalesSource` | a POS's takings for some days: money kept per place, cost of goods, cost coverage, orders, truncated | there is no POS: sales are recorded by hand, and bringing them in is refused |
| `BooksPubSub` | the app's one engine | not live: screens see others' entries on reload |

The web server's adapters are in `apps/web-server/src/books/`. The sales source
calls the POS's own `PosReportService.takings`, so the books count sales exactly
as the POS dashboard does.

## Realtime

One trigger, `books.changed`, carrying `{ organizationId, workspaceId, change:
'books', actorId }`: no amounts and no names. Published after the commit, never
failing the write. `booksEvents` sends `sync` first; every event makes a screen
read the overview again.

## Vocabulary

| Term | Means |
|---|---|
| entry | one movement in the ledger (`BooksEntry`). Never edited or deleted, only voided |
| place | where money is: `cash`, `ewallet`, `bank` (card payments land in the bank) |
| cash on hand | Σ money in − money out, per place, over live entries |
| capital | what an investor has in: put in + reinvested − returned |
| still owed | profit shared with an investor − paid out − reinvested. Negative is an advance |
| profit | sales − refunds − cost of goods − expenses, by entry day. Purchases, loans, capital, payouts, transfers and count adjustments are not in it |
| profit share | a period's profit split among current investors, by capital or agreed % |
| shared through | the last day whose profit was shared. What decides a share is closed on or before it |
| import | POS sales for a run of whole days: one `sales` entry per place, plus cost of goods |

| Kind | Direction | Operation (key) |
|---|---|---|
| `sales`, `adjustment_in`, `loan_repayment` | in | `recordBooksEntry` (`books:record`) |
| `expense`, `purchase`, `refund`, `adjustment_out` | out | `recordBooksEntry` (`books:record`) |
| `transfer` | between places | `recordBooksEntry` (`books:record`) |
| `loan_out` | out | `lendBooksMoney` (`books:record`) |
| `capital` | in | `recordBooksInvestorEntry` (`books:manage_investors`) |
| `payout`, `capital_return` | out | `recordBooksInvestorEntry` (`books:manage_investors`) |
| `reinvest` | no money moves | `recordBooksInvestorEntry` (`books:manage_investors`) |
| `profit_share` | no money moves | `shareBooksProfit` (`books:manage_investors`) |

## The domain entry point

`@kwtech/module-basic-bookkeeping` is pure: `moneyOnHand`, `investorBalances`,
`loanBalances`, `profitShares`, `allocate` (largest remainder, to the centavo),
`profitBetween`, `profitByMonth`, `planProfitShare`, `checkInvestorEntry`,
`checkLoanRepayment`, `prepareBooksEntry`, `prepareBooksDay`, the statements
(`investorStatement`, `loanStatement`, `cashBook`), the registry, presets and
`BOOKS_OPERATIONS`. The server and the forms run the same functions.

## The rules that keep the numbers honest

- **Balances are added up, never stored**, so they cannot disagree with the
  entries. A read past `BOOKS_LEDGER_MAX` live entries says `truncated`
  (PLAN §12.86).
- **Every write takes the books' lock**: an upsert of `books_settings` bumping
  its version, inside the transaction, before anything is decided. A profit
  share or import commits only if the version is unchanged.
- **A second press records once**: each form sends a `clientId`
  (`@@unique([workspaceId, clientId])`).
- **Dates are days of the workspace's calendar** (`DATE`), never in the future.
- **Once profit is shared through a day**, sales, refunds, expenses, capital,
  capital returns and reinvestments dated on or before it are closed: neither
  recorded nor voided. Payouts, loans, transfers and purchases may still be.
- **A payout is at most what is owed**, unless marked an advance. A capital
  return is at most the capital. A repayment is at most what is owed on the
  loan. A void may not leave capital or a loan below zero.
- **Voiding an investor's entry needs `books:manage_investors`** as well as the
  binding's `books:record`, asked through the access port.
- **A profit share and a POS import are voided whole, latest first.** Voiding
  any entry of an import voids the import, and its days can be brought in again.
- **POS sales come in whole days, once, in order**, from the chosen first day
  (`posImportFrom`) or the day after the last import, at most 366 days at a
  time, and are refused if the POS could not count them (`truncated`). While
  connected, profit cannot be shared past the last day brought in.
- **Amounts are integer centavos**, `BigInt` columns, read back as numbers; an
  entry is at most ₱1,000,000,000.

## What it declares

| | |
|---|---|
| Feature keys (workspace level) | `books:read`, `books:record`, `books:manage_investors` (privileged) |
| Limits | none |
| Role presets | `books-bookkeeper` (read, record), `books-owner` (all three) |
| Sub-app | `books`, "Books", icon `wallet`, order 50 |
| Tables | `books_investor`, `books_loan`, `books_entry`, `books_sales_import`, `books_profit_share`, `books_settings` |
| Events | `books.changed` |

The web server grants `books-owner` to `workspace-admin`, nothing to
`workspace-user`, and sells the keys in Starter, Pro and Enterprise.
