import type { PlanEntitlement } from './grants.js';

/**
 * Limits are how MANY, as opposed to what.
 *
 * Kept apart from features throughout, because they answer different questions
 * at different moments: a feature is checked when someone READS or acts, a
 * limit when someone WRITES one more row. Merging them makes a full
 * organization indistinguishable from an unauthorised one — the user is told
 * "access denied" when the truth is "buy more seats", and the ticket goes to
 * the wrong team.
 */

export const LIMIT = {
  /**
   * Organizations one user may belong to. Capped by their APP-LEVEL ROLE, not
   * by a subscription — the question is asked before any organization exists,
   * so there is no plan to ask.
   */
  userOrganizations: 'user:organizations',
  /** Members an organization may have. */
  organizationMembers: 'organization:members',
  /** Workspaces an organization may create. */
  organizationWorkspaces: 'organization:workspaces',
  /** Members any one workspace may have. */
  workspaceMembers: 'workspace:members',
} as const;

export type LimitKey = (typeof LIMIT)[keyof typeof LIMIT] | (string & {});

export interface LimitSpec {
  key: string;
  label: string;
  description: string;
  /**
   * Where the number comes from.
   *
   *   plan — bought, via the organization's subscription.
   *   role — granted, via the user's app-level role.
   *
   * They are not interchangeable: a plan-sourced limit has no meaning before an
   * organization exists, and a role-sourced one has no meaning inside a
   * subscription. Keeping the source on the spec is what lets one map hold both
   * without anyone having to remember which is which.
   */
  source: 'plan' | 'role';
  /** Which entity the count is taken over — drives what checkCapacity counts. */
  countedOver: 'user' | 'organization' | 'workspace';
  /**
   * Whether every PLAN must set this. Seat counts are `required`, so a plan that
   * forgets one fails the seed rather than silently granting unlimited seats —
   * the expensive direction to be wrong in.
   *
   * Role-sourced limits are not required: most roles say nothing about how many
   * organizations a person may have, and the floor is the right answer for them.
   */
  required: boolean;
  /**
   * The cap when nothing assigns one — no plan at all, or a plan that omits this
   * key. `null` would mean genuinely unrestricted; no seat limit uses that.
   *
   * One, not zero. An unset cap must not mean "infinite", but zero is the wrong
   * floor in the other direction: an organization is created before it is
   * subscribed, and a cap of zero stops its founder from being its first member
   * — sign-up fails before billing is ever reached. One admits exactly the owner
   * and nobody else, which is the smallest coherent organization.
   *
   * Combined with `required`, no configured plan ever reaches this value: the
   * seed refuses a plan that omits a required limit. It is the floor for the
   * unconfigured and the lapsed.
   */
  defaultValue: number | null;
}

/**
 * THIS FILE IS THE SOURCE, PLAN ROWS ARE THE VALUES. A limit key only means
 * something if something counts it, exactly as a feature key only means
 * something if something checks it.
 */
export const LIMIT_REGISTRY: readonly LimitSpec[] = [
  {
    key: LIMIT.userOrganizations,
    label: 'Organizations per user',
    description: 'How many organizations this user may belong to.',
    source: 'role',
    countedOver: 'user',
    required: false,
    defaultValue: 1,
  },
  {
    key: LIMIT.organizationMembers,
    label: 'Organization members',
    description: 'How many people may belong to the organization.',
    source: 'plan',
    countedOver: 'organization',
    required: true,
    defaultValue: 1,
  },
  {
    key: LIMIT.organizationWorkspaces,
    label: 'Workspaces',
    description: 'How many workspaces the organization may have.',
    source: 'plan',
    countedOver: 'organization',
    required: true,
    defaultValue: 1,
  },
  {
    key: LIMIT.workspaceMembers,
    label: 'Workspace members',
    description: 'How many people may belong to any one workspace.',
    source: 'plan',
    countedOver: 'workspace',
    required: true,
    defaultValue: 1,
  },
] as const;

