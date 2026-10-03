import type { BooksEntryView, BooksInvestorView, BooksOverviewView } from '../src/react/books-client.js';
import {
  emptyEntryDraft,
  emptyInvestorEntryDraft,
  emptyLendDraft,
  validateEntryDraft,
  validateInvestorDraft,
  validateInvestorEntryDraft,
  validateLendDraft,
} from '../src/react/view/forms.js';
import { entryMoneyChange, entryTitle, formatDay } from '../src/react/view/labels.js';
import { canVoidEntry, ledgerLines } from '../src/react/view/ledger.js';
import { formatPeso, parsePercent, parsePeso } from '../src/react/view/money.js';
import { activeMonths, overviewNotices } from '../src/react/view/overview.js';

const TODAY = '2026-10-03';

const INVESTOR: BooksInvestorView = {
  id: 'maria',
  name: 'Maria',
  contact: null,
  note: null,
  agreedShare: null,
  formerAt: null,
  putIn: 1_000_000,
  reinvested: 0,
  capitalReturned: 0,
  capital: 1_000_000,
  profitShared: 320_000,
  paidOut: 0,
  owed: 320_000,
  share: 4000,
};

function overview(fields: Partial<BooksOverviewView> = {}): BooksOverviewView {
  return {
    timeZone: 'Asia/Manila',
    today: TODAY,
    money: { cash: 0, ewallet: 0, bank: 0, total: 0 },
    shareMode: 'capital',
    sharedThrough: null,
    investors: [],
    owedToInvestors: 0,
    loans: [],
    lentOutstanding: 0,
    unsharedFrom: null,
    unshared: null,
    months: [],
    shares: [],
    pos: { available: false, connected: false, importFrom: null, recordedThrough: null, nextFromDay: null },
    truncated: false,
    ...fields,
  };
}

function entry(fields: Partial<BooksEntryView>): BooksEntryView {
  return {
    id: 'e1',
    kind: 'sales',
    amount: 1000,
    place: 'cash',
    toPlace: null,
    day: TODAY,
    category: null,
    description: null,
    reference: null,
    investorId: null,
    loanId: null,
    importId: null,
    shareId: null,
    advance: false,
    recordedById: 'user-ana',
    recordedByName: 'ana',
    recordedAt: '2026-10-03T02:00:00Z',
    voidedAt: null,
    voidedById: null,
    voidedByName: null,
    voidReason: null,
    ...fields,
  };
}

describe('money as typed', () => {
  it('⚠ parses pesos from the text, never through a float', () => {
    expect(parsePeso('0.29')).toBe(29);
    expect(parsePeso('₱1,500.50')).toBe(150_050);
    expect(parsePeso('1.505')).toBeNull();
    expect(parsePeso('-5')).toBeNull();
    expect(parsePercent('33.33')).toBe(3333);
    expect(parsePercent('101')).toBeNull();
    expect(formatPeso(-1500)).toBe('-₱15.00');
  });
});

describe('the forms', () => {
  it('turns an expense draft into what the server takes', () => {
    const draft = { ...emptyEntryDraft('expense', TODAY), amount: '1,200', category: ' Rent ', description: '  ' };
    expect(validateEntryDraft(draft, { today: TODAY, clientId: 'c1' })).toEqual({
      input: {
        kind: 'expense',
        amount: 120_000,
        place: 'cash',
        toPlace: null,
        day: TODAY,
        category: 'Rent',
        description: null,
        reference: null,
        loanId: null,
        clientId: 'c1',
      },
    });
  });

  it('says why before Save: no category, a future day, no amount', () => {
    const draft = { ...emptyEntryDraft('expense', TODAY), amount: '', day: '2026-10-04' };
    const checked = validateEntryDraft(draft, { today: TODAY, clientId: 'c1' });
    expect('errors' in checked ? Object.keys(checked.errors).sort() : null).toEqual(['amount', 'day']);
    const noCategory = validateEntryDraft({ ...draft, amount: '5', day: TODAY }, { today: TODAY, clientId: 'c1' });
    expect('errors' in noCategory ? Object.keys(noCategory.errors) : null).toEqual(['category']);
  });

  it('refuses a payout over what is owed unless it is an advance — the server’s rule', () => {
    const draft = { ...emptyInvestorEntryDraft('payout', TODAY), amount: '3200.01' };
    const over = validateInvestorEntryDraft(draft, INVESTOR, { today: TODAY, clientId: 'c1' });
    expect('errors' in over ? over.errors.amount : null).toMatch(/more than they are owed/);
    const advance = validateInvestorEntryDraft({ ...draft, advance: true }, INVESTOR, { today: TODAY, clientId: 'c1' });
    expect('input' in advance ? advance.input.advance : null).toBe(true);
  });

  it('sends no place for a reinvestment', () => {
    const draft = { ...emptyInvestorEntryDraft('reinvest', TODAY), amount: '100' };
    const checked = validateInvestorEntryDraft(draft, INVESTOR, { today: TODAY, clientId: 'c1' });
    expect('input' in checked ? checked.input.place : 'refused').toBeNull();
  });

  it('needs a borrower for a new loan, and none for lending more', () => {
    const draft = { ...emptyLendDraft(TODAY), amount: '50' };
    expect('errors' in validateLendDraft(draft, { today: TODAY, clientId: 'c' })).toBe(true);
    const more = validateLendDraft({ ...draft, loanId: 'l1' }, { today: TODAY, clientId: 'c' });
    expect('input' in more ? more.input.loanId : null).toBe('l1');
  });

  it('takes an agreed share as a percentage, or none', () => {
    expect(validateInvestorDraft({ name: 'Gil', contact: '', note: '', agreedShare: '60' }, null)).toEqual({
      input: { name: 'Gil', contact: null, note: null, agreedShare: 6000 },
    });
    expect('errors' in validateInvestorDraft({ name: 'Gil', contact: '', note: '', agreedShare: 'half' }, null)).toBe(
      true,
    );
  });
});

