import { notGrantedText, type RoleHolderCandidate, rolesHoldingFeature } from '../src/domain/role-holders.js';

/**
 * Which roles a `not_granted` refusal names, and the sentence it says (#99).
 * The app's seed test runs the same function against the seeded roles; these
 * pin the rule itself on small literals.
 */
const ROLES: RoleHolderCandidate[] = [
  {
    key: 'workspace-admin',
    label: 'Workspace admin',
    level: 'workspace',
    description: 'Runs the shop.',
    features: ['pos:refund', 'pos:sell', 'pos:settings'],
  },
  {
    key: 'workspace-supervisor',
    label: 'Supervisor',
    level: 'workspace',
    description: 'The shift lead.',
    features: ['pos:refund', 'pos:sell'],
  },
  { key: 'workspace-user', label: 'Staff', level: 'workspace', features: ['pos:sell'] },
  // Holds the key through the organization; levels reach downward.
  {
    key: 'organization-owner',
    label: 'Organization owner',
    level: 'organization',
    features: ['pos:refund', 'org:rename'],
  },
];

describe('rolesHoldingFeature', () => {
  it('names the roles at the feature’s level that hold it, fewest rights first', () => {
    expect(rolesHoldingFeature(ROLES, 'pos:refund', 'workspace').map((role) => role.label)).toEqual([
      'Supervisor',
      'Workspace admin',
    ]);
  });

  it('leaves out an organization role that holds a workspace key, since nobody in the shop can give it', () => {
    expect(rolesHoldingFeature(ROLES, 'pos:refund', 'workspace').map((role) => role.key)).not.toContain(
      'organization-owner',
    );
  });

  it('names organization roles for an organization key', () => {
    expect(rolesHoldingFeature(ROLES, 'org:rename', 'organization').map((role) => role.key)).toEqual([
      'organization-owner',
    ]);
  });

  it('names nobody for an app-level key', () => {
    const appRole: RoleHolderCandidate = { key: 'super-admin', label: 'Super admin', level: 'app', features: ['x'] };
    expect(rolesHoldingFeature([appRole], 'x', 'app')).toEqual([]);
  });

  it('carries the description, null when a role has none', () => {
    const holders = rolesHoldingFeature(ROLES, 'pos:sell', 'workspace');
    expect(holders.find((role) => role.key === 'workspace-supervisor')?.description).toBe('The shift lead.');
    expect(holders.find((role) => role.key === 'workspace-user')?.description).toBeNull();
  });
});

describe('notGrantedText', () => {
  it('names the roles and who to ask, for a workspace key', () => {
    expect(
      notGrantedText({
        featureLabel: 'Refund and void',
        featureLevel: 'workspace',
        holders: rolesHoldingFeature(ROLES, 'pos:refund', 'workspace'),
      }),
    ).toBe('“Refund and void” needs the Supervisor or Workspace admin role. Ask a workspace admin to give you one.');
  });

  it('lists three roles with commas, and sends an organization key to the owner or an admin', () => {
    const holders = ['A', 'B', 'C'].map((label) => ({
      key: label,
      label,
      level: 'organization' as const,
      description: null,
    }));
    expect(notGrantedText({ featureLabel: 'Rename', featureLevel: 'organization', holders })).toBe(
      "“Rename” needs the A, B or C role. Ask the organization's owner or an admin to give you one.",
    );
  });

  it('says nothing when no role holds it, so the general sentence stands', () => {
    expect(notGrantedText({ featureLabel: 'Anything', featureLevel: 'workspace', holders: [] })).toBeNull();
  });
});
