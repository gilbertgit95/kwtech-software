import {
  cancelNeedsReason,
  checkOrderVersion,
  checkPayLater,
  isPosOrderEditable,
  isPosOrderFinalised,
  nextOrderStatus,
  planPayment,
} from '../src/domain/orders.js';

const JUAN = { name: 'Juan Dela Cruz', contact: '0917 000 0000' };
const WALK_IN = { name: null, contact: null };

describe('nextOrderStatus', () => {
  it('pays, releases unpaid or cancels an open order', () => {
    expect(nextOrderStatus('open', 'pay')).toEqual({ status: 'paid' });
    expect(nextOrderStatus('open', 'pay_later')).toEqual({ status: 'unpaid' });
    expect(nextOrderStatus('open', 'cancel')).toEqual({ status: 'cancelled' });
  });

  it('pays or voids an unpaid order, and nothing else', () => {
    expect(nextOrderStatus('unpaid', 'pay')).toEqual({ status: 'paid' });
    expect(nextOrderStatus('unpaid', 'void')).toEqual({ status: 'voided' });
    expect(nextOrderStatus('unpaid', 'cancel')).toEqual({ refused: 'not_open' });
  });

  it('⚠ lets nothing leave paid, cancelled or voided — a paid order is corrected by a refund', () => {
    for (const status of ['paid', 'cancelled', 'voided'] as const) {
      expect(nextOrderStatus(status, 'pay')).toEqual({ refused: 'invalid_transition' });
      expect(nextOrderStatus(status, 'cancel')).toEqual({ refused: 'not_open' });
      expect(nextOrderStatus(status, 'void')).toEqual({ refused: 'not_unpaid' });
    }
  });

  it('edits only open orders, and numbers only finalised ones', () => {
    expect(isPosOrderEditable('open')).toBe(true);
    expect(isPosOrderEditable('unpaid')).toBe(false);
    expect(isPosOrderFinalised('voided')).toBe(true);
    expect(isPosOrderFinalised('cancelled')).toBe(false);
  });
});

describe('guards', () => {
  it('refuses a change made on an old version of the order', () => {
    expect(checkOrderVersion(3, 3)).toBeNull();
    expect(checkOrderVersion(2, 3)).toBe('conflict');
  });

  it('⚠ asks a reason to cancel an order with lines, not an empty one', () => {
    expect(cancelNeedsReason(0)).toBe(false);
    expect(cancelNeedsReason(2)).toBe(true);
  });

  it('releases unpaid only with a name and a contact, and never an empty order', () => {
    expect(checkPayLater(JUAN, 1)).toBeNull();
    expect(checkPayLater({ name: 'Juan', contact: null }, 1)).toBe('customer_required');
    expect(checkPayLater(JUAN, 0)).toBe('invalid_transition');
  });
});

describe('planPayment', () => {
  const cash = (received: number, extra: { tip?: number; changeOwed?: number } = {}) => ({
    method: 'cash' as const,
    received,
    tip: extra.tip ?? 0,
    changeOwed: extra.changeOwed ?? 0,
  });

  it('gives change on cash: ₱1,500 for ₱1,490 is ₱10 back', () => {
    expect(planPayment(149_000, cash(150_000), WALK_IN)).toEqual({ change: 1000 });
  });

  it('keeps change as a tip: ₱10 for ₱7, all ₱3 kept', () => {
    expect(planPayment(700, cash(1000, { tip: 300 }), WALK_IN)).toEqual({ change: 0 });
  });

  it('records change owed, which needs a name and contact', () => {
    expect(planPayment(90_000, cash(100_000, { changeOwed: 10_000 }), JUAN)).toEqual({ change: 0 });
    expect(planPayment(90_000, cash(100_000, { changeOwed: 10_000 }), WALK_IN)).toEqual({
      refused: 'customer_required',
    });
  });

  it('refuses too little cash, and a tip larger than the change', () => {
    expect(planPayment(1000, cash(900), WALK_IN)).toEqual({ refused: 'insufficient_payment' });
    expect(planPayment(700, cash(1000, { tip: 500 }), WALK_IN)).toEqual({ refused: 'invalid_amount' });
  });

  it('⚠ allows no change on e-wallet or card: received is the total plus the tip, exactly', () => {
    expect(planPayment(700, { method: 'ewallet', received: 1000, tip: 300, changeOwed: 0 }, WALK_IN)).toEqual({
      change: 0,
    });
    expect(planPayment(700, { method: 'card', received: 1000, tip: 0, changeOwed: 0 }, WALK_IN)).toEqual({
      refused: 'change_not_allowed',
    });
    expect(planPayment(700, { method: 'ewallet', received: 1000, tip: 0, changeOwed: 300 }, JUAN)).toEqual({
      refused: 'change_not_allowed',
    });
  });

  it('completes an order discounted to ₱0 with ₱0', () => {
    expect(planPayment(0, cash(0), WALK_IN)).toEqual({ change: 0 });
  });

  it('refuses a negative or fractional amount', () => {
    expect(planPayment(700, cash(-1), WALK_IN)).toEqual({ refused: 'invalid_amount' });
    expect(planPayment(700, cash(700.5), WALK_IN)).toEqual({ refused: 'invalid_amount' });
  });
});
