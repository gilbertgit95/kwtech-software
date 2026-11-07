import { checkFeature, denialReason } from '../src/check.js';
import { assertPlanExemptFeatures, composeContext } from '../src/domain/grants.js';
import { partitionSubscriptions, unbilledAccessUntil } from '../src/domain/subscription-access.js';

/**
 * #92: `accessUntil` decides entitlement, an expiry says so, and the billing
 * keys alone work without a plan. Pure, so the rules are pinned without a
 * database; the service tests check the wiring.
 */
const NOW = new Date('2026-12-10T00:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const daysAhead = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe('partitionSubscriptions', () => {
  it('entitles a row with no end, or an end still ahead, and excludes the instant itself', () => {
    const rows = [
      { id: 'open', workspaceId: null, accessUntil: null },
      { id: 'ahead', workspaceId: null, accessUntil: daysAhead(1) },
      { id: 'now', workspaceId: null, accessUntil: NOW },
    ];
    expect(partitionSubscriptions(rows, NOW).entitling.map((row) => row.id)).toEqual(['open', 'ahead']);
  });

  it('⚠ names when the latest organization-wide row ended, once nothing organization-wide replaced it', () => {
    const rows = [
      { workspaceId: null, accessUntil: daysAgo(9) },
      { workspaceId: null, accessUntil: daysAgo(2) },
      { workspaceId: 'ws1', accessUntil: daysAhead(5) },
    ];
    expect(partitionSubscriptions(rows, NOW)).toMatchObject({ needsFallback: true, endedAt: daysAgo(2).toISOString() });
  });

  it('is not expired while an organization-wide row is in force, nor for one that never subscribed', () => {
    expect(
      partitionSubscriptions(
        [
          { workspaceId: null, accessUntil: daysAgo(2) },
          { workspaceId: null, accessUntil: daysAhead(20) },
        ],
        NOW,
      ),
    ).toMatchObject({ needsFallback: false, endedAt: null });
    expect(partitionSubscriptions([], NOW)).toMatchObject({ needsFallback: true, endedAt: null });
  });

  it('gives a period end written outside billing 7 days of grace, and none to no end', () => {
    expect(unbilledAccessUntil(NOW)?.toISOString()).toBe(daysAhead(7).toISOString());
    expect(unbilledAccessUntil(null)).toBeNull();
  });
});

describe('the billing exemption (D13)', () => {
  const registry = [
    { key: 'platform-billing:read', level: 'organization' },
    { key: 'pos:sell', level: 'workspace' },
    { key: 'platform-billing:approve', level: 'app' },
  ];

  it('accepts organization keys only, and names the one it refuses', () => {
    expect(() => assertPlanExemptFeatures(['platform-billing:read'], registry)).not.toThrow();
    expect(() => assertPlanExemptFeatures(['pos:sell'], registry)).toThrow(/pos:sell.*workspace/u);
    expect(() => assertPlanExemptFeatures(['platform-billing:approve'], registry)).toThrow(/app/u);
    expect(() => assertPlanExemptFeatures(['platform-billing:typo'], registry)).toThrow(/no module declares/u);
  });

  it('⚠ skips the plan filter for an exempt key a role grants, and for nothing else', () => {
    const ctx = composeContext({
      subjectId: 'u1',
      organizationId: 'org1',
      roles: [
        {
          roleKey: 'owner',
          level: 'organization',
          workspaceId: null,
          features: ['platform-billing:read', 'members:read'],
        },
      ],
      plans: [],
      planExemptFeatures: ['platform-billing:read', 'platform-billing:renew'],
    });
    expect(ctx.effective).toEqual(['platform-billing:read']);
  });
});

describe('the expired reason', () => {
  const expired = composeContext({
    subjectId: 'u1',
    organizationId: 'org1',
    roles: [{ roleKey: 'owner', level: 'organization', workspaceId: null, features: ['members:read'] }],
    plans: [],
    subscriptionEndedAt: '2026-12-08T00:00:00.000Z',
  });

  it('⚠ says subscription_expired, not not_entitled, when a granted key fell to an ended plan', () => {
    expect(expired.subscriptionEndedAt).toBe('2026-12-08T00:00:00.000Z');
    expect(checkFeature(expired, 'members:read')).toEqual({ allowed: false, reason: 'subscription_expired' });
  });

  it('still says not_granted first: an expiry is not a reason to tell a member to renew', () => {
    expect(checkFeature(expired, 'roles:manage')).toEqual({ allowed: false, reason: 'not_granted' });
    expect(denialReason(expired, ['roles:manage', 'members:read'])).toBe('not_granted');
  });

  it('says not_entitled for an organization that never had the plan', () => {
    const never = { ...expired, subscriptionEndedAt: null };
    expect(checkFeature(never, 'members:read')).toEqual({ allowed: false, reason: 'not_entitled' });
  });
});
