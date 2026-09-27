import { composeFeatures } from '@kwtech/module-kit';
import {
  NOTE_FEATURE,
  NOTE_FEATURE_REGISTRY,
  NOTE_LIMIT,
  NOTE_LIMIT_REGISTRY,
  NOTE_ROLE_PRESETS,
} from '../src/feature-keys.js';

/**
 * The registry is a CONTRACT with the host. Every assertion here is about a
 * mistake that would be silent — a key at the wrong level, a cap that resolves
 * to infinity, a preset naming a key that does not exist.
 */
describe('NOTE_FEATURE_REGISTRY', () => {
  it('declares the three keys in NOTE_FEATURE, and no others', () => {
    expect(NOTE_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(NOTE_FEATURE).sort());
    expect(NOTE_FEATURE_REGISTRY).toHaveLength(3);
  });

  it('⚠ keeps the placeholder’s key — plans and roles already carry note:read', () => {
    expect(NOTE_FEATURE.read).toBe('note:read');
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(NOTE_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(NOTE_FEATURE_REGISTRY.every((spec) => spec.module === 'note' && spec.key.startsWith('note:'))).toBe(true);
  });

  it('flags only manage_all as privileged: it throws away other people’s work', () => {
    expect(NOTE_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key)).toEqual([
      NOTE_FEATURE.manageAll,
    ]);
  });

  it('has no key for reading others’ private notes, or for managing tags', () => {
    expect(NOTE_FEATURE_REGISTRY.some((spec) => /private|read_any|tag/i.test(spec.key))).toBe(false);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'note', features: NOTE_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(NOTE_FEATURE_REGISTRY.length + 1);
  });
});

describe('NOTE_LIMIT_REGISTRY', () => {
  it('declares the one cap, plan-sourced because the keys are workspace level', () => {
    expect(NOTE_LIMIT_REGISTRY.map((spec) => spec.key)).toEqual(Object.values(NOTE_LIMIT));
    expect(NOTE_LIMIT_REGISTRY.every((spec) => spec.source === 'plan' && spec.module === 'note')).toBe(true);
  });

  it('⚠ counts per PERSON — nobody can clear another member’s private notes', () => {
    expect(NOTE_LIMIT_REGISTRY.every((spec) => spec.countedOver === 'user')).toBe(true);
  });

  it('⚠ never defaults to unlimited — the default is what an unconfigured plan gets', () => {
    expect(NOTE_LIMIT_REGISTRY.every((spec) => typeof spec.defaultValue === 'number' && spec.defaultValue > 0)).toBe(
      true,
    );
  });
});

describe('NOTE_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level', () => {
    const declared = new Set<string>(Object.values(NOTE_FEATURE));
    for (const preset of NOTE_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });

  it('gives every preset read — a key to write in an app you cannot open is useless', () => {
    expect(NOTE_ROLE_PRESETS.every((preset) => preset.features.includes(NOTE_FEATURE.read))).toBe(true);
  });

  it('keeps manage_all to the admin preset', () => {
    const holders = NOTE_ROLE_PRESETS.filter((preset) => preset.features.includes(NOTE_FEATURE.manageAll));
    expect(holders.map((preset) => preset.key)).toEqual(['note-admin']);
  });
});
