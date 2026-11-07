import { platformDay, platformDayStart } from '../src/domain/days.js';
import { readBillSnapshot } from '../src/domain/documents.js';
import { PlatformBillingWriteError } from '../src/server/platform-billing.errors.js';
import { fakeBilling, giveSubscription, noonOn, setPrices } from './fake-client.js';

const ORG = 'org1';
const OWNER = 'owner1';
const APPROVER = 'approver1';
const ZONE = 'Asia/Manila';

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof PlatformBillingWriteError) return error.reason;
    throw error;
  }
  throw new Error('Expected a refusal');
}

function cash(amount: number, paidOn = '2026-11-15') {
  return { method: 'cash', amount, paidOn };
}

function approval(detailsVersion: number, amount: number) {
  return { detailsVersion, method: 'cash', amount, paidOn: '2026-11-15' };
}

function day(instant: Date | null | undefined): string | null {
  return instant ? platformDay(instant, ZONE) : null;
}

describe('a subscribe, from request to receipt', () => {
  it('issues a numbered bill, then on approval applies the plan, pays the bill and issues a receipt', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');

    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    expect(billing.store().bills).toHaveLength(1);
    const bill = billing.store().bills[0];
    expect(bill?.number).toBe(1);
    expect(bill?.total).toBe(100_000);
    expect(bill?.status).toBe('unpaid');

    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000), now);
    expect(billing.store().bills[0]?.status).toBe('submitted');

    const approved = await billing.writes.approve(request.id, APPROVER, approval(1, 100_000), now);
    expect(approved.state).toBe('approved');
    expect(approved.pendingOrganizationId).toBeNull();

    const live = billing.store().subscriptions.get(ORG);
    expect(live?.planKey).toBe('basic');
    // From approval: that day is the billing day, a month to its end, plus 7 days of grace.
    expect(day(live?.periodStart)).toBe('2026-11-15');
    expect(day(live?.currentPeriodEnd)).toBe('2026-12-15');
    expect(live?.billingDay).toBe(15);
    expect(day(live?.accessUntil)).toBe('2026-12-22');

    expect(billing.store().bills[0]?.status).toBe('paid');
    expect(billing.store().receipts).toHaveLength(1);
    expect(billing.store().receipts[0]?.number).toBe(1);
    expect(billing.store().credits).toEqual([]);
    expect(billing.store().events.map((event) => event.step)).toEqual([
      'submitted',
      'bill_issued',
      'details_entered',
      'approved',
      'receipt_issued',
    ]);
  });

  it('records a self-approval, and an approver who is a member, without blocking either (D15)', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    billing.people.members.add(`${OWNER}@${ORG}`);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000), now);
    const approved = await billing.writes.approve(request.id, OWNER, approval(1, 100_000), now);
    expect(approved.selfApproved).toBe(true);
    expect(approved.approverIsMember).toBe(true);
  });
});

