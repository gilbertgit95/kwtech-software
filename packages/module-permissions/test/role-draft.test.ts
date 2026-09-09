import { cloneFeatures, EMPTY_ROLE_DRAFT, type RoleDraft, validateRoleDraft } from '../src/domain/role-draft.js';
import { canRoleGrant } from '../src/domain/roles.js';
import { FEATURE, FEATURE_REGISTRY } from '../src/feature-keys.js';

const draft = (over: Partial<RoleDraft> = {}): RoleDraft => ({
  ...EMPTY_ROLE_DRAFT,
  key: 'support-agent',
  label: 'Support agent',
  level: 'organization',
  ...over,
});

/** Everything the registry holds, i.e. the actor is a super admin. */
const ALL = FEATURE_REGISTRY.map((spec) => spec.key);
const base = { registry: FEATURE_REGISTRY, actorFeatures: ALL, actorMayWriteAppRoles: true };

describe('validateRoleDraft', () => {
  it('accepts a well-formed organization role', () => {
    expect(validateRoleDraft(draft({ features: [FEATURE.membersRead] }), base)).toEqual({});
  });

  it('refuses a key that is not kebab-case', () => {
    // Deliberately NOT the feature-key pattern: a role is a name, a feature is
    // a verb on a noun, and letting a role be called `billing:manage` makes the
    // two indistinguishable in the log line where they appear side by side.
    expect(validateRoleDraft(draft({ key: 'subscriptions:read' }), base).key).toMatch(/lower-case words/);
  });

  it('refuses a duplicate key in the same scope, which the DATABASE cannot', () => {
    // @@unique([organizationId, key]) does not constrain rows where
    // organizationId is null, because Postgres treats NULLs as distinct. See
    // PLAN §12.19 — this check is what stands in for the index Prisma cannot
    // express.
    const errors = validateRoleDraft(draft({ key: 'taken' }), { ...base, existingKeys: ['taken'] });
    expect(errors.key).toContain('already used');
  });

  it('lets an edit keep its own key', () => {
    const errors = validateRoleDraft(draft({ key: 'taken' }), {
      ...base,
      existingKeys: ['taken'],
      originalKey: 'taken',
    });
    expect(errors.key).toBeUndefined();
  });

  it('needs no organization at any level — every role is a shared preset', () => {
    /*
     * What scopes a role is its LEVEL, not an owner. An organization-level role
     * applies inside whichever organization it is granted in; naming an owner
     * as well would answer the same question twice, and the two answers can
     * disagree — which is the cross-tenant grant assertRoleAssignable refuses.
     */
    for (const level of ['app', 'organization', 'workspace']) {
      expect(validateRoleDraft(draft({ level }), base)).toEqual({});
    }
  });

  it('refuses an app-level role from someone without roles:manage_app', () => {
    /*
     * The escalation the LEVEL rule does not close. An app role applies in every
     * organization and skips the subscription filter, so an organization admin
     * minting one carries their own tenant's rights across every tenant.
     */
    const errors = validateRoleDraft(draft({ level: 'app' }), {
      ...base,
      actorMayWriteAppRoles: false,
    });
    expect(errors.level).toMatch(/may not create or change app-level roles/);
  });

  it('refuses a feature the registry does not know', () => {
    expect(validateRoleDraft(draft({ features: ['made:up'] }), base).features).toContain('not in the registry');
  });

  it('refuses an app-level feature inside an organization role', () => {
    const errors = validateRoleDraft(draft({ features: [FEATURE.featuresCreate] }), base);
    expect(errors.features).toContain('broader than a organization-level role may grant');
  });

  it('allows an app-level role to collect any level', () => {
    // The exemption assertRoleFeatureLevels already makes: an app role hangs off
    // no membership, so there is no lesser right to escalate FROM.
    const errors = validateRoleDraft(
      draft({ level: 'app', features: [FEATURE.membersRead, FEATURE.featuresCreate] }),
      base,
    );
    expect(errors.features).toBeUndefined();
  });

  it('REFUSES A FEATURE THE ACTOR DOES NOT HOLD', () => {
    /*
     * No escalation: you may not put a right into a role that you do not hold
     * yourself. Without it, one coarse "create roles" key is indirectly every
     * key in the system — compose a role granting everything, assign it to
     * yourself, and the model has been walked around rather than broken.
     */
    const errors = validateRoleDraft(draft({ features: [FEATURE.subscriptionsRead] }), {
      ...base,
      actorFeatures: [FEATURE.membersRead],
    });
    expect(errors.features).toContain('you do not hold: subscriptions:read');
  });

  it('skips the escalation check when no actor is supplied, for the seeder', () => {
    // A seed script is the machine; there is no actor to be limited by.
    const errors = validateRoleDraft(draft({ features: [FEATURE.subscriptionsRead] }), {
      registry: FEATURE_REGISTRY,
    });
    expect(errors.features).toBeUndefined();
  });
});

