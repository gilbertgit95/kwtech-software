import {
  accessWindow,
  approvalLagCredit,
  checkApproval,
  checkNewRequest,
  checkVoid,
  periodFrom,
  planHold,
  planRenewal,
  prorate,
  quotePlanChange,
  quoteRenewal,
} from '../src/index.js';

/**
 * The #88 review's loopholes that are rules, one case each, by number, so a
 * change that reopens one fails here under its name (#91).
 *
 * Not here, because they are not pure rules: 1 (billing keys without a plan,
 * module-permissions, phase 3), 2 (renewal on the same row, phase 3), 5
 * (`accessUntil` on the row, phase 3), 6 (gap-free numbering, phase 4), 13
 * (trial per account, phase 4, §12.130), 14 (reminders, phase 5b), 15
 * (settings locks, phase 4).
 */
const BASIC = 100_000;
const PRO = 150_000;
const NOVEMBER = periodFrom('2026-11-01');
const WINDOW = accessWindow(NOVEMBER.end, 7);

describe('the #88 review’s loopholes', () => {
  it('3: a month paid ahead becomes credit on a plan change, never lost', () => {
    const quote = quotePlanChange({
      oldMonthly: BASIC,
      newMonthly: PRO,
      period: NOVEMBER,
      day: '2026-11-26',
      creditBalance: 0,
      prepaidMonth: BASIC,
    });
    expect(quote.lines).toContainEqual({ kind: 'prepaid_month', amount: -BASIC });
  });

  it('4: no plan change while overdue', () => {
    const standing = {
      hasPaidSubscription: true,
      overdueOrExpired: true,
      currentPlanArchived: false,
      renewalOpen: true,
      hasPendingRequest: false,
      cancelled: false,
    };
    const plan = { key: 'pro', isPublic: true, archived: false };
    expect(
      checkNewRequest({
        kind: 'change_plan',
        actorIsOwner: true,
        standing,
        currentPlanKey: 'starter',
        plan,
        overCaps: 0,
      }),
    ).toBe('renew_first');
  });

  it('7: a short payment cannot be approved', () => {
    expect(
      checkApproval({
        state: 'pending',
        detailsVersionSeen: 1,
        detailsVersion: 1,
        received: 90_000,
        total: 100_000,
        planArchived: false,
      }),
    ).toBe('payment_short');
  });

  it('8: a negative balance after a void is owed on the next bill', () => {
    expect(quoteRenewal(BASIC, -25_000).lines).toContainEqual({ kind: 'owed', amount: 25_000 });
  });

  it('8: an earlier change of a period cannot be voided over a later one', () => {
    expect(
      checkVoid('first', [
        { requestId: 'first', approvedAt: '2026-11-02T00:00:00Z' },
        { requestId: 'second', approvedAt: '2026-11-09T00:00:00Z' },
      ]),
    ).toBe('void_not_latest');
  });

  it('9: letting it lapse every month gains nothing: a late renewal pays for the access used', () => {
    const plan = planRenewal({ current: NOVEMBER, window: WINDOW, approvedOn: '2026-12-09', onTime: false });
    expect(plan).toMatchObject({ kind: 'restart_late', accessUsedDays: 7 });
    const days = plan.kind === 'restart_late' ? plan.accessUsedDays : 0;
    const quote = quoteRenewal(BASIC, 0, { days, oldMonthly: BASIC, oldPeriod: NOVEMBER });
    expect(quote.total).toBe(BASIC + prorate(BASIC, 7, 30));
  });

  it('10: fake details after a rejection buy no extra days, and a hold comes once per period', () => {
    const input = { coveredOn: '2026-12-03', holdUsedThisPeriod: false, afterRejection: true };
    expect(planHold(WINDOW, input)).toEqual({ kind: 'not_held', reason: 'after_rejection' });
    expect(planHold(WINDOW, { ...input, afterRejection: false, holdUsedThisPeriod: true })).toEqual({
      kind: 'not_held',
      reason: 'hold_used',
    });
  });

  it('11: a slow downgrade earns no credit for days the old plan was used', () => {
    // Priced at approval (day 20 → 11 days left), not at submission (day 1 → 30 days).
    const atApproval = quotePlanChange({
      oldMonthly: PRO,
      newMonthly: BASIC,
      period: NOVEMBER,
      day: '2026-11-20',
      creditBalance: 0,
    });
    expect(atApproval.creditAdded).toBe(prorate(PRO, 11, 30) - prorate(BASIC, 11, 30));
    expect(
      approvalLagCredit({ oldMonthly: PRO, newMonthly: BASIC, period: NOVEMBER }, '2026-11-01', '2026-11-20'),
    ).toBe(0);
  });

  it('12: upgrade, add, downgrade and keep it all is refused', () => {
    const standing = {
      hasPaidSubscription: true,
      overdueOrExpired: false,
      currentPlanArchived: false,
      renewalOpen: false,
      hasPendingRequest: false,
      cancelled: false,
    };
    const plan = { key: 'starter', isPublic: true, archived: false };
    expect(
      checkNewRequest({ kind: 'change_plan', actorIsOwner: true, standing, currentPlanKey: 'pro', plan, overCaps: 1 }),
    ).toBe('over_new_plan_caps');
  });
});
