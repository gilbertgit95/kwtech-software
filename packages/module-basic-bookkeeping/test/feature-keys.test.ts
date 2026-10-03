import { composeApps, composeFeatures, composeNav, composeRoutes } from '@kwtech/module-kit';
import { BOOKS_FEATURE, BOOKS_FEATURE_REGISTRY, BOOKS_ROLE_PRESETS } from '../src/feature-keys.js';
import { BooksApp } from '../src/react/books-app.js';
import { booksWebModule } from '../src/react/module.js';

/**
 * The registry and the web descriptor are CONTRACTS with the host. Every
 * assertion here is about a mistake that would be silent.
 */
describe('BOOKS_FEATURE_REGISTRY', () => {
  it('declares the keys in BOOKS_FEATURE, and no others', () => {
    expect(BOOKS_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(BOOKS_FEATURE).sort());
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(BOOKS_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(BOOKS_FEATURE_REGISTRY.every((spec) => spec.module === 'books' && spec.key.startsWith('books:'))).toBe(true);
  });

  it('flags only managing investors as privileged — it pays the owners', () => {
    expect(BOOKS_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key)).toEqual([
      BOOKS_FEATURE.manageInvestors,
    ]);
  });

  it('⚠ binds every key — a key with no binding guards nothing while reading as coverage', () => {
    for (const spec of BOOKS_FEATURE_REGISTRY) {
      expect([spec.key, (spec.bindings ?? []).length > 0]).toEqual([spec.key, true]);
    }
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'books', features: BOOKS_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(BOOKS_FEATURE_REGISTRY.length + 1);
  });
});

describe('BOOKS_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level', () => {
    const declared = new Set<string>(Object.values(BOOKS_FEATURE));
    for (const preset of BOOKS_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });

  it('⚠ gives the owner every bookkeeper key, and keeps the owners’ money from the bookkeeper', () => {
    const bookkeeper = BOOKS_ROLE_PRESETS.find((preset) => preset.key === 'books-bookkeeper');
    const owner = BOOKS_ROLE_PRESETS.find((preset) => preset.key === 'books-owner');
    expect(bookkeeper?.features.every((key) => owner?.features.includes(key))).toBe(true);
    expect([...(owner?.features ?? [])].sort()).toEqual(Object.values(BOOKS_FEATURE).sort());
    expect(bookkeeper?.features).not.toContain(BOOKS_FEATURE.manageInvestors);
  });
});

describe('booksWebModule', () => {
  const module = booksWebModule();

  it('offers the books on the Apps page, gated on books:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({ key: 'books', label: 'Books', feature: BOOKS_FEATURE.read, component: BooksApp }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['books']);
  });

  it('⚠ has no route and nothing in the drawer — a sub-app is reached from the Apps page', () => {
    expect(composeRoutes([module])).toEqual([]);
    expect(composeNav([module], [BOOKS_FEATURE.read], { params: {} })).toEqual([]);
  });
});
