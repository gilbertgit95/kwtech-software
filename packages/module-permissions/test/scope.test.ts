import { isScopeConsistent, parseScope, scopePath } from '../src/scope.js';

/**
 * One convention, parsed in one place, because the Nest guard, the Next
 * middleware, the navigation builder and these tests must all agree on it. Two
 * implementations of a URL convention is one implementation plus a future
 * incident.
 *
 *   /api/v1/*                                          app
 *   /api/v1/organizations/:orgId/*                     organization
 *   /api/v1/organizations/:orgId/workspaces/:wsId/*    workspace
 */

describe('parseScope — levels', () => {
  it('reads an app-level path', () => {
    expect(parseScope('/health')).toEqual({ level: 'app', organizationId: null, workspaceId: null });
  });

  it('reads an organization-level path', () => {
    expect(parseScope('/organizations/org1/members')).toEqual({
      level: 'organization',
      organizationId: 'org1',
      workspaceId: null,
    });
  });

  it('reads a workspace-level path', () => {
    expect(parseScope('/organizations/org1/workspaces/ws1/data-samples')).toEqual({
      level: 'workspace',
      organizationId: 'org1',
      workspaceId: 'ws1',
    });
  });

  it('treats /organizations with no id as app level — it is a listing, not a scoped request', () => {
    expect(parseScope('/organizations')).toEqual({ level: 'app', organizationId: null, workspaceId: null });
  });

  it('treats a trailing /workspaces with no id as organization level', () => {
    expect(parseScope('/organizations/org1/workspaces')).toMatchObject({
      level: 'organization',
      workspaceId: null,
    });
  });
});

describe('parseScope — never throws, always the most restrictive reading', () => {
  it.each([
    ['', 'empty'],
    ['/', 'root'],
    ['///', 'only separators'],
    ['/orgs/org1', 'a different vocabulary'],
    ['/workspaces/ws1', 'a workspace with no organization'],
    ['/organizations//workspaces/ws1', 'an empty organization id'],
  ])('resolves %p (%s) to app level with no ids', (path) => {
    // A parser that threw would turn a typo'd URL into a 500 instead of a 403.
    expect(parseScope(path)).toEqual({ level: 'app', organizationId: null, workspaceId: null });
  });
});

describe('parseScope — apiPrefix and query strings', () => {
  it('strips the configured prefix', () => {
    expect(parseScope('/api/v1/organizations/org1/members', { apiPrefix: '/api/v1' })).toMatchObject({
      level: 'organization',
      organizationId: 'org1',
    });
  });

  it('does NOT strip a prefix that was not configured', () => {
    // The ids would otherwise be read one segment off, silently.
    expect(parseScope('/api/v1/organizations/org1/members')).toMatchObject({ level: 'app' });
  });

  it('ignores the query string', () => {
    expect(parseScope('/organizations/org1?tab=members')).toMatchObject({
      level: 'organization',
      organizationId: 'org1',
    });
  });

  it('decodes percent-encoded ids', () => {
    expect(parseScope('/organizations/acme%20inc')).toMatchObject({ organizationId: 'acme inc' });
  });

  it('honours an overridden vocabulary', () => {
    expect(
      parseScope('/orgs/org1/projects/p1', { organizationsSegment: 'orgs', workspacesSegment: 'projects' }),
    ).toEqual({ level: 'workspace', organizationId: 'org1', workspaceId: 'p1' });
  });
});

describe('scopePath', () => {
  it('builds each level', () => {
    expect(scopePath({})).toBe('/');
    expect(scopePath({ organizationId: 'org1' })).toBe('/organizations/org1');
    expect(scopePath({ organizationId: 'org1', workspaceId: 'ws1' })).toBe('/organizations/org1/workspaces/ws1');
  });

  it('appends a suffix without doubling the separator', () => {
    expect(scopePath({ organizationId: 'org1' }, '/members')).toBe('/organizations/org1/members');
    expect(scopePath({ organizationId: 'org1' }, 'members')).toBe('/organizations/org1/members');
  });

  it('applies the api prefix', () => {
    expect(scopePath({ organizationId: 'org1' }, 'members', { apiPrefix: '/api/v1' })).toBe(
      '/api/v1/organizations/org1/members',
    );
  });

  it('drops a workspace with no organization — there is no such path', () => {
    expect(scopePath({ workspaceId: 'ws1' })).toBe('/');
  });

  it('encodes ids', () => {
    expect(scopePath({ organizationId: 'acme inc' })).toBe('/organizations/acme%20inc');
  });
});

describe('parseScope ∘ scopePath round-trips', () => {
  it.each([
    { organizationId: null, workspaceId: null },
    { organizationId: 'org1', workspaceId: null },
    { organizationId: 'org1', workspaceId: 'ws1' },
    { organizationId: 'acme inc', workspaceId: 'ws/1' },
  ])('survives %j', (scope) => {
    // The inverse must actually be the inverse, or links point somewhere the
    // guard parses differently.
    expect(parseScope(scopePath(scope))).toMatchObject(scope);
  });

  it('round-trips through the api prefix too', () => {
    const config = { apiPrefix: '/api/v1' };
    const path = scopePath({ organizationId: 'org1', workspaceId: 'ws1' }, 'data', config);
    expect(parseScope(path, config)).toMatchObject({ organizationId: 'org1', workspaceId: 'ws1' });
  });
});

describe('isScopeConsistent', () => {
  it('accepts each well-formed level', () => {
    expect(isScopeConsistent({ level: 'app', organizationId: null, workspaceId: null })).toBe(true);
    expect(isScopeConsistent({ level: 'organization', organizationId: 'o', workspaceId: null })).toBe(true);
    expect(isScopeConsistent({ level: 'workspace', organizationId: 'o', workspaceId: 'w' })).toBe(true);
  });

  it('rejects a workspace level missing an id — a route declared a level deeper than it parses', () => {
    expect(isScopeConsistent({ level: 'workspace', organizationId: 'o', workspaceId: null })).toBe(false);
    expect(isScopeConsistent({ level: 'workspace', organizationId: null, workspaceId: 'w' })).toBe(false);
  });

  it('rejects an organization level carrying a workspace id', () => {
    expect(isScopeConsistent({ level: 'organization', organizationId: 'o', workspaceId: 'w' })).toBe(false);
  });

  it('rejects an app level carrying any id', () => {
    expect(isScopeConsistent({ level: 'app', organizationId: 'o', workspaceId: null })).toBe(false);
  });

  it('holds for everything parseScope produces', () => {
    for (const path of ['/x', '/organizations/o', '/organizations/o/workspaces/w', '/organizations', '///']) {
      expect(isScopeConsistent(parseScope(path))).toBe(true);
    }
  });
});