describe('the ledger', () => {
  it('signs each line by what it did to cash on hand, and a voided one by nothing', () => {
    expect(entryMoneyChange(entry({ kind: 'expense' }))).toBe(-1000);
    expect(entryMoneyChange(entry({ kind: 'transfer', toPlace: 'bank' }))).toBe(0);
    expect(entryMoneyChange(entry({ voidedAt: '2026-10-03T03:00:00Z' }))).toBe(0);
  });

  it('counts a kind this build does not know for nothing, rather than guess', () => {
    expect(ledgerLines([entry({ kind: 'dividend' })])[0]?.voided).toBe(true);
  });

  it('offers Void only where the server would allow it', () => {
    const can = { canRecord: true, canManage: false };
    expect(canVoidEntry(entry({}), can)).toBe(true);
    expect(canVoidEntry(entry({ kind: 'payout' }), can)).toBe(false);
    expect(canVoidEntry(entry({ kind: 'payout' }), { canRecord: true, canManage: true })).toBe(true);
    expect(canVoidEntry(entry({ kind: 'profit_share' }), { canRecord: true, canManage: true })).toBe(false);
  });

  it('titles a line by what it was for and who', () => {
    expect(entryTitle(entry({ kind: 'payout', advance: true }), { investor: 'Maria' })).toBe(
      'Payout (advance) · Maria',
    );
    expect(entryTitle(entry({ kind: 'transfer', toPlace: 'bank' }))).toBe('Transfer · Cash → Bank');
    expect(formatDay('2026-10-03')).toBe('Oct 3, 2026');
  });
});

describe('the overview’s notices', () => {
  it('warns of a place below zero, and of POS days not brought in', () => {
    const notices = overviewNotices(
      overview({
        money: { cash: -100, ewallet: 0, bank: 0, total: -100 },
        pos: {
          available: true,
          connected: true,
          importFrom: '2026-09-01',
          recordedThrough: '2026-09-30',
          nextFromDay: '2026-10-01',
        },
      }),
    );
    expect(notices.map((notice) => [notice.key, notice.action ?? null])).toEqual([
      ['negative-cash', null],
      ['pos-behind', 'pos'],
    ]);
  });

  it('says nothing about today’s POS sales — today is still selling', () => {
    const pos = {
      available: true,
      connected: true,
      importFrom: '2026-09-01',
      recordedThrough: '2026-10-02',
      nextFromDay: TODAY,
    };
    expect(overviewNotices(overview({ pos }))).toEqual([]);
  });

  it('starts the months at the first with anything in it', () => {
    const empty = { sales: 0, refunds: 0, costOfGoods: 0, expenses: 0, profit: 0, purchases: 0 };
    const months = [
      { month: '2026-08', ...empty },
      { month: '2026-09', ...empty, purchases: 5 },
      { month: '2026-10', ...empty },
    ];
    expect(activeMonths(months).map((month) => month.month)).toEqual(['2026-09', '2026-10']);
  });
});
