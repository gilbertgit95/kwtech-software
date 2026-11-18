import { POS_FEATURE } from '@kwtech/module-basic-pos';
import { FEATURE, notGrantedText, ROLE_DESCRIPTION_MAX, rolesHoldingFeature } from '@kwtech/module-permissions';
import { APP_ROLES } from '../src/seed/app-roles.js';
import { ALL_FEATURES } from '../src/seed/registry.js';

/**
 * Roles describe themselves, and a refusal names the role that allows it (#99).
 *
 * The holder lists below run `rolesHoldingFeature` — the same function the API
 * runs on `perm_role` — against the seeded definitions, so a preset or tier
 * change that moves a key between roles changes what the refusal tells people,
 * and fails here by name rather than quietly.
 */

const labelOf = (key: string): string => ALL_FEATURES.find((spec) => spec.key === key)?.label ?? key;
const levelOf = (key: string) => {
  const spec = ALL_FEATURES.find((one) => one.key === key);
  if (!spec) throw new Error(`'${key}' is not in the composed registry`);
  return spec.level;
};
const holders = (key: string) => rolesHoldingFeature(APP_ROLES, key, levelOf(key)).map((role) => role.key);

describe('every seeded role describes itself', () => {
  it.each(APP_ROLES.map((role) => [role.key, role.description]))('%s has a one-line description', (_key, text) => {
    expect(text?.trim()).toBeTruthy();
    expect(text?.length ?? 0).toBeLessThanOrEqual(ROLE_DESCRIPTION_MAX);
  });
});

describe('the roles a refusal names for a key are the seeded ones that hold it', () => {
  it('a refund names the Supervisor, then the Workspace admin', () => {
    expect(holders(POS_FEATURE.refund)).toEqual(['workspace-supervisor', 'workspace-admin']);
  });

  it('taking payment names all three workspace tiers, Staff first', () => {
    expect(holders(POS_FEATURE.takePayment)).toEqual(['workspace-user', 'workspace-supervisor', 'workspace-admin']);
  });

  it('inviting a member names the organization admin, then the owner', () => {
    expect(holders(FEATURE.membersInvite)).toEqual(['organization-admin', 'organization-owner']);
  });

  it('an app-level key names nobody, so the refusal keeps its general sentence', () => {
    expect(holders(FEATURE.featuresRead)).toEqual([]);
  });

  it('says it in a sentence a cashier can act on', () => {
    expect(
      notGrantedText({
        featureLabel: labelOf(POS_FEATURE.refund),
        featureLevel: 'workspace',
        holders: rolesHoldingFeature(APP_ROLES, POS_FEATURE.refund, 'workspace'),
      }),
    ).toBe('“Refund and void” needs the Supervisor or Workspace admin role. Ask a workspace admin to give you one.');
  });
});
