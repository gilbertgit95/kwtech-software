import type { BooksInvestorView } from '../src/react/books-client.js';
import {
  emptyEntryDraft,
  isMoneyTabInvestorKind,
  MONEY_TAB_INVESTOR_KINDS,
  validateInvestorMoneyDraft,
} from '../src/react/view/forms.js';

/*
 * The Money tab's record form, for an investor's money (issue #5): the same
 * checks as the investor's own form, plus choosing whose money it is.
 */

const TODAY = '2026-10-15';
const CONTEXT = { today: TODAY, clientId: 'c1' };

function investor(fields: Partial<BooksInvestorView> = {}): BooksInvestorView {
  return {
    id: 'i1',
    name: 'Ana',
    contact: null,
    note: null,
    agreedShare: null,
    formerAt: null,
    putIn: 50_000_00,
    reinvested: 0,
    capitalReturned: 0,
    capital: 50_000_00,
    profitShared: 2_000_00,
    paidOut: 0,
    owed: 2_000_00,
    share: null,
    ...fields,
  };
}

function draft(kind: (typeof MONEY_TAB_INVESTOR_KINDS)[number], fields: Partial<ReturnType<typeof emptyEntryDraft>>) {
  return { ...emptyEntryDraft(kind, TODAY), ...fields, kind };
}

describe('the investors’ kinds on the Money tab', () => {
  it('offers the kinds that move money, and leaves reinvesting to the investor’s page', () => {
    expect([...MONEY_TAB_INVESTOR_KINDS]).toEqual(['capital', 'payout', 'capital_return']);
    expect(isMoneyTabInvestorKind('capital')).toBe(true);
    expect(isMoneyTabInvestorKind('reinvest')).toBe(false);
    expect(isMoneyTabInvestorKind('expense')).toBe(false);
  });
});

describe('validateInvestorMoneyDraft', () => {
  it('sends capital put in as the investor form would', () => {
    const checked = validateInvestorMoneyDraft(
      draft('capital', { amount: '10,000', place: 'bank', investorId: 'i1', reference: ' DEP-1 ' }),
      investor(),
      CONTEXT,
    );
    expect(checked).toEqual({
      input: {
        kind: 'capital',
        investorId: 'i1',
        amount: 10_000_00,
        place: 'bank',
        day: TODAY,
        description: null,
        reference: 'DEP-1',
        advance: false,
        clientId: 'c1',
      },
    });
  });

  it('asks whose money it is, and still checks the other fields', () => {
    const checked = validateInvestorMoneyDraft(draft('capital', { amount: '' }), null, CONTEXT);
    expect(checked).toEqual({
      errors: { investorId: 'Choose whose money it is.', amount: expect.any(String) },
    });
  });

  it('refuses a payout above what is owed, unless it is an advance', () => {
    const over = draft('payout', { amount: '3000', investorId: 'i1' });
    expect(validateInvestorMoneyDraft(over, investor(), CONTEXT)).toEqual({
      errors: { amount: expect.stringContaining('more than they are owed') },
    });
    const advance = validateInvestorMoneyDraft({ ...over, advance: true }, investor(), CONTEXT);
    expect('input' in advance && advance.input.advance).toBe(true);
  });

  it('refuses returning more capital than they have in', () => {
    const checked = validateInvestorMoneyDraft(
      draft('capital_return', { amount: '60000', investorId: 'i1' }),
      investor(),
      CONTEXT,
    );
    expect(checked).toEqual({ errors: { amount: expect.stringContaining('more capital') } });
  });

  it('never marks anything but a payout an advance', () => {
    const checked = validateInvestorMoneyDraft(
      draft('capital', { amount: '100', investorId: 'i1', advance: true }),
      investor(),
      CONTEXT,
    );
    expect('input' in checked && checked.input.advance).toBe(false);
  });
});
