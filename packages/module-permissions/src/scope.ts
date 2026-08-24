import type { RoleLevel } from './types.js';

/**
 * The level of a request, read from its path.
 *
 * One convention, mirrored on both sides, so the level is never guessed and
 * never carried in a header someone can forget to send:
 *
 *   server  /api/v1/*                                               app
 *           /api/v1/organizations/:orgId/*                           organization
 *           /api/v1/organizations/:orgId/workspaces/:wsId/*          workspace
 *
 *   web     /*                                                       app
 *           /organizations/[org_id]/*                                organization
 *           /organizations/[org_id]/workspaces/[workspace_id]/*      workspace
 *
 * Parsing lives here, in the module's dependency-free core, because the Nest
 * guard, the Next middleware, the navigation builder and the tests must all
 * agree on it. Two implementations of this convention is one implementation
 * plus a future incident.
 */

export interface RequestScope {
  level: RoleLevel;
  organizationId: string | null;
  workspaceId: string | null;
}

export interface ScopeConfig {
  /** Stripped before matching. '/api/v1' on the server, unset on the web. */
  apiPrefix?: string;
  /** Path segment naming organizations. Override only if the URL vocabulary changes. */
  organizationsSegment?: string;
  workspacesSegment?: string;
}

const DEFAULTS = { organizationsSegment: 'organizations', workspacesSegment: 'workspaces' } as const;

/**
 * Never throws and never returns undefined: an unrecognised path is app level
 * with no ids, which is the most restrictive reading. A parser that threw would
 * turn a typo'd URL into a 500 instead of a 403.
 */
export function parseScope(pathname: string, config: ScopeConfig = {}): RequestScope {
  const orgSegment = config.organizationsSegment ?? DEFAULTS.organizationsSegment;
  const wsSegment = config.workspacesSegment ?? DEFAULTS.workspacesSegment;

  let path = pathname.split('?')[0] ?? '';
  if (config.apiPrefix && path.startsWith(config.apiPrefix)) {
    path = path.slice(config.apiPrefix.length);
  }

  const segments = path.split('/').filter(Boolean);

  // '/organizations' with no id is a listing, not an organization-scoped
  // request — app level, so it is not treated as scoped to nothing.
  const organizationId = segments[0] === orgSegment && segments[1] ? decodeURIComponent(segments[1]) : null;
  if (!organizationId) return { level: 'app', organizationId: null, workspaceId: null };

  const workspaceId = segments[2] === wsSegment && segments[3] ? decodeURIComponent(segments[3]) : null;
  if (!workspaceId) return { level: 'organization', organizationId, workspaceId: null };

  return { level: 'workspace', organizationId, workspaceId };
}

/** The inverse, so links are built from the same convention they are parsed by. */
export function scopePath(
  scope: { organizationId?: string | null; workspaceId?: string | null },
  suffix = '',
  config: ScopeConfig = {},
): string {
  const orgSegment = config.organizationsSegment ?? DEFAULTS.organizationsSegment;
  const wsSegment = config.workspacesSegment ?? DEFAULTS.workspacesSegment;
  const tail = suffix.replace(/^\/+/, '');

  const parts = [config.apiPrefix?.replace(/\/+$/, '') ?? ''];
  if (scope.organizationId) {
    parts.push(orgSegment, encodeURIComponent(scope.organizationId));
    if (scope.workspaceId) parts.push(wsSegment, encodeURIComponent(scope.workspaceId));
  }
  if (tail) parts.push(tail);

  return `${parts.filter(Boolean).join('/')}`.replace(/^(?!\/)/, '/');
}

/**
 * Guards the convention itself: a request that reached a workspace-level path
 * must carry both ids. Catches a route declared one level deeper than it parses.
 */
export function isScopeConsistent(scope: RequestScope): boolean {
  if (scope.level === 'workspace') return Boolean(scope.organizationId && scope.workspaceId);
  if (scope.level === 'organization') return Boolean(scope.organizationId && !scope.workspaceId);
  return !scope.organizationId && !scope.workspaceId;
}
