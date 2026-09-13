import type { FeatureLevel } from './types.js';

/**
 * The metadata keys a module WRITES and exactly one other module ENFORCES.
 *
 * ## Why these live here and not beside their guards
 *
 * `@Public` is `@kwtech/module-auth`'s and `@RequireScope` is
 * `@kwtech/module-permissions`', and §9 forbids a module importing a module. So
 * a third module could neither mark a surface anonymous nor say which level a
 * resolver works at — and the second one fails SILENTLY: a GraphQL resolver has
 * no path, so with no declared scope the guard resolves app level, where no
 * workspace-level key participates, and every such key grants nothing to
 * everybody. That is the trap PLAN §12.13 records, and it was unreachable for
 * `module-chat` only because chat is app level.
 *
 * The same wall `FeatureContribution` came down through, and the same fix: the
 * vocabulary moves to the package every module already depends on. This package
 * still imports no Nest — these are string constants and one shape. A module
 * applies them with its own `SetMetadata`; the enforcing guard reads the same
 * constant it always read.
 *
 * ⚠ The VALUES are unchanged from when each enforcer owned them. A module
 * writing `REQUIRED_SCOPE_METADATA` and a guard reading `REQUIRED_SCOPE` are
 * reading one string, which is the entire mechanism.
 */

/**
 * Marks a handler as reachable with no authenticated principal. The value is
 * the REASON, and it must be a non-empty string — the authentication guard
 * treats any truthy value as "public", so a reason is what keeps the exception
 * a decision on the record rather than a habit.
 */
export const PUBLIC_SURFACE_METADATA = 'kwtech:auth-public';

/** Declares the level a handler operates at. The value is a `ScopeDeclaration`. */
export const REQUIRED_SCOPE_METADATA = 'kwtech:required-scope';

/**
 * Marks a handler where somebody GUESSES A SECRET — a code typed into a TV, a
 * password. The host points its tightest rate limit at every handler carrying
 * it. The value is the reason, a non-empty string.
 *
 * Here for the reason the other two are: the module that owns the handler may
 * not depend on the throttler, which is the APP's policy. `module-auth`
 * publishes a list for its REST controller; a module with a GraphQL surface
 * marks the handler instead, and the app's guard reads this key.
 */
export const CREDENTIAL_SURFACE_METADATA = 'kwtech:credential-surface';

export interface ScopeDeclaration {
  level: FeatureLevel;
  /**
   * Where the ids live for a handler with no path to read — a GraphQL
   * resolver, chiefly. Defaults match the usual argument names,
   * `organizationId` and `workspaceId`.
   */
  organizationIdArg?: string;
  workspaceIdArg?: string;
}

/**
 * A `ScopeDeclaration`, built rather than written as a literal so a module's
 * resolvers read the same way the enforcer's own `@RequireScope` does:
 *
 *   const RequireScope = (level: FeatureLevel) =>
 *     SetMetadata(REQUIRED_SCOPE_METADATA, declareScope(level));
 */
export function declareScope(level: FeatureLevel, args: Omit<ScopeDeclaration, 'level'> = {}): ScopeDeclaration {
  return { level, ...args };
}
