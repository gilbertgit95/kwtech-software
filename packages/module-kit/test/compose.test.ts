import {
  composeFeatures,
  composeNav,
  composeNavGroups,
  composeRoutes,
  ModuleCompositionError,
  matchRoute,
  matchRouteWithParams,
  navGroupRank,
  serverModuleImports,
  serverRoutePrefixes,
} from '../src/compose.js';
import type { ModuleRoute, ServerModuleDescriptor, WebModuleDescriptor } from '../src/types.js';

/**
 * Composition fails LOUDLY. Two modules quietly owning one path — or one
 * feature key — is the failure this package exists to catch, and a silent
 * winner is worse than a failed boot: it picks one at random and nobody finds
 * out until the wrong page renders.
 */

const Page = (() => null) as unknown as ModuleRoute['component'];

const route = (over: Partial<ModuleRoute> & Pick<ModuleRoute, 'path'>): ModuleRoute => ({
  component: Page,
  title: over.path,
  ...over,
});

const web = (
  key: string,
  routes: ModuleRoute[],
  features: WebModuleDescriptor['features'] = [],
): WebModuleDescriptor => ({
  key,
  routes,
  features,
});

describe('composeRoutes', () => {
  it('flattens every module’s routes in module order', () => {
    const routes = composeRoutes([web('a', [route({ path: '/a' })]), web('b', [route({ path: '/b' })])]);
    expect(routes.map((r) => r.path)).toEqual(['/a', '/b']);
  });

  it('throws on a duplicate path, naming both owners', () => {
    expect(() => composeRoutes([web('a', [route({ path: '/x' })]), web('b', [route({ path: '/x' })])])).toThrow(
      ModuleCompositionError,
    );
    expect(() => composeRoutes([web('a', [route({ path: '/x' })]), web('b', [route({ path: '/x' })])])).toThrow(
      /Route \/x declared by both 'a' and 'b'/,
    );
  });

  it('throws on a duplicate WITHIN one module too', () => {
    expect(() => composeRoutes([web('a', [route({ path: '/x' }), route({ path: '/x' })])])).toThrow(
      ModuleCompositionError,
    );
  });

  it('tolerates a module with no routes at all', () => {
    expect(composeRoutes([{ key: 'server-only' }])).toEqual([]);
  });
});

describe('composeNav', () => {
  const modules = [
    web('a', [
      route({ path: '/z', title: 'Zebra', nav: { group: 'Admin', order: 2 } }),
      route({ path: '/a', title: 'Apple', nav: { group: 'Admin', order: 1 }, feature: 'admin:access' }),
      route({ path: '/hidden', title: 'Hidden' }),
    ]),
  ];

  it('lists only routes that asked for a nav entry', () => {
    expect(composeNav(modules).map((e) => e.label)).toEqual(['Apple', 'Zebra']);
  });

  it('sorts by group, then order, then label', () => {
    const nav = composeNav([
      web('a', [
        route({ path: '/1', title: 'B', nav: { group: 'Zed', order: 1 } }),
        route({ path: '/2', title: 'A', nav: { group: 'Alpha', order: 5 } }),
        route({ path: '/3', title: 'A', nav: { group: 'Alpha', order: 1 } }),
      ]),
    ]);

    expect(nav.map((e) => [e.group, e.label])).toEqual([
      ['Alpha', 'A'],
      ['Alpha', 'A'],
      ['Zed', 'B'],
    ]);
    expect(nav[0]?.order).toBe(1);
  });

  it('returns the unfiltered menu when no held features are passed — the role editor wants that', () => {
    expect(composeNav(modules)).toHaveLength(2);
  });

  it('hides a guarded entry the caller does not hold', () => {
    // Derived from the same route list the middleware protects, which is what
    // stops a menu linking somewhere the guard refuses.
    expect(composeNav(modules, []).map((e) => e.label)).toEqual(['Zebra']);
  });

  it('keeps an unguarded entry when filtering', () => {
    expect(composeNav(modules, ['admin:access']).map((e) => e.label)).toEqual(['Apple', 'Zebra']);
  });

  it('carries the feature key through, so the entry can say what it needs', () => {
    expect(composeNav(modules).find((e) => e.label === 'Apple')?.feature).toBe('admin:access');
    expect(composeNav(modules).find((e) => e.label === 'Zebra')).not.toHaveProperty('feature');
  });

  it('inherits composeRoutes’ duplicate check', () => {
    expect(() => composeNav([web('a', [route({ path: '/x' })]), web('b', [route({ path: '/x' })])])).toThrow(
      ModuleCompositionError,
    );
  });
});

