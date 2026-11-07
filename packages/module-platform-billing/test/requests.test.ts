import {
  allowedActions,
  checkApproval,
  checkNewRequest,
  checkVoid,
  type NewRequestInput,
  nextState,
  type RequestStanding,
} from '../src/index.js';

/** The request state machine and the checks each step runs (plan §4). */
describe('the request state machine', () => {
  it('moves only a pending request; voids only an approved one', () => {
    expect(allowedActions('pending')).toEqual(['edit_details', 'approve', 'reject', 'withdraw', 'close_as_credit']);
    expect(allowedActions('approved')).toEqual(['void']);
    for (const state of ['rejected', 'withdrawn', 'voided', 'closed_as_credit'] as const) {
      expect(allowedActions(state)).toEqual([]);
    }
  });

  it('steps, or names the refusal', () => {
    expect(nextState('pending', 'approve')).toEqual({ state: 'approved' });
    expect(nextState('pending', 'close_as_credit')).toEqual({ state: 'closed_as_credit' });
    expect(nextState('approved', 'void')).toEqual({ state: 'voided' });
    expect(nextState('approved', 'approve')).toEqual({ refused: 'not_pending' });
    expect(nextState('pending', 'void')).toEqual({ refused: 'invalid' });
  });
});

const ACTIVE: RequestStanding = {
  hasPaidSubscription: true,
  overdueOrExpired: false,
  currentPlanArchived: false,
  renewalOpen: false,
  hasPendingRequest: false,
};
const PRO = { key: 'pro', isPublic: true, archived: false };

function request(overrides: Partial<NewRequestInput>): NewRequestInput {
  return {
    kind: 'change_plan',
    actorIsOwner: true,
    standing: ACTIVE,
    currentPlanKey: 'starter',
    plan: PRO,
    overCaps: 0,
    ...overrides,
  };
}

describe('a new request', () => {
  it('lets the owner change plan while active', () => {
    expect(checkNewRequest(request({}))).toBeNull();
  });

  it('⚠ refuses an admin anything but renewing (D8)', () => {
    for (const kind of ['subscribe', 'change_plan', 'replace', 'cancel'] as const) {
      expect(checkNewRequest(request({ kind, actorIsOwner: false }))).toBe('owner_only');
    }
    expect(
      checkNewRequest(request({ kind: 'renew', actorIsOwner: false, standing: { ...ACTIVE, renewalOpen: true } })),
    ).toBeNull();
  });

  it('refuses a second pending request', () => {
    expect(checkNewRequest(request({ standing: { ...ACTIVE, hasPendingRequest: true } }))).toBe(
      'pending_request_exists',
    );
  });

  it('opens renewing 7 days before the due date', () => {
    expect(checkNewRequest(request({ kind: 'renew' }))).toBe('renewal_not_open');
    expect(checkNewRequest(request({ kind: 'renew', standing: { ...ACTIVE, renewalOpen: true } }))).toBeNull();
    expect(checkNewRequest(request({ kind: 'renew', standing: { ...ACTIVE, overdueOrExpired: true } }))).toBeNull();
  });

  it('refuses a plan change while overdue: renew first (loophole 4)', () => {
    expect(checkNewRequest(request({ standing: { ...ACTIVE, overdueOrExpired: true } }))).toBe('renew_first');
  });

  it('refuses the plan you already have', () => {
    expect(checkNewRequest(request({ plan: { ...PRO, key: 'starter' } }))).toBe('same_plan');
  });

  it('⚠ refuses a downgrade while over the new plan’s caps (D6)', () => {
    expect(checkNewRequest(request({ overCaps: 2 }))).toBe('over_new_plan_caps');
  });

  it('refuses a plan withdrawn from sale to someone new, and renews it for those on it', () => {
    const custom = { key: 'enterprise', isPublic: false, archived: false };
    expect(checkNewRequest(request({ plan: custom }))).toBe('plan_not_offered');
    expect(
      checkNewRequest(
        request({ kind: 'renew', currentPlanKey: 'enterprise', standing: { ...ACTIVE, renewalOpen: true } }),
      ),
    ).toBeNull();
  });

  it('⚠ refuses renewing an archived plan, and offers a replacement at any standing', () => {
    const archived = { ...ACTIVE, currentPlanArchived: true, renewalOpen: true };
    expect(checkNewRequest(request({ kind: 'renew', standing: archived }))).toBe('plan_archived');
    expect(checkNewRequest(request({ kind: 'change_plan', standing: archived }))).toBe('plan_archived');
    expect(checkNewRequest(request({ kind: 'replace', standing: { ...archived, overdueOrExpired: true } }))).toBeNull();
    expect(checkNewRequest(request({ kind: 'replace' }))).toBe('invalid');
  });

  it('refuses to subscribe to an archived plan', () => {
    const none = { ...ACTIVE, hasPaidSubscription: false };
    expect(checkNewRequest(request({ kind: 'subscribe', standing: none, plan: { ...PRO, archived: true } }))).toBe(
      'plan_archived',
    );
    expect(checkNewRequest(request({ kind: 'subscribe', standing: none }))).toBeNull();
  });

  it('refuses renewing, changing or cancelling with no paid plan', () => {
    const none = { ...ACTIVE, hasPaidSubscription: false };
    for (const kind of ['renew', 'change_plan', 'cancel'] as const) {
      expect(checkNewRequest(request({ kind, standing: none }))).toBe('no_subscription');
    }
  });
});

describe('approval', () => {
  const ok = {
    state: 'pending',
    detailsVersionSeen: 2,
    detailsVersion: 2,
    received: 25_000,
    total: 25_000,
    planArchived: false,
  } as const;

  it('approves a pending request paid in full', () => {
    expect(checkApproval(ok)).toBeNull();
    expect(checkApproval({ ...ok, received: 30_000 })).toBeNull();
  });

  it.each([
    ['a decided request', { state: 'approved' }, 'not_pending'],
    ['details changed while reviewing', { detailsVersion: 3 }, 'details_changed'],
    ['a short payment (D7)', { received: 24_999 }, 'payment_short'],
    ['a plan archived meanwhile', { planArchived: true }, 'plan_archived'],
    [
      'a change priced for an ended period',
      { pricedForPeriodEnd: '2026-12-01', currentPeriodEnd: '2027-01-01' },
      'quote_expired',
    ],
  ] as const)('refuses %s', (_name, overrides, reason) => {
    expect(checkApproval({ ...ok, ...overrides })).toBe(reason);
  });
});

describe('voiding', () => {
  const period = [
    { requestId: 'a-to-b', approvedAt: '2026-11-05T02:00:00Z' },
    { requestId: 'b-to-c', approvedAt: '2026-11-20T02:00:00Z' },
  ];

  it('⚠ voids only the latest approved request of a period, newest first', () => {
    expect(checkVoid('b-to-c', period)).toBeNull();
    expect(checkVoid('a-to-b', period)).toBe('void_not_latest');
    expect(checkVoid('a-to-b', period.slice(0, 1))).toBeNull();
    expect(checkVoid('elsewhere', period)).toBe('not_found');
  });
});
