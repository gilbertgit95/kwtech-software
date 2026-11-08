import type { BillingOverviewView, BillingStandingView } from '../src/react/billing-client.js';
import {
  type BillingAbilities,
  billingStatus,
  cancelControl,
  changePlanControl,
  eventSentence,
  formatDay,
  formatInstantDay,
  formatMoney,
  mainAction,
  planChoices,
} from '../src/react/view/billing-view.js';
import { checkPaymentDraft, parseAmount, paymentInput } from '../src/react/view/payment-form.js';

const OWNER: BillingAbilities = { choosePlan: true, renew: true, enterPayment: true };
const ADMIN: BillingAbilities = { choosePlan: false, renew: true, enterPayment: true };

/** An overview on Basic, due 1 December 2026, 7 days of grace: access until the 8th. */
function overview(standing: Partial<BillingStandingView> = {}, over: Partial<BillingOverviewView> = {}) {
  return {
    currency: 'PHP',
    creditBalance: 0,
    pending: null,
    standing: {
      kind: 'active',
      days: 20,
      planKey: 'basic',
      planLabel: 'Basic',
      planArchived: false,
      cancelled: false,
      trial: false,
      periodStart: '2026-11-01',
      periodEnd: '2026-12-01',
      accessUntil: '2026-12-08',
      graceDays: 7,
      holdDays: 0,
      prepaid: false,
      ...standing,
    },
    ...over,
  };
}

describe('the status at the top of the Billing page', () => {
  it('says when it is due and when renewing opens', () => {
    const status = billingStatus(overview());
    expect(status).toMatchObject({ tone: 'ok', headline: 'Basic is active' });
    expect(status.details[0]).toBe('Due on 1 Dec 2026, in 20 days.');
    expect(status.details[1]).toMatch(/Renewing opens 7 days before the due date/);
  });

  it('⚠ explains access past the due date by its rule: the due date plus the grace', () => {
    const status = billingStatus(overview({ kind: 'overdue', days: 4 }));
    expect(status.headline).toBe('Basic is overdue: 4 days of access left');
    expect(status.details[0]).toBe(
      'It was due on 1 Dec 2026. Access lasts until 7 Dec 2026: the due date plus 7 days of grace.',
    );
  });

  it('names a hold, a cancel, a trial, an expiry and an archived plan', () => {
    expect(billingStatus(overview({ kind: 'held', holdDays: 3, accessUntil: '2026-12-11' })).details[0]).toMatch(
      /plus 7 days of grace and 3 days held, because your payment details came in before grace ended/,
    );
    expect(billingStatus(overview({ cancelled: true })).headline).toBe('Basic ends on 1 Dec 2026');
    expect(billingStatus(overview({ kind: 'none', trial: true })).headline).toBe('Trial of Basic');
    expect(billingStatus(overview({ kind: 'expired' })).headline).toBe('Basic ended on 7 Dec 2026');
    expect(billingStatus(overview({ planArchived: true })).tone).toBe('alert');
  });

  it('says what credit or debt the next bill carries', () => {
    expect(billingStatus(overview({}, { creditBalance: 25_000 })).details).toContain(
      'Credit of ₱250.00 is applied to your next bill.',
    );
    expect(billingStatus(overview({}, { creditBalance: -10_000 })).details).toContain(
      '₱100.00 is owed and added to your next bill.',
    );
  });
});

describe('the main button and the controls beside it', () => {
  it('follows the status: renew when open, subscribe on Free or a trial, replace an archived plan', () => {
    expect(mainAction(overview({ kind: 'renewal_open' }), OWNER)).toEqual({
      kind: 'renew',
      label: 'Renew',
      disabledReason: null,
    });
    expect(mainAction(overview({ kind: 'expired' }), OWNER).label).toBe('Renew to restore access');
    expect(mainAction(overview({ kind: 'none' }), OWNER).kind).toBe('subscribe');
    expect(mainAction(overview({ kind: 'none', trial: true }), OWNER).kind).toBe('subscribe');
    expect(mainAction(overview({ planArchived: true }), OWNER).kind).toBe('replace');
  });

  it('says why renewing is not open yet, and when it opens; a cancel opens it at once', () => {
    expect(mainAction(overview(), OWNER).disabledReason).toBe(
      'Renewing opens on 24 Nov 2026, 7 days before the due date. You will be reminded.',
    );
    expect(mainAction(overview({ cancelled: true }), OWNER).disabledReason).toBeNull();
  });

  it('shows the waiting request instead of a button', () => {
    const waiting = overview({}, { pending: { id: 'r1' } as BillingOverviewView['pending'] });
    expect(mainAction(waiting, OWNER).kind).toBe('pending');
    expect(changePlanControl(waiting, OWNER)).toEqual({
      enabled: false,
      reason: 'A request is already waiting. Finish or withdraw it first.',
    });
  });

  it('⚠ keeps choosing the plan the owner’s (D8), and says so to an admin', () => {
    expect(mainAction(overview({ kind: 'none' }), ADMIN).disabledReason).toBe(
      "Only the organization's owner can choose, change or cancel the plan.",
    );
    expect(changePlanControl(overview(), ADMIN).enabled).toBe(false);
    expect(cancelControl(overview(), ADMIN).enabled).toBe(false);
    // An admin still renews.
    expect(mainAction(overview({ kind: 'renewal_open' }), ADMIN).disabledReason).toBeNull();
  });

  it('turns Change plan off while overdue, with "Renew first"', () => {
    expect(changePlanControl(overview({ kind: 'overdue' }), OWNER)).toEqual({
      enabled: false,
      reason: 'Your subscription is overdue, so the plan cannot be changed yet. Renew first.',
    });
    expect(changePlanControl(overview(), OWNER)).toEqual({ enabled: true, reason: null });
    expect(cancelControl(overview({ cancelled: true }), OWNER).reason).toMatch(/Already set to end/);
  });
});

