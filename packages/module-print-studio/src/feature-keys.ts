import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the print studio lets somebody do, and how much of it
 * (docs/PRINT-STUDIO-PLAN.md §4).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 *
 * Keys are ATOMIC and split by RISK. Using the studio is one thing; keeping
 * layouts of your own is another; changing or throwing away SOMEBODY ELSE'S
 * shared layout, and reading everybody's log, is a third and the only one that
 * is privileged.
 */
export const STUDIO_FEATURE = {
  /**
   * Open the studio; use your own layouts, shared ones and the presets; keep
   * your own calibration profiles; write and read your own log entries.
   */
  read: 'studio:read',
  /** Create, edit, share, unshare, duplicate and delete your own layouts. */
  write: 'studio:write',
  /**
   * Edit and delete OTHER people's SHARED layouts, and read everybody's log.
   * Never their private layouts.
   */
  manageAll: 'studio:manage_all',
  /** Change the workspace's shortcut keys. Everybody's keys change with them. */
  manageSettings: 'studio:manage_settings',
} as const;

export type StudioFeatureKey = (typeof STUDIO_FEATURE)[keyof typeof STUDIO_FEATURE];

/*
 * ── no key that reads somebody else's private layout ────────────────────────
 *
 * Not `manage_all`, not a super admin's. "Private" is a promise made to the
 * layout's maker, and a key that breaks it would make every private layout
 * shared with whoever an organization later hands that key to
 * (PRINT-STUDIO-PLAN decision 16).
 *
 * ── no key for printing ─────────────────────────────────────────────────────
 *
 * Making a result happens in the browser and reaches no server, so there is
 * nothing a key could guard. `studio:read` opens the studio; what somebody
 * does with their own photos on their own computer is not this app's to allow.
 * A key to send a job to a shop's printer arrives with the print agent.
 */

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature` — the
 * decorator belongs to `module-permissions`, and a module may not import a
 * module (§9) — so `FeatureGuard` enforces each operation through its binding.
 * A missing binding is an UNGUARDED OPERATION, which is why
 * `surface-coverage.test.ts` fails on any operation that is not bound here.
 */
export const STUDIO_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: STUDIO_FEATURE.read,
    module: 'studio',
    level: 'workspace',
    label: 'Use the print studio',
    description:
      'Open the print studio, lay photos out with your own layouts and the ones shared with the workspace, and see your own print history.',
    tags: ['studio'],
    bindings: [
      op('Query.studioLayouts'),
      op('Query.studioLayout'),
      op('Query.studioCalibrations'),
      op('Query.studioLog'),
      // Everybody reads the settings: the keymap drives each person's keys and shortcut bar.
      op('Query.studioSettings'),
      /*
       * ⚠ The person's OWN calibration profiles and log entries, and still
       * bound. An unbound operation skips the guard's workspace-membership
       * check entirely, and each of these WRITES a row into the workspace named
       * in the request. The key is what makes "a member of this workspace" true
       * before the row is written.
       */
      op('Mutation.saveStudioCalibration'),
      op('Mutation.deleteStudioCalibration'),
      op('Mutation.recordStudioPrint'),
    ],
  },
  {
    key: STUDIO_FEATURE.write,
    module: 'studio',
    level: 'workspace',
    label: 'Keep layouts',
    description: 'Create layouts, edit and delete your own, and share them with the workspace.',
    tags: ['studio'],
    bindings: [
      op('Mutation.createStudioLayout'),
      op('Mutation.duplicateStudioLayout'),
      op('Mutation.setStudioLayoutVisibility'),
      /*
       * Editing and deleting are ONE operation each, whoever does it:
       * `studio:write` lets you change your own layouts, and the service asks
       * `StudioAccessCheck` for `studio:manage_all` only when the layout is
       * somebody else's shared one.
       */
      op('Mutation.updateStudioLayout'),
      op('Mutation.deleteStudioLayout'),
    ],
  },
  {
    key: STUDIO_FEATURE.manageAll,
    module: 'studio',
    /*
     * ⚠ PRIVILEGED because it changes work that is not the holder's — and a
     * changed shared layout changes everybody's next print — and because it
     * reads a log that names customers' files. It has NO BINDINGS OF ITS OWN:
     * each operation it widens is bound above, and the service asks the
     * `StudioAccessCheck` port only when the answer depends on this key.
     */
    isPrivileged: true,
    level: 'workspace',
    label: 'Manage everyone’s shared layouts',
    description:
      'Edit and delete layouts other people shared with the workspace, and see everyone’s print history. Private layouts stay private.',
    tags: ['studio'],
    bindings: [],
  },
  {
    key: STUDIO_FEATURE.manageSettings,
    module: 'studio',
    level: 'workspace',
    label: 'Set the studio’s shortcut keys',
    description: 'Choose which key does what in the print studio, for everybody in the workspace.',
    tags: ['studio'],
    bindings: [op('Mutation.saveStudioSettings')],
  },
];

export const STUDIO_LIMIT = {
  /** How many layouts one person may keep in a workspace. */
  layouts: 'studio:layouts',
} as const;

/**
 * The cap, PLAN-SOURCED — every `studio:*` key is workspace level, so an
 * organization's subscription is there to read — and COUNTED PER PERSON.
 *
 * ⚠ PER PERSON, NOT PER WORKSPACE. Nobody may read another member's private
 * layouts, so nobody could clear them: a workspace-wide cap would let one
 * person, or one departed person, fill everybody's quota with layouts no admin
 * can see or delete (PRINT-STUDIO-PLAN decision 17).
 *
 * The module counts, in the transaction that inserts; the host's `LimitChecker`
 * only resolves the number (`LimitCheckInput.current`).
 */
export const STUDIO_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: STUDIO_LIMIT.layouts,
    module: 'studio',
    label: 'Layouts per person',
    description: 'How many layouts one person may keep in a workspace, private and shared together.',
    source: 'plan',
    countedOver: 'user',
    required: false,
    defaultValue: 100,
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface StudioRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly StudioFeatureKey[];
}

export const STUDIO_ROLE_PRESETS: readonly StudioRolePreset[] = [
  {
    key: 'studio-user',
    label: 'Print studio user',
    icon: 'printer',
    level: 'workspace',
    features: [STUDIO_FEATURE.read, STUDIO_FEATURE.write],
  },
  {
    key: 'studio-admin',
    label: 'Print studio admin',
    icon: 'printer',
    level: 'workspace',
    features: [STUDIO_FEATURE.read, STUDIO_FEATURE.write, STUDIO_FEATURE.manageAll, STUDIO_FEATURE.manageSettings],
  },
];
