import { FILE_FEATURE, FILE_FEATURE_REGISTRY, FILE_LIMIT_REGISTRY, FILE_ROLE_PRESETS } from '../src/feature-keys.js';

describe('the file registry', () => {
  it('declares every key once, workspace level, prefixed file:', () => {
    const keys = FILE_FEATURE_REGISTRY.map((spec) => spec.key);
    expect(keys).toEqual(Object.values(FILE_FEATURE));
    for (const spec of FILE_FEATURE_REGISTRY) {
      expect(spec).toMatchObject({ module: 'file', level: 'workspace' });
      expect(spec.key).toMatch(/^file:[a-z_]+$/u);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  it('caps sizes from the plan, per workspace, never unlimited by default', () => {
    for (const limit of FILE_LIMIT_REGISTRY) {
      expect(limit).toMatchObject({ module: 'file', source: 'plan', countedOver: 'workspace' });
      expect(typeof limit.defaultValue).toBe('number');
    }
  });

  it('offers presets built only from its own keys, the read key in each', () => {
    for (const preset of FILE_ROLE_PRESETS) {
      expect(preset.features).toContain(FILE_FEATURE.read);
      for (const key of preset.features) expect(Object.values(FILE_FEATURE)).toContain(key);
    }
  });
});
