import { platformDay } from '../src/domain/days.js';
import { planVoid, readSubscriptionBefore, type SubscriptionBefore } from '../src/domain/voids.js';
import { PlatformBillingWriteError } from '../src/server/platform-billing.errors.js';
import { fakeBilling, giveSubscription, noonOn, setPrices } from './fake-client.js';

const ORG = 'org1';
const OWNER = 'owner1';
const APPROVER = 'approver1';
const ZONE = 'Asia/Manila';

/** The refusal reason `work` was refused with; fails the test when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof PlatformBillingWriteError) return error.reason;
    throw error;
  }
  throw new Error('Expected a refusal');
}

/** Payment details of `amount` centavos in cash. */
function cash(amount: number, paidOn = '2026-11-15') {
  return { method: 'cash', amount, paidOn };
}

/** What an approver confirms: the details version they saw and the payment received. */
function approval(detailsVersion: number, amount: number, paidOn = '2026-11-15') {
  return { detailsVersion, method: 'cash', amount, paidOn };
}

/** An instant as its Manila day, for assertions. */
function day(instant: Date | null | undefined): string | null {
  return instant ? platformDay(instant, ZONE) : null;
}

const BEFORE: SubscriptionBefore = {
  subscriptionId: 'sub1',
  planKey: 'basic',
  periodStart: '2026-11-01',
  periodEnd: '2026-12-01',
  billingDay: 1,
  accessUntil: '2026-12-07T16:00:00.000Z',
};

describe('planVoid: what reversing an approval writes', () => {
  it('ends a row the approval started, whatever was live before it', () => {
    expect(planVoid('start', null, false)).toEqual({ kind: 'end' });
    expect(planVoid('start', BEFORE, true)).toEqual({ kind: 'end' });
  });

  it('puts a renewed row back on its previous period and access', () => {
    expect(planVoid('renew', BEFORE, true)).toEqual({
      kind: 'restore_period',
      period: { start: '2026-11-01', end: '2026-12-01', billingDay: 1 },
      accessUntil: BEFORE.accessUntil,
    });
  });

  it('puts the previous plan back after a change, or ends the row when that plan is archived', () => {
    expect(planVoid('change', BEFORE, true)).toMatchObject({ kind: 'restore_plan', planKey: 'basic' });
    expect(planVoid('change', BEFORE, false)).toEqual({ kind: 'end' });
  });

  it('gives a cancelled period its access end back', () => {
    expect(planVoid('cancel', BEFORE, true)).toEqual({ kind: 'restore_access', accessUntil: BEFORE.accessUntil });
  });

  it('⚠ refuses an approval that did not record what it replaced, rather than guessing', () => {
    expect(planVoid(null, BEFORE, true)).toEqual({ refused: 'subscription_changed' });
    expect(planVoid('renew', null, true)).toEqual({ refused: 'subscription_changed' });
    expect(planVoid('renew', { ...BEFORE, periodStart: null }, true)).toEqual({ refused: 'subscription_changed' });
    expect(planVoid('cancel', { ...BEFORE, accessUntil: null }, true)).toEqual({ refused: 'subscription_changed' });
  });

  it('reads a malformed stored record as none', () => {
    expect(readSubscriptionBefore(null)).toBeNull();
    expect(readSubscriptionBefore({ planKey: 'basic' })).toBeNull();
    expect(readSubscriptionBefore({ ...BEFORE, periodStart: 'yesterday', accessUntil: 'soon' })).toMatchObject({
      periodStart: null,
      accessUntil: null,
    });
    expect(readSubscriptionBefore(BEFORE)).toEqual(BEFORE);
  });
});

