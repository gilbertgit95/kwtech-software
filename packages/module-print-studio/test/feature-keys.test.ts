import { composeFeatures, composeProcesses } from '@kwtech/module-kit';
import {
  STUDIO_FEATURE,
  STUDIO_FEATURE_REGISTRY,
  STUDIO_LIMIT,
  STUDIO_LIMIT_REGISTRY,
  STUDIO_ROLE_PRESETS,
} from '../src/feature-keys.js';
import { STUDIO_PROCESS, STUDIO_PROCESS_REGISTRY } from '../src/processes.js';
import { studioServerModule } from '../src/server/server-module.js';

/**
 * The registry is a CONTRACT with the host. Every assertion here is about a
 * mistake that would be silent — a key at the wrong level, a cap that resolves
 * to infinity, a preset naming a key that does not exist.
 */
describe('STUDIO_FEATURE_REGISTRY', () => {
  it('declares the four keys in STUDIO_FEATURE, and no others', () => {
    expect(STUDIO_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(STUDIO_FEATURE).sort());
    expect(STUDIO_FEATURE_REGISTRY).toHaveLength(4);
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(STUDIO_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(STUDIO_FEATURE_REGISTRY.every((spec) => spec.module === 'studio' && spec.key.startsWith('studio:'))).toBe(
      true,
    );
  });

  it('flags only manage_all as privileged: it changes other people’s work and reads everyone’s history', () => {
    expect(STUDIO_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key)).toEqual([
      STUDIO_FEATURE.manageAll,
    ]);
  });

  it('has no key for reading others’ private layouts', () => {
    expect(STUDIO_FEATURE_REGISTRY.some((spec) => /private|read_any/i.test(spec.key))).toBe(false);
  });

  it('⚠ binds read and write — a key with no binding guards nothing while reading as coverage', () => {
    for (const key of [STUDIO_FEATURE.read, STUDIO_FEATURE.write, STUDIO_FEATURE.manageSettings]) {
      const spec = STUDIO_FEATURE_REGISTRY.find((candidate) => candidate.key === key);
      expect([key, (spec?.bindings ?? []).length > 0]).toEqual([key, true]);
    }
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'studio', features: STUDIO_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(STUDIO_FEATURE_REGISTRY.length + 1);
  });
});

describe('STUDIO_LIMIT_REGISTRY', () => {
  it('declares the one cap, plan-sourced because the keys are workspace level', () => {
    expect(STUDIO_LIMIT_REGISTRY.map((spec) => spec.key)).toEqual(Object.values(STUDIO_LIMIT));
    expect(STUDIO_LIMIT_REGISTRY.every((spec) => spec.source === 'plan' && spec.module === 'studio')).toBe(true);
  });

  it('⚠ counts per PERSON — nobody can clear another member’s private layouts', () => {
    expect(STUDIO_LIMIT_REGISTRY.every((spec) => spec.countedOver === 'user')).toBe(true);
  });

  it('⚠ never defaults to unlimited — the default is what an unconfigured plan gets', () => {
    expect(STUDIO_LIMIT_REGISTRY.every((spec) => typeof spec.defaultValue === 'number' && spec.defaultValue > 0)).toBe(
      true,
    );
  });
});

describe('STUDIO_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level, and always the read key', () => {
    const declared = new Set<string>(Object.values(STUDIO_FEATURE));
    for (const preset of STUDIO_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
      // Without the read key the app does not appear on the Apps page.
      expect(preset.features).toContain(STUDIO_FEATURE.read);
    }
  });

  it('gives manage_all to the admin preset alone', () => {
    const holders = STUDIO_ROLE_PRESETS.filter((preset) => preset.features.includes(STUDIO_FEATURE.manageAll));
    expect(holders.map((preset) => preset.key)).toEqual(['studio-admin']);
  });
});

describe('STUDIO_PROCESS_REGISTRY', () => {
  it('declares the prune with every limit, serving a key of this module', () => {
    expect(STUDIO_PROCESS_REGISTRY.map((spec) => spec.key)).toEqual(Object.values(STUDIO_PROCESS));
    for (const spec of STUDIO_PROCESS_REGISTRY) {
      expect(spec.module).toBe('studio');
      expect(spec.serves).toBe(STUDIO_FEATURE.read);
    }
  });

  it('⚠ composes — the runner’s own check that no limit was left unsaid', () => {
    const descriptor = studioServerModule();
    expect(() => composeProcesses([descriptor])).not.toThrow();
    expect(composeProcesses([descriptor])).toHaveLength(1);
  });

  it('joins every declaration to a handler', () => {
    expect(studioServerModule().processes?.every((process) => typeof process.handler === 'function')).toBe(true);
  });
});
