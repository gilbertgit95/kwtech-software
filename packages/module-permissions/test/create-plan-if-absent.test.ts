import { LIMIT } from '../src/domain/limits.js';
import type { PlanDefinition } from '../src/domain/plans.js';
import { createPlanIfAbsent, type PermissionsRegistryClient } from '../src/server/registry-sync.js';
import type { FeatureSpec } from '../src/types.js';

/**
 * The seed path for plans, whose defining property is what it does NOT do.
 *
 * `upsertSystemRole` REPLACES a role's features on every `db:sync`, because a
 * role's meaning is code. This creates a plan and then leaves it alone forever,
 * because what a plan sells is a product decision an operator changes through
 * the admin screens — and a seed that re-asserted itself would silently undo
 * that work on the next deploy.
 */

const REGISTRY: FeatureSpec[] = [
  { key: 'reports:read', module: 'demo', level: 'organization', label: 'Read reports', description: '' },
  { key: 'reports:share', module: 'demo', level: 'workspace', label: 'Share reports', description: '' },
  { key: 'platform:support_access', module: 'demo', level: 'app', label: 'Support', description: '' },
];

const REQUIRED_LIMITS = {
  [LIMIT.organizationMembers]: 10,
  [LIMIT.organizationWorkspaces]: 3,
  [LIMIT.workspaceMembers]: 5,
};

const plan = (over: Partial<PlanDefinition> = {}): PlanDefinition => ({
  key: 'team',
  label: 'Team',
  isPublic: true,
  features: ['reports:read'],
  limits: REQUIRED_LIMITS,
  ...over,
});

interface State {
  plans: { key: string; label: string; isPublic: boolean; icon: string | null }[];
  features: { planKey: string; featureKey: string }[];
  limits: { planKey: string; limitKey: string; value: number }[];
}

/** A literal object, not a database — the point of the structural client. */
function fake(state: State = { plans: [], features: [], limits: [] }) {
  const client = {
    permPlan: {
      findFirst: async (args: { where: { key: string } }) => state.plans.find((p) => p.key === args.where.key) ?? null,
      create: async (args: { data: { key: string; label: string; isPublic: boolean; icon: string | null } }) => {
        state.plans.push(args.data);
        return { key: args.data.key };
      },
    },
    permPlanFeature: {
      createMany: async (args: { data: { planKey: string; featureKey: string }[] }) => {
        state.features.push(...args.data);
        return { count: args.data.length };
      },
    },
    permPlanLimit: {
      createMany: async (args: { data: { planKey: string; limitKey: string; value: number }[] }) => {
        state.limits.push(...args.data);
        return { count: args.data.length };
      },
    },
  } as unknown as PermissionsRegistryClient;

  return { client, state };
}

describe('createPlanIfAbsent', () => {
  it('creates the plan, its features and its caps', async () => {
    const { client, state } = fake();
    const result = await createPlanIfAbsent(client, plan({ features: ['reports:read', 'reports:share'] }), REGISTRY);

    expect(result).toEqual({ key: 'team', created: true, features: 2 });
    expect(state.plans).toEqual([{ key: 'team', label: 'Team', isPublic: true, icon: null }]);
    expect(state.features).toHaveLength(2);
    expect(state.limits).toContainEqual({ planKey: 'team', limitKey: LIMIT.organizationMembers, value: 10 });
  });

  /**
   * THE POINT OF THE FUNCTION. An operator who adds a feature to `pro` through
   * the screens must still have it after the next deploy — so a second run
   * writes nothing at all, not even a "harmless" label update.
   */
  it('leaves an existing plan completely alone', async () => {
    const { client, state } = fake();
    await createPlanIfAbsent(client, plan(), REGISTRY);

    const changed = plan({ label: 'Renamed', isPublic: false, features: ['reports:share'] });
    const result = await createPlanIfAbsent(client, changed, REGISTRY);

    expect(result).toEqual({ key: 'team', created: false, features: 1 });
    expect(state.plans).toEqual([{ key: 'team', label: 'Team', isPublic: true, icon: null }]);
    // Not re-written, not merged, not appended to.
    expect(state.features).toEqual([{ planKey: 'team', featureKey: 'reports:read' }]);
    expect(state.limits).toHaveLength(3);
  });

  /**
   * Validated BEFORE the existence check, so a malformed definition fails on
   * EVERY run rather than only the first. A seed that stops checking itself
   * once the row exists is a seed that drifts unnoticed.
   */
  it('refuses an app-level feature even when the plan already exists', async () => {
    const { client } = fake();
    await createPlanIfAbsent(client, plan(), REGISTRY);

    await expect(createPlanIfAbsent(client, plan({ features: ['platform:support_access'] }), REGISTRY)).rejects.toThrow(
      /app-level features are exempt from entitlement/,
    );
  });

  it('refuses an unregistered feature', async () => {
    const { client } = fake();
    await expect(createPlanIfAbsent(client, plan({ features: ['nope:at-all'] }), REGISTRY)).rejects.toThrow(
      /not in the registry/,
    );
  });

  /**
   * A plan missing a required cap falls back to the registry floor of ONE and
   * silently caps a paying customer at a single seat — the expensive direction.
   */
  it('refuses a plan missing a required cap, before writing anything', async () => {
    const { client, state } = fake();
    await expect(
      createPlanIfAbsent(client, plan({ limits: { [LIMIT.organizationMembers]: 10 } }), REGISTRY),
    ).rejects.toThrow(/missing required limits/);

    expect(state.plans).toEqual([]);
  });

  it("stores the definition's icon, and null when it names none", async () => {
    const { client, state } = fake();
    await createPlanIfAbsent(client, plan({ key: 'pro', icon: 'gem' }), REGISTRY);
    await createPlanIfAbsent(client, plan({ key: 'plain' }), REGISTRY);

    // `?? null`, never undefined — Prisma skips an undefined column, so a plan
    // created without an icon would hold nothing rather than null.
    expect(state.plans.find((p) => p.key === 'pro')?.icon).toBe('gem');
    expect(state.plans.find((p) => p.key === 'plain')?.icon).toBeNull();
  });

  it('de-duplicates a feature listed twice', async () => {
    const { client, state } = fake();
    await createPlanIfAbsent(client, plan({ features: ['reports:read', 'reports:read'] }), REGISTRY);

    expect(state.features).toHaveLength(1);
  });
});
