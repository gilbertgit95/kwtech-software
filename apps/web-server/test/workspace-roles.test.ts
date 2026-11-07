import { APP_HUB_FEATURE } from '@kwtech/module-app-hub';
import { BOOKS_FEATURE, BOOKS_ROLE_PRESETS } from '@kwtech/module-basic-bookkeeping';
import { STOCK_ROLE_PRESETS } from '@kwtech/module-basic-inventory';
import { POS_FEATURE, POS_ROLE_PRESETS } from '@kwtech/module-basic-pos';
import { BOOKING_ROLE_PRESETS } from '@kwtech/module-booking';
import { NOTE_FEATURE, NOTE_ROLE_PRESETS } from '@kwtech/module-note';
import { FEATURE } from '@kwtech/module-permissions';
import { PRINT_FEATURE, PRINT_ROLE_PRESETS } from '@kwtech/module-print';
import { STUDIO_FEATURE, STUDIO_ROLE_PRESETS } from '@kwtech/module-print-studio';
import { QUEUE_FEATURE, QUEUE_ROLE_PRESETS } from '@kwtech/module-queuing-window';
import { TASK_ROLE_PRESETS } from '@kwtech/module-task';
import { APP_ROLES } from '../src/seed/app-roles.js';

/**
 * ⚠ THE THREE WORKSPACE ROLES ARE TIERS OF TRUST (issue #25, PLAN §13 2026-11-07).
 *
 * Each covers every sub-app at one level of trust, built only from module
 * presets. These tests pin WHICH preset each tier reads, so a preset gaining a
 * key, or a tier quietly switched to a broader preset, fails here by name
 * instead of changing what a shop's staff may do with nobody noticing.
 */

const PRESETS: readonly { key: string; features: readonly string[] }[] = [
  ...QUEUE_ROLE_PRESETS,
  ...NOTE_ROLE_PRESETS,
  ...TASK_ROLE_PRESETS,
  ...POS_ROLE_PRESETS,
  ...BOOKS_ROLE_PRESETS,
  ...STOCK_ROLE_PRESETS,
  ...BOOKING_ROLE_PRESETS,
  ...STUDIO_ROLE_PRESETS,
  ...PRINT_ROLE_PRESETS,
];

/** The table in issue #25: one preset per sub-app per tier, or none. */
const TIERS: Readonly<Record<string, { presets: readonly string[]; extra: readonly string[] }>> = {
  'workspace-user': {
    presets: [
      'queue-staff',
      'note-user',
      'task-user',
      'pos-cashier',
      'stock-keeper',
      'booking-front-desk',
      'studio-user',
      'print-user',
    ],
    extra: [FEATURE.workspaceRead, APP_HUB_FEATURE.read],
  },
  'workspace-supervisor': {
    presets: [
      'queue-supervisor',
      'note-user',
      'task-admin',
      'pos-supervisor',
      'books-bookkeeper',
      'stock-manager',
      'booking-manager',
      'studio-user',
      'print-user',
    ],
    extra: [FEATURE.workspaceRead, APP_HUB_FEATURE.read],
  },
  'workspace-admin': {
    presets: [
      'queue-admin',
      'note-admin',
      'task-admin',
      'pos-manager',
      'books-owner',
      'stock-manager',
      'booking-manager',
      'studio-admin',
      'print-admin',
    ],
    extra: [
      FEATURE.workspaceRead,
      FEATURE.workspaceMembersAdd,
      FEATURE.workspaceMembersRemove,
      FEATURE.workspaceAssignRole,
      APP_HUB_FEATURE.read,
      APP_HUB_FEATURE.layoutManage,
    ],
  },
};

/**
 * A seeded role by key. Throws rather than returning undefined, so a renamed or
 * removed role fails the suite naming it instead of passing every `toContain`
 * check against an empty list.
 */
function role(key: string): { features: readonly string[] } {
  const found = APP_ROLES.find((one) => one.key === key);
  if (!found) throw new Error(`app-roles.ts no longer seeds '${key}'.`);
  return found;
}

/**
 * The keys a module preset holds, read from the module itself. Throws when no
 * module ships the preset, the same failure `app-roles.ts` raises at sync, so a
 * renamed preset is caught here first.
 */
function presetFeatures(key: string): readonly string[] {
  const found = PRESETS.find((one) => one.key === key);
  if (!found) throw new Error(`No module ships a '${key}' preset any more.`);
  return found.features;
}

describe('the workspace roles', () => {
  it('are exactly the three tiers, admin, supervisor and staff', () => {
    const workspace = APP_ROLES.filter((one) => one.level === 'workspace').map((one) => one.key);
    expect(workspace.sort()).toEqual(['workspace-admin', 'workspace-supervisor', 'workspace-user']);
  });

  it('label the staff tier "Staff" while keeping its key, which memberships point at', () => {
    expect(APP_ROLES.find((one) => one.key === 'workspace-user')?.label).toBe('Staff');
    expect(APP_ROLES.find((one) => one.key === 'workspace-supervisor')?.label).toBe('Supervisor');
  });

  it.each(Object.entries(TIERS))('%s holds exactly its presets and nothing else', (key, tier) => {
    const expected = new Set([...tier.extra, ...tier.presets.flatMap(presetFeatures)]);
    expect([...new Set(role(key).features)].sort()).toEqual([...expected].sort());
  });

  /*
   * Grants add up and there is no deny, so promoting someone must never take a
   * right away: a cashier made supervisor who can no longer take payment is a
   * till that stops at the worst moment.
   */
  it('⚠ nest: every staff key is a supervisor key, and every supervisor key an admin key', () => {
    const staff = role('workspace-user').features;
    const supervisor = role('workspace-supervisor').features;
    const admin = role('workspace-admin').features;
    expect(staff.filter((key) => !supervisor.includes(key))).toEqual([]);
    expect(supervisor.filter((key) => !admin.includes(key))).toEqual([]);
  });

  it('⚠ keep members, settings, investors and printer pairing away from the supervisor', () => {
    const supervisor = role('workspace-supervisor').features;
    const adminOnly = [
      FEATURE.workspaceMembersAdd,
      FEATURE.workspaceMembersRemove,
      FEATURE.workspaceAssignRole,
      APP_HUB_FEATURE.layoutManage,
      POS_FEATURE.manageSettings,
      BOOKS_FEATURE.manageInvestors,
      PRINT_FEATURE.manageAgents,
      NOTE_FEATURE.manageAll,
      STUDIO_FEATURE.manageAll,
      STUDIO_FEATURE.manageSettings,
    ];
    expect(supervisor.filter((key) => adminOnly.includes(key))).toEqual([]);
  });

  it('give the supervisor the acts a refund or a stock take waits for', () => {
    const supervisor = role('workspace-supervisor').features;
    for (const key of [
      POS_FEATURE.discount,
      POS_FEATURE.refund,
      POS_FEATURE.reports,
      BOOKS_FEATURE.record,
      QUEUE_FEATURE.start,
      QUEUE_FEATURE.stop,
    ]) {
      expect(supervisor).toContain(key);
    }
  });
});
