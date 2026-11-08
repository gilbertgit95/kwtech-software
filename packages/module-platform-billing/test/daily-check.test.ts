import { checkProcessDeclaration, type ProcessRunContext } from '@kwtech/module-kit';
import { accessWindow } from '../src/domain/access.js';
import { planReminders } from '../src/domain/notices.js';
import { PLATFORM_BILLING_PROCESS, PLATFORM_BILLING_PROCESS_REGISTRY } from '../src/processes.js';
import { noticeDay } from '../src/server/platform-billing-daily.process.js';
import { type FakeBilling, fakeBilling, giveSubscription, noonOn, setPrices } from './fake-client.js';

const ORG = 'org1';
const OWNER = 'owner1';
/** A period ending on 1 December, 7 days of grace: access until 8 December. */
const WINDOW = accessWindow('2026-12-01', 7);

describe('planReminders: what an organization is told on a day', () => {
  it('counts down 7, 3 and 1 days before the due date and on it, each keyed by its milestone', () => {
    expect(planReminders(WINDOW, '2026-11-23', null)).toEqual([]);
    expect(planReminders(WINDOW, '2026-11-24', null)).toEqual([{ kind: 'due_in_7', day: '2026-11-24', daysLeft: 7 }]);
    // A run missed on the 24th catches up on the 25th, keyed by the 24th: said once.
    expect(planReminders(WINDOW, '2026-11-25', null)).toEqual([{ kind: 'due_in_7', day: '2026-11-24', daysLeft: 6 }]);
    expect(planReminders(WINDOW, '2026-11-28', null)[0]).toMatchObject({ kind: 'due_in_3', day: '2026-11-28' });
    expect(planReminders(WINDOW, '2026-11-30', null)[0]).toMatchObject({ kind: 'due_in_1', day: '2026-11-30' });
  });

  it('says each overdue day with the days left, then the last warning, then the expiry once', () => {
    expect(planReminders(WINDOW, '2026-12-01', null)).toEqual([{ kind: 'due_today', day: '2026-12-01', daysLeft: 7 }]);
    expect(planReminders(WINDOW, '2026-12-02', null)).toEqual([{ kind: 'overdue', day: '2026-12-02', daysLeft: 6 }]);
    expect(planReminders(WINDOW, '2026-12-04', null)).toEqual([{ kind: 'overdue', day: '2026-12-04', daysLeft: 4 }]);
    expect(planReminders(WINDOW, '2026-12-07', null)).toEqual([
      { kind: 'last_warning', day: '2026-12-07', daysLeft: 1 },
    ]);
    // Keyed by the day access ended, however late the run.
    expect(planReminders(WINDOW, '2026-12-08', null)).toEqual([{ kind: 'expired', day: '2026-12-08', daysLeft: 0 }]);
    expect(planReminders(WINDOW, '2026-12-20', null)).toEqual([{ kind: 'expired', day: '2026-12-08', daysLeft: 0 }]);
  });

  it('reminds daily while a request waits without payment details, and goes quiet once they cover the bill', () => {
    expect(planReminders(WINDOW, '2026-12-03', { covered: false, hasDetails: false })).toEqual([
      { kind: 'no_payment_details', day: '2026-12-03', daysLeft: 0 },
      { kind: 'overdue', day: '2026-12-03', daysLeft: 5 },
    ]);
    // Paid, waiting on us: no "please pay", but the expiry is still said if access ends.
    expect(planReminders(WINDOW, '2026-12-03', { covered: true, hasDetails: true })).toEqual([]);
    expect(planReminders(WINDOW, '2026-12-09', { covered: true, hasDetails: true })[0]?.kind).toBe('expired');
    // A first subscribe has no window, and still hears about its missing details.
    expect(planReminders(null, '2026-12-03', { covered: false, hasDetails: false })).toHaveLength(1);
  });
});

