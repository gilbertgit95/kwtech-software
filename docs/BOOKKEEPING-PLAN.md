# Bookkeeping app — plan (draft)

Status: **ideas captured, 2026-09-29, not scheduled.** Collected while planning
`module-basic-pos` (`docs/POS-PLAN.md`), when the operator asked how an owner
knows their capital, reinvestment and investors. It is **not part of POS v1**:
it is bookkeeping, not selling, so it is planned as its own sub-app, after POS
v1 is running with real sales. Nothing here is decided until it is planned
properly; the examples below are the operator's.

## 1. Why a separate app

- POS answers *what did we sell*. This answers *where did the money come from,
  where did it go, and who is owed what*. Different screens, people and
  questions.
- It serves businesses that do not use POS too.
- A module never imports another (PLAN §9), so it reads POS's **sales and
  profit per period through a port** the web app implements. POS already keeps
  each sale's **unit cost** (POS-PLAN D15), so profit is right back to the
  first sale with nothing re-entered.

## 2. The money it records

| Entry | Example | Paid from |
|---|---|---|
| **Capital** | laminator ₱15,000 | an investor's pocket |
| **Reinvestment** | printer ₱25,000, bulk film ₱8,000 | the business's earnings |
| **Expense** | rent, electricity, internet, wages | the business's earnings |
| **Profit payout** | Maria's share, paid in parts | the business's earnings |
| **Capital return** | part of Gilbert's ₱15,000 given back | the business's earnings |
| **Buyout** | Maria leaves; ₱20,000 in instalments | the business's earnings |

Each entry has a type, a category (equipment, supplies, rent, utilities …),
an amount, a date, how it was paid (cash, bank, GCash) and a reference, who
recorded it, and a note. **Entries are never edited or deleted**: a mistake
is corrected by a reversing entry, as POS refunds are.

## 3. Investors

- An **investor** is a name and contact. They need not be a user.
- Every capital entry names **who** put it in; every payout, return or buyout
  names **who** was paid.
- **Share**: by default each investor's part of the capital put in (₱15k of
  ₱25k = 60%); or an **agreed %** the partners set ("50/50"). The app records
  the agreement, it does not decide it.
- **Former investor** after a buyout: history kept, nothing deleted.
- Later, optional: an investor signs in **view-only** and sees their own
  statement and the overview.

### "The business": the built-in reinvestment source

A special source that cannot be deleted, renamed into a person or given a
share. Reinvestment is recorded against it.

- It **holds no share**: the profit it spends already belongs to the investors
  by their shares, so a ₱25,000 printer is Gilbert's 60% and Maria's 40% of the
  profit put back in. Shares do not change; each investor's **still owed**
  goes down by their part.
- It **can only spend what was earned**. If the printer costs ₱25,000 and
  ₱18,000 of profit is available, the missing ₱7,000 must come as new capital
  from a person (which does change shares).
- Reports show it on its own line: "funded by the business".

## 4. Paying investors

Three kinds, because each changes different numbers:

1. **Profit payout**: from the investor's still-owed profit share. Capital and
   share unchanged.
2. **Capital return**: reduces their capital; if shares follow capital, shares
   change (Gilbert returns ₱5,000 → ₱10,000 vs ₱10,000 → 50/50). With agreed
   shares, shares stay and the app says so.
3. **Buyout**: an agreed amount; their share passes to the others (by share,
   or to whoever buys it) when the agreement is recorded; they become a former
   investor.

**Partial is the normal case.** Every payment is any amount, any number of
times, against a **running balance**. New profit shares add to the same
balance, so what is unpaid carries over:

```
Maria — still owed
Oct 31   Profit share (40%)               ₱16,000
Nov 5    Profit payout  (cash)             −₱3,000     still owed ₱13,000
Nov 20   Profit payout  (GCash, ref …)     −₱5,000     still owed  ₱8,000
Dec 15   Profit payout  (cash)             −₱2,000     still owed  ₱6,000
Dec 31   Profit share, Q4 (40%)            ₱10,000     still owed ₱16,000
```

A capital return can be in parts, and a buyout in instalments (the unpaid part
shows as owed to a former investor until ₱0).

**Rules**: a payout warns when cash on hand or the investor's still owed is
lower; paying ahead of profit only as a marked **advance** (negative still
owed, taken from the next share). Every payment has a printable **slip**.
Admin only.

## 5. Reports

1. **Investors overview**: put in, share, profit share, paid out, still owed,
   paid back %, per investor; "The business" and what it reinvested; totals,
   including **owed to investors**.
2. **Statement per investor**, printable: every capital, share, reinvestment
   part, payout, and the running balance.
3. **Payback over time**: a line per investor toward 100%.
4. **Capital and reinvestment history**: every investment, who funded it (a
   person or the business), and what it bought.
5. **What the business owns**: equipment, when bought, who funded it.
6. **Profit and loss by month**: sales − item costs − expenses = net profit,
   then reinvested / paid to investors / kept.

Optional: link an investment to a POS **category** (laminator → Lamination) so
payback per machine is counted from what it produces ("which machine was
worth buying"). Optional: one card on the POS dashboard, "capital paid back
62%", through a port.

## 6. Questions for when it is planned

- One app ("Bookkeeping" / "Business money") or part of POS after all?
- Payback per machine (linked to a category), or all capital from all profit?
- How profit is split into shares: per month, per quarter, on demand?
- Cash on hand: computed from POS cash and entries, or counted and entered?
- Investor sign-in (view-only): wanted, and when?
- Depreciation of equipment: needed, or out of scope for a small business?
