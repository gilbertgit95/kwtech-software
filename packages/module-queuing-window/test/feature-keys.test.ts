import { composeFeatures } from '@kwtech/module-kit';
import {
  QUEUE_FEATURE,
  QUEUE_FEATURE_REGISTRY,
  QUEUE_LIMIT,
  QUEUE_LIMIT_REGISTRY,
  QUEUE_ROLE_PRESETS,
} from '../src/feature-keys.js';

/**
 * The registry is a CONTRACT with the host. Every assertion here is about a
 * mistake that would be silent — a key granted at the wrong level, a cap that
 * resolves to infinity, a preset naming a key that does not exist.
 */

describe('QUEUE_FEATURE_REGISTRY', () => {
  it('declares the six keys in QUEUE_FEATURE, and no others', () => {
    expect(QUEUE_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(QUEUE_FEATURE).sort());
    expect(QUEUE_FEATURE_REGISTRY).toHaveLength(6);
  });

  it('⚠ is WORKSPACE LEVEL throughout — which is why every resolver must declare its scope', () => {
    expect(QUEUE_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module', () => {
    expect(QUEUE_FEATURE_REGISTRY.every((spec) => spec.module === 'queue')).toBe(true);
  });

  it('flags starting as privileged: it generates what admits a screen in a public room', () => {
    expect(QUEUE_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key)).toEqual([
      QUEUE_FEATURE.start,
    ]);
  });

  it('has no key for issuing a number, releasing your own seat, or your own nickname', () => {
    expect(QUEUE_FEATURE_REGISTRY.some((spec) => /issue|release|nickname/i.test(spec.key))).toBe(false);
  });

  it('⚠ binds every key to something — a key with no binding guards nothing while reading as coverage', () => {
    const unbound = QUEUE_FEATURE_REGISTRY.filter((spec) => (spec.bindings ?? []).length === 0);
    expect(unbound.map((spec) => spec.key)).toEqual([]);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'queue', features: QUEUE_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(QUEUE_FEATURE_REGISTRY.length + 1);
  });
});

describe('QUEUE_LIMIT_REGISTRY', () => {
  it('declares both caps, plan-sourced, because the keys are workspace level', () => {
    expect(QUEUE_LIMIT_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(QUEUE_LIMIT).sort());
    expect(QUEUE_LIMIT_REGISTRY.every((spec) => spec.source === 'plan')).toBe(true);
  });

  it('⚠ never defaults to unlimited — the default is what an unconfigured plan gets', () => {
    const defaults = Object.fromEntries(QUEUE_LIMIT_REGISTRY.map((spec) => [spec.key, spec.defaultValue]));
    expect(defaults).toEqual({ [QUEUE_LIMIT.windows]: 10, [QUEUE_LIMIT.displays]: 5 });
  });
});

describe('QUEUE_ROLE_PRESETS', () => {
  const declared = new Set<string>(Object.values(QUEUE_FEATURE));

  it('names only keys this module declares', () => {
    for (const preset of QUEUE_ROLE_PRESETS) {
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });

  it('ships staff, supervisor and admin, each a workspace role', () => {
    const byKey = Object.fromEntries(QUEUE_ROLE_PRESETS.map((preset) => [preset.key, [...preset.features].sort()]));

    expect(byKey['queue-staff']).toEqual([QUEUE_FEATURE.read, QUEUE_FEATURE.serve].sort());
    expect(byKey['queue-supervisor']).toEqual(
      [
        QUEUE_FEATURE.read,
        QUEUE_FEATURE.serve,
        QUEUE_FEATURE.assignWindows,
        QUEUE_FEATURE.start,
        QUEUE_FEATURE.stop,
      ].sort(),
    );
    expect(byKey['queue-admin']).toEqual([...declared].sort());
    expect(QUEUE_ROLE_PRESETS.every((preset) => preset.level === 'workspace')).toBe(true);
  });
});
