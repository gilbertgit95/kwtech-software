import {
  accessWindow,
  canRequestRenewal,
  isOnTime,
  periodFrom,
  planHold,
  planRenewal,
  standingOn,
} from '../src/index.js';

/** Grace, hold and expiry (plan §4). November's period ends, and is due, on Dec 1. */
const NOVEMBER = periodFrom('2026-11-01');
const WINDOW = accessWindow(NOVEMBER.end, 7);

describe('accessUntil', () => {
  it('is the period end plus grace plus hold, with its parts kept for the screen', () => {
    expect(WINDOW).toEqual({ periodEnd: '2026-12-01', graceDays: 7, holdDays: 0, accessUntil: '2026-12-08' });
    expect(accessWindow('2026-12-01', 7, 3).accessUntil).toBe('2026-12-11');
  });

  it('refuses a negative grace or hold', () => {
    expect(() => accessWindow('2026-12-01', -1)).toThrow(RangeError);
    expect(() => accessWindow('2026-12-01', 7, 1.5)).toThrow(RangeError);
  });
});

describe('the standing of a subscription', () => {
  it.each([
    ['2026-11-20', { kind: 'active', daysToDue: 11 }],
    ['2026-11-24', { kind: 'renewal_open', daysToDue: 7 }],
    ['2026-11-30', { kind: 'renewal_open', daysToDue: 1 }],
    ['2026-12-01', { kind: 'overdue', daysLeft: 7 }],
    ['2026-12-07', { kind: 'overdue', daysLeft: 1 }],
    ['2026-12-08', { kind: 'expired', daysAgo: 0 }],
    ['2026-12-11', { kind: 'expired', daysAgo: 3 }],
  ])('on %s', (today, standing) => {
    expect(standingOn(WINDOW, today)).toEqual(standing);
  });

  it('is held past grace while a hold runs', () => {
    expect(standingOn(accessWindow('2026-12-01', 7, 7), '2026-12-10')).toEqual({ kind: 'held', daysLeft: 5 });
  });

  it('opens renewing 7 days before the due date, and keeps it open after', () => {
    expect(canRequestRenewal(WINDOW, '2026-11-23')).toBe(false);
    expect(canRequestRenewal(WINDOW, '2026-11-24')).toBe(true);
    expect(canRequestRenewal(WINDOW, '2026-12-20')).toBe(true);
  });
});

describe('the hold (D9)', () => {
  const fresh = { coveredOn: '2026-12-05', holdUsedThisPeriod: false, afterRejection: false };

  it('holds for the grace days when covering details came before grace ended', () => {
    expect(planHold(WINDOW, fresh)).toEqual({ kind: 'held', days: 7 });
  });

  it.each([
    ['details after grace', { ...fresh, coveredOn: '2026-12-08' }, 'details_after_grace'],
    ['no covering details', { ...fresh, coveredOn: null }, 'no_covering_details'],
    ['a second hold in the period', { ...fresh, holdUsedThisPeriod: true }, 'hold_used'],
    ['a request after a rejection', { ...fresh, afterRejection: true }, 'after_rejection'],
  ] as const)('gives none for %s, and says why', (_name, input, reason) => {
    expect(planHold(WINDOW, input)).toEqual({ kind: 'not_held', reason });
  });
});

describe('what a renewal’s approval does to the period (D10)', () => {
  it('⚠ before access ended, continues from the period end on the same billing day', () => {
    const plan = planRenewal({ current: NOVEMBER, window: WINDOW, approvedOn: '2026-12-04', onTime: true });
    expect(plan).toEqual({ kind: 'continue', period: { start: '2026-12-01', end: '2027-01-01', billingDay: 1 } });
  });

  it('early, too: renewing ahead loses nothing', () => {
    const plan = planRenewal({ current: NOVEMBER, window: WINDOW, approvedOn: '2026-11-25', onTime: true });
    expect(plan.period.start).toBe('2026-12-01');
  });

  it('after access ended but on time, starts at approval with no access line: the delay was ours', () => {
    const plan = planRenewal({ current: NOVEMBER, window: WINDOW, approvedOn: '2026-12-10', onTime: true });
    expect(plan).toEqual({
      kind: 'restart_on_time',
      period: { start: '2026-12-10', end: '2027-01-10', billingDay: 10 },
    });
  });

  it('after access ended and late, starts at approval and charged the access used', () => {
    const plan = planRenewal({ current: NOVEMBER, window: WINDOW, approvedOn: '2026-12-10', onTime: false });
    expect(plan).toMatchObject({ kind: 'restart_late', accessUsedDays: 7 });
  });

  it('on time means covering details before access ended', () => {
    expect(isOnTime('2026-12-07', WINDOW)).toBe(true);
    expect(isOnTime('2026-12-08', WINDOW)).toBe(false);
    expect(isOnTime(null, WINDOW)).toBe(false);
  });
});