/**
 * SCOPED ENTRIES — what makes the drawer switch into an organization.
 *
 * `/organizations/:organizationId/members` is not a URL. Listing it with the
 * placeholder still in it produces a link that 404s; listing it with the
 * segment removed produces a link to somebody else's page. So an entry whose
 * parameters cannot all be filled is ABSENT, which is the honest rendering of
 * "there is no active organization" — and its reappearance when there is one is
 * the whole mechanism, with nothing having to declare that the drawer switches.
 */
describe('composeNav with route parameters', () => {
  const modules = [
    web('tenant', [
      route({ path: '/organizations', title: 'Organizations', nav: { group: 'Org', order: 1 } }),
      route({
        path: '/organizations/:organizationId/members',
        title: 'Members',
        nav: { group: 'Org', order: 2 },
      }),
      route({
        path: '/organizations/:organizationId/workspaces/:workspaceId',
        title: 'Workspace',
        nav: { group: 'Org', order: 3 },
      }),
    ]),
  ];

  it('drops an entry whose parameters have no values', () => {
    expect(composeNav(modules).map((e) => e.label)).toEqual(['Organizations']);
  });

  it('lists it, substituted, once the value is there', () => {
    const nav = composeNav(modules, undefined, { params: { organizationId: 'org1' } });
    expect(nav.map((e) => e.href)).toEqual(['/organizations', '/organizations/org1/members']);
  });

  it('still drops an entry whose SECOND parameter has no value', () => {
    // A partially-filled path is never produced. The workspace entry needs a
    // workspace, and one organization does not supply it.
    const nav = composeNav(modules, undefined, { params: { organizationId: 'org1' } });
    expect(nav.map((e) => e.label)).not.toContain('Workspace');
  });

  it('fills every parameter when every parameter has a value', () => {
    const nav = composeNav(modules, undefined, { params: { organizationId: 'org1', workspaceId: 'ws1' } });
    expect(nav.find((e) => e.label === 'Workspace')?.href).toBe('/organizations/org1/workspaces/ws1');
  });

  it('treats an EMPTY value as no value', () => {
    // An empty string collapses the segment and shifts every id after it one
    // place left — '/organizations//members' is not a smaller URL, it is a
    // different one.
    expect(composeNav(modules, undefined, { params: { organizationId: '' } }).map((e) => e.label)).toEqual([
      'Organizations',
    ]);
  });

  it('encodes a value that needs it, so the href round-trips through parseScope', () => {
    expect(composeNav(modules, undefined, { params: { organizationId: 'a/b' } })[1]?.href).toBe(
      '/organizations/a%2Fb/members',
    );
  });

  it('applies the FEATURE filter before the parameters, so a held key is not required to be dropped', () => {
    const guarded = [
      web('tenant', [
        route({
          path: '/organizations/:organizationId/members',
          title: 'Members',
          feature: 'members:manage',
          nav: { group: 'Org', order: 1 },
        }),
      ]),
    ];
    // Not held: absent whether or not a scope is active.
    expect(composeNav(guarded, [], { params: { organizationId: 'org1' } })).toHaveLength(0);
    expect(composeNav(guarded, ['members:manage'], { params: { organizationId: 'org1' } })).toHaveLength(1);
  });

  it('leaves a parameterless route untouched by params it does not use', () => {
    expect(composeNav(modules, undefined, { params: { somethingElse: 'x' } }).map((e) => e.href)).toEqual([
      '/organizations',
    ]);
  });
});

