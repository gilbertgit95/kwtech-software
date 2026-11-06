import { LOCAL_NETWORK_FEATURE, LOCAL_NETWORK_FEATURE_REGISTRY } from '../src/feature-keys.js';

describe('the local network registry', () => {
  it('declares every key once, app level, in this module', () => {
    expect(LOCAL_NETWORK_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(
      Object.values(LOCAL_NETWORK_FEATURE).sort(),
    );
    for (const spec of LOCAL_NETWORK_FEATURE_REGISTRY) {
      expect([spec.key, spec.module, spec.level]).toEqual([spec.key, 'local_network', 'app']);
    }
  });

  it('⚠ spells its keys in snake_case, which the Features page accepts', () => {
    // A copy of module-permissions' FEATURE_KEY_PATTERN (modules never import
    // each other): a hyphen, as the plan first wrote it, fails there.
    for (const key of Object.values(LOCAL_NETWORK_FEATURE)) {
      expect(key).toMatch(/^[a-z][a-z0-9_.]*:[a-z][a-z0-9_.]*$/u);
      expect(key).toMatch(/^local_network:[a-z_]+$/u);
    }
  });

  it('is not privileged: everything it shows is public already', () => {
    expect(LOCAL_NETWORK_FEATURE_REGISTRY.some((spec) => spec.isPrivileged)).toBe(false);
  });
});
