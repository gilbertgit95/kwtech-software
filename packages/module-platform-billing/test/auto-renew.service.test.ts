import type { ProcessRunContext } from '@kwtech/module-kit';
import { platformDay } from '../src/domain/days.js';
import { PlatformBillingWriteError } from '../src/server/platform-billing.errors.js';
import { PLATFORM_BILLING_SYSTEM_ACTOR } from '../src/server/platform-billing-write.service.js';
import { type FakeBilling, fakeBilling, noonOn, setPrices } from './fake-client.js';

const ORG = 'org1';
const OWNER = 'owner1';
const APPROVER = 'approver1';
const ZONE = 'Asia/Manila';

function day(instant: Date | null | undefined): string | null {
  return instant ? platformDay(instant, ZONE) : null;
}

function balance(billing: FakeBilling): number {
  return billing.store().credits.reduce((sum, entry) => sum + entry.amount, 0);
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof PlatformBillingWriteError) return error.reason;
    throw error;
  }
  throw new Error('Expected a refusal');
}

/**
 * Basic subscribed on 15 Nov for `months` at once, paid and approved that day:
 * the period 15 Nov – 15 Dec, and `months - 1` months held as credit.
 */
async function prepaid(months: number): Promise<FakeBilling> {
  const billing = fakeBilling();
  await setPrices(billing);
  const now = noonOn('2026-11-15');
  const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now, months);
  const total = 100_000 * months;
  await billing.writes.enterPayment(
    ORG,
    request.id,
    OWNER,
    { method: 'cash', amount: total, paidOn: '2026-11-15' },
    now,
  );
  await billing.writes.approve(
    request.id,
    APPROVER,
    { detailsVersion: 1, method: 'cash', amount: total, paidOn: '2026-11-15' },
    now,
  );
  return billing;
}

