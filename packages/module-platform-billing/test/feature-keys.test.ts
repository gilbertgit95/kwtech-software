import { composeFeatures } from '@kwtech/module-kit';
import {
  PLATFORM_BILLING_FEATURE,
  PLATFORM_BILLING_FEATURE_REGISTRY,
  PLATFORM_BILLING_ORGANIZATION_KEYS,
  PLATFORM_BILLING_REFUSALS,
  PLATFORM_BILLING_ROLE_PRESETS,
} from '../src/index.js';

/**
 * The registry is a contract with the host, and the refusals are the operator's
 * rule that every "no" says why. Each assertion is about a silent mistake.
 */
describe('PLATFORM_BILLING_FEATURE_REGISTRY', () => {
  const level = (key: string) => PLATFORM_BILLING_FEATURE_REGISTRY.find((spec) => spec.key === key)?.level;

  it('declares the keys in PLATFORM_BILLING_FEATURE, and no others', () => {
    expect(PLATFORM_BILLING_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(
      Object.values(PLATFORM_BILLING_FEATURE).sort(),
    );
  });

  it('attributes every key to this module, prefixed with it', () => {
    expect(
      PLATFORM_BILLING_FEATURE_REGISTRY.every(
        (spec) => spec.module === 'platform-billing' && spec.key.startsWith('platform-billing:'),
      ),
    ).toBe(true);
  });

  it('⚠ is never workspace level: billing is not a sub-app', () => {
    expect(PLATFORM_BILLING_FEATURE_REGISTRY.filter((spec) => spec.level === 'workspace')).toEqual([]);
  });

  it('⚠ keeps approving, voiding and the settings at app level, so no organization role or plan can carry them', () => {
    for (const key of [
      PLATFORM_BILLING_FEATURE.queueRead,
      PLATFORM_BILLING_FEATURE.approve,
      PLATFORM_BILLING_FEATURE.void,
      PLATFORM_BILLING_FEATURE.manageSettings,
    ]) {
      expect([key, level(key)]).toEqual([key, 'app']);
    }
  });

  it('lists exactly the organization-level keys as those to work without a plan (D13)', () => {
    expect([...PLATFORM_BILLING_ORGANIZATION_KEYS].sort()).toEqual(
      PLATFORM_BILLING_FEATURE_REGISTRY.filter((spec) => spec.level === 'organization')
        .map((spec) => spec.key)
        .sort(),
    );
  });

  it('flags approving, voiding and the settings as privileged, and nothing else', () => {
    expect(
      PLATFORM_BILLING_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged)
        .map((spec) => spec.key)
        .sort(),
    ).toEqual(
      [PLATFORM_BILLING_FEATURE.approve, PLATFORM_BILLING_FEATURE.void, PLATFORM_BILLING_FEATURE.manageSettings].sort(),
    );
  });

  it('composes with another module without collision', () => {
    const composed = composeFeatures([
      { key: 'platform-billing', features: PLATFORM_BILLING_FEATURE_REGISTRY },
      { key: 'other', features: [{ key: 'other:thing', module: 'other', label: 'x', description: 'x' }] },
    ]);
    expect(composed).toHaveLength(PLATFORM_BILLING_FEATURE_REGISTRY.length + 1);
  });
});

describe('PLATFORM_BILLING_ROLE_PRESETS', () => {
  const preset = (key: string) => PLATFORM_BILLING_ROLE_PRESETS.find((one) => one.key === key);

  it('names only keys this module declares, each at its preset’s level', () => {
    for (const one of PLATFORM_BILLING_ROLE_PRESETS) {
      for (const key of one.features) {
        const spec = PLATFORM_BILLING_FEATURE_REGISTRY.find((entry) => entry.key === key);
        expect([one.key, key, spec?.level]).toEqual([one.key, key, one.level]);
      }
    }
  });

  it('⚠ gives an admin renewing and paying, never choosing the plan (D8)', () => {
    expect(preset('platform-billing-admin')?.features).not.toContain(PLATFORM_BILLING_FEATURE.changePlan);
    expect(preset('platform-billing-owner')?.features).toContain(PLATFORM_BILLING_FEATURE.changePlan);
  });

  it('gives an approver the queue, approving and voiding, never the settings', () => {
    expect([...(preset('platform-billing-approver')?.features ?? [])].sort()).toEqual(
      [PLATFORM_BILLING_FEATURE.queueRead, PLATFORM_BILLING_FEATURE.approve, PLATFORM_BILLING_FEATURE.void].sort(),
    );
  });
});

describe('PLATFORM_BILLING_REFUSALS', () => {
  it('⚠ gives every refusal a sentence and a next step (§6)', () => {
    for (const [reason, text] of Object.entries(PLATFORM_BILLING_REFUSALS)) {
      expect([reason, text.message.trim().length > 0, text.nextStep.trim().length > 0]).toEqual([reason, true, true]);
    }
  });

  it('puts no numbers in the words: counts and dates travel in the detail, and a constant could drift', () => {
    for (const [reason, text] of Object.entries(PLATFORM_BILLING_REFUSALS)) {
      expect([reason, /\d/u.test(text.message + text.nextStep)]).toEqual([reason, false]);
    }
  });

  it('never says only "not permitted"', () => {
    for (const text of Object.values(PLATFORM_BILLING_REFUSALS)) {
      expect(text.message.toLowerCase()).not.toMatch(/^not permitted\.?$/u);
    }
  });
});
