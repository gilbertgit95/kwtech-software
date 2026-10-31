import { composeFeatures } from '@kwtech/module-kit';
import {
  POS_FEATURE,
  POS_FEATURE_REGISTRY,
  POS_LIMIT,
  POS_LIMIT_REGISTRY,
  POS_ROLE_PRESETS,
} from '../src/feature-keys.js';

/**
 * The registry is a CONTRACT with the host. Every assertion here is about a
 * mistake that would be silent — a key at the wrong level, a cap that resolves
 * to infinity, a preset naming a key that does not exist.
 */
describe('POS_FEATURE_REGISTRY', () => {
  it('declares the keys in POS_FEATURE, and no others', () => {
    expect(POS_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(POS_FEATURE).sort());
  });

  it('⚠ keeps the placeholder’s key — plans and roles already carry pos:read', () => {
    expect(POS_FEATURE.read).toBe('pos:read');
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(POS_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(POS_FEATURE_REGISTRY.every((spec) => spec.module === 'pos' && spec.key.startsWith('pos:'))).toBe(true);
  });

  it('flags only refund as privileged — it gives money back out of the drawer', () => {
    expect(POS_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key)).toEqual([
      POS_FEATURE.refund,
    ]);
  });

  it('⚠ puts every act that settles an order under take_payment, and none under sell (issue #23)', () => {
    const bound = (key: string) =>
      (POS_FEATURE_REGISTRY.find((spec) => spec.key === key)?.bindings ?? []).map((b) => b.identifier);
    const settling = [
      'Mutation.payPosOrder',
      'Mutation.payLaterPosOrder',
      'Mutation.cancelPosOrder',
      'Mutation.settlePosChangeOwed',
    ];
    expect(bound(POS_FEATURE.takePayment).sort()).toEqual([...settling].sort());
    expect(bound(POS_FEATURE.sell).filter((one) => settling.includes(one))).toEqual([]);
    expect(bound(POS_FEATURE.sell)).toContain('Mutation.holdPosOrder');
  });

  it('⚠ binds no operation to two keys — the guard would demand BOTH', () => {
    const identifiers = POS_FEATURE_REGISTRY.flatMap((spec) => (spec.bindings ?? []).map((b) => b.identifier));
    expect(identifiers.length).toBe(new Set(identifiers).size);
  });

  it('⚠ binds every key — a key with no binding guards nothing while reading as coverage', () => {
    for (const spec of POS_FEATURE_REGISTRY) {
      expect([spec.key, (spec.bindings ?? []).length > 0]).toEqual([spec.key, true]);
    }
  });

  it('⚠ no feature key shares a name with a limit key', () => {
    const limits = new Set<string>(Object.values(POS_LIMIT));
    expect(POS_FEATURE_REGISTRY.filter((spec) => limits.has(spec.key))).toEqual([]);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'pos', features: POS_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(POS_FEATURE_REGISTRY.length + 1);
  });
});

describe('POS_LIMIT_REGISTRY', () => {
  it('declares the cap, plan-sourced because the keys are workspace level, counted over the store', () => {
    expect(POS_LIMIT_REGISTRY.map((spec) => spec.key)).toEqual([POS_LIMIT.items]);
    expect(POS_LIMIT_REGISTRY.every((spec) => spec.source === 'plan' && spec.countedOver === 'workspace')).toBe(true);
  });

  it('⚠ never defaults to unlimited', () => {
    expect(POS_LIMIT_REGISTRY.every((spec) => typeof spec.defaultValue === 'number' && spec.defaultValue > 0)).toBe(
      true,
    );
  });
});

describe('POS_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level', () => {
    const declared = new Set<string>(Object.values(POS_FEATURE));
    for (const preset of POS_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });

  it('⚠ gives the manager every cashier key, so a store with no cashier runs on the manager alone', () => {
    const cashier = POS_ROLE_PRESETS.find((preset) => preset.key === 'pos-cashier');
    const manager = POS_ROLE_PRESETS.find((preset) => preset.key === 'pos-manager');
    expect(cashier?.features.every((key) => manager?.features.includes(key))).toBe(true);
    expect([...(manager?.features ?? [])].sort()).toEqual(Object.values(POS_FEATURE).sort());
  });

  it('sells at the listed price only: a cashier cannot discount, refund, see costs or reports', () => {
    const cashier = POS_ROLE_PRESETS.find((preset) => preset.key === 'pos-cashier');
    // `setAvailability` changes no price or name: the counter is who hears "we ran out" (issue #37).
    expect(cashier?.features).toEqual([
      POS_FEATURE.read,
      POS_FEATURE.sell,
      POS_FEATURE.takePayment,
      POS_FEATURE.setAvailability,
    ]);
  });

  it('⚠ an order taker builds and holds, and never settles an order (issue #23)', () => {
    const taker = POS_ROLE_PRESETS.find((preset) => preset.key === 'pos-order-taker');
    const cashier = POS_ROLE_PRESETS.find((preset) => preset.key === 'pos-cashier');
    expect(taker?.features).toEqual([POS_FEATURE.read, POS_FEATURE.sell]);
    expect(taker?.features.every((key) => cashier?.features.includes(key))).toBe(true);
  });
});