describe('voiding an approval (D9a)', () => {
  async function approvedSubscribe(paid = 100_000) {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(paid), now);
    await billing.writes.approve(request.id, APPROVER, approval(1, paid), now);
    return { billing, request };
  }

  it('voids a subscribe: the row ends, the receipt reads VOID, the bill is unpaid, the overpayment reversed', async () => {
    const { billing, request } = await approvedSubscribe(120_000);
    expect(billing.store().credits.map((credit) => [credit.kind, credit.amount])).toEqual([['overpayment', 20_000]]);

    const voided = await billing.writes.void(
      request.id,
      'approver2',
      'approved the wrong organization',
      noonOn('2026-11-16'),
    );
    expect(voided).toMatchObject({
      state: 'voided',
      voidedById: 'approver2',
      voidReason: 'approved the wrong organization',
    });
    // The approval is still on record as it was.
    expect(voided.decidedById).toBe(APPROVER);

    // No live row: permissions falls back to Free (organization.fallback_plan).
    expect(billing.store().subscriptions.get(ORG)).toBeUndefined();
    expect(billing.store().receipts[0]).toMatchObject({ number: 1, voidReason: 'approved the wrong organization' });
    expect(billing.store().receipts[0]?.voidedAt).not.toBeNull();
    expect(billing.store().bills[0]).toMatchObject({ number: 1, status: 'unpaid' });
    expect(billing.store().credits.map((credit) => [credit.kind, credit.amount, credit.note])).toEqual([
      ['overpayment', 20_000, null],
      ['void_reversal', -20_000, 'overpayment'],
    ]);
    expect(await billing.reads.creditBalance(ORG)).toBe(0);
  });

  it('voids an upgrade: the previous plan back for the rest of the period, its lag credit reversed', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-16'));
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(25_000, '2026-11-16'), noonOn('2026-11-16'));
    await billing.writes.approve(request.id, APPROVER, approval(1, 25_000, '2026-11-16'), noonOn('2026-11-17'));
    expect(billing.store().subscriptions.get(ORG)?.planKey).toBe('pro');

    await billing.writes.void(request.id, APPROVER, 'payment bounced', noonOn('2026-11-18'));
    const live = billing.store().subscriptions.get(ORG);
    expect([live?.planKey, day(live?.periodStart), day(live?.currentPeriodEnd), day(live?.accessUntil)]).toEqual([
      'basic',
      '2026-11-01',
      '2026-12-01',
      '2026-12-08',
    ]);
    expect(await billing.reads.creditBalance(ORG)).toBe(0);
  });

  it('voids a renewal: the same row back on the period and access it had', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    const before = billing.store().subscriptions.get(ORG);
    const now = noonOn('2026-11-27');
    const request = await billing.writes.submit(ORG, OWNER, 'renew', null, now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000, '2026-11-27'), now);
    await billing.writes.approve(request.id, APPROVER, approval(1, 100_000, '2026-11-27'), now);
    expect(day(billing.store().subscriptions.get(ORG)?.currentPeriodEnd)).toBe('2027-01-01');

    // The renewal earned a hold while it waited (to 15 December); the void gives back the access from before it.
    await billing.writes.void(request.id, APPROVER, 'counted twice', noonOn('2026-11-28'));
    const live = billing.store().subscriptions.get(ORG);
    expect(live?.subscriptionId).toBe(before?.subscriptionId);
    expect([day(live?.periodStart), day(live?.currentPeriodEnd), day(live?.accessUntil)]).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2026-12-08',
    ]);
  });

  it('⚠ voids newest first: a renewal resting on a subscribe is voided before it', async () => {
    const { billing, request: subscribe } = await approvedSubscribe();
    const later = noonOn('2026-12-10');
    const renewal = await billing.writes.submit(ORG, OWNER, 'renew', null, later);
    await billing.writes.enterPayment(ORG, renewal.id, OWNER, cash(100_000, '2026-12-10'), later);
    await billing.writes.approve(renewal.id, APPROVER, approval(1, 100_000, '2026-12-10'), later);

    expect(await refusal(billing.writes.void(subscribe.id, APPROVER, 'mistake', later))).toBe('void_not_latest');
    await billing.writes.void(renewal.id, APPROVER, 'mistake', later);
    expect((await billing.writes.void(subscribe.id, APPROVER, 'mistake', later)).state).toBe('voided');
    expect(billing.store().receipts.every((receipt) => receipt.voidedAt !== null)).toBe(true);
  });

  it('voids only an approval, needs a reason, and never twice', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const pending = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    expect(await refusal(billing.writes.void(pending.id, APPROVER, 'mistake', now))).toBe('not_approved');
    await billing.writes.enterPayment(ORG, pending.id, OWNER, cash(100_000), now);
    await billing.writes.approve(pending.id, APPROVER, approval(1, 100_000), now);
    expect(await refusal(billing.writes.void(pending.id, APPROVER, '   ', now))).toBe('invalid');
    await billing.writes.void(pending.id, APPROVER, 'mistake', now);
    expect(await refusal(billing.writes.void(pending.id, APPROVER, 'mistake', now))).toBe('not_approved');
    expect(billing.store().credits).toEqual([]);
  });

  it('⚠ refuses when an admin edited the same row since, never overwriting the edit', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    const now = noonOn('2026-11-27');
    const request = await billing.writes.submit(ORG, OWNER, 'renew', null, now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000, '2026-11-27'), now);
    await billing.writes.approve(request.id, APPROVER, approval(1, 100_000, '2026-11-27'), now);
    // The same row, extended by hand: its id passes, its state does not.
    const live = billing.store().subscriptions.get(ORG);
    if (!live) throw new Error('No live row');
    const extended = new Date('2027-02-01T00:00:00.000Z');
    billing.store().subscriptions.set(ORG, { ...live, accessUntil: extended });

    expect(await refusal(billing.writes.void(request.id, APPROVER, 'mistake', noonOn('2026-11-28')))).toBe(
      'subscription_changed',
    );
    expect(billing.store().subscriptions.get(ORG)?.accessUntil?.getTime()).toBe(extended.getTime());
  });

  it('⚠ voids A → B → C newest first all the way down, through the row the first void restored', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    const up = await billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-16'));
    await billing.writes.enterPayment(ORG, up.id, OWNER, cash(25_000, '2026-11-16'), noonOn('2026-11-16'));
    await billing.writes.approve(up.id, APPROVER, approval(1, 25_000, '2026-11-16'), noonOn('2026-11-16'));
    const down = await billing.writes.submit(ORG, OWNER, 'change_plan', 'basic', noonOn('2026-11-20'));
    await billing.writes.approve(down.id, APPROVER, approval(0, 0, '2026-11-20'), noonOn('2026-11-20'));

    await billing.writes.void(down.id, APPROVER, 'mistake', noonOn('2026-11-21'));
    expect(billing.store().subscriptions.get(ORG)?.planKey).toBe('pro');
    // A new row put Pro back; the upgrade's approval recognises it and can be voided in turn.
    await billing.writes.void(up.id, APPROVER, 'mistake', noonOn('2026-11-21'));
    const live = billing.store().subscriptions.get(ORG);
    expect([live?.planKey, day(live?.currentPeriodEnd), day(live?.accessUntil)]).toEqual([
      'basic',
      '2026-12-01',
      '2026-12-08',
    ]);
    expect(await billing.reads.creditBalance(ORG)).toBe(0);
  });

  it('takes the organization’s decision lock in every decision', async () => {
    const { billing, request } = await approvedSubscribe();
    // Submit, payment details and approval: one each.
    expect(billing.store().locks[ORG]).toBe(3);
    await billing.writes.void(request.id, APPROVER, 'mistake', noonOn('2026-11-16'));
    expect(billing.store().locks[ORG]).toBe(4);
  });

  it('⚠ refuses when the subscription changed since the approval, never overwriting the change', async () => {
    const { billing, request } = await approvedSubscribe();
    // An admin put the organization on another row meanwhile.
    giveSubscription(billing, ORG, 'pro', '2026-11-20', '2026-12-20', '2026-12-27');
    expect(await refusal(billing.writes.void(request.id, APPROVER, 'mistake', noonOn('2026-11-21')))).toBe(
      'subscription_changed',
    );
    expect(billing.store().subscriptions.get(ORG)?.planKey).toBe('pro');
    expect(billing.store().receipts[0]?.voidedAt).toBeNull();
  });
});