describe('words and numbers', () => {
  it('formats money, days and instants in the billing zone', () => {
    expect(formatMoney(100_050, 'PHP')).toBe('₱1,000.50');
    expect(formatDay('2026-12-01')).toBe('1 Dec 2026');
    expect(formatDay(null)).toBe('—');
    // 20:00Z on the 30th is already 1 December in Manila.
    expect(formatInstantDay('2026-11-30T20:00:00.000Z', 'Asia/Manila')).toBe('1 Dec 2026');
    expect(formatInstantDay('2026-11-30T20:00:00.000Z', 'Europe/London')).toBe('30 Nov 2026');
  });

  it('turns every timeline step into a sentence with its reason', () => {
    expect(eventSentence({ step: 'bill_issued', reason: null, data: '{"number":12,"total":100000}' }, 'PHP')).toBe(
      'Bill B-000012 issued for ₱1,000.00.',
    );
    expect(
      eventSentence({ step: 'bill_cancelled', reason: 'access_ended_before_details', data: '{"number":3}' }, 'PHP'),
    ).toBe(
      'Bill B-000003 cancelled: access ended before payment details were entered, so a new bill charges the access used.',
    );
    expect(eventSentence({ step: 'approved', reason: 'cancel_needs_no_approval', data: '{}' }, 'PHP')).toBe(
      'Cancelled: access ends at the close of the period.',
    );
    expect(eventSentence({ step: 'withdrawn', reason: 'plan_archived', data: '{}' }, 'PHP')).toMatch(
      /the plan was withdrawn/,
    );
  });
});

describe('the payment details form', () => {
  const draft = { method: 'cash', amount: '1,000.00', paidOn: '2026-11-30', reference: '', sender: '', note: '' };

  it('reads an amount as centavos, refusing what is not money', () => {
    expect(parseAmount('1,000.50')).toBe(100_050);
    expect(parseAmount('250')).toBe(25_000);
    expect(parseAmount('12.345')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
  });

  it('needs a reference for an e-wallet or a bank transfer, as the server does', () => {
    expect(checkPaymentDraft(draft)).toEqual({});
    expect(checkPaymentDraft({ ...draft, method: 'e_wallet' }).reference).toBe(
      'An e-wallet or bank transfer needs its reference number.',
    );
    expect(checkPaymentDraft({ ...draft, amount: 'abc', paidOn: '' })).toMatchObject({
      amount: expect.any(String),
      paidOn: expect.any(String),
    });
  });

  it('sends centavos, and empty text as absent', () => {
    expect(paymentInput({ ...draft, note: '  ' })).toEqual({
      method: 'cash',
      amount: 100_000,
      paidOn: '2026-11-30',
      reference: null,
      sender: null,
      note: null,
    });
  });
});

describe('the plans a request may name', () => {
  const plans = [
    { key: 'free', label: 'Free', monthly: null, isPublic: true, archived: false, current: false },
    { key: 'lite', label: 'Lite', monthly: 0, isPublic: true, archived: false, current: false },
    { key: 'basic', label: 'Basic', monthly: 100_000, isPublic: true, archived: false, current: true },
    { key: 'pro', label: 'Pro', monthly: 150_000, isPublic: true, archived: false, current: false },
    { key: 'old', label: 'Old', monthly: 80_000, isPublic: true, archived: true, current: false },
  ];
  const keys = (mode: Parameters<typeof planChoices>[1]) => planChoices(plans, mode).map((plan) => plan.key);

  it('offers a change every other priced plan, a zero-priced one included', () => {
    expect(keys('change_plan')).toEqual(['lite', 'pro']);
  });

  it('⚠ offers a replacement a zero-priced plan too', () => {
    expect(keys('replace')).toEqual(['lite', 'basic', 'pro']);
  });

  it('offers a subscribe paid plans only, the plan being tried included', () => {
    expect(keys('subscribe')).toEqual(['basic', 'pro']);
  });
});
