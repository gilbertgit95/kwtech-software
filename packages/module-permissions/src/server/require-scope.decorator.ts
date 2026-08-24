import { SetMetadata } from '@nestjs/common';
import type { RoleLevel } from '../types.js';

export const REQUIRED_SCOPE = 'kwtech:required-scope';

export interface ScopeSpec {
  level: RoleLevel;
  /**
   * Where the ids live for a handler with no path to read — a GraphQL
   * resolver, chiefly. Defaults match the usual argument names.
   */
  organizationIdArg?: string;
  workspaceIdArg?: string;
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
 *   @RequireFeature(FEATURE.workspacesShare)
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
