import { composeFeatures } from '@kwtech/module-kit';
import {
  TASK_FEATURE,
  TASK_FEATURE_REGISTRY,
  TASK_LIMIT,
  TASK_LIMIT_REGISTRY,
  TASK_ROLE_PRESETS,
} from '../src/feature-keys.js';

/**
 * The registry is a CONTRACT with the host. Every assertion here is about a
 * mistake that would be silent — a key at the wrong level, a cap that resolves
 * to infinity, a preset naming a key that does not exist.
 */
describe('TASK_FEATURE_REGISTRY', () => {
  it('declares the keys in TASK_FEATURE, and no others', () => {
    expect(TASK_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(TASK_FEATURE).sort());
  });

  it('⚠ keeps the placeholder’s key — plans and roles already carry task:read', () => {
    expect(TASK_FEATURE.read).toBe('task:read');
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(TASK_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(TASK_FEATURE_REGISTRY.every((spec) => spec.module === 'task' && spec.key.startsWith('task:'))).toBe(true);
  });

  it('flags only manage_all as privileged', () => {
    expect(TASK_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key)).toEqual([
      TASK_FEATURE.manageAll,
    ]);
  });

  it('⚠ binds every key — a key with no binding guards nothing while reading as coverage', () => {
    for (const spec of TASK_FEATURE_REGISTRY) {
      expect([spec.key, (spec.bindings ?? []).length > 0]).toEqual([spec.key, true]);
    }
  });

  it('binds each operation exactly once', () => {
    const identifiers = TASK_FEATURE_REGISTRY.flatMap((spec) => (spec.bindings ?? []).map((b) => b.identifier));
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('⚠ no feature key shares a name with a limit key', () => {
    const limits = new Set<string>(Object.values(TASK_LIMIT));
    expect(TASK_FEATURE_REGISTRY.filter((spec) => limits.has(spec.key))).toEqual([]);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'task', features: TASK_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(TASK_FEATURE_REGISTRY.length + 1);
  });
});

describe('TASK_LIMIT_REGISTRY', () => {
  it('declares the caps, plan-sourced because the keys are workspace level', () => {
    expect(TASK_LIMIT_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(TASK_LIMIT).sort());
    expect(TASK_LIMIT_REGISTRY.every((spec) => spec.source === 'plan' && spec.module === 'task')).toBe(true);
  });

  it('⚠ counts per PERSON — nobody can clear another member’s private board', () => {
    expect(TASK_LIMIT_REGISTRY.every((spec) => spec.countedOver === 'user')).toBe(true);
  });

  it('⚠ never defaults to unlimited', () => {
    expect(TASK_LIMIT_REGISTRY.every((spec) => typeof spec.defaultValue === 'number' && spec.defaultValue > 0)).toBe(
      true,
    );
  });
});

describe('TASK_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level', () => {
    const declared = new Set<string>(Object.values(TASK_FEATURE));
    for (const preset of TASK_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });

  it('gives every preset read — a key to write in an app you cannot open is useless', () => {
    expect(TASK_ROLE_PRESETS.every((preset) => preset.features.includes(TASK_FEATURE.read))).toBe(true);
  });

  it('keeps manage_all to the admin preset', () => {
    const holders = TASK_ROLE_PRESETS.filter((preset) => preset.features.includes(TASK_FEATURE.manageAll));
    expect(holders.map((preset) => preset.key)).toEqual(['task-admin']);
  });
});