describe('the rules #93 names', () => {
  it('⚠ two approvals at once give one receipt: the second finds nothing pending', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000), now);

    const results = await Promise.allSettled([
      billing.writes.approve(request.id, APPROVER, approval(1, 100_000), now),
      billing.writes.approve(request.id, 'approver2', approval(1, 100_000), now),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    const second = results[1];
    expect(second?.status === 'rejected' && (second.reason as PlatformBillingWriteError).reason).toBe('not_pending');
    expect(billing.store().receipts).toHaveLength(1);
    expect(billing.store().subscriptionWrites).toHaveLength(1);
  });

  it('⚠ changed payment details refuse an approval of the version the approver saw', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000), now);
    // The approver opens version 1; the owner corrects the details meanwhile.
    await billing.writes.enterPayment(ORG, request.id, OWNER, { ...cash(100_000), note: 'paid at the counter' }, now);

    expect(await refusal(billing.writes.approve(request.id, APPROVER, approval(1, 100_000), now))).toBe(
      'details_changed',
    );
    expect(billing.store().receipts).toHaveLength(0);
    expect((await billing.writes.approve(request.id, APPROVER, approval(2, 100_000), now)).state).toBe('approved');
    expect(billing.store().payments.map((payment) => payment.version)).toEqual([1, 2]);
  });

  it('⚠ numbering keeps no gap: a withdrawn request keeps its bill number, a refused approval takes none', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const first = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.withdraw(ORG, first.id, OWNER, 'wrong plan', now);
    expect(billing.store().bills[0]).toMatchObject({ number: 1, status: 'cancelled', cancelledReason: 'withdrawn' });

    const second = await billing.writes.submit(ORG, OWNER, 'subscribe', 'pro', now);
    expect(billing.store().bills.map((bill) => bill.number)).toEqual([1, 2]);

    await billing.writes.enterPayment(ORG, second.id, OWNER, cash(100_000), now);
    // Short: refused, and the transaction that would have numbered a receipt rolled back.
    expect(await refusal(billing.writes.approve(second.id, APPROVER, approval(1, 100_000), now))).toBe('payment_short');
    await billing.writes.enterPayment(ORG, second.id, OWNER, cash(150_000), now);
    await billing.writes.approve(second.id, APPROVER, approval(2, 150_000), now);
    expect(billing.store().receipts.map((receipt) => receipt.number)).toEqual([1]);
  });

  it('⚠ a failed subscription write leaves no receipt, no credit and no number taken', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(120_000), now);
    const start = billing.subscriptions.start;
    billing.subscriptions.start = async () => {
      throw new Error('permissions refused');
    };
    await expect(billing.writes.approve(request.id, APPROVER, approval(1, 120_000), now)).rejects.toThrow(
      'permissions refused',
    );
    expect(billing.store().receipts).toHaveLength(0);
    expect(billing.store().credits).toHaveLength(0);
    expect(billing.store().requests[0]?.state).toBe('pending');
    expect(billing.store().counters.find((counter) => counter.sequence === 'receipt')).toBeUndefined();

    billing.subscriptions.start = start;
    await billing.writes.approve(request.id, APPROVER, approval(1, 120_000), now);
    expect(billing.store().receipts[0]?.number).toBe(1);
  });

  it('allows one pending request per organization', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    expect(await refusal(billing.writes.submit(ORG, OWNER, 'subscribe', 'pro', now))).toBe('pending_request_exists');
    // Another organization is not held up by it.
    await billing.writes.submit('org2', OWNER, 'subscribe', 'basic', now);
  });
});

describe('payments', () => {
  it('turns an overpayment into credit, never change (D7)', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(130_000), now);
    await billing.writes.approve(request.id, APPROVER, approval(1, 130_000), now);
    expect(billing.store().credits.map((credit) => [credit.kind, credit.amount])).toEqual([['overpayment', 30_000]]);
    expect(await billing.reads.creditBalance(ORG)).toBe(30_000);
  });

  it('spends credit on the next bill', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(130_000), now);
    await billing.writes.approve(request.id, APPROVER, approval(1, 130_000), now);

    const later = noonOn('2026-12-10');
    const renewal = await billing.writes.submit(ORG, OWNER, 'renew', null, later);
    const bill = billing.store().bills.find((one) => one.requestId === renewal.id);
    expect(bill?.total).toBe(70_000);
    await billing.writes.enterPayment(ORG, renewal.id, OWNER, cash(70_000, '2026-12-10'), later);
    await billing.writes.approve(renewal.id, APPROVER, approval(1, 70_000), later);
    expect(await billing.reads.creditBalance(ORG)).toBe(0);
    // Renewed before the due date: the same billing day, the next month from the old end.
    const live = billing.store().subscriptions.get(ORG);
    expect([day(live?.periodStart), day(live?.currentPeriodEnd)]).toEqual(['2026-12-15', '2027-01-15']);
  });

  it('needs a reference for an e-wallet or a bank transfer', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    expect(
      await refusal(
        billing.writes.enterPayment(
          ORG,
          request.id,
          OWNER,
          { method: 'e_wallet', amount: 100_000, paidOn: '2026-11-15' },
          now,
        ),
      ),
    ).toBe('reference_required');
  });

  it('refuses a request on a plan with no price', async () => {
    const billing = fakeBilling();
    await billing.writes.setPrice('admin', 'basic', 100_000, '2026-01-01');
    expect(await refusal(billing.writes.submit(ORG, OWNER, 'subscribe', 'pro', noonOn('2026-11-15')))).toBe(
      'price_not_set',
    );
  });

  it('finds a request only in its own organization', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    expect(await refusal(billing.writes.enterPayment('org2', request.id, OWNER, cash(100_000), now))).toBe('not_found');
    expect(await refusal(billing.writes.withdraw('org2', request.id, OWNER, null, now))).toBe('not_found');
  });
});

