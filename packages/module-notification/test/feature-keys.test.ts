import { composeFeatures } from '@kwtech/module-kit';
import { NOTIFICATION_FEATURE, NOTIFICATION_FEATURE_REGISTRY, NOTIFICATION_ROLE_PRESETS } from '../src/feature-keys.js';

describe('NOTIFICATION_FEATURE_REGISTRY', () => {
  it('declares exactly the keys in NOTIFICATION_FEATURE', () => {
    expect(NOTIFICATION_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(
      Object.values(NOTIFICATION_FEATURE).sort(),
    );
  });

  it('⚠ is APP level throughout — the inbox belongs to no organization or workspace', () => {
    expect(NOTIFICATION_FEATURE_REGISTRY.every((spec) => spec.level === 'app')).toBe(true);
  });

  it('attributes every key to this module, in its own namespace', () => {
    for (const spec of NOTIFICATION_FEATURE_REGISTRY) {
      expect(spec.module).toBe('notification');
      expect(spec.key.startsWith('notification:')).toBe(true);
    }
  });

  it('⚠ flags sending and recalling as privileged — they speak with the platform’s name', () => {
    expect(
      NOTIFICATION_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged)
        .map((spec) => spec.key)
        .sort(),
    ).toEqual([NOTIFICATION_FEATURE.manage, NOTIFICATION_FEATURE.send].sort());
  });

  it('⚠ binds every key to something — a key with no binding guards nothing while reading as coverage', () => {
    expect(NOTIFICATION_FEATURE_REGISTRY.filter((spec) => (spec.bindings ?? []).length === 0)).toEqual([]);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'notification', features: NOTIFICATION_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(NOTIFICATION_FEATURE_REGISTRY.length + 1);
  });
});

describe('NOTIFICATION_ROLE_PRESETS', () => {
  it('offers the receiving key only — sending stays with whoever the app decides', () => {
    expect(NOTIFICATION_ROLE_PRESETS).toEqual([
      expect.objectContaining({ key: 'notification-user', features: [NOTIFICATION_FEATURE.read] }),
    ]);
  });

  it('names only keys that exist', () => {
    const known = new Set<string>(Object.values(NOTIFICATION_FEATURE));
    for (const preset of NOTIFICATION_ROLE_PRESETS) {
      for (const key of preset.features) expect(known.has(key)).toBe(true);
    }
  });
});
