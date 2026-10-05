import { composeFeatures } from '@kwtech/module-kit';
import { JOBS_FEATURE, JOBS_FEATURE_REGISTRY } from '../src/feature-keys.js';

/**
 * The registry is a CONTRACT with the host. Every assertion here is about a
 * mistake that would be silent — a key granted at the wrong level, a key that
 * guards nothing, seeing that grants control.
 */
describe('JOBS_FEATURE_REGISTRY', () => {
  it('declares the four keys in JOBS_FEATURE, and no others', () => {
    expect(JOBS_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(JOBS_FEATURE).sort());
    expect(JOBS_FEATURE_REGISTRY).toHaveLength(4);
  });

  it('⚠ is APP LEVEL throughout — a process is one thing for the whole application', () => {
    expect(JOBS_FEATURE_REGISTRY.every((spec) => spec.level === 'app')).toBe(true);
  });

  it('attributes every key to this module', () => {
    expect(JOBS_FEATURE_REGISTRY.every((spec) => spec.module === 'jobs')).toBe(true);
  });

  it('flags pausing and scheduling as privileged: one act, every organization', () => {
    expect(
      JOBS_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged)
        .map((spec) => spec.key)
        .sort(),
    ).toEqual([JOBS_FEATURE.pause, JOBS_FEATURE.schedule]);
  });

  it('⚠ binds every key to something — a key with no binding guards nothing while reading as coverage', () => {
    const unbound = JOBS_FEATURE_REGISTRY.filter((spec) => (spec.bindings ?? []).length === 0);
    expect(unbound.map((spec) => spec.key)).toEqual([]);
  });

  it('⚠ keeps seeing apart from control: jobs:read binds queries only', () => {
    const read = JOBS_FEATURE_REGISTRY.find((spec) => spec.key === JOBS_FEATURE.read);
    expect((read?.bindings ?? []).every((binding) => binding.identifier.startsWith('Query.'))).toBe(true);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'jobs', features: JOBS_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(JOBS_FEATURE_REGISTRY.length + 1);
  });
});