describe('plan changes (D11, D12)', () => {
  // A 30-day period: 1 November to 1 December. The 16th leaves 15 days.
  function onBasic() {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    return billing;
  }

  it('prices an upgrade at submission and credits the days approval took', async () => {
    const billing = onBasic();
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-16'));
    const bill = billing.store().bills[0];
    // 1,500 × 15/30 − 1,000 × 15/30 = 250.
    expect(bill?.total).toBe(25_000);

    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(25_000, '2026-11-16'), noonOn('2026-11-16'));
    await billing.writes.approve(
      request.id,
      APPROVER,
      { ...approval(1, 25_000), paidOn: '2026-11-16' },
      noonOn('2026-11-17'),
    );
    // One day on the old plan, paid for at the new: (1,500 − 1,000) × 1/30, rounded half up.
    expect(billing.store().credits.map((credit) => [credit.kind, credit.amount])).toEqual([['approval_lag', 1_667]]);
    const live = billing.store().subscriptions.get(ORG);
    // The billing day never moves for a change: the new plan runs to the period's end.
    expect([live?.planKey, day(live?.currentPeriodEnd), day(live?.accessUntil)]).toEqual([
      'pro',
      '2026-12-01',
      '2026-12-08',
    ]);
  });

  it('bills a downgrade only at approval, with that day’s credit', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'pro', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'change_plan', 'basic', noonOn('2026-11-16'));
    expect(billing.store().bills).toHaveLength(0);

    await billing.writes.approve(
      request.id,
      APPROVER,
      { ...approval(0, 0), paidOn: '2026-11-16' },
      noonOn('2026-11-16'),
    );
    const bill = billing.store().bills[0];
    expect(bill?.total).toBe(0);
    expect(readBillSnapshot(bill?.snapshot).creditAdded).toBe(25_000);
    expect(billing.store().credits.map((credit) => [credit.kind, credit.amount])).toEqual([['change_credit', 25_000]]);
    expect(billing.store().receipts[0]?.amount).toBe(0);
  });

  it('refuses a downgrade while over the new plan’s caps (D6)', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'pro', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    billing.plans.usageOf = { 'organization:members': 5 };
    expect(await refusal(billing.writes.submit(ORG, OWNER, 'change_plan', 'basic', noonOn('2026-11-16')))).toBe(
      'over_new_plan_caps',
    );
  });

  it('refuses a change once the period it was priced for has ended (quote_expired)', async () => {
    const billing = onBasic();
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-30'));
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(1_667, '2026-11-30'), noonOn('2026-11-30'));
    // The period moved on (renewed elsewhere) before anybody approved.
    giveSubscription(billing, ORG, 'basic', '2026-12-01', '2027-01-01', '2027-01-08');
    expect(await refusal(billing.writes.approve(request.id, APPROVER, approval(1, 1_667), noonOn('2026-12-02')))).toBe(
      'quote_expired',
    );
  });
});

