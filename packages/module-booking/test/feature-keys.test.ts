import { composeFeatures, composeProcesses } from '@kwtech/module-kit';
import {
  BOOKING_FEATURE,
  BOOKING_FEATURE_REGISTRY,
  BOOKING_LIMIT,
  BOOKING_LIMIT_REGISTRY,
  BOOKING_ROLE_PRESETS,
} from '../src/feature-keys.js';
import { BOOKING_PROCESS, BOOKING_PROCESS_REGISTRY } from '../src/processes.js';
import { bookingServerModule } from '../src/server/server-module.js';

/**
 * The registry is a CONTRACT with the host. Every assertion here is about a
 * mistake that would be silent — a key at the wrong level, a cap that resolves
 * to infinity, a preset naming a key that does not exist.
 */
describe('BOOKING_FEATURE_REGISTRY', () => {
  it('declares the keys in BOOKING_FEATURE, and no others', () => {
    expect(BOOKING_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(BOOKING_FEATURE).sort());
  });

  it('declares the five keys of the plan (BOOKING-PLAN §5)', () => {
    expect(Object.values(BOOKING_FEATURE).sort()).toEqual([
      'booking:cancel_appointments',
      'booking:manage_appointments',
      'booking:manage_services',
      'booking:manage_settings',
      'booking:read',
    ]);
  });

  it('⚠ is WORKSPACE LEVEL — a sub-app always lives under a workspace', () => {
    expect(BOOKING_FEATURE_REGISTRY.every((spec) => spec.level === 'workspace')).toBe(true);
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(BOOKING_FEATURE_REGISTRY.every((spec) => spec.module === 'booking' && spec.key.startsWith('booking:'))).toBe(
      true,
    );
  });

  it('flags only cancelling as privileged', () => {
    expect(BOOKING_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key)).toEqual([
      BOOKING_FEATURE.cancelAppointments,
    ]);
  });

  it('⚠ binds every key — a key with no binding guards nothing while reading as coverage', () => {
    for (const spec of BOOKING_FEATURE_REGISTRY) {
      expect([spec.key, (spec.bindings ?? []).length > 0]).toEqual([spec.key, true]);
    }
  });

  it('binds each operation exactly once', () => {
    const identifiers = BOOKING_FEATURE_REGISTRY.flatMap((spec) => (spec.bindings ?? []).map((b) => b.identifier));
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('⚠ no feature key shares a name with a limit key', () => {
    const limits = new Set<string>(Object.values(BOOKING_LIMIT));
    expect(BOOKING_FEATURE_REGISTRY.filter((spec) => limits.has(spec.key))).toEqual([]);
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'booking', features: BOOKING_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(BOOKING_FEATURE_REGISTRY.length + 1);
  });
});

describe('BOOKING_LIMIT_REGISTRY', () => {
  it('declares the cap, plan-sourced because the keys are workspace level', () => {
    expect(BOOKING_LIMIT_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(BOOKING_LIMIT).sort());
    expect(BOOKING_LIMIT_REGISTRY.every((spec) => spec.source === 'plan' && spec.module === 'booking')).toBe(true);
  });

  it('counts per WORKSPACE — a resource belongs to the shop, not to whoever added it', () => {
    expect(BOOKING_LIMIT_REGISTRY.every((spec) => spec.countedOver === 'workspace')).toBe(true);
  });

  it('⚠ never defaults to unlimited', () => {
    expect(BOOKING_LIMIT_REGISTRY.every((spec) => typeof spec.defaultValue === 'number' && spec.defaultValue > 0)).toBe(
      true,
    );
  });
});

describe('BOOKING_ROLE_PRESETS', () => {
  it('names only keys this module declares, at workspace level', () => {
    const declared = new Set<string>(Object.values(BOOKING_FEATURE));
    for (const preset of BOOKING_ROLE_PRESETS) {
      expect(preset.level).toBe('workspace');
      expect(preset.features.every((key) => declared.has(key))).toBe(true);
    }
  });

  it('gives every preset read — or the app does not appear on the Apps page', () => {
    expect(BOOKING_ROLE_PRESETS.every((preset) => preset.features.includes(BOOKING_FEATURE.read))).toBe(true);
  });

  it('is a front desk that works the day, and a manager who holds everything', () => {
    const byKey = new Map(BOOKING_ROLE_PRESETS.map((preset) => [preset.key, preset.features]));
    expect(byKey.get('booking-front-desk')).toEqual([
      BOOKING_FEATURE.read,
      BOOKING_FEATURE.manageAppointments,
      BOOKING_FEATURE.cancelAppointments,
    ]);
    expect([...(byKey.get('booking-manager') ?? [])].sort()).toEqual(Object.values(BOOKING_FEATURE).sort());
  });
});

describe('BOOKING_PROCESS_REGISTRY', () => {
  it('⚠ composes: every limit is declared, and the default schedule fits its own limits', () => {
    expect(composeProcesses([{ key: 'booking', processes: BOOKING_PROCESS_REGISTRY }])).toHaveLength(
      BOOKING_PROCESS_REGISTRY.length,
    );
  });

  it('declares the keys in BOOKING_PROCESS, each serving a key of this module', () => {
    expect(BOOKING_PROCESS_REGISTRY.map((entry) => entry.key).sort()).toEqual(Object.values(BOOKING_PROCESS).sort());
    expect(BOOKING_PROCESS_REGISTRY.every((entry) => entry.serves === BOOKING_FEATURE.read)).toBe(true);
  });

  it('⚠ joins every declaration to a handler, or the descriptor throws', () => {
    const descriptor = bookingServerModule();
    expect(descriptor.processes?.map((entry) => entry.key)).toEqual(Object.values(BOOKING_PROCESS));
    expect(descriptor.processes?.every((entry) => typeof entry.handler === 'function')).toBe(true);
  });
});