describe('composeFeatures', () => {
  const feature = (key: string) => ({ key, module: 'm', label: key, description: key });

  it('collects the grantable vocabulary across modules', () => {
    const features = composeFeatures([web('a', [], [feature('a:x')]), web('b', [], [feature('b:y')])]);
    expect(features.map((f) => f.key)).toEqual(['a:x', 'b:y']);
  });

  it('throws when two modules define the same key', () => {
    // Two modules defining 'records:write' differently is exactly the ambiguity
    // a shared registry exists to prevent.
    expect(() =>
      composeFeatures([web('a', [], [feature('records:write')]), web('b', [], [feature('records:write')])]),
    ).toThrow(/Feature 'records:write' declared by both 'a' and 'b'/);
  });

  it('accepts server and web descriptors side by side', () => {
    const server: ServerModuleDescriptor = { key: 's', nestModule: class {}, features: [feature('s:x')] };
    expect(composeFeatures([server, web('w', [], [feature('w:y')])]).map((f) => f.key)).toEqual(['s:x', 'w:y']);
  });

  it('tolerates modules declaring no features', () => {
    expect(composeFeatures([{ key: 'plain' }])).toEqual([]);
  });
});

describe('matchRoute', () => {
  const routes = [route({ path: '/admin' }), route({ path: '/admin/roles' }), route({ path: '/admin/roles/new' })];

  it('prefers an exact match', () => {
    expect(matchRoute(routes, '/admin/roles')?.path).toBe('/admin/roles');
  });

  it('falls back to the longest matching prefix, so a static segment beats a shallower one', () => {
    // The catch-all page and the middleware both call this, so the route a
    // request RENDERS and the route it is AUTHORISED against are the same one.
    expect(matchRoute(routes, '/admin/roles/new/extra')?.path).toBe('/admin/roles/new');
  });

  it('requires a segment boundary — /adminx is not under /admin', () => {
    expect(matchRoute(routes, '/adminx')).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    expect(matchRoute(routes, '/somewhere-else')).toBeUndefined();
    expect(matchRoute([], '/admin')).toBeUndefined();
  });
});

describe('server wiring helpers', () => {
  const A = class {};
  const B = class {};
  const modules: ServerModuleDescriptor[] = [
    { key: 'a', nestModule: A, routePrefix: 'perm' },
    { key: 'b', nestModule: B },
  ];

  it('spreads every module into imports', () => {
    expect(serverModuleImports(modules)).toEqual([A, B]);
  });

  it('emits a prefix entry only for modules that asked for one', () => {
    expect(serverRoutePrefixes(modules)).toEqual([{ path: 'perm', module: A }]);
  });
});

