import { FEATURE, FEATURE_REGISTRY } from '../src/feature-keys.js';
import {
  buildBindingIndex,
  featuresForSurface,
  graphqlIdentifier,
  restIdentifier,
} from '../src/server/binding-index.js';
import type { FeatureSpec } from '../src/types.js';

const spec = (key: string, bindings: NonNullable<FeatureSpec['bindings']>): FeatureSpec => ({
  key,
  module: 'test',
  level: 'organization',
  label: key,
  description: key,
  bindings,
});

describe('buildBindingIndex', () => {
  it('indexes API surfaces', () => {
    const index = buildBindingIndex([
      spec('a:b', [
        { surface: 'rest_endpoint', identifier: 'GET /things' },
        { surface: 'graphql_operation', identifier: 'Query.things' },
      ]),
    ]);
    expect(featuresForSurface(index, 'GET /things')).toEqual(['a:b']);
    expect(featuresForSurface(index, 'Query.things')).toEqual(['a:b']);
  });

  /**
   * A `ui_route` binding looks like a path. Indexing it would have the guard
   * match a page URL and refuse the request for the wrong reason entirely.
   */
  it('ignores UI surfaces', () => {
    const index = buildBindingIndex([
      spec('a:b', [
        { surface: 'ui_route', identifier: '/admin/things' },
        { surface: 'ui_component', identifier: 'ThingsPage' },
      ]),
    ]);
    expect(index.size).toBe(0);
  });

  it('collects every key bound to one surface', () => {
    const index = buildBindingIndex([
      spec('a:b', [{ surface: 'rest_endpoint', identifier: 'GET /x' }]),
      spec('c:d', [{ surface: 'rest_endpoint', identifier: 'GET /x' }]),
    ]);
    expect(featuresForSurface(index, 'GET /x')).toEqual(['a:b', 'c:d']);
  });

  /** Undefined means "no binding — let it through", which is opt-in enforcement. */
  it('is undefined for an unbound surface', () => {
    expect(featuresForSurface(buildBindingIndex([]), 'GET /anything')).toBeUndefined();
  });
});

describe('restIdentifier', () => {
  it('builds METHOD /path', () => {
    expect(restIdentifier('get', '/permissions/features')).toBe('GET /permissions/features');
  });

  /**
   * A binding describes the route as the MODULE declares it; the request
   * carries wherever the app mounted it. Writing the prefix into the registry
   * would make the same module's bindings wrong in the next app.
   */
  it('strips the app prefix', () => {
    expect(restIdentifier('GET', '/api/v1/permissions/features', '/api/v1')).toBe('GET /permissions/features');
    expect(restIdentifier('GET', '/api/v1/permissions/features', 'api/v1')).toBe('GET /permissions/features');
  });

  it('leaves a path that does not carry the prefix alone', () => {
    expect(restIdentifier('GET', '/health', '/api/v1')).toBe('GET /health');
  });

  /** A prefix must match a whole segment: /api/v1x is not /api/v1. */
  it('does not strip a partial segment match', () => {
    expect(restIdentifier('GET', '/api/v1x/things', '/api/v1')).toBe('GET /api/v1x/things');
  });

  it('drops the query string and a trailing slash', () => {
    expect(restIdentifier('GET', '/things/?a=1', undefined)).toBe('GET /things');
  });
});

describe('featuresForSurface with parameters', () => {
  const index = buildBindingIndex([
    spec('org:read', [{ surface: 'rest_endpoint', identifier: 'GET /organizations/:id/members' }]),
  ]);

  it('matches a parameterised binding', () => {
    expect(featuresForSurface(index, 'GET /organizations/abc/members')).toEqual(['org:read']);
  });

  it('does not match a different method', () => {
    expect(featuresForSurface(index, 'POST /organizations/abc/members')).toBeUndefined();
  });

  /** A parameter matches ONE segment, so a binding cannot swallow a deeper path. */
  it('does not match a deeper path', () => {
    expect(featuresForSurface(index, 'GET /organizations/abc/members/xyz')).toBeUndefined();
  });

  it('does not match an empty segment', () => {
    expect(featuresForSurface(index, 'GET /organizations//members')).toBeUndefined();
  });

  it('prefers an exact binding over a parameterised one', () => {
    const both = buildBindingIndex([
      spec('exact:key', [{ surface: 'rest_endpoint', identifier: 'GET /things/new' }]),
      spec('param:key', [{ surface: 'rest_endpoint', identifier: 'GET /things/:id' }]),
    ]);
    expect(featuresForSurface(both, 'GET /things/new')).toEqual(['exact:key']);
  });
});

describe('graphqlIdentifier', () => {
  it('builds Type.field', () => {
    expect(graphqlIdentifier('Query', 'permissionFeatures')).toBe('Query.permissionFeatures');
  });
});

/** The whole point: the real registry's API bindings resolve to real keys. */
describe('the live registry', () => {
  const index = buildBindingIndex(FEATURE_REGISTRY);

  it.each([
    ['GET /permissions/features', FEATURE.featuresRead],
    ['Query.permissionFeatures', FEATURE.featuresRead],
  ])('%s is guarded by %s', (identifier, key) => {
    expect(featuresForSurface(index, identifier)).toContain(key);
  });

  /** Deliberately unbound: asking what you hold is not a privilege. */
  it('leaves the caller-own-grants surfaces unbound', () => {
    expect(featuresForSurface(index, 'GET /permissions/me')).toBeUndefined();
    expect(featuresForSurface(index, 'Query.myPermissions')).toBeUndefined();
  });

  it('binds no UI route into the request index', () => {
    expect(featuresForSurface(index, 'GET /admin/features')).toBeUndefined();
  });
});
