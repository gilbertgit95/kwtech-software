import { FEATURE } from '../feature-keys.js';
import type { FeatureKey, PermissionContext, RoleLevel } from '../types.js';
import { resolveLimits } from './limits.js';

/**
 * A role as the module reads it: a name, the features it collects, and where it
 * applies. A role is nothing but a collection of features — all the meaning is
 * in `features`.
 */
export interface RoleGrant {
  roleKey: string;
  level: RoleLevel;
  features: readonly FeatureKey[];
  /**
   * For workspace-level roles, which workspace the grant is in. Null for app-
   * and organization-level roles, which have no workspace to be scoped to.
   */
  workspaceId: string | null;
  /**
   * Caps this role sets — only meaningful on app-level roles, which is where
   * "how many organizations may this user have" lives. See ./limits.ts.
   */
  limits?: Readonly<Record<string, number>>;
}

/** An active plan and the features it entitles. */
export interface PlanEntitlement {
  planKey: string;
  /** Null for an organization-wide subscription; set for a workspace one. */
  workspaceId: string | null;
  features: readonly FeatureKey[];
  /** Caps this plan sets. Absent keys are unrestricted. See ./limits.ts. */
  limits?: Readonly<Record<string, number>>;
}

export interface ComposeInput {
  subjectId: string;
  organizationId: string | null;
  /** The active workspace. Null asks the organization-wide question. */
  workspaceId?: string | null;
  roles: readonly RoleGrant[];
  /**
   * Workspaces explicitly shared with this member. Unioned with the workspaces
   * they hold a role in — a role grant implies access on its own.
   */
  workspaceIds?: readonly string[];
  /**
   * Active plans: the organization's, plus the active workspace's if it has its
   * own. Additive, like role grants — a workspace plan adds to what the
   * organization bought rather than replacing it, so there is no precedence
   * rule and no way for a downgraded workspace to revoke an organization-wide
   * entitlement.
   *
   * Three distinct states, and the difference matters:
   *   undefined — the app has no subscription model; everything is entitled.
   *   null / [] — no active plan; nothing is entitled.
   *   plans     — entitled to exactly the union of what they list.
   * Collapsing the middle into the first would silently grant everything to a
   * lapsed organization, which is the expensive direction to be wrong in.
   */
  plans?: readonly PlanEntitlement[] | null | undefined;
}

/**
 * Composes a caller's roles, and their organization's plan, into the context
 * every check runs against.
 *
 * Roles are additive and duplicates collapse. There is deliberately no deny
 * rule: a subtractive grant model turns every authorisation question into an
 * ordering question, and ordering is the part teams get wrong.
 *
 * Level is a filter, not a precedence chain: app, organization and workspace
 * grants all simply apply. Nothing overrides anything, so there is no "which
 * wins" rule to get wrong either — which is the same reason there is no deny.
 *
 * The result carries the final list (`effective`) AND the three inputs that
 * produced it. Keeping the inputs is what lets a denial say which step dropped
 * the feature — a bare boolean cannot, and "access denied" with no reason is
 * the ticket that takes a day to close.
 */
export function composeContext(input: ComposeInput): PermissionContext {
  const workspaceId = input.workspaceId ?? null;
  const organizationId = input.organizationId;

  // The trigger level, derived from the ids rather than passed alongside them —
  // two sources for one fact is one source plus a way for them to disagree.
  const level: RoleLevel = workspaceId ? 'workspace' : organizationId ? 'organization' : 'app';

  // undefined means the app has no subscription model at all — nothing is
  // filtered. null or an empty list means no ACTIVE plan, which entitles
  // nothing; collapsing the two would hand a lapsed organization everything.
  const entitled: readonly FeatureKey[] | null =
    input.plans === undefined ? null : [...new Set((input.plans ?? []).flatMap((plan) => plan.features))].sort();

  const granted = new Set<FeatureKey>();
  const appLevel = new Set<FeatureKey>();

  for (const role of input.roles) {
    // A role participates only if the request reached its level. An app-level
    // request is answered by app-level roles alone — an organization role is
    // not "also true" there, it is unasked, because the request named no
    // organization for it to be true about.
    //
    // Workspace roles additionally have to match the workspace in hand: never a
    // fallback when no workspace is active, which would turn a scoped grant
    // into a global one.
    const applies =
      role.level === 'app'
        ? true
        : role.level === 'organization'
          ? level !== 'app'
          : level === 'workspace' && role.workspaceId === workspaceId;
    if (!applies) continue;

    for (const feature of role.features) {
      granted.add(feature);
      if (role.level === 'app') appLevel.add(feature);
    }
  }

  // ── the resolution pipeline ───────────────────────────────────────────────
  //
  // What participates depends on the level the request triggered:
  //
  //   app           app-level features, and nothing else. No subscription is
  //                 consulted: there is no organization to have bought anything.
  //   organization  organization features ∩ subscription, then ∪ app-level.
  //   workspace     organization + workspace features ∩ subscription,
  //                 then ∪ app-level.
  //
  // Order is the whole design. Filtering before the app union is what makes the
  // app level an exemption rather than just another grant; doing it after would
  // strip staff rights along with everyone else's.
  //
  // At app level `scoped` is empty by construction, so the same three lines
  // produce "app features only" without a special case to keep in step.
  const scoped = [...granted].filter((feature) => !appLevel.has(feature));
  const entitledSet = entitled === null ? null : new Set(entitled);

  const effective = new Set(entitledSet === null ? scoped : scoped.filter((f) => entitledSet.has(f)));
  for (const feature of appLevel) effective.add(feature);

  // Which workspaces this user may enter.
  //
  // Their workspace memberships, which is where workspace roles hang from — so
  // holding a role in a workspace you cannot enter is now impossible to express
  // rather than merely wrong. The union with role-derived ids is kept as a
  // belt-and-braces guard for any caller assembling grants by hand.
  //
  // Seeing every workspace is a granted right rather than a structural rule, so
  // an organization can compose it into whichever role it wants.
  const roleWorkspaceIds = input.roles
    .filter((role) => role.level === 'workspace' && role.workspaceId)
    .map((role) => role.workspaceId as string);

  // Platform support counts as access-all: a support engineer holds no
  // membership anywhere, and the whole point of the right is entering an
  // organization they do not belong to. Without this, C1's enforcement would
  // lock out exactly the people it must not.
  const seesEveryWorkspace = granted.has(FEATURE.workspacesAccessAll) || granted.has(FEATURE.platformSupportAccess);

  const accessibleWorkspaceIds = seesEveryWorkspace
    ? null
    : [...new Set([...(input.workspaceIds ?? []), ...roleWorkspaceIds])].sort();

  return {
    subjectId: input.subjectId,
    organizationId,
    workspaceId,
    limits: resolveLimits({ plans: input.plans, roles: input.roles }),
    effective: [...effective].sort(),
    accessibleWorkspaceIds,
    granted: [...granted].sort(),
    grantedAtAppLevel: [...appLevel].sort(),
    entitled,
  };
}
