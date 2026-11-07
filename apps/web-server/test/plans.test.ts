import { BOOKS_FEATURE } from '@kwtech/module-basic-bookkeeping';
import { STOCK_FEATURE } from '@kwtech/module-basic-inventory';
import { POS_FEATURE } from '@kwtech/module-basic-pos';
import { BOOKING_FEATURE } from '@kwtech/module-booking';
import { NOTE_FEATURE, NOTE_LIMIT } from '@kwtech/module-note';
import { assertPlanFeatureLevels, assertPlanLimits, FEATURE, LIMIT } from '@kwtech/module-permissions';
import { PRINT_FEATURE } from '@kwtech/module-print';
import { STUDIO_FEATURE } from '@kwtech/module-print-studio';
import { QUEUE_FEATURE } from '@kwtech/module-queuing-window';
import { TASK_FEATURE, TASK_LIMIT } from '@kwtech/module-task';
import { PLANS } from '../src/seed/plans.js';
import { ALL_FEATURES, ALL_LIMITS } from '../src/seed/registry.js';

/**
 * ⚠ THE PLANS ARE TIERS BY SIZE (issue #89, PLAN §13 2026-11-07).
 *
 * Every paid tier sells every sub-app and the tiers differ only in numbers.
 * These tests pin that shape, so a sub-app added to one tier and forgotten in
 * another, or a cap missing from a tier (which falls to the registry floor of
 * 1 — one item for sale, with nothing saying why), fails here by name.
 */

/** A seeded plan by key. Throws, so a renamed plan names itself instead of passing every check vacuously. */
function plan(key: string): (typeof PLANS)[number] {
  const found = PLANS.find((one) => one.key === key);
  if (!found) throw new Error(`plans.ts no longer seeds '${key}'.`);
  return found;
}

/** Every sub-app's keys, read from the modules, so a key a module adds is expected in every paid tier. */
const SUB_APP_KEYS: readonly string[] = [
  ...Object.values(QUEUE_FEATURE),
  ...Object.values(NOTE_FEATURE),
  ...Object.values(TASK_FEATURE),
  ...Object.values(POS_FEATURE),
  ...Object.values(BOOKS_FEATURE),
  ...Object.values(STOCK_FEATURE),
  ...Object.values(BOOKING_FEATURE),
  ...Object.values(STUDIO_FEATURE),
  ...Object.values(PRINT_FEATURE),
];

/** Every cap a plan sets: the plan-sourced limits of every composed module. */
const PLAN_LIMIT_KEYS: readonly string[] = ALL_LIMITS.filter((limit) => limit.source === 'plan').map(
  (limit) => limit.key,
);

const PAID = ['starter', 'pro', 'enterprise'] as const;

describe('the seeded plans', () => {
  it('are Free, Basic, Pro and a private Custom, keeping their keys', () => {
    expect(PLANS.map((one) => [one.key, one.label, one.isPublic])).toEqual([
      ['free', 'Free', true],
      ['starter', 'Basic', true],
      ['pro', 'Pro', true],
      ['enterprise', 'Custom', false],
    ]);
  });

  /*
   * The two checks `createPlanIfAbsent` runs before writing a plan. Run here so
   * a tier that would fail on a FRESH database fails the build instead — no
   * existing database ever runs them, because it already has the plans.
   */
  it.each(PLANS.map((one) => [one.key, one] as const))('%s passes the checks plan creation runs', (_key, one) => {
    expect(() => assertPlanFeatureLevels(one, ALL_FEATURES)).not.toThrow();
    expect(() => assertPlanLimits(one.key, one.limits, ALL_LIMITS)).not.toThrow();
  });

  it('⚠ every tier can create its workspace and invite its people, or a new organization can use nothing', () => {
    for (const one of PLANS) {
      expect(one.features).toEqual(
        expect.arrayContaining([
          FEATURE.organizationRead,
          FEATURE.workspacesCreate,
          FEATURE.membersInvite,
          FEATURE.subscriptionsRead,
        ]),
      );
    }
  });

  it('Free sells notes and tasks and no sub-app that handles money or customers', () => {
    const free = plan('free').features;
    const notesAndTasks = [...Object.values(NOTE_FEATURE), ...Object.values(TASK_FEATURE)];
    expect(free).toEqual(expect.arrayContaining(notesAndTasks));
    expect(free.filter((key) => SUB_APP_KEYS.includes(key) && !notesAndTasks.includes(key))).toEqual([]);
  });

  it.each(PAID)('%s sells every sub-app', (key) => {
    expect(SUB_APP_KEYS.filter((feature) => !plan(key).features.includes(feature))).toEqual([]);
  });

  it.each(PAID)('%s sets every plan cap, so none falls to the floor of 1', (key) => {
    expect(PLAN_LIMIT_KEYS.filter((limit) => plan(key).limits[limit] === undefined)).toEqual([]);
  });

  /*
   * A bigger plan never allows less of anything: an upgrade that lowered one cap
   * would refuse a shop something it could do the day before.
   */
  it('⚠ grows: Free ≤ Basic ≤ Pro ≤ Custom, cap by cap', () => {
    const order = ['free', 'starter', 'pro', 'enterprise'];
    const shrinks: string[] = [];
    for (let i = 1; i < order.length; i += 1) {
      const smaller = plan(order[i - 1] ?? '');
      const bigger = plan(order[i] ?? '');
      for (const [limit, value] of Object.entries(smaller.limits)) {
        const next = bigger.limits[limit];
        if (next === undefined || next < value)
          shrinks.push(`${limit}: ${smaller.key} ${value} → ${bigger.key} ${next}`);
      }
      for (const feature of smaller.features) {
        if (!bigger.features.includes(feature)) shrinks.push(`${feature}: in ${smaller.key}, not ${bigger.key}`);
      }
    }
    expect(shrinks).toEqual([]);
  });

  it('Basic is one shop and Pro a small chain', () => {
    expect(plan('free').limits[LIMIT.organizationWorkspaces]).toBe(1);
    expect(plan('starter').limits[LIMIT.organizationWorkspaces]).toBe(1);
    expect(plan('pro').limits[LIMIT.organizationWorkspaces]).toBe(5);
    expect(plan('free').limits[NOTE_LIMIT.notes]).toBe(100);
    expect(plan('free').limits[TASK_LIMIT.boards]).toBe(3);
  });
});