describe('the daily check (platform_billing.daily_check)', () => {
  it('is declared to reach every organization, with no plan gate and every limit', () => {
    const declaration = PLATFORM_BILLING_PROCESS_REGISTRY.find(
      (one) => one.key === PLATFORM_BILLING_PROCESS.dailyCheck,
    );
    expect(declaration).toMatchObject({ reach: 'organizations', serves: null, module: 'platform_billing' });
    expect(declaration?.maxItemsPerRun).toBeGreaterThan(0);
    // The composer's own check, so a key it refuses fails here rather than at boot.
    expect(declaration && checkProcessDeclaration(declaration)).toBeNull();
  });

  /** A run as `module-jobs` hands it: at `now`, daily at 08:00, over `organizations`. */
  function runContext(now: Date, organizations: readonly string[], maxItems = 100): ProcessRunContext {
    return {
      now,
      schedule: { kind: 'daily', times: ['08:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
      maxItems,
      tooLateAfterMinutes: 720,
      signal: new AbortController().signal,
      /** None: this process reaches organizations. */
      async workspaces() {
        return { workspaces: [], nextCursor: null };
      },
      /** The given organizations, a page at a time, as module-jobs pages them. */
      async organizations(cursor, limit) {
        const start = cursor ? organizations.indexOf(cursor) + 1 : 0;
        const page = organizations.slice(start, start + limit);
        const more = start + limit < organizations.length;
        return {
          organizations: page.map((organizationId) => ({ organizationId })),
          nextCursor: more ? (page.at(-1) ?? null) : null,
        };
      },
    };
  }

  /** The kinds of reminder told so far, in order. */
  function told(billing: FakeBilling): string[] {
    return billing.notifier.told
      .filter((one) => one.what === 'reminder')
      .map((one) => (one.notice as { kind: string }).kind);
  }

  /** ORG on Basic, due on 1 December, with prices set. */
  async function onBasic() {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    return billing;
  }

  it('⚠ tells once: a second run the same day writes and sends nothing', async () => {
    const billing = await onBasic();
    const first = await billing.daily.run(runContext(noonOn('2026-11-24'), [ORG]));
    const second = await billing.daily.run(runContext(noonOn('2026-11-24'), [ORG]));
    expect(first.handled).toBe(1);
    expect(second.handled).toBe(0);
    expect(told(billing)).toEqual(['due_in_7']);
    expect(billing.store().notices.map((row) => [row.kind, noticeDay(row), row.sentAt !== null])).toEqual([
      ['due_in_7', '2026-11-24', true],
    ]);
  });

  it('⚠ reads "today" in the billing zone: one instant, two days, two zones', async () => {
    // 2026-11-23T20:00Z is the 24th in Manila (04:00), and still the 23rd in London.
    const instant = new Date('2026-11-23T20:00:00.000Z');
    const manila = await onBasic();
    await manila.daily.run({ ...runContext(instant, [ORG]), schedule: { kind: 'interval', everyMinutes: 60 } });
    expect(told(manila)).toEqual(['due_in_7']);

    // The same period, its days stored as London days, as billing writes them in its own zone.
    const london = fakeBilling();
    await setPrices(london);
    await london.writes.setSettings('admin', { timeZone: 'Europe/London' });
    giveSubscription(london, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08', { timeZone: 'Europe/London' });
    await london.daily.run({ ...runContext(instant, [ORG]), schedule: { kind: 'interval', everyMinutes: 60 } });
    // The 23rd in London: 8 days before the due date, nothing yet.
    expect(told(london)).toEqual([]);
  });

  it('waits for the day’s time, and skips a run past the late limit', async () => {
    const billing = await onBasic();
    // 06:00 in Manila: before 08:00.
    const early = await billing.daily.run(runContext(new Date('2026-11-23T22:00:00.000Z'), [ORG]));
    expect(early).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    // 23:30 in Manila: more than twelve hours after 08:00.
    const late = await billing.daily.run(runContext(new Date('2026-11-24T15:30:00.000Z'), [ORG]));
    expect(late.skippedLate).toBe(1);
    expect(told(billing)).toEqual([]);
  });

  it('⚠ retries a notice whose send failed, from its row, and sends it once', async () => {
    const billing = await onBasic();
    billing.notifier.failing = true;
    await billing.daily.run(runContext(noonOn('2026-12-03'), [ORG]));
    expect(billing.store().notices.map((row) => [row.kind, row.sentAt])).toEqual([['overdue', null]]);

    billing.notifier.failing = false;
    await billing.daily.run(runContext(noonOn('2026-12-03'), [ORG]));
    expect(told(billing)).toEqual(['overdue']);
    expect(billing.notifier.told[0]?.notice).toMatchObject({ daysLeft: 5 });
    expect(billing.store().notices.every((row) => row.sentAt !== null)).toBe(true);
  });

  it('⚠ goes on past an organization whose check fails, so one never silences the rest', async () => {
    const billing = await onBasic();
    giveSubscription(billing, 'org2', 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    const read = billing.subscriptions.live.bind(billing.subscriptions);
    billing.subscriptions.live = async (organizationId, tx) => {
      if (organizationId === ORG) throw new Error('unreadable');
      return read(organizationId, tx);
    };
    const result = await billing.daily.run(runContext(noonOn('2026-11-24'), [ORG, 'org2']));
    expect(result.handled).toBe(1);
    expect(billing.notifier.told.map((one) => (one.notice as { organizationId: string }).organizationId)).toEqual([
      'org2',
    ]);
  });

  it('⚠ goes on retrying past a row whose sent mark cannot be written', async () => {
    const billing = await onBasic();
    giveSubscription(billing, 'org2', 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    billing.notifier.failing = true;
    await billing.daily.run(runContext(noonOn('2026-12-03'), [ORG, 'org2']));
    billing.notifier.failing = false;
    const update = billing.client.platformBillingNotice.update.bind(billing.client.platformBillingNotice);
    let calls = 0;
    billing.client.platformBillingNotice.update = async (args) => {
      calls += 1;
      if (calls === 1) throw new Error('database went away');
      return update(args);
    };
    await billing.daily.run(runContext(noonOn('2026-12-03'), [ORG, 'org2']));
    // Both were sent; the first could not be marked, so only the second reads as sent.
    expect(billing.notifier.told).toHaveLength(2);
    expect(billing.store().notices.map((row) => row.sentAt !== null)).toEqual([false, true]);
  });

  it('does not retry a notice too old to be true any more: the next one says the current thing', async () => {
    const billing = await onBasic();
    billing.notifier.failing = true;
    await billing.daily.run(runContext(noonOn('2026-12-03'), [ORG]));
    billing.notifier.failing = false;
    // Two days on: the 3rd's "5 days left" is stale; only the 5th's own notice goes out.
    await billing.daily.run(runContext(noonOn('2026-12-05'), [ORG]));
    expect(billing.notifier.told.map((one) => one.notice)).toEqual([expect.objectContaining({ daysLeft: 3 })]);
  });

  it('stops at its item limit and leaves the rest for the next run, which finishes them', async () => {
    const billing = await onBasic();
    giveSubscription(billing, 'org2', 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    giveSubscription(billing, 'org3', 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    const first = await billing.daily.run(runContext(noonOn('2026-11-24'), [ORG, 'org2', 'org3'], 2));
    expect(first).toMatchObject({ handled: 2, leftForNext: 1 });
    const second = await billing.daily.run(runContext(noonOn('2026-11-24'), [ORG, 'org2', 'org3'], 2));
    expect(second.handled).toBe(1);
    expect(told(billing)).toHaveLength(3);
  });

  it('says nothing about paying to an organization that cancelled, and nothing to one on a trial', async () => {
    const billing = await onBasic();
    await billing.writes.cancel(ORG, OWNER, noonOn('2026-11-20'));
    giveSubscription(billing, 'trial-org', 'basic', '2026-11-20', '2026-12-01', '2026-12-01', { trial: true });
    await billing.daily.run(runContext(noonOn('2026-11-24'), [ORG, 'trial-org']));
    expect(told(billing)).toEqual([]);
  });

  it('tells approvers once a day about requests waiting more than a day, as a count', async () => {
    const billing = await onBasic();
    await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-11-25'));
    await billing.daily.run(runContext(noonOn('2026-11-25'), []));
    expect(billing.notifier.told.filter((one) => one.what === 'approvers')).toEqual([]);

    await billing.daily.run(runContext(noonOn('2026-11-27'), []));
    await billing.daily.run(runContext(noonOn('2026-11-27'), []));
    const digests = billing.notifier.told.filter((one) => one.what === 'approvers');
    expect(digests).toHaveLength(1);
    expect(digests[0]?.notice).toMatchObject({ waiting: 1 });
  });

  it('tells nothing and writes nothing without a notifier', async () => {
    const billing = await onBasic();
    const { PlatformBillingDailyCheck } = await import('../src/server/platform-billing-daily.process.js');
    const unbound = new PlatformBillingDailyCheck(billing.client, billing.reads);
    expect(await unbound.run(runContext(noonOn('2026-11-24'), [ORG]))).toEqual({
      handled: 0,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect(billing.store().notices).toEqual([]);
  });
});

describe('request notices, after the commit', () => {
  it('tells of each step, and a failed notice never fails the write', async () => {
    const billing = fakeBilling();
    await setPrices(billing);
    const now = noonOn('2026-11-15');
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', now);
    await billing.writes.enterPayment(
      ORG,
      request.id,
      OWNER,
      { method: 'cash', amount: 100_000, paidOn: '2026-11-15' },
      now,
    );
    billing.notifier.failing = true;
    const approved = await billing.writes.approve(
      request.id,
      'approver1',
      { detailsVersion: 1, method: 'cash', amount: 100_000, paidOn: '2026-11-15' },
      now,
    );
    expect(approved.state).toBe('approved');
    expect(billing.notifier.told.map((one) => (one.notice as { step: string }).step)).toEqual([
      'submitted',
      'details_entered',
    ]);
  });
});