describe('paying several months at once (#129)', () => {
  it('bills them together and, on approval, keeps the months ahead as credit', async () => {
    const billing = await prepaid(6);
    const bill = billing.store().bills[0];
    expect(bill?.total).toBe(600_000);
    expect(billing.store().requests[0]?.months).toBe(6);
    // One period applied, as for one month; the other five wait as credit.
    const live = billing.store().subscriptions.get(ORG);
    expect(day(live?.currentPeriodEnd)).toBe('2026-12-15');
    expect(billing.store().credits.map((entry) => [entry.kind, entry.amount])).toEqual([['paid_ahead', 500_000]]);
    expect(balance(billing)).toBe(500_000);
  });

  it('⚠ takes the months ahead back with a void of the payment that bought them', async () => {
    const billing = await prepaid(3);
    const request = billing.store().requests[0];
    if (!request) throw new Error('no request');
    await billing.writes.void(request.id, APPROVER, 'Entered against the wrong organization', noonOn('2026-11-16'));
    expect(balance(billing)).toBe(0);
  });

  it('refuses months on a plan change', async () => {
    const billing = await prepaid(1);
    expect(await refusal(billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-20'), 3))).toBe(
      'invalid',
    );
  });
});

describe('autoRenew: the daily check renews from credit (#129)', () => {
  it('renews on the due date, paid from credit: a paid bill of nothing, a receipt that took no money', async () => {
    const billing = await prepaid(6);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));

    expect((await billing.writes.autoRenew(ORG, noonOn('2026-12-14'))).kind).toBe('not_due');
    const outcome = await billing.writes.autoRenew(ORG, noonOn('2026-12-15'));
    expect(outcome.kind).toBe('renewed');

    const renewal = billing.store().requests.find((row) => row.automatic);
    expect(renewal).toMatchObject({
      kind: 'renew',
      state: 'approved',
      requestedById: PLATFORM_BILLING_SYSTEM_ACTOR,
      selfApproved: false,
      approverIsMember: false,
      pendingOrganizationId: null,
    });
    const bill = billing.store().bills.find((row) => row.requestId === renewal?.id);
    expect(bill).toMatchObject({ total: 0, status: 'paid' });
    const receipt = billing.store().receipts.find((row) => row.requestId === renewal?.id);
    expect(receipt).toMatchObject({ amount: 0, method: 'credit', kind: 'paid_from_credit' });

    // The month continues the cycle, and its price left the balance.
    expect(day(billing.store().subscriptions.get(ORG)?.currentPeriodEnd)).toBe('2027-01-15');
    expect(balance(billing)).toBe(400_000);

    // The owner is told what is left and how far it goes.
    const told = billing.notifier.told.filter((one) => one.what === 'request').at(-1)?.notice;
    expect(told).toMatchObject({
      step: 'auto_renewed',
      renewal: { periodEnd: '2027-01-15', creditLeft: 400_000, paidUpTo: '2027-05-15' },
    });
  });

  it('⚠ renews once a period: a second run the same day finds nothing due', async () => {
    const billing = await prepaid(3);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));
    await billing.writes.autoRenew(ORG, noonOn('2026-12-15'));
    expect((await billing.writes.autoRenew(ORG, noonOn('2026-12-15'))).kind).toBe('not_due');
    expect(billing.store().requests.filter((row) => row.automatic)).toHaveLength(1);
  });

  it('renews nothing with the switch off, and says why it skips when the credit falls short', async () => {
    const off = await prepaid(3);
    expect((await off.writes.autoRenew(ORG, noonOn('2026-12-15'))).kind).toBe('not_due');

    const short = await prepaid(1);
    await short.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));
    expect(await short.writes.autoRenew(ORG, noonOn('2026-12-15'))).toEqual({
      kind: 'skip',
      reason: 'credit_short',
      short: 100_000,
    });
    expect(short.store().requests).toHaveLength(1);
  });

  it('leaves a waiting request to the people handling it', async () => {
    const billing = await prepaid(3);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));
    await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-12-10'));
    expect(await billing.writes.autoRenew(ORG, noonOn('2026-12-15'))).toMatchObject({
      kind: 'skip',
      reason: 'pending_request',
    });
  });

  it('is voided as any renewal is: the period and the credit it spent come back', async () => {
    const billing = await prepaid(3);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));
    await billing.writes.autoRenew(ORG, noonOn('2026-12-15'));
    const renewal = billing.store().requests.find((row) => row.automatic);
    if (!renewal) throw new Error('no renewal');
    await billing.writes.void(renewal.id, APPROVER, 'The plan should have ended', noonOn('2026-12-16'));
    expect(day(billing.store().subscriptions.get(ORG)?.currentPeriodEnd)).toBe('2026-12-15');
    expect(balance(billing)).toBe(200_000);
  });

  it('shows on the overview: the switch, and how far the credit pays', async () => {
    const billing = await prepaid(6);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-16'));
    const context = await billing.reads.context(ORG, noonOn('2026-11-20'));
    expect(context.autoRenew.enabled).toBe(true);
    const renewal = billing.reads.renewalFromCredit(context);
    expect('refused' in renewal ? null : renewal.total).toBe(0);
  });
});

describe('the daily check with auto-renew on (#129)', () => {
  /** A run as `module-jobs` hands it: at `now`, daily at 08:00, over the one organization. */
  function runAt(now: Date): ProcessRunContext {
    return {
      now,
      schedule: { kind: 'daily', times: ['08:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
      maxItems: 100,
      tooLateAfterMinutes: 720,
      signal: new AbortController().signal,
      async workspaces() {
        return { workspaces: [], nextCursor: null };
      },
      async organizations() {
        return { organizations: [{ organizationId: ORG }], nextCursor: null };
      },
    };
  }

  it('announces the renewal a week before instead of asking to pay, then renews on the due date', async () => {
    const billing = await prepaid(3);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));

    await billing.daily.run(runAt(noonOn('2026-12-08')));
    expect(billing.store().notices.map((row) => row.kind)).toEqual(['auto_renew_upcoming']);

    await billing.daily.run(runAt(noonOn('2026-12-15')));
    expect(billing.store().requests.filter((row) => row.automatic)).toHaveLength(1);
    // Renewed before reminding: nobody is told "due today" about a plan that just renewed.
    expect(billing.store().notices.map((row) => row.kind)).toEqual(['auto_renew_upcoming']);
  });

  it('tells the owner once a period why it did not renew, beside the usual due notice', async () => {
    const billing = await prepaid(1);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));

    await billing.daily.run(runAt(noonOn('2026-12-15')));
    await billing.daily.run(runAt(noonOn('2026-12-16')));
    const kinds = billing.store().notices.map((row) => row.kind);
    expect(kinds.filter((kind) => kind === 'auto_renew_skipped')).toHaveLength(1);
    expect(kinds).toContain('due_today');
    const skipped = billing.store().notices.find((row) => row.kind === 'auto_renew_skipped');
    expect(skipped?.data).toMatchObject({ autoRenewSkip: 'credit_short', short: 100_000 });
  });
});

