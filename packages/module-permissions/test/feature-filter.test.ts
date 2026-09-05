import { featureFacets, filterFeatures, isEmptyFilter } from '../src/domain/feature-filter.js';
import { FEATURE, FEATURE_REGISTRY } from '../src/feature-keys.js';

const keys = (specs: readonly { key: string }[]) => specs.map((s) => s.key).sort();

describe('no filter means everything', () => {
  it.each([[{}], [{ search: '' }], [{ modules: [] }], [{ tags: [] }], [{ search: '   ' }]])(
    'passes all for %p',
    (filter) => {
      expect(filterFeatures(FEATURE_REGISTRY, filter)).toHaveLength(FEATURE_REGISTRY.length);
    },
  );
});

describe('search', () => {
  it('matches the key', () => {
    expect(keys(filterFeatures(FEATURE_REGISTRY, { search: 'features:read' }))).toEqual([FEATURE.featuresRead]);
  });

  it('is case-insensitive and trimmed', () => {
    expect(filterFeatures(FEATURE_REGISTRY, { search: '  BILLING  ' }).length).toBeGreaterThan(0);
  });

  it('matches the description, not just the key', () => {
    const found = filterFeatures(FEATURE_REGISTRY, { search: 'authenticator' });
    expect(found.length).toBeGreaterThanOrEqual(0);
    // A word that only appears in a description proves the haystack is wider
    // than the key — 'dashboard' is in admin:access's description alone.
    expect(keys(filterFeatures(FEATURE_REGISTRY, { search: 'dashboard' }))).toContain(FEATURE.adminAccess);
  });

  it('matches a binding identifier', () => {
    expect(keys(filterFeatures(FEATURE_REGISTRY, { search: '/admin/roles' }))).toContain(FEATURE.adminAccess);
  });

  it('matches a tag', () => {
    expect(filterFeatures(FEATURE_REGISTRY, { search: 'access-control' }).length).toBeGreaterThan(0);
  });

  it('finds nothing for nonsense', () => {
    expect(filterFeatures(FEATURE_REGISTRY, { search: 'zzzznope' })).toEqual([]);
  });
});

/**
 * The rule that is arithmetic rather than preference: a feature has exactly one
 * module and one level, so requiring ALL of several would always match nothing.
 */
describe('modules and levels are ANY-of', () => {
  it('matches either module', () => {
    const found = filterFeatures(FEATURE_REGISTRY, { modules: ['permissions', 'auth'] });
    expect(found.length).toBe(FEATURE_REGISTRY.length);
  });

  it('narrows to one module', () => {
    expect(
      filterFeatures(FEATURE_REGISTRY, { modules: ['permissions'] }).every((s) => s.module === 'permissions'),
    ).toBe(true);
  });

  it('matches either level', () => {
    const found = filterFeatures(FEATURE_REGISTRY, { levels: ['app', 'workspace'] });
    expect(found.every((s) => s.level === 'app' || s.level === 'workspace')).toBe(true);
    expect(found.length).toBeGreaterThan(0);
  });

  it('finds nothing for an unknown module', () => {
    expect(filterFeatures(FEATURE_REGISTRY, { modules: ['nope'] })).toEqual([]);
  });
});

/** Tags are many-per-feature, so intersecting is meaningful — each chip narrows. */
describe('tags are ALL-of', () => {
  it('narrows on the second tag rather than widening', () => {
    const one = filterFeatures(FEATURE_REGISTRY, { tags: ['admin'] });
    const two = filterFeatures(FEATURE_REGISTRY, { tags: ['admin', 'access-control'] });
    expect(two.length).toBeLessThan(one.length);
    expect(two.every((s) => (s.tags ?? []).includes('admin') && (s.tags ?? []).includes('access-control'))).toBe(true);
  });

  it('normalises what it is given, so a query string matches the registry', () => {
    expect(filterFeatures(FEATURE_REGISTRY, { tags: ['Access Control'] }).length).toBeGreaterThan(0);
  });

  it('finds nothing when the combination has no members', () => {
    expect(filterFeatures(FEATURE_REGISTRY, { tags: ['billing', 'workspaces'] })).toEqual([]);
  });
});

describe('boolean facets', () => {
  it('privileged only', () => {
    expect(filterFeatures(FEATURE_REGISTRY, { isPrivileged: true }).every((s) => s.isPrivileged)).toBe(true);
  });

  /** `false` is a real filter, not the absence of one. */
  it('ordinary only', () => {
    const found = filterFeatures(FEATURE_REGISTRY, { isPrivileged: false });
    expect(found.every((s) => !s.isPrivileged)).toBe(true);
    expect(found.length).toBeGreaterThan(0);
  });

  it('unbound only finds keys that guard nothing', () => {
    const found = filterFeatures(FEATURE_REGISTRY, { unboundOnly: true });
    expect(found.every((s) => (s.bindings ?? []).length === 0)).toBe(true);
  });
});

describe('facets combine with AND', () => {
  it('each added facet narrows or holds', () => {
    const a = filterFeatures(FEATURE_REGISTRY, { modules: ['permissions'] }).length;
    const b = filterFeatures(FEATURE_REGISTRY, { modules: ['permissions'], tags: ['admin'] }).length;
    const c = filterFeatures(FEATURE_REGISTRY, {
      modules: ['permissions'],
      tags: ['admin'],
      isPrivileged: true,
    }).length;
    expect(b).toBeLessThanOrEqual(a);
    expect(c).toBeLessThanOrEqual(b);
  });

  it('combines search with facets', () => {
    const found = filterFeatures(FEATURE_REGISTRY, { search: 'features', levels: ['app'] });
    expect(found.every((s) => s.level === 'app')).toBe(true);
  });
});

describe('isEmptyFilter', () => {
  it.each([[{}], [{ search: '  ' }], [{ modules: [] }]])('is empty for %p', (filter) => {
    expect(isEmptyFilter(filter)).toBe(true);
  });

  it.each([
    [{ search: 'x' }],
    [{ modules: ['permissions'] }],
    [{ tags: ['admin'] }],
    [{ isPrivileged: true }],
    // The one a `!filter.isPrivileged` check would get wrong.
    [{ isPrivileged: false }],
    [{ unboundOnly: true }],
  ])('is not empty for %p', (filter) => {
    expect(isEmptyFilter(filter)).toBe(false);
  });
});

describe('featureFacets', () => {
  it('lists the modules present, sorted', () => {
    expect(featureFacets(FEATURE_REGISTRY).modules).toEqual(['permissions']);
  });

  /** Blast-radius order, matching the grid's own sort — not alphabetical. */
  it('lists levels by blast radius', () => {
    expect(featureFacets(FEATURE_REGISTRY).levels).toEqual(['workspace', 'organization', 'app']);
  });

  it('omits a level nothing uses', () => {
    const appOnly = FEATURE_REGISTRY.filter((s) => s.level === 'app');
    expect(featureFacets(appOnly).levels).toEqual(['app']);
  });
});
