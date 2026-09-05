import type { FeatureContribution } from '@kwtech/module-kit';

/** A feature key as it appears in the registry: 'review:read', 'jobs:run'. */
export type FeatureKey = string;

/**
 * Where a key is actually enforced.
 *
 * A feature is the smallest thing a user can be given access to, and a binding
 * names the concrete place that access is checked. A key with no bindings is
 * decoration: it reads as coverage in the role editor while guarding nothing.
 * A guarded surface whose key is absent from the registry is worse — it can
 * never be granted, so the check behind it always fails.
 */
export type FeatureSurface =
  // ── server ──────────────────────────────────────────────────────────────
  /** A controller handler. Identifier: 'POST /workspaces/:id/share'. */
  | 'rest_endpoint'
  /** A query or mutation. Identifier: 'Mutation.shareWorkspace'. */
  | 'graphql_operation'
  /**
   * A subscription. Separate from an operation because it is enforced at a
   * different moment — the WebSocket handshake, not the request — and a key
   * that guards one does not automatically guard the other.
   */
  | 'graphql_subscription'
  /**
   * A single field on a type. Identifier: 'Organization.billingEmail'.
   * Field-level checks are what let one query serve users who may see
   * different columns, instead of forking the whole operation.
   */
  | 'graphql_field'
  /** A scheduled or queued job. Identifier: 'reindex-search'. */
  | 'job'
  /** A CLI command. Identifier: 'kwtech roles:grant'. */
  | 'cli_command'
  // ── UI ──────────────────────────────────────────────────────────────────
  /** A page. Identifier: '/admin/roles'. Also drives the navigation filter. */
  | 'ui_route'
  /** A control inside a page — a button, a column, a tab. Identifier: 'RoleEditor'. */
  | 'ui_component';

/**
 * The surface names, as data.
 *
 * Exported because a module may declare a binding through
 * `@kwtech/module-kit`'s `FeatureContribution`, where `surface` is a plain
 * `string` — that package must not own this module's vocabulary. Something has
 * to check the string is one of these on the way back in, and a type cannot do
 * it at runtime.
 */
export const FEATURE_SURFACES: readonly FeatureSurface[] = [
  'rest_endpoint',
  'graphql_operation',
  'graphql_subscription',
  'graphql_field',
  'job',
  'cli_command',
  'ui_route',
  'ui_component',
];

export function isFeatureSurface(value: string): value is FeatureSurface {
  return (FEATURE_SURFACES as readonly string[]).includes(value);
}

export interface FeatureBinding {
  surface: FeatureSurface;
  identifier: string;
}

/**
 * The three levels a role can exist at, and the level a feature belongs to.
 *
 *   app          — across every organization. Platform staff: support, billing
 *                  operations, incident response. Granted to a USER, not to a
 *                  membership, because it is not scoped to any organization.
 *   organization — everywhere inside one organization.
 *   workspace    — inside one workspace of one organization.
 *
 * A feature carries a level too, and a role may only collect features at its own
 * level. That is what stops a workspace role quietly containing `billing:manage`
 * — an organization-wide concern that no workspace should be able to grant.
 */
export type RoleLevel = 'app' | 'organization' | 'workspace';

/**
 * Exported now that the write screens validate a level typed in by hand: the
 * form's options, the import's check and `toRoleLevel` below must all read the
 * same list, or one of them accepts a level the others refuse.
 */
export const ROLE_LEVELS: readonly RoleLevel[] = ['app', 'organization', 'workspace'];

/**
 * Validates a level read from storage instead of casting it.
 *
 * A row holding 'Organization' or 'organization ' would otherwise cast cleanly
 * and then match nothing — a role that silently grants nothing, with no error
 * anywhere to explain it. Silent denial is the safe direction and the
 * undiagnosable one.
 */
export function toRoleLevel(value: string): RoleLevel {
  if ((ROLE_LEVELS as readonly string[]).includes(value)) return value as RoleLevel;
  throw new Error(`Unknown role level '${value}'. Expected one of: ${ROLE_LEVELS.join(', ')}`);
}

export interface FeatureSpec extends FeatureContribution {
  /**
   * The level a role must be at to grant this feature. Drives the role editor:
   * a workspace-level role is only ever offered workspace-level features.
   */
  level: RoleLevel;

  /**
   * The concrete surfaces this key guards. Add the binding in the SAME commit
   * that adds the guard, or the registry starts lying.
   */
  bindings?: FeatureBinding[];
}

/**
 * The answer to "what may this caller do, right now".
 *
 * Always per (subject, organization): the same person legitimately holds
 * different rights in two organizations, so a context without an organization
 * is not a smaller context — it is an ambiguous one.
 */
export interface PermissionContext {
  subjectId: string;
  /** Null only for apps with no organization concept at all. */
  organizationId: string | null;
  /**
   * The workspace the answer is scoped to. Null means the question was asked
   * organization-wide, and only organization-wide grants apply — not "all
   * workspaces". Treating null as a wildcard is how a scoped grant silently
   * becomes a global one.
   */
  workspaceId: string | null;

  /** Keys the caller's ROLES grant, at every level. What the person may do. */
  granted: readonly FeatureKey[];

  /**
   * The subset granted by APP-level roles — platform staff rights.
   *
   * Tracked separately because these are exempt from plan entitlement: a lapsed
   * organization is exactly when support is needed, so gating staff behind the
   * customer's subscription locks out the people trying to fix it. Empty for
   * everyone who is not staff, which is almost everyone.
   */
  grantedAtAppLevel: readonly FeatureKey[];

  /**
   * The answer: every feature accessible at this scope, after the whole
   * pipeline has run. This is what a check tests against, and what the frontend
   * receives. The three lists above are kept alongside it only so a denial can
   * explain which step dropped the feature.
   */
  effective: readonly FeatureKey[];

  /**
   * Every cap in force, from both sources: the user's app-level role (how many
   * organizations) and the organization's plan (seats, workspaces, workspace
   * members). A null VALUE means that key is unrestricted; the map itself is
   * always present, because role-sourced caps apply even at app level where no
   * subscription is consulted. Checked when something is ADDED, never when
   * something is read — see domain/limits.ts.
   */
  limits: Readonly<Record<string, number | null>>;

  /**
   * Workspaces this caller may enter.
   *
   * `null` means every workspace in the organization — the caller holds
   * `workspaces:access_all`. An empty array means none, which is a normal state
   * for a member who has not been shared anything yet.
   */
  accessibleWorkspaceIds: readonly string[] | null;

  /**
   * Keys the organization's PLAN includes. What the organization bought.
   *
   * `null` means "no entitlement model" — an app without subscriptions gets
   * unrestricted entitlement rather than a special case at every call site.
   */
  entitled: readonly FeatureKey[] | null;
}

/** Why a check failed. The distinction is the point — see check.ts. */
export type DenialReason =
  /** No permission context on the request at all. */
  | 'no_context'
  /**
   * The caller may not enter the workspace the request names. Asked before any
   * feature question, and kept distinct from a missing grant: "you are not in
   * this workspace" and "you lack this right here" need different answers.
   */
  | 'no_workspace_access'
  /** The organization's plan does not include it. Upgrade, not a role change. */
  | 'not_entitled'
  /** The plan includes it; this caller's roles do not grant it. Ask an admin. */
  | 'not_granted';

export interface FeatureDecision {
  allowed: boolean;
  reason?: DenialReason;
}
