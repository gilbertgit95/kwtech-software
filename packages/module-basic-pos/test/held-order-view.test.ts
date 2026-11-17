import type { PosOrderSummaryView } from '../src/react/pos-client.js';
import {
  closedHeldOrderNotice,
  closeHeldOrderLabel,
  heldOrderBanner,
  heldOrderOnTill,
} from '../src/react/view/held-order.js';

function summary(id: string, extra: Partial<PosOrderSummaryView> = {}): PosOrderSummaryView {
  return {
    id,
    status: 'open',
    version: 1,
    number: 12,
    label: null,
    orderTypeName: null,
    customerName: null,
    itemCount: 3,
    total: 30_000,
    changeOwed: 0,
    refunded: 0,
    createdAt: '2026-11-17T02:00:00.000Z',
    finalisedAt: null,
    finalisedById: null,
    paidAt: null,
    cancelReason: null,
    ...extra,
  };
}

describe('heldOrderOnTill (issue #162)', () => {
  const pending = [summary('held-1', { label: 'Table 4' }), summary('held-2')];

  it('finds the held order the till has open', () => {
    expect(heldOrderOnTill({ id: 'held-1', status: 'open' }, pending)?.label).toBe('Table 4');
  });

  it('is null for an order being taken, which is listed nowhere until Hold', () => {
    expect(heldOrderOnTill({ id: 'new-order', status: 'open' }, pending)).toBeNull();
  });

  it('is null for a clear till', () => {
    expect(heldOrderOnTill(null, pending)).toBeNull();
  });

  it('is null for a finished order on the till, even while the list has not caught up', () => {
    // Just paid here: the till shows its receipt, and the pending list still holds it until the re-read lands.
    expect(heldOrderOnTill({ id: 'held-1', status: 'paid' }, pending)).toBeNull();
  });
});

describe('heldOrderBanner (issue #162)', () => {
  it('names the order as the waiting list does, with its type and items', () => {
    const text = heldOrderBanner(summary('a', { label: 'Table 4', orderTypeName: 'Dine-in' }));
    expect(text.heading).toBe('Held order: Table 4');
    expect(text.detail).toBe('Dine-in · 3 items');
  });

  it('falls back to the customer, then the number', () => {
    expect(heldOrderBanner(summary('a', { customerName: 'Ana' })).heading).toBe('Held order: Ana');
    expect(heldOrderBanner(summary('a')).heading).toBe('Held order: Order 12');
  });

  it('says changes are already saved, so Close never looks like it throws them away', () => {
    expect(heldOrderBanner(summary('a')).note).toMatch(/saved to this order/u);
    expect(heldOrderBanner(summary('a')).note).toMatch(/keeps waiting for payment/u);
  });
});

describe('closing a held order (issue #162)', () => {
  it('names the order on the button and in the notice', () => {
    const held = summary('a', { label: 'Table 4' });
    expect(closeHeldOrderLabel(held)).toBe('Close Table 4 and start a new order');
    expect(closedHeldOrderNotice(held)).toBe('Closed Table 4. It is still waiting for payment.');
  });
});