describe('auto-renew at the edges (#129)', () => {
  it('⚠ renews on the due date in the billing time zone, never by the server’s UTC day', async () => {
    const billing = await prepaid(3);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));
    // 23:30 on the 14th in Manila is still the day before the due date…
    expect((await billing.writes.autoRenew(ORG, new Date('2026-12-14T15:30:00.000Z'))).kind).toBe('not_due');
    // …and 00:30 on the 15th in Manila is the due date, though UTC still says the 14th.
    expect((await billing.writes.autoRenew(ORG, new Date('2026-12-14T16:30:00.000Z'))).kind).toBe('renewed');
  });

  it('⚠ still reminds when the renewal fails: a failure is logged, never the end of the organization’s notices', async () => {
    const billing = await prepaid(1);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));
    billing.writes.autoRenew = async () => {
      throw new Error('the subscriptions port is down');
    };
    await billing.daily.run({
      now: noonOn('2026-12-15'),
      schedule: { kind: 'daily', times: ['08:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
      maxItems: 100,
      tooLateAfterMinutes: 720,
      signal: new AbortController().signal,
      async workspaces() {
        return { workspaces: [], nextCursor: null };
      },
      async organizations() {
        return { organizations: [{ organizationId: ORG }], nextCursor: null };
      },
    });
    expect(billing.store().notices.map((row) => row.kind)).toContain('due_today');
  });

  it('tells the owner once when a price rise shortens how far the credit pays', async () => {
    const billing = await prepaid(6);
    await billing.writes.setPrice('admin', 'basic', 125_000, '2026-12-01');
    const run = (day: string) =>
      billing.daily.run({
        now: noonOn(day),
        schedule: { kind: 'daily', times: ['08:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
        maxItems: 100,
        tooLateAfterMinutes: 720,
        signal: new AbortController().signal,
        async workspaces() {
          return { workspaces: [], nextCursor: null };
        },
        async organizations() {
          return { organizations: [{ organizationId: ORG }], nextCursor: null };
        },
      });
    await run('2026-12-01');
    await run('2026-12-02');
    const moved = billing.store().notices.filter((row) => row.kind === 'paid_up_to_moved');
    expect(moved).toHaveLength(1);
    expect(moved[0]?.data).toMatchObject({ paidUpToBefore: '2027-05-15', paidUpToAfter: '2027-04-15' });
  });
});

describe('the countdown is replaced only when the plan will renew (#129)', () => {
  it('⚠ keeps asking to pay while a request waits without details, though the credit covers it', async () => {
    const billing = await prepaid(3);
    await billing.writes.setAutoRenew(ORG, OWNER, true, noonOn('2026-11-15'));
    // A renewal requested by hand, its details never entered: the daily check will skip on the due date.
    await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-12-08'));
    await billing.daily.run({
      now: noonOn('2026-12-08'),
      schedule: { kind: 'daily', times: ['08:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
      maxItems: 100,
      tooLateAfterMinutes: 720,
      signal: new AbortController().signal,
      async workspaces() {
        return { workspaces: [], nextCursor: null };
      },
      async organizations() {
        return { organizations: [{ organizationId: ORG }], nextCursor: null };
      },
    });
    const kinds = billing.store().notices.map((row) => row.kind);
    expect(kinds).not.toContain('auto_renew_upcoming');
    expect(kinds).toContain('due_in_7');
  });
});