describe('cloneFeatures', () => {
  const opts = { registry: FEATURE_REGISTRY, actorFeatures: ALL };

  it('replace discards what was there', () => {
    const result = cloneFeatures([FEATURE.membersRead], [FEATURE.subscriptionsRead], 'replace', 'organization', opts);
    expect(result.features).toEqual([FEATURE.subscriptionsRead]);
  });

  it('add keeps what was there and unions the rest', () => {
    const result = cloneFeatures([FEATURE.membersRead], [FEATURE.subscriptionsRead], 'add', 'organization', opts);
    expect(result.features).toEqual([FEATURE.membersRead, FEATURE.subscriptionsRead].sort());
    expect(result.added).toEqual([FEATURE.subscriptionsRead]);
  });

  it('reports what was already there as NOT added', () => {
    const result = cloneFeatures([FEATURE.membersRead], [FEATURE.membersRead], 'add', 'organization', opts);
    expect(result.added).toEqual([]);
  });

  it('drops features the target level may not grant, and says so', () => {
    /*
     * Filtering rather than refusing wholesale: a super admin's features cloned
     * into an organization role would fail validation entirely, leaving the
     * person to un-tick them one at a time. Dropping what cannot apply and
     * SAYING SO leaves a working role and an accurate list.
     */
    const result = cloneFeatures([], [FEATURE.featuresCreate], 'replace', 'organization', opts);
    expect(result.features).toEqual([]);
    expect(result.skipped).toEqual([{ key: FEATURE.featuresCreate, reason: 'wrong_level' }]);
  });

  it('drops features the ACTOR does not hold — a clone cannot outrun the escalation rule', () => {
    const result = cloneFeatures([], [FEATURE.subscriptionsRead], 'replace', 'organization', {
      registry: FEATURE_REGISTRY,
      actorFeatures: [FEATURE.membersRead],
    });
    expect(result.features).toEqual([]);
    expect(result.skipped).toEqual([{ key: FEATURE.subscriptionsRead, reason: 'not_held' }]);
  });

  it('drops an unregistered key rather than carrying it across', () => {
    const result = cloneFeatures([], ['made:up'], 'replace', 'app', opts);
    expect(result.skipped).toEqual([{ key: 'made:up', reason: 'unregistered' }]);
  });

  it('de-duplicates and sorts, so the form does not reorder between renders', () => {
    const result = cloneFeatures(
      [FEATURE.subscriptionsRead],
      [FEATURE.membersRead, FEATURE.membersRead],
      'add',
      'organization',
      opts,
    );
    expect(result.features).toEqual([FEATURE.membersRead, FEATURE.subscriptionsRead].sort());
  });
});

/**
 * Levels reach DOWNWARD only.
 *
 * A role may collect features at its own level and at any narrower one, never a
 * broader one. The permissive direction is the convenience; the refused one is
 * the whole point, so both are pinned here.
 */
describe('canRoleGrant', () => {
  it('lets a role grant its own level', () => {
    expect(canRoleGrant('app', 'app')).toBe(true);
    expect(canRoleGrant('organization', 'organization')).toBe(true);
    expect(canRoleGrant('workspace', 'workspace')).toBe(true);
  });

  it('lets a BROADER role grant a narrower feature', () => {
    // An organization role already applies inside every workspace of its
    // organization, so carrying a workspace feature says nothing new.
    expect(canRoleGrant('app', 'organization')).toBe(true);
    expect(canRoleGrant('app', 'workspace')).toBe(true);
    expect(canRoleGrant('organization', 'workspace')).toBe(true);
  });

  it('REFUSES a narrower role a broader feature — the escalation', () => {
    /*
     * The load-bearing case. Creating workspace roles is routine and widely
     * delegated; if one could carry `billing:manage`, anyone able to define a
     * workspace role could grant themselves an organization-wide power from
     * inside a single workspace.
     */
    expect(canRoleGrant('workspace', 'organization')).toBe(false);
    expect(canRoleGrant('workspace', 'app')).toBe(false);
    expect(canRoleGrant('organization', 'app')).toBe(false);
  });
});

describe('level reach, through the validator and the clone', () => {
  const workspaceLevelKey = FEATURE_REGISTRY.find((spec) => spec.level === 'workspace')?.key ?? '';
  const orgLevelKey = FEATURE_REGISTRY.find((spec) => spec.level === 'organization')?.key ?? '';
  const appLevelKey = FEATURE_REGISTRY.find((spec) => spec.level === 'app')?.key ?? '';

  it('an organization role may now carry a workspace-level feature', () => {
    // Previously refused by the exact-match rule, which is what this change is.
    const errors = validateRoleDraft(draft({ level: 'organization', features: [workspaceLevelKey] }), base);
    expect(errors.features).toBeUndefined();
  });

  it('a workspace role still may not carry an organization-level feature', () => {
    const errors = validateRoleDraft(draft({ level: 'workspace', features: [orgLevelKey] }), base);
    expect(errors.features).toContain('broader than a workspace-level role may grant');
  });

  it('an organization role still may not carry an app-level feature', () => {
    const errors = validateRoleDraft(draft({ level: 'organization', features: [appLevelKey] }), base);
    expect(errors.features).toContain('broader than a organization-level role may grant');
  });

  it('a clone carries a narrower feature across, and drops a broader one', () => {
    const result = cloneFeatures([], [workspaceLevelKey, appLevelKey], 'replace', 'organization', {
      registry: FEATURE_REGISTRY,
      actorFeatures: ALL,
    });
    expect(result.features).toEqual([workspaceLevelKey]);
    expect(result.skipped).toEqual([{ key: appLevelKey, reason: 'wrong_level' }]);
  });
});
