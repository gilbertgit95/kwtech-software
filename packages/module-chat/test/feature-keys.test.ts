import { composeFeatures, composeLimits } from '@kwtech/module-kit';
import {
  CHAT_FEATURE,
  CHAT_FEATURE_REGISTRY,
  CHAT_LIMIT,
  CHAT_LIMIT_REGISTRY,
  CHAT_ROLE_PRESETS,
} from '../src/feature-keys.js';

/**
 * The registry is a CONTRACT with the host: it composes these into the list the
 * seeder writes and the role editor offers. Every assertion here is about a
 * mistake that would be silent — a key nobody can grant, a cap that resolves to
 * infinity.
 */

describe('CHAT_FEATURE_REGISTRY', () => {
  it('declares every key in CHAT_FEATURE, and no others', () => {
    expect(CHAT_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(CHAT_FEATURE).sort());
  });

  it('⚠ is APP LEVEL throughout — the cost of which is that no plan can sell chat', () => {
    expect(CHAT_FEATURE_REGISTRY.every((spec) => spec.level === 'app')).toBe(true);
  });

  it('attributes every key to this module, so the role editor can group them', () => {
    expect(CHAT_FEATURE_REGISTRY.every((spec) => spec.module === 'chat')).toBe(true);
  });

  it('flags the keys that are irreversible, read another module’s table, or act from outside a room', () => {
    const privileged = CHAT_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key);
    expect(privileged.sort()).toEqual([CHAT_FEATURE.directory, CHAT_FEATURE.moderate, CHAT_FEATURE.manageAll].sort());
  });

  it('has no key for leaving, which would be a lockout dressed as a permission', () => {
    expect(CHAT_FEATURE_REGISTRY.some((spec) => /leave/i.test(spec.key))).toBe(false);
  });

  it('⚠ has NO read-any-conversation key — §12.42, and it must stay that way', () => {
    // The pressure will come from abuse reports. The honest answer then is a
    // separate, audited key, not a quiet widening of one of these.
    expect(CHAT_FEATURE_REGISTRY.some((spec) => /read_any|read_all|inspect/i.test(spec.key))).toBe(false);
  });

  it('⚠ `chat:manage_all` is not that key, and says so where somebody will read it', () => {
    /*
     * The one key that acts on a conversation its holder is not in, which is
     * exactly the shape §12.42 refuses for READING. The line between them is
     * the whole reason it may exist: membership and settings are metadata,
     * message bodies are not — and "manage" drifting into "read" is what that
     * entry exists to prevent.
     *
     * Asserted on the DESCRIPTION because that is what an operator sees in the
     * role editor when they decide whether to hand it out. The enforcement is
     * elsewhere; this is the promise made to the person granting it.
     */
    const manageAll = CHAT_FEATURE_REGISTRY.find((spec) => spec.key === CHAT_FEATURE.manageAll);
    expect(manageAll?.description).toMatch(/does not grant reading/i);
  });

  it('⚠ binds NO operation, because it widens rather than gates', () => {
    // A binding would make the operation REQUIRE this key, refusing an ordinary
    // owner renaming their own group. It is resolved inside the request instead
    // and handed to the domain as a boolean.
    const manageAll = CHAT_FEATURE_REGISTRY.find((spec) => spec.key === CHAT_FEATURE.manageAll);
    expect(manageAll?.bindings ?? []).toEqual([]);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'chat', features: CHAT_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(CHAT_FEATURE_REGISTRY.length + 1);
  });
});

describe('CHAT_LIMIT_REGISTRY', () => {
  it('⚠ is ROLE-sourced, because a plan-sourced cap has no meaning at app level', () => {
    // Two users with no organization between them have no subscription to read.
    expect(CHAT_LIMIT_REGISTRY.every((spec) => spec.source === 'role')).toBe(true);
  });

  it('⚠ has a real default, never null — null is an unbounded resource for an unknown party', () => {
    const groups = CHAT_LIMIT_REGISTRY.find((spec) => spec.key === CHAT_LIMIT.groupChats);
    expect(groups?.defaultValue).toBe(20);
  });

  it('is counted over the USER, which is who the cap belongs to', () => {
    expect(CHAT_LIMIT_REGISTRY.every((spec) => spec.countedOver === 'user')).toBe(true);
  });

  it('composes through module-kit', () => {
    expect(composeLimits([{ key: 'chat', limits: CHAT_LIMIT_REGISTRY }]).map((spec) => spec.key)).toEqual([
      CHAT_LIMIT.groupChats,
    ]);
  });
});

describe('CHAT_ROLE_PRESETS', () => {
  it('only ever names keys this module declares', () => {
    const declared = new Set(CHAT_FEATURE_REGISTRY.map((spec) => spec.key));
    for (const preset of CHAT_ROLE_PRESETS) {
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });

  it('⚠ gives the ordinary preset NO moderation key', () => {
    const user = CHAT_ROLE_PRESETS.find((preset) => preset.key === 'chat-user');
    expect(user?.features).not.toContain(CHAT_FEATURE.moderate);
    expect(user?.features).not.toContain(CHAT_FEATURE.removeParticipant);
  });

  it('only ever sets caps this module declares', () => {
    const declared = new Set(CHAT_LIMIT_REGISTRY.map((spec) => spec.key));
    for (const preset of CHAT_ROLE_PRESETS) {
      expect(Object.keys(preset.limits).every((key) => declared.has(key))).toBe(true);
    }
  });
});