describe('composeNavGroups', () => {
  const mod = (key: string, navGroups: { group: string; order: number }[]) => ({ key, navGroups });

  it('is empty when no module places a group', () => {
    expect(composeNavGroups([{ key: 'a' }])).toEqual([]);
  });

  it('sorts declared groups by order', () => {
    const groups = composeNavGroups([
      mod('a', [
        { group: 'Account', order: 90 },
        { group: 'Overview', order: 10 },
      ]),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['Overview', 'Account']);
  });

  /**
   * A shared group is the normal case, not a wiring bug — unlike a duplicate
   * route or feature key, which throw. Two modules contributing to
   * 'Administration' must not fail the boot.
   */
  it('does not throw when two modules place the same group', () => {
    expect(() =>
      composeNavGroups([
        mod('a', [{ group: 'Administration', order: 50 }]),
        mod('b', [{ group: 'Administration', order: 70 }]),
      ]),
    ).not.toThrow();
  });

  it('takes the lowest order for a shared group', () => {
    const groups = composeNavGroups([
      mod('a', [{ group: 'Administration', order: 50 }]),
      mod('b', [{ group: 'Administration', order: 20 }]),
    ]);
    expect(groups).toEqual([{ group: 'Administration', order: 20 }]);
  });

  /** The property that matters: the drawer cannot depend on module list order. */
  it('is independent of the order modules are listed in', () => {
    const a = mod('a', [
      { group: 'Administration', order: 50 },
      { group: 'Overview', order: 10 },
    ]);
    const b = mod('b', [{ group: 'Administration', order: 20 }]);
    expect(composeNavGroups([a, b])).toEqual(composeNavGroups([b, a]));
  });

  it('breaks an order tie alphabetically', () => {
    const groups = composeNavGroups([
      mod('a', [
        { group: 'Zulu', order: 10 },
        { group: 'Alpha', order: 10 },
      ]),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['Alpha', 'Zulu']);
  });
});

describe('navGroupRank', () => {
  const groups = [
    { group: 'Overview', order: 10 },
    { group: 'Administration', order: 50 },
  ];

  it('returns the declared order', () => {
    expect(navGroupRank(groups, 'Overview')).toBe(10);
    expect(navGroupRank(groups, 'Administration')).toBe(50);
  });

  /**
   * A new module whose group nobody placed appears at the BOTTOM, which is
   * visible and harmless. Ranking it first would put an unknown module's pages
   * above the dashboard on the day it was installed.
   */
  it('ranks an undeclared group after every declared one', () => {
    expect(navGroupRank(groups, 'Whatever')).toBeGreaterThan(50);
  });
});

describe('matchRouteWithParams', () => {
  const route = (path: string) => ({ path, title: path, component: (() => null) as never });
  const ROUTES = [
    route('/admin/features'),
    route('/admin/features/new/manual'),
    route('/admin/features/new/import'),
    route('/admin/features/:featureId/edit'),
    route('/admin/roles'),
  ];

  it('matches a literal path with no params', () => {
    const match = matchRouteWithParams(ROUTES, '/admin/features');
    expect(match?.route.path).toBe('/admin/features');
    expect(match?.params).toEqual({});
  });

  it('captures a dynamic segment', () => {
    const match = matchRouteWithParams(ROUTES, '/admin/features/billing:manage/edit');
    expect(match?.route.path).toBe('/admin/features/:featureId/edit');
    expect(match?.params).toEqual({ featureId: 'billing:manage' });
  });

  /**
   * The reason specificity is scored rather than left to array order:
   * '/admin/features/new/manual' and '/admin/features/:featureId/edit' are both
   * four segments, and without scoring the winner would be whichever module
   * happened to be listed first.
   */
  it('prefers a literal segment over a dynamic one', () => {
    expect(matchRouteWithParams(ROUTES, '/admin/features/new/manual')?.route.path).toBe('/admin/features/new/manual');
    expect(matchRouteWithParams(ROUTES, '/admin/features/new/import')?.route.path).toBe('/admin/features/new/import');
  });

  it('is independent of route declaration order', () => {
    const reversed = [...ROUTES].reverse();
    expect(matchRouteWithParams(reversed, '/admin/features/new/manual')?.route.path).toBe('/admin/features/new/manual');
  });

  it('URL-decodes a captured value', () => {
    const match = matchRouteWithParams(ROUTES, '/admin/features/billing%3Amanage/edit');
    expect(match?.params.featureId).toBe('billing:manage');
  });

  /** A pattern that swallowed extra segments would capture 'new' here. */
  it('does not let a dynamic segment span several path segments', () => {
    expect(matchRouteWithParams([route('/admin/features/:featureId')], '/admin/features/new/manual')).toBeUndefined();
  });

  /**
   * In isolation, so the prefix fallback does not mask it: an empty segment is
   * not a value, and '/features//edit' must not match with an id of ''.
   */
  it('refuses an empty dynamic segment', () => {
    expect(matchRouteWithParams([route('/admin/features/:featureId/edit')], '/admin/features//edit')).toBeUndefined();
  });

  /**
   * With a prefix owner present it falls through to that instead — the empty
   * segment still fails the pattern, and '/admin/features' legitimately owns
   * everything beneath it.
   */
  it('falls back to the prefix owner when a dynamic match is refused', () => {
    expect(matchRouteWithParams(ROUTES, '/admin/features//edit')?.route.path).toBe('/admin/features');
  });

  it('is undefined when nothing matches', () => {
    expect(matchRouteWithParams(ROUTES, '/nope')).toBeUndefined();
  });

  /** The pre-existing prefix behaviour, kept: a route may own everything beneath it. */
  it('falls back to the longest prefix owner when nothing matches exactly', () => {
    const match = matchRouteWithParams([route('/admin'), route('/admin/features')], '/admin/features/deep/path');
    expect(match?.route.path).toBe('/admin/features');
    expect(match?.params).toEqual({});
  });

  it('matchRoute returns just the route', () => {
    expect(matchRoute(ROUTES, '/admin/features/x/edit')?.path).toBe('/admin/features/:featureId/edit');
  });
});
