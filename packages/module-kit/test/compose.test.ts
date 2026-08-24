import {
  composeFeatures,
  composeNav,
  composeRoutes,
  ModuleCompositionError,
  matchRoute,
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
