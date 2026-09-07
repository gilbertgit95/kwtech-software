import type { FeatureDecision, FeatureKey, PermissionContext } from './types.js';

/**
 * The whole decision surface. Every guard, gate and navigation filter routes
 * through here, so an authorisation change is one edit rather than a search
 * across apps.
 *
 * How access is resolved, for a request that reaches the deepest level
 * (/api/v1/organizations/1/workspaces/2/data-samples triggers all three):
 *
 *   1. combine the caller's ORGANIZATION-level and WORKSPACE-level role features
 *   2. filter that set against the organization's SUBSCRIPTION — anything not
 *      in the plan falls out
 *   3. union the APP-level features, which skip the filter entirely
 *   → the result is every feature accessible at this scope
 *
 * A request is allowed when the feature it names is in that result.
 * `composeContext` computes it once per request into `ctx.effective`; the
 * functions here only read it. Checking is a set lookup, not a re-derivation —
 * which matters when one GraphQL operation asks fifty times.
 *
 * Pure and dependency-free: importable from a resolver, a React component, a
 * worker and a test alike.
 */
export function checkFeature(ctx: PermissionContext | undefined, feature: FeatureKey): FeatureDecision {
  if (!ctx) return { allowed: false, reason: 'no_context' };
  if (ctx.effective.includes(feature)) return { allowed: true };

  // Reasons follow the pipeline order, so the answer names the FIRST step that
  // dropped the feature. A caller with no role grant is told to ask an
  // administrator rather than to buy a plan they are not the one to buy — and
  // it avoids disclosing the organization's billing state to every member.
  if (!ctx.granted.includes(feature)) return { allowed: false, reason: 'not_granted' };
  return { allowed: false, reason: 'not_entitled' };
}

/** Boolean shorthand for the common case. Use checkFeature when the reason matters. */
export function hasFeature(ctx: PermissionContext | undefined, feature: FeatureKey): boolean {
  return checkFeature(ctx, feature).allowed;
}

/** True only if every key passes. AND semantics. */
export function hasAllFeatures(ctx: PermissionContext | undefined, required: readonly FeatureKey[]): boolean {
  return required.every((feature) => hasFeature(ctx, feature));
}

/** True if any key passes. OR semantics. */
export function hasAnyFeature(ctx: PermissionContext | undefined, required: readonly FeatureKey[]): boolean {
  return required.some((feature) => hasFeature(ctx, feature));
}

/**
 * The first denial reason among the required keys, for the message shown to the
 * user. Pipeline order again: a missing grant is reported before a missing
 * entitlement.
 */
export function denialReason(ctx: PermissionContext | undefined, required: readonly FeatureKey[]) {
  const reasons = required.map((feature) => checkFeature(ctx, feature).reason);
  return (
    reasons.find((r) => r === 'no_context') ??
    reasons.find((r) => r === 'not_granted') ??
    reasons.find((r) => r === 'not_entitled')
  );
}

/**
 * Whether the caller may enter a workspace at all — a question about SHARING,
 * asked before any feature question.
 *
 * Membership is required: no role widens this for a tenant user.
 * `accessibleWorkspaceIds === null` means platform support, the one exemption.
 *
 * Kept separate from checkFeature because the two answer different questions:
 * this one is "may you be here", that one is "may you do this here".
 */
export function canAccessWorkspace(ctx: PermissionContext | undefined, workspaceId: string): boolean {
  if (!ctx) return false;
  return ctx.accessibleWorkspaceIds === null || ctx.accessibleWorkspaceIds.includes(workspaceId);
}

export interface FeatureExplanation {
  feature: FeatureKey;
  allowed: boolean;
  /** Granted by an app-level role, and therefore exempt from the plan filter. */
  fromAppLevel: boolean;
  /** Granted by an organization- or workspace-level role applicable here. */
  fromScopedRole: boolean;
  /** Included in an active plan. Null when the app has no subscription model. */
  inSubscription: boolean | null;
  /** Which pipeline step dropped it, if it was dropped. */
  droppedAt?: 'no_role_grant' | 'subscription_filter';
}

/**
 * Why a feature is or is not accessible, step by step.
 *
 * Worth its own function because "access denied" with no reason is the support
 * ticket that takes a day to close: the answer is spread across a role, a plan
 * and a scope, and nobody can see all three at once. Use it in an admin
 * diagnostic and in test assertions.
 */
export function explainFeature(ctx: PermissionContext | undefined, feature: FeatureKey): FeatureExplanation {
  if (!ctx) {
    return { feature, allowed: false, fromAppLevel: false, fromScopedRole: false, inSubscription: null };
  }

  const fromAppLevel = ctx.grantedAtAppLevel.includes(feature);
  const fromScopedRole = ctx.granted.includes(feature) && !fromAppLevel;
  const inSubscription = ctx.entitled === null ? null : ctx.entitled.includes(feature);
  const allowed = ctx.effective.includes(feature);

  const explanation: FeatureExplanation = { feature, allowed, fromAppLevel, fromScopedRole, inSubscription };
  if (!allowed) {
    explanation.droppedAt = !fromAppLevel && !fromScopedRole ? 'no_role_grant' : 'subscription_filter';
  }
  return explanation;
}
