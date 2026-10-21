import { composeApps, composeFeatures, composeNav, composeRoutes } from '@kwtech/module-kit';
import {
  STOCK_FEATURE,
  STOCK_FEATURE_REGISTRY,
  STOCK_LIMIT_REGISTRY,
  STOCK_ROLE_PRESETS,
} from '../src/feature-keys.js';
import { STOCK_PROCESS_REGISTRY } from '../src/processes.js';
import { stockWebModule } from '../src/react/module.js';
import { StockApp } from '../src/react/stock-app.js';

/**
 * The registry and the web descriptor are CONTRACTS with the host. Every
 * assertion here is about a mistake that would be silent.
 */
describe('STOCK_FEATURE_REGISTRY', () => {
  it('declares the keys in STOCK_FEATURE, and no others', () => {
    expect(STOCK_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(STOCK_FEATURE).sort());
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(STOCK_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(STOCK_FEATURE_REGISTRY.every((spec) => spec.module === 'stock' && spec.key.startsWith('stock:'))).toBe(true);
  });

  it('⚠ binds every key — a key with no binding guards nothing while reading as coverage', () => {
    for (const spec of STOCK_FEATURE_REGISTRY) {
      expect([spec.key, (spec.bindings ?? []).length > 0]).toEqual([spec.key, true]);
    }
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'stock', features: STOCK_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(STOCK_FEATURE_REGISTRY.length + 1);
  });

  it('caps items from the plan, per workspace, with a finite default', () => {
    expect(STOCK_LIMIT_REGISTRY).toEqual([
      expect.objectContaining({ key: 'stock:items', source: 'plan', countedOver: 'workspace', defaultValue: 1000 }),
    ]);
  });

  it('serves its catch-up only where the plan includes stock', () => {
    expect(STOCK_PROCESS_REGISTRY.map((process) => [process.key, process.serves])).toEqual([
      ['stock.catch_up', STOCK_FEATURE.read],
    ]);
  });
});

describe('STOCK_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level', () => {
    const declared = new Set<string>(Object.values(STOCK_FEATURE));
    for (const preset of STOCK_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });

  it('⚠ gives the manager every keeper key, and keeps lists and stock takes from the keeper', () => {
    const keeper = STOCK_ROLE_PRESETS.find((preset) => preset.key === 'stock-keeper');
    const manager = STOCK_ROLE_PRESETS.find((preset) => preset.key === 'stock-manager');
    expect(keeper?.features.every((key) => manager?.features.includes(key))).toBe(true);
    expect([...(manager?.features ?? [])].sort()).toEqual(Object.values(STOCK_FEATURE).sort());
    expect(keeper?.features).toEqual([STOCK_FEATURE.read, STOCK_FEATURE.receive]);
  });
});

describe('stockWebModule', () => {
  const module = stockWebModule();

  it('offers stock on the Apps page, gated on stock:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({ key: 'stock', label: 'Stock', feature: STOCK_FEATURE.read, component: StockApp }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['stock']);
  });

  it('⚠ has no route and nothing in the drawer — a sub-app is reached from the Apps page', () => {
    expect(composeRoutes([module])).toEqual([]);
    expect(composeNav([module], [STOCK_FEATURE.read], { params: {} })).toEqual([]);
  });
});