describe('renewals, grace and the hold (D9, D10)', () => {
  it('charges the access used past the period end on a renewal made after access ended', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-10-01', '2026-11-01', '2026-11-08');
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-11-10'));
    const snapshot = readBillSnapshot(billing.store().bills[0]?.snapshot);
    // A month, plus 7 days of the 31-day October period: 1,000 × 7/31 = 225.81.
    expect(snapshot.lines.map((line) => [line.kind, line.amount, line.days ?? null])).toEqual([
      ['month', 100_000, null],
      ['access_used', 22_581, 7],
    ]);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(122_581, '2026-11-10'), noonOn('2026-11-10'));
    await billing.writes.approve(
      request.id,
      APPROVER,
      { ...approval(1, 122_581), paidOn: '2026-11-10' },
      noonOn('2026-11-10'),
    );
    // After expiry: a new period from approval, the billing day reset.
    const live = billing.store().subscriptions.get(ORG);
    expect([day(live?.periodStart), day(live?.currentPeriodEnd), live?.billingDay]).toEqual([
      '2026-11-10',
      '2026-12-10',
      10,
    ]);
  });

  it('⚠ re-bills a renewal whose covering details arrive only after access ended: not on time', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-10-01', '2026-11-01', '2026-11-08');
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-10-28'));
    expect(billing.store().bills[0]?.total).toBe(100_000);

    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000, '2026-11-09'), noonOn('2026-11-09'));
    const [first, second] = billing.store().bills;
    expect(first).toMatchObject({ number: 1, status: 'cancelled', cancelledReason: 'access_ended_before_details' });
    expect(second).toMatchObject({ number: 2, total: 122_581, status: 'unpaid' });
    expect(billing.store().requests[0]?.coveredOn).toBeNull();
  });

  it('holds access for a renewal covered before grace ends, and gives it back on a rejection', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-10-01', '2026-11-01', '2026-11-08');
    await setPrices(billing);
    const now = noonOn('2026-11-03');
    const request = await billing.writes.submit(ORG, OWNER, 'renew', null, now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000, '2026-11-03'), now);
    // End + 7 grace + 7 hold.
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-11-15');
    expect(billing.store().requests[0]).toMatchObject({ holdDays: 7, holdReason: 'held' });

    await billing.writes.reject(request.id, APPROVER, 'No such payment at the counter.', noonOn('2026-11-04'));
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-11-08');
    expect(billing.store().bills[0]).toMatchObject({ status: 'cancelled', cancelledReason: 'rejected' });

    // Never after a rejection in the same period (D9).
    const again = await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-11-05'));
    await billing.writes.enterPayment(ORG, again.id, OWNER, cash(100_000, '2026-11-05'), noonOn('2026-11-05'));
    expect(billing.store().requests[1]).toMatchObject({ holdDays: 0, holdReason: 'after_rejection' });
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-11-08');
  });

  it('⚠ gives back exactly the access before the hold, even after grace was lowered', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-10-01', '2026-11-01', '2026-11-08');
    await setPrices(billing);
    const now = noonOn('2026-11-03');
    const request = await billing.writes.submit(ORG, OWNER, 'renew', null, now);
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000, '2026-11-03'), now);
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-11-15');

    await billing.writes.setSettings('admin', { graceDays: 2 });
    await billing.writes.withdraw(ORG, request.id, OWNER, null, noonOn('2026-11-04'));
    // The 7 days of grace it had, not the 2 the setting now gives new periods (D16).
    expect(day(billing.store().subscriptions.get(ORG)?.accessUntil)).toBe('2026-11-08');
  });

  it('keeps an on-time renewal’s bill when approval comes after access ended: the delay was ours', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-10-01', '2026-11-01', '2026-11-08');
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-10-28'));
    await billing.writes.enterPayment(ORG, request.id, OWNER, cash(100_000, '2026-10-28'), noonOn('2026-10-28'));
    // Held to 15 November; approved on the 20th, after even the hold.
    await billing.writes.approve(
      request.id,
      APPROVER,
      { ...approval(1, 100_000), paidOn: '2026-10-28' },
      noonOn('2026-11-20'),
    );
    expect(billing.store().bills).toHaveLength(1);
    const live = billing.store().subscriptions.get(ORG);
    expect([day(live?.periodStart), day(live?.currentPeriodEnd)]).toEqual(['2026-11-20', '2026-12-20']);
  });

  it('refuses a renewal before it opens', async () => {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    expect(await refusal(billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-11-10')))).toBe(
      'renewal_not_open',
    );
  });
});

describe('settings (D16)', () => {
  it('locks the currency and the time zone once a bill exists, but not the grace days', async () => {
    const billing = fakeBilling();
    await billing.writes.setSettings('admin', { currency: 'USD', timeZone: 'Asia/Tokyo' });
    await billing.writes.setSettings('admin', { currency: 'PHP', timeZone: 'Asia/Manila' });
    await setPrices(billing);
    await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', noonOn('2026-11-15'));
    expect(await refusal(billing.writes.setSettings('admin', { currency: 'USD' }))).toBe('currency_locked');
    expect(await refusal(billing.writes.setSettings('admin', { timeZone: 'Asia/Tokyo' }))).toBe('time_zone_locked');
    await billing.writes.setSettings('admin', { graceDays: 3 });
    expect((await billing.reads.settings()).graceDays).toBe(3);
  });

  it('refuses a grace beyond a month and an unknown time zone', async () => {
    const billing = fakeBilling();
    expect(await refusal(billing.writes.setSettings('admin', { graceDays: 60 }))).toBe('invalid');
    expect(await refusal(billing.writes.setSettings('admin', { timeZone: 'Mars/Olympus' }))).toBe('invalid');
  });
});

it('writes instants at the start of platform days', () => {
  expect(platformDayStart('2026-11-15', ZONE).toISOString()).toBe('2026-11-14T16:00:00.000Z');
});
