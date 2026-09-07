import {
  EMPTY_SUBSCRIPTION_DRAFT,
  type SubscriptionDraft,
  subscriptionPeriodEnd,
  subscriptionPeriodField,
  validateSubscriptionDraft,
} from '../src/domain/subscription-draft.js';
import { SUBSCRIPTION_STATUSES, toSubscriptionStatus } from '../src/types.js';

function draft(overrides: Partial<SubscriptionDraft> = {}): SubscriptionDraft {
  return { ...EMPTY_SUBSCRIPTION_DRAFT, organizationId: 'org-1', planKey: 'team', ...overrides };
}

describe('subscription status', () => {
  it('validates rather than casts, so a bad row fails loudly instead of entitling nothing', () => {
    expect(toSubscriptionStatus('active')).toBe('active');
    expect(() => toSubscriptionStatus('Active')).toThrow(/Unknown subscription status/);
  });

  /**
   * `past_due` and `canceled` are deliberately not one value: "your payment
   * bounced" and "you cancelled" need different messages and lead to different
   * actions.
   */
  it('keeps past_due and canceled apart', () => {
    expect(SUBSCRIPTION_STATUSES).toEqual(['active', 'past_due', 'canceled']);
  });
});

describe('validateSubscriptionDraft', () => {
  it('accepts a well-formed draft', () => {
    expect(validateSubscriptionDraft(draft())).toEqual({});
  });

  it('requires an organization and a plan', () => {
    const errors = validateSubscriptionDraft(draft({ organizationId: '', planKey: '' }));
    expect(errors.organizationId).toBeDefined();
    expect(errors.planKey).toBeDefined();
  });

  /**
   * The default is `past_due`, NOT `active`. Starting a subscription changes
   * entitlement for a whole tenant, and defaulting to the value that switches
   * features on would make that the outcome of not reading the form.
   */
  it('starts nothing entitling by default', () => {
    expect(EMPTY_SUBSCRIPTION_DRAFT.status).toBe('past_due');
  });

  /**
   * An empty string is not null, and the difference is the whole meaning of the
   * field: coercing a half-filled picker to null would silently widen a
   * workspace subscription into an organization-wide one.
   */
  it('refuses an empty workspace id rather than reading it as organization-wide', () => {
    expect(validateSubscriptionDraft(draft({ workspaceId: '' })).workspaceId).toBeDefined();
    expect(validateSubscriptionDraft(draft({ workspaceId: null })).workspaceId).toBeUndefined();
  });

  /**
   * A workspace id from another tenant paired with this organization is a
   * well-formed row that would entitle one customer's workspace off another
   * customer's plan. The list handed in is the CHOSEN organization's.
   */
  it('refuses a workspace that is not in the chosen organization', () => {
    const errors = validateSubscriptionDraft(draft({ workspaceId: 'ws-other' }), {
      organizationIds: ['org-1'],
      workspaceIds: ['ws-1'],
    });
    expect(errors.workspaceId).toMatch(/not in this organization/);
  });

  it('refuses a plan that does not exist or is archived', () => {
    expect(validateSubscriptionDraft(draft(), { planKeys: ['free'] }).planKey).toMatch(/does not exist/);
  });

  it('refuses an unknown status', () => {
    expect(validateSubscriptionDraft(draft({ status: 'Active' })).status).toMatch(/Status must be one of/);
  });

  it('accepts a blank renewal date, refuses a malformed one', () => {
    expect(validateSubscriptionDraft(draft({ currentPeriodEnd: '' })).currentPeriodEnd).toBeUndefined();
    expect(validateSubscriptionDraft(draft({ currentPeriodEnd: '2026-03-01' })).currentPeriodEnd).toBeUndefined();
    expect(validateSubscriptionDraft(draft({ currentPeriodEnd: '01/03/2026' })).currentPeriodEnd).toBeDefined();
    // Right shape, not a real date.
    expect(validateSubscriptionDraft(draft({ currentPeriodEnd: '2026-02-31' })).currentPeriodEnd).toBeDefined();
  });
});

describe('the renewal date', () => {
  /**
   * Parsed as UTC midnight. Local midnight would shift the recorded date by a
   * day for anyone west of Greenwich, which is how a renewal lands in the wrong
   * month.
   */
  it('parses to UTC midnight, and round-trips', () => {
    const parsed = subscriptionPeriodEnd('2026-03-01');
    expect(parsed?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(subscriptionPeriodField(parsed)).toBe('2026-03-01');
  });

  it('treats blank as no date rather than as an invalid one', () => {
    expect(subscriptionPeriodEnd('')).toBeNull();
    expect(subscriptionPeriodEnd('   ')).toBeNull();
    expect(subscriptionPeriodField(null)).toBe('');
  });
});