describe('closing a request as credit (D12a)', () => {
  async function expiredUpgrade() {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-30'));
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(1_667, '2026-11-30'), noonOn('2026-11-30'));
    giveSubscription(billing, ORG, 'basic', '2026-12-01', '2027-01-01', '2027-01-08');
    return { billing, request };
  }

  it('keeps an expired change’s payment as credit: a receipt for it, the bill cancelled, the plan unchanged', async () => {
    const { billing, request } = await expiredUpgrade();
    const closed = await billing.writes.closeAsCredit(
      request.id,
      APPROVER,
      approval(1, 1_667, '2026-11-30'),
      'priced for November',
      noonOn('2026-12-02'),
    );
    expect(closed).toMatchObject({ state: 'closed_as_credit', pendingOrganizationId: null });
    expect(billing.store().receipts[0]).toMatchObject({ number: 1, amount: 1_667, kind: 'closed_as_credit' });
    // ⚠ Cancelled, never paid: the bill must not read PAID on what was received.
    expect(billing.store().bills[0]).toMatchObject({ status: 'cancelled', cancelledReason: 'closed_as_credit' });
    expect(billing.store().credits.map((credit) => [credit.kind, credit.amount])).toEqual([
      ['closed_as_credit', 1_667],
    ]);
    expect(billing.store().subscriptions.get(ORG)?.planKey).toBe('basic');
    expect(billing.store().subscriptionWrites).toEqual([]);
    const cancelled = billing.store().events.find((event) => event.step === 'bill_cancelled');
    expect(cancelled?.data).toMatchObject({ received: 1_667, receiptNumber: 1 });

    // The slot is free again, and the credit pays towards the new request.
    const again = await billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-12-02'));
    expect(again.state).toBe('pending');
  });

  it('records what was received whatever its amount, but refuses nothing received', async () => {
    const { billing, request } = await expiredUpgrade();
    expect(
      await refusal(billing.writes.closeAsCredit(request.id, APPROVER, approval(1, 0), null, noonOn('2026-12-02'))),
    ).toBe('nothing_received');
    expect(
      await refusal(billing.writes.closeAsCredit(request.id, APPROVER, approval(0, 500), null, noonOn('2026-12-02'))),
    ).toBe('details_changed');
    await billing.writes.closeAsCredit(request.id, APPROVER, approval(1, 500), null, noonOn('2026-12-02'));
    expect(await billing.reads.creditBalance(ORG)).toBe(500);
    expect(
      await refusal(billing.writes.closeAsCredit(request.id, APPROVER, approval(1, 500), null, noonOn('2026-12-02'))),
    ).toBe('not_pending');
  });

  it('gives back a hold the request earned', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-10-01', '2026-11-01', '2026-11-08');
    await setPrices(billing);
    const now = noonOn('2026-11-03');
    const request = await billing.writes.submit(ORG, OWNER, 'renew', null, now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000, '2026-11-03'), now);
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-11-15');

    await billing.writes.closeAsCredit(request.id, APPROVER, approval(1, 100_000, '2026-11-03'), null, now);
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-11-08');
  });
});

