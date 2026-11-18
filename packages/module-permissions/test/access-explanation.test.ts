import { accessReasonText, explainAccess } from '../src/domain/access-explanation.js';
import type { ComposeInput, RoleGrant } from '../src/domain/grants.js';
import type { RoleHolderCandidate } from '../src/domain/role-holders.js';
import type { FeatureSpec } from '../src/types.js';

/**
 * One person's access, explained (#173). The verdicts come from
 * `composeContext`, so these pin the explanation around it: which keys are
 * listed, which roles are named, and the sentence.
 */
const spec = (key: string, level: FeatureSpec['level'], module = key.split(':')[0] ?? key): FeatureSpec => ({
  key,
  module,
  level,
  label: key,
  description: `${key}.`,
});

const SPECS: FeatureSpec[] = [
  spec('pos:refund', 'workspace'),
  spec('pos:sell', 'workspace'),
  spec('stock:read', 'workspace'),
  spec('members:invite', 'organization'),
  spec('billing:renew', 'organization'),
  spec('users:read', 'app'),
];

const supervisor: RoleGrant = {
  roleKey: 'workspace-supervisor',
  label: 'Supervisor',
  level: 'workspace',
  workspaceId: 'w1',
  features: ['pos:refund', 'pos:sell', 'stock:read'],
};
const orgUser: RoleGrant = {
  roleKey: 'organization-user',
  label: 'Member',
  level: 'organization',
  workspaceId: null,
  features: [],
};

const SEEDED: RoleHolderCandidate[] = [
  { key: 'organization-admin', label: 'Organization admin', level: 'organization', features: ['members:invite'] },
  { key: 'workspace-supervisor', label: 'Supervisor', level: 'workspace', features: ['pos:refund'] },
];

const PLANS = [
  { label: 'Basic', features: ['pos:refund', 'pos:sell'] },
  { label: 'Pro', features: ['pos:refund', 'pos:sell', 'stock:read'] },
];

const compose = (overrides: Partial<ComposeInput> = {}): ComposeInput => ({
  subjectId: 'u1',
  organizationId: 'o1',
  workspaceId: 'w1',
  workspaceIds: ['w1'],
  roles: [orgUser, supervisor],
  plans: [{ planKey: 'basic', workspaceId: null, features: ['pos:refund', 'pos:sell'] }],
  ...overrides,
});

const explain = (overrides: Partial<ComposeInput> = {}) =>
  explainAccess({ compose: compose(overrides), specs: SPECS, plans: PLANS, roles: SEEDED });
const line = (lines: ReturnType<typeof explain>, key: string) => {
  const found = lines.find((one) => one.key === key);
  if (!found) throw new Error(`no line for ${key}`);
  return found;
};

describe('explainAccess', () => {
  it('lists organization and workspace keys in a workspace, never app keys', () => {
    expect(
      explain()
        .map((one) => one.key)
        .sort(),
    ).toEqual(['billing:renew', 'members:invite', 'pos:refund', 'pos:sell', 'stock:read']);
  });

  it('lists only organization keys at organization level', () => {
    expect(explain({ workspaceId: null }).map((one) => one.level)).toEqual(['organization', 'organization']);
  });

  it('names the role behind a grant', () => {
    expect(line(explain(), 'pos:refund')).toMatchObject({ verdict: 'granted', grantedBy: ['Supervisor'] });
  });

  it('says the plan filtered a key the role includes, and which plans have it', () => {
    expect(line(explain(), 'stock:read')).toMatchObject({
      verdict: 'not_entitled',
      grantedBy: ['Supervisor'],
      inPlans: ['Pro'],
    });
  });

  it('names the seeded roles that would allow a missing key', () => {
    const invite = line(explain(), 'members:invite');
    expect(invite.verdict).toBe('not_granted');
    expect(invite.grantedBy).toEqual([]);
    expect(invite.holders.map((role) => role.label)).toEqual(['Organization admin']);
  });

  it('does not count a workspace role from another workspace', () => {
    expect(line(explain({ roles: [{ ...supervisor, workspaceId: 'w2' }] }), 'pos:refund').verdict).toBe('not_granted');
  });

  it('marks a platform role, which skips the plan', () => {
    const staff: RoleGrant = {
      roleKey: 'super-admin',
      label: 'Super admin',
      level: 'app',
      workspaceId: null,
      features: ['stock:read'],
    };
    expect(line(explain({ roles: [staff] }), 'stock:read')).toMatchObject({
      verdict: 'granted',
      viaPlatformRole: true,
      grantedBy: ['Super admin'],
    });
  });

  it('treats a key the plan need not include as granted', () => {
    const owner: RoleGrant = { ...orgUser, features: ['billing:renew'] };
    const lines = explainAccess({
      compose: compose({ roles: [owner], plans: [], planExemptFeatures: ['billing:renew'] }),
      specs: SPECS,
      plans: PLANS,
      roles: SEEDED,
    });
    expect(line(lines, 'billing:renew').verdict).toBe('granted');
  });
});

describe('accessReasonText', () => {
  const lines = explain();

  it('says which role includes it', () => {
    expect(accessReasonText(line(lines, 'pos:refund'))).toBe('Their Supervisor role includes it.');
    expect(accessReasonText(line(lines, 'pos:refund'), 'self')).toBe('Your Supervisor role includes it.');
  });

  it('says the plan is missing it, and where it is', () => {
    expect(accessReasonText(line(lines, 'stock:read'))).toBe(
      "Their Supervisor role includes it, but the organization's plan does not. It is in Pro.",
    );
  });

  it('says which role would allow it', () => {
    expect(accessReasonText(line(lines, 'members:invite'))).toBe(
      'None of their roles includes it. The Organization admin role does.',
    );
  });

  it('says so when nothing would allow it', () => {
    expect(accessReasonText(line(lines, 'billing:renew'), 'self')).toBe(
      'None of your roles includes it. No seeded role does either.',
    );
  });

  it('joins two roles with "and"', () => {
    expect(accessReasonText({ ...line(lines, 'pos:refund'), grantedBy: ['Staff', 'Supervisor'] })).toBe(
      'Their Staff and Supervisor roles include it.',
    );
  });
});
