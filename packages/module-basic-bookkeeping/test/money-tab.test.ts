import { prepareBooksRange } from '../src/domain/days.js';
import type { BooksEntryView } from '../src/react/books-client.js';
import {
  activeFilterCount,
  kindOfLabel,
  kindOptions,
  matchesMoneyFilter,
  matchPreset,
  moneyTotals,
  NO_MONEY_FILTER,
  presetRange,
  rangeLength,
  stepRange,
} from '../src/react/view/money-tab.js';

/** The workspace's today in these tests: mid-month, so "this month" is not a whole month. */
const TODAY = '2026-10-15';
const NO_NAMES = { investor: null, borrower: null };

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
    recordedByName: 'Ana',
    recordedAt: '2026-10-15T02:00:00Z',
    voidedAt: null,
    voidedById: null,
    voidedByName: null,
    voidReason: null,
    ...fields,
  };
}

describe('the period', () => {
  it('works out each quick period from the workspace’s today, never past it', () => {
    expect(presetRange('this_month', TODAY)).toEqual({ fromDay: '2026-10-01', toDay: TODAY });
    expect(presetRange('last_month', TODAY)).toEqual({ fromDay: '2026-09-01', toDay: '2026-09-30' });
    expect(presetRange('last_7_days', TODAY)).toEqual({ fromDay: '2026-10-09', toDay: TODAY });
    expect(presetRange('last_30_days', TODAY)).toEqual({ fromDay: '2026-09-16', toDay: TODAY });
    expect(presetRange('this_year', TODAY)).toEqual({ fromDay: '2026-01-01', toDay: TODAY });
    // Across a year's end: January's "last month" is December.
    expect(presetRange('last_month', '2027-01-05')).toEqual({ fromDay: '2026-12-01', toDay: '2026-12-31' });
  });

  it('lights the chip of the period picked, and none for days picked by hand', () => {
    expect(matchPreset({ fromDay: '2026-09-01', toDay: '2026-09-30' }, TODAY)).toBe('last_month');
    expect(matchPreset({ fromDay: '2026-09-02', toDay: '2026-09-30' }, TODAY)).toBeNull();
  });

  it('steps a month by whole months, as the tab always did', () => {
    const thisMonth = presetRange('this_month', TODAY);
    expect(stepRange(thisMonth, -1, TODAY)).toEqual({ fromDay: '2026-09-01', toDay: '2026-09-30' });
    expect(stepRange({ fromDay: '2026-09-01', toDay: '2026-09-30' }, 1, TODAY)).toEqual(thisMonth);
    expect(stepRange({ fromDay: '2026-03-01', toDay: '2026-03-31' }, -1, TODAY)).toEqual({
      fromDay: '2026-02-01',
      toDay: '2026-02-28',
    });
  });

  it('steps a year by years, and any other run of days by its own length', () => {
    expect(stepRange(presetRange('this_year', TODAY), -1, TODAY)).toEqual({
      fromDay: '2025-01-01',
      toDay: '2025-12-31',
    });
    expect(stepRange(presetRange('last_7_days', TODAY), -1, TODAY)).toEqual({
      fromDay: '2026-10-02',
      toDay: '2026-10-08',
    });
  });

  it('⚠ never steps past today: none after a period ending today, and a step running past it stops there', () => {
    expect(stepRange(presetRange('this_month', TODAY), 1, TODAY)).toBeNull();
    expect(stepRange({ fromDay: '2026-10-05', toDay: '2026-10-12' }, 1, TODAY)).toEqual({
      fromDay: '2026-10-13',
      toDay: TODAY,
    });
  });

  it('counts both ends', () => {
    expect(rangeLength({ fromDay: TODAY, toDay: TODAY })).toBe(1);
    expect(rangeLength(presetRange('last_30_days', TODAY))).toBe(30);
  });

  it('refuses a range backwards or of days that do not exist', () => {
    expect(prepareBooksRange('2026-10-01', '2026-10-31')).toEqual({ fromDay: '2026-10-01', toDay: '2026-10-31' });
    expect(prepareBooksRange('2026-10-02', '2026-10-01')).toEqual({ refused: 'invalid_range' });
    expect(prepareBooksRange('2026-02-30', '2026-03-01')).toEqual({ refused: 'invalid_range' });
  });
});

describe('the filters', () => {
  const rent = entry({ id: 'rent', kind: 'expense', category: 'Rent', description: 'June', amount: 500_000 });
  const sale = entry({ id: 'sale', kind: 'sales', place: 'ewallet' });
  const deposit = entry({ id: 'deposit', kind: 'transfer', place: 'cash', toPlace: 'bank' });
  const voided = entry({ id: 'void', kind: 'sales', voidedAt: '2026-10-15T03:00:00Z', voidReason: 'typo' });
  const all = [rent, sale, deposit, voided];
  const shown = (filter: Partial<typeof NO_MONEY_FILTER>) =>
    all.filter((view) => matchesMoneyFilter(view, { ...NO_MONEY_FILTER, ...filter }, NO_NAMES)).map((v) => v.id);

  it('shows everything with no filter', () => {
    expect(shown({})).toEqual(['rent', 'sale', 'deposit', 'void']);
    expect(activeFilterCount(NO_MONEY_FILTER)).toBe(0);
  });

  it('finds every word typed, anywhere in the line', () => {
    expect(shown({ search: 'rent june' })).toEqual(['rent']);
    expect(shown({ search: 'RENT july' })).toEqual([]);
    expect(shown({ search: 'ana' })).toHaveLength(4);
  });

  it('narrows by kind and by place — a transfer matching either end', () => {
    expect(shown({ kinds: ['expense', 'transfer'] })).toEqual(['rent', 'deposit']);
    expect(shown({ places: ['bank'] })).toEqual(['deposit']);
    expect(shown({ places: ['ewallet'] })).toEqual(['sale']);
  });

  it('narrows by direction by the KIND, so a voided sale is still money in, and a transfer is neither', () => {
    expect(shown({ direction: 'in' })).toEqual(['sale', 'void']);
    expect(shown({ direction: 'out' })).toEqual(['rent']);
  });

  it('hides voided lines on request, and counts each filter once', () => {
    expect(shown({ showVoided: false })).toEqual(['rent', 'sale', 'deposit']);
    expect(activeFilterCount({ ...NO_MONEY_FILTER, search: ' ', kinds: ['sales'], showVoided: false })).toBe(2);
  });

  it('offers the kinds in the period, plus any chosen, in the labels’ order', () => {
    expect(kindOptions(all, ['payout'])).toEqual(['sales', 'expense', 'payout', 'transfer']);
    expect(kindOfLabel('Expense')).toBe('expense');
    expect(kindOfLabel('Nonsense')).toBeNull();
  });

  it('adds up money in and out of the lines shown, voided ones counting nothing', () => {
    expect(moneyTotals(all.map((view) => ({ view })))).toEqual({ moneyIn: 1000, moneyOut: -500_000, net: -499_000 });
  });
});
