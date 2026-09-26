import { APP_HUB_FEATURE, APP_HUB_FEATURE_REGISTRY } from '../src/feature-keys.js';

/** The registry's shape — what `db:sync` mirrors into `perm_feature`. */
describe('APP_HUB_FEATURE_REGISTRY', () => {
  it('declares both keys, once each, under this module', () => {
    expect(APP_HUB_FEATURE_REGISTRY.map((spec) => [spec.key, spec.module])).toEqual([
      [APP_HUB_FEATURE.read, 'app_hub'],
      [APP_HUB_FEATURE.layoutManage, 'app_hub'],
    ]);
  });

  it('⚠ is WORKSPACE level throughout — an app always lives under a workspace', () => {
    expect(APP_HUB_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('matches the key pattern the role editor accepts (no hyphen in `app_hub`)', () => {
    for (const spec of APP_HUB_FEATURE_REGISTRY) expect(spec.key).toMatch(/^[a-z][a-z0-9_.]*:[a-z][a-z0-9_.]*$/);
  });

  it('labels and describes every key for the role editor', () => {
    for (const spec of APP_HUB_FEATURE_REGISTRY) {
      expect(spec.label).toMatch(/\S/);
      expect(spec.description).toMatch(/\S/);
    }
  });
});
