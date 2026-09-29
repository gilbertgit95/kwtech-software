import { composeFeatures } from '@kwtech/module-kit';
import { POS_FEATURE, POS_FEATURE_REGISTRY, POS_ROLE_PRESETS } from '../src/feature-keys.js';

/**
 * The registry is a CONTRACT with the host, even for a placeholder: a key at
 * the wrong level offers the app nowhere, and a preset naming an undeclared key
 * fails the seed.
 */
describe('POS_FEATURE_REGISTRY', () => {
  it('declares the keys in POS_FEATURE, and no others', () => {
    expect(POS_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(POS_FEATURE).sort());
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(POS_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(POS_FEATURE_REGISTRY.every((spec) => spec.module === 'pos' && spec.key.startsWith('pos:'))).toBe(true);
  });

  it('⚠ binds nothing, because there is no API yet — the first operation must be bound here', () => {
    expect(POS_FEATURE_REGISTRY.flatMap((spec) => spec.bindings ?? [])).toEqual([]);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'pos', features: POS_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(POS_FEATURE_REGISTRY.length + 1);
  });
});

describe('POS_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level', () => {
    const declared = new Set<string>(Object.values(POS_FEATURE));
    for (const preset of POS_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });
});
