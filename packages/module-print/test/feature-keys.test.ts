import { composeFeatures } from '@kwtech/module-kit';
import {
  PRINT_FEATURE,
  PRINT_FEATURE_REGISTRY,
  PRINT_LIMIT,
  PRINT_LIMIT_REGISTRY,
  PRINT_ROLE_PRESETS,
} from '../src/feature-keys.js';
import { printServerModule } from '../src/server/server-module.js';

/**
 * The registry is a CONTRACT with the host. Every assertion here is about a
 * mistake that would be silent — a key at the wrong level, a cap that resolves
 * to infinity, a preset naming a key that does not exist.
 */
describe('PRINT_FEATURE_REGISTRY', () => {
  it('declares the three keys in PRINT_FEATURE, and no others', () => {
    expect(PRINT_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(PRINT_FEATURE).sort());
    expect(PRINT_FEATURE_REGISTRY).toHaveLength(3);
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(PRINT_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(PRINT_FEATURE_REGISTRY.every((spec) => spec.module === 'print' && spec.key.startsWith('print:'))).toBe(true);
  });

  it('⚠ flags pairing as privileged: a paired computer receives the workspace’s print jobs', () => {
    expect(PRINT_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key)).toEqual([
      PRINT_FEATURE.manageAgents,
    ]);
  });

  it('⚠ binds every key — a key with no binding guards nothing while reading as coverage', () => {
    for (const spec of PRINT_FEATURE_REGISTRY) {
      expect([spec.key, (spec.bindings ?? []).length > 0]).toEqual([spec.key, true]);
    }
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'print', features: PRINT_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(PRINT_FEATURE_REGISTRY.length + 1);
  });

  it('arrives on the server descriptor with the cap, and no background process', () => {
    const descriptor = printServerModule();
    expect(descriptor.key).toBe('print');
    expect(descriptor.features).toBe(PRINT_FEATURE_REGISTRY);
    expect(descriptor.limits).toBe(PRINT_LIMIT_REGISTRY);
    expect(descriptor.processes).toBeUndefined();
  });
});

describe('PRINT_LIMIT_REGISTRY', () => {
  it('declares the one cap, plan-sourced because the keys are workspace level, counted per workspace', () => {
    expect(PRINT_LIMIT_REGISTRY.map((spec) => spec.key)).toEqual(Object.values(PRINT_LIMIT));
    expect(PRINT_LIMIT_REGISTRY.every((spec) => spec.source === 'plan' && spec.module === 'print')).toBe(true);
    expect(PRINT_LIMIT_REGISTRY.every((spec) => spec.countedOver === 'workspace')).toBe(true);
  });

  it('⚠ never defaults to unlimited — the default is what an unconfigured plan gets', () => {
    expect(PRINT_LIMIT_REGISTRY.every((spec) => typeof spec.defaultValue === 'number' && spec.defaultValue > 0)).toBe(
      true,
    );
  });
});

describe('PRINT_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level, and always the read key', () => {
    const declared = new Set<string>(Object.values(PRINT_FEATURE));
    for (const preset of PRINT_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
      // Without the read key the app does not appear on the Apps page.
      expect(preset.features).toContain(PRINT_FEATURE.read);
    }
  });

  it('lets both presets print: seeing a printer one cannot use is half a feature', () => {
    for (const preset of PRINT_ROLE_PRESETS) expect(preset.features).toContain(PRINT_FEATURE.send);
  });

  it('gives pairing to the admin preset alone', () => {
    const holders = PRINT_ROLE_PRESETS.filter((preset) => preset.features.includes(PRINT_FEATURE.manageAgents));
    expect(holders.map((preset) => preset.key)).toEqual(['print-admin']);
  });
});
