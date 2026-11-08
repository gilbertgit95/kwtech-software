import { buildStatement, checkStatementRange, STATEMENT_MAX_DAYS } from '../src/domain/statement.js';
import type { BillingStatementView } from '../src/react/billing-client.js';
import { documentStamp } from '../src/react/view/billing-view.js';
import { monthOf, statementCsv, statementLineLabel } from '../src/react/view/statement-view.js';
import { historyWhere } from '../src/server/platform-billing.service.js';
import { fakeBilling, noonOn, setPrices } from './fake-client.js';

const ORG = 'org1';
const OWNER = 'owner1';

describe('buildStatement: the statement of account', () => {
  const at = (iso: string) => new Date(iso);
  const statement = buildStatement({
    from: '2026-11-01',
    to: '2026-11-30',
    currency: 'PHP',
    timeZone: 'Asia/Manila',
    openingCredit: 5_000,
    bills: [
      { id: 'b1', number: 1, status: 'paid', total: 100_000, issuedAt: at('2026-11-15T04:00:00.000Z') },
      { id: 'b2', number: 2, status: 'cancelled', total: 150_000, issuedAt: at('2026-11-16T04:00:00.000Z') },
    ],
    receipts: [
      {
        id: 'r1',
        number: 1,
        amount: 120_000,
        kind: 'payment',
        issuedAt: at('2026-11-15T04:00:00.000Z'),
        voidedAt: null,
      },
      {
        id: 'r2',
        number: 2,
        amount: 30_000,
        kind: 'payment',
        issuedAt: at('2026-11-20T04:00:00.000Z'),
        voidedAt: at('2026-11-21T04:00:00.000Z'),
      },
    ],
    credits: [{ id: 'c1', amount: 20_000, kind: 'overpayment', note: null, createdAt: at('2026-11-15T04:00:00.000Z') }],
  });

  it('lists bills, receipts and credit oldest first, a bill before its receipt and credit at one instant', () => {
    expect(statement.entries.map((entry) => entry.id)).toEqual(['b1', 'r1', 'c1', 'b2', 'r2']);
  });

  it('runs the credit balance from the opening one, and counts nothing cancelled or voided', () => {
    expect(statement.entries.map((entry) => entry.creditBalance)).toEqual([5_000, 5_000, 25_000, 25_000, 25_000]);
    expect(statement).toMatchObject({ openingCredit: 5_000, closingCredit: 25_000, billed: 100_000, paid: 120_000 });
    expect(statement.entries.find((entry) => entry.id === 'b2')).toMatchObject({ billed: 0, detail: 'cancelled' });
    expect(statement.entries.find((entry) => entry.id === 'r2')).toMatchObject({ paid: 0, detail: 'void' });
  });

  it('dates each line in the billing zone', () => {
    // 20:00Z on the 30th is the 1st in Manila.
    const late = buildStatement({
      from: '2026-12-01',
      to: '2026-12-01',
      currency: 'PHP',
      timeZone: 'Asia/Manila',
      openingCredit: 0,
      bills: [{ id: 'b', number: 3, status: 'unpaid', total: 1, issuedAt: at('2026-11-30T20:00:00.000Z') }],
      receipts: [],
      credits: [],
    });
    expect(late.entries[0]?.day).toBe('2026-12-01');
  });
});

describe('the statement and the history, read from the store', () => {
  /** An organization subscribed to Basic on 15 November, paid 1,200 for a 1,000 bill. */
  async function approvedSubscribe() {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(
      ORG,
      request.id,
      OWNER,
      { method: 'cash', amount: 120_000, paidOn: '2026-11-15' },
      now,
    );
    await billing.writes.approve(
      request.id,
      'approver1',
      { detailsVersion: 1, method: 'cash', amount: 120_000, paidOn: '2026-11-15' },
      now,
    );
    return billing;
  }

  it('states November: the bill, its receipt and the overpayment kept as credit', async () => {
    const billing = await approvedSubscribe();
    const statement = await billing.reads.statement(ORG, '2026-11-01', '2026-11-30');
    expect(statement.entries.map((entry) => [entry.kind, entry.number, entry.detail])).toEqual([
      ['bill', 'B-000001', 'paid'],
      ['receipt', 'R-000001', 'payment'],
      ['credit', null, 'overpayment'],
    ]);
    expect(statement).toMatchObject({ billed: 100_000, paid: 120_000, closingCredit: 20_000 });
    // October holds nothing, and opens and closes on no credit.
    expect(await billing.reads.statement(ORG, '2026-10-01', '2026-10-31')).toMatchObject({
      entries: [],
      openingCredit: 0,
      closingCredit: 0,
    });
    // December opens on November's credit.
    expect((await billing.reads.statement(ORG, '2026-12-01', '2026-12-31')).openingCredit).toBe(20_000);
  });

  it('filters the history by year and state, with totals over every page', async () => {
    const billing = await approvedSubscribe();
    await billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-20'));
    const all = await billing.reads.history(ORG, null, null);
    expect(all.totals).toEqual({ requests: 2, paidInYear: null });
    const approved = await billing.reads.history(ORG, null, null, { state: 'approved' });
    expect(approved.items.map((detail) => detail.request.kind)).toEqual(['subscribe']);
    const year = await billing.reads.history(ORG, null, null, { year: 2026 });
    expect(year.totals).toEqual({ requests: 2, paidInYear: 120_000 });
    expect((await billing.reads.history(ORG, null, null, { year: 2025 })).totals.requests).toBe(0);
  });

  it('turns filters into a query, ignoring what it cannot name', () => {
    expect(historyWhere({ state: 'approved; drop table' }, 'Asia/Manila')).toEqual({});
    expect(historyWhere({ hideClosed: true }, 'Asia/Manila')).toEqual({ state: { notIn: ['withdrawn', 'rejected'] } });
    // A state chosen outranks "hide closed".
    expect(historyWhere({ state: 'rejected', hideClosed: true }, 'Asia/Manila')).toEqual({ state: 'rejected' });
    // 2026 in Manila: from 2025-12-31T16:00Z.
    expect(historyWhere({ year: 2026 }, 'Asia/Manila').requestedAt?.gte.toISOString()).toBe('2025-12-31T16:00:00.000Z');
    expect(historyWhere({ year: 26 }, 'Asia/Manila')).toEqual({});
  });
});

