import { REQUIRED_SCOPE_METADATA, type ScopeDeclaration } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import type { RoleLevel } from '../types.js';

/**
 * The key `@RequireScope` writes and `FeatureGuard` reads.
 *
 * ⚠ Its value lives in `@kwtech/module-kit`, and that is load-bearing rather
 * than tidy: a module below app level must declare its scope, and it may not
 * import this package (PLAN §9). Without the shared key a workspace resolver in
 * another module resolves at app level and every workspace-level key grants
 * nothing — §12.13's trap, one module over. Kept under this name so the guard
 * and every existing reader are unchanged.
 */
export const REQUIRED_SCOPE = REQUIRED_SCOPE_METADATA;

/** A `ScopeDeclaration`, spelled in this module's own level vocabulary (the same union). */
export interface ScopeSpec extends ScopeDeclaration {
  level: RoleLevel;
}

/**
 * Declares the level a handler operates at.
 *
 * REST does not need it: the level is already in the path
 * (/api/v1/organizations/:orgId/workspaces/:wsId/…) and the guard parses it.
 * A GraphQL resolver has no path, so it says so explicitly and names the
 * arguments carrying the ids:
 *
 *   @RequireScope('workspace')
 *   @RequireFeature(FEATURE.workspaceMembersAdd)
 *   @Mutation(() => Workspace)
 *   shareWorkspace(@Args('organizationId') orgId: string, @Args('workspaceId') wsId: string) {}
 *
 * On a REST handler it is still worth adding: the guard then checks the
 * declared level against the parsed one and refuses on a mismatch, which
 * catches a controller mounted a level away from where it thinks it is —
 * otherwise a silent under-check, since the wrong scope still resolves a
 * perfectly valid-looking context.
 */
export const RequireScope = (level: RoleLevel, args: Omit<ScopeSpec, 'level'> = {}) =>
  SetMetadata(REQUIRED_SCOPE, { level, ...args } satisfies ScopeSpec);