/** null = unrestricted. */
export type LimitMap = Readonly<Record<string, number | null>>;

export interface LimitDecision {
  allowed: boolean;
  limit: number | null;
  current: number;
  /**
   * How many more may be added; null when unrestricted.
   *
   * Null rather than Infinity because this crosses a JSON boundary — REST
   * responses, GraphQL fields — and JSON.stringify(Infinity) is `null`, which a
   * client cannot tell apart from "unknown". Null on purpose is at least
   * honest, and `limit === null` says the same thing.
   */
  remaining: number | null;
}

/** The part of a role grant that carries caps. Only app-level roles contribute. */
export interface RoleLimitGrant {
  level: 'app' | 'organization' | 'workspace';
  limits?: Readonly<Record<string, number>>;
}

export interface ResolveLimitsInput {
  /**
   * Active plans. `undefined` means the app has no subscription model, and
   * plan-sourced limits come back unrestricted. `null` or `[]` means no active
   * plan, and they come back at their floor.
   */
  plans?: readonly PlanEntitlement[] | null;
  /** The caller's role grants. Only the app-level ones set role-sourced limits. */
  roles?: readonly RoleLimitGrant[];
}

/**
 * Resolves every cap in force, from both sources at once.
 *
 *   role-sourced  the MAX any APP-LEVEL role gives the key. A user with no role
 *                 saying otherwise gets the floor — one organization.
 *   plan-sourced  undefined plans → unrestricted (no subscription model);
 *                 no active plan → the floor; active plans → the MAX any of
 *                 them gives, and the floor for keys none of them set.
 *
 * Max in both cases, which is the additive reading grants already get: holding
 * two roles, or an organization plan plus a workspace plan, adds capacity rather
 * than having one cap the other.
 *
 * Always returns a map, never null. Role-sourced limits must resolve even at app
 * level, where no subscription is consulted at all — "how many organizations may
 * I create" is asked before any organization exists, so there is no plan to ask.
 */
export function resolveLimits(input: ResolveLimitsInput, registry: readonly LimitSpec[] = LIMIT_REGISTRY): LimitMap {
  const { plans, roles = [] } = input;
  const appRoleLimits = roles.filter((role) => role.level === 'app').map((role) => role.limits ?? {});
  const planLimits = (plans ?? []).map((plan) => plan.limits ?? {});

  const resolved: Record<string, number | null> = {};
  for (const spec of registry) {
    if (spec.source === 'plan' && plans === undefined) {
      resolved[spec.key] = null;
      continue;
    }

    const sources = spec.source === 'role' ? appRoleLimits : planLimits;
    const assigned = sources.map((limits) => limits[spec.key]).filter((v): v is number => v !== undefined);

    resolved[spec.key] = assigned.length > 0 ? Math.max(...assigned) : spec.defaultValue;
  }
  return resolved;
}

/**
 * Whether one more may be added. Fails closed on a registered key with no cap
 * resolved, open on an unregistered one: a limit nobody declared is not a limit.
 */
export function checkLimit(limits: LimitMap | null | undefined, key: LimitKey, current: number): LimitDecision {
  const limit = limits ? (limits[key] ?? null) : null;
  if (limit === null) return { allowed: true, limit: null, current, remaining: null };

  return { allowed: current < limit, limit, current, remaining: Math.max(0, limit - current) };
}

/**
 * Guards plan configuration at seed time: a plan that omits a required limit
 * would otherwise fall back to the floor of 1 and quietly cap a paying customer
 * at a single seat — or, before the registry existed, grant unlimited ones.
 */
export function assertPlanLimits(
  planKey: string,
  limits: Readonly<Record<string, number>> = {},
  registry: readonly LimitSpec[] = LIMIT_REGISTRY,
): void {
  const missing = registry
    .filter((spec) => spec.source === 'plan' && spec.required && limits[spec.key] === undefined)
    .map((spec) => spec.key);
  if (missing.length > 0) {
    throw new Error(`Plan '${planKey}' is missing required limits: ${missing.join(', ')}`);
  }
}