describe('what a printed document and the CSV say', () => {
  it('stamps a bill by its status, PAID with its receipt, and a receipt VOID when reversed', () => {
    expect(documentStamp({ kind: 'bill', status: 'unpaid', paidBy: null })).toBe('UNPAID');
    expect(documentStamp({ kind: 'bill', status: 'submitted', paidBy: null })).toBe(
      'PAYMENT SUBMITTED, PENDING VERIFICATION',
    );
    expect(documentStamp({ kind: 'bill', status: 'paid', paidBy: 'R-000003' })).toBe('PAID, RECEIPT R-000003');
    expect(documentStamp({ kind: 'bill', status: 'cancelled', paidBy: null })).toBe('CANCELLED');
    expect(documentStamp({ kind: 'receipt', voided: true })).toBe('VOID');
    expect(documentStamp({ kind: 'receipt', voided: false })).toBeNull();
  });

  const view: BillingStatementView = {
    from: '2026-11-01',
    to: '2026-11-30',
    currency: 'PHP',
    openingCredit: 0,
    closingCredit: 20_000,
    billed: 100_000,
    paid: 120_000,
    entries: [
      {
        id: 'b1',
        at: '2026-11-15T04:00:00.000Z',
        day: '2026-11-15',
        kind: 'bill',
        number: 'B-000001',
        detail: 'paid',
        note: null,
        billed: 100_000,
        paid: 0,
        credit: 0,
        creditBalance: 0,
      },
      {
        id: 'c1',
        at: '2026-11-15T04:00:00.000Z',
        day: '2026-11-15',
        kind: 'credit',
        number: null,
        detail: 'archive',
        note: 'Basic was withdrawn on 2026-11-15; 15 paid days added as credit.',
        billed: 0,
        paid: 0,
        credit: 20_000,
        creditBalance: 20_000,
      },
    ],
  };

  it('words each line, a credit entry by its own note', () => {
    expect(statementLineLabel({ kind: 'bill', number: 'B-000001', detail: 'paid', note: null })).toBe(
      'Bill B-000001 (paid)',
    );
    expect(statementLineLabel({ kind: 'credit', number: null, detail: 'overpayment', note: null })).toBe(
      'Overpayment, kept as credit',
    );
    expect(statementLineLabel({ kind: 'receipt', number: 'R-000002', detail: 'void', note: null })).toBe(
      'Receipt R-000002 (void)',
    );
  });

  it('writes the CSV with plain amounts, quoted fields and the totals', () => {
    const lines = statementCsv(view).split('\r\n');
    expect(lines[0]).toBe('"Day","Item","Billed","Paid","Credit","Credit balance"');
    expect(lines[2]).toBe('"2026-11-15","Bill B-000001 (paid)","1000.00","","","0.00"');
    // A note with a comma and a semicolon stays one column.
    expect(lines[3]).toBe(
      '"2026-11-15","Basic was withdrawn on 2026-11-15; 15 paid days added as credit.","","","200.00","200.00"',
    );
    expect(lines[4]).toBe('"","Totals","1000.00","1200.00","","200.00"');
  });

  it('defaults the statement to the month today is in', () => {
    expect(monthOf('2026-11-08')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthOf('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('the statement range', () => {
  it('takes two real days in order, at most two years apart', () => {
    expect(STATEMENT_MAX_DAYS).toBe(731);
    expect(checkStatementRange('2026-11-01', '2026-11-30')).toBeNull();
    expect(checkStatementRange('2026-11-01', '2026-11-01')).toBeNull();
    // 731 days apart is the most; 732 is refused.
    expect(checkStatementRange('2025-01-01', '2027-01-02')).toBeNull();
    expect(checkStatementRange('2025-01-01', '2027-01-03')).toBe('invalid');
  });

  it('refuses a reversed range and a day that does not exist', () => {
    expect(checkStatementRange('2026-11-30', '2026-11-01')).toBe('invalid');
    expect(checkStatementRange('2026-02-30', '2026-03-01')).toBe('invalid');
    expect(checkStatementRange('yesterday', '2026-03-01')).toBe('invalid');
  });

  it('is checked by the service, before anything is read', async () => {
    const billing = fakeBilling();
    await expect(billing.reads.statement(ORG, '2026-11-30', '2026-11-01')).rejects.toMatchObject({ reason: 'invalid' });
  });
});