describe('cancelling at the period’s end', () => {
  function onBasic() {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    return billing;
  }

  it('applies at once: access ends on the period’s end, without grace, and no bill or credit', async () => {
    const billing = onBasic();
    await setPrices(billing);
    const cancel = await billing.writes.cancel(ORG, OWNER, noonOn('2026-11-10'));
    expect(cancel).toMatchObject({
      kind: 'cancel',
      state: 'approved',
      pendingOrganizationId: null,
      decisionReason: 'cancel_needs_no_approval',
    });
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-12-01');
    expect(billing.store().bills).toEqual([]);
    expect(billing.store().receipts).toEqual([]);
    expect(billing.store().credits).toEqual([]);
    expect(await refusal(billing.writes.cancel(ORG, OWNER, noonOn('2026-11-11')))).toBe('already_cancelled');
  });

  it('is undone by renewing, which opens at once after a cancel', async () => {
    const billing = onBasic();
    await setPrices(billing);
    await billing.writes.cancel(ORG, OWNER, noonOn('2026-11-10'));
    // Outside the 7 days before the due date, and still allowed: renewing is how a cancel is undone.
    const now = noonOn('2026-11-12');
    const renewal = await billing.writes.submit(ORG, OWNER, 'renew', null, now);
    await billing.writes.enterPayment(ORG, renewal.id, OWNER, cash(100_000, '2026-11-12'), now);
    await billing.writes.approve(renewal.id, APPROVER, approval(1, 100_000, '2026-11-12'), now);
    const live = billing.store().subscriptions.get(ORG);
    expect([day(live?.currentPeriodEnd), day(live?.accessUntil)]).toEqual(['2027-01-01', '2027-01-08']);
    // The renewal moved the period on: the cancel no longer applies, so cancelling again is allowed.
    expect((await billing.writes.cancel(ORG, OWNER, noonOn('2026-11-13'))).state).toBe('approved');
  });

  it('gives back the access end when the cancel is voided', async () => {
    const billing = onBasic();
    await setPrices(billing);
    const cancel = await billing.writes.cancel(ORG, OWNER, noonOn('2026-11-10'));
    await billing.writes.void(cancel.id, APPROVER, 'the owner pressed it by mistake', noonOn('2026-11-11'));
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-12-08');
  });

  it('refuses without a paid plan, and beside a pending request', async () => {
    const empty = fakeBilling();
    await setPrices(empty);
    expect(await refusal(empty.writes.cancel(ORG, OWNER, noonOn('2026-11-10')))).toBe('no_subscription');

    const billing = onBasic();
    await setPrices(billing);
    await billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-10'));
    expect(await refusal(billing.writes.cancel(ORG, OWNER, noonOn('2026-11-10')))).toBe('pending_request_exists');
  });
});
