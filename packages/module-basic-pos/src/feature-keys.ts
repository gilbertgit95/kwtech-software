import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the point of sale lets somebody do, and how much of it (docs/POS-PLAN.md §4).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 *
 * Keys are ATOMIC and split by RISK: selling at the listed price; lowering a
 * price; giving money back; changing the catalogue (and seeing what things
 * cost); reading the takings; changing how every till behaves.
 */
export const POS_FEATURE = {
  /** Open the app; see items (without costs), orders and customers. */
  read: 'pos:read',
  /**
   * Build, hold, resume, pay and cancel orders; pay later and change owed;
   * create and edit customers. At the LISTED price: lowering it is `discount`.
   */
  sell: 'pos:sell',
  /** Give a ₱ or % discount on a line or the whole order (D16). */
  discount: 'pos:discount',
  /** Refund a paid order, by line or by amount, and void an unpaid one whose items came back (D17). */
  refund: 'pos:refund',
  /** Add, edit and archive items, variants and categories — and SEE COSTS (D15). */
  manageItems: 'pos:manage_items',
  /** The dashboard and the reports, with profit and CSV export (D22). */
  reports: 'pos:reports',
  /** Store settings: the time zone, the hot keys and item keys (D18). */
  manageSettings: 'pos:manage_settings',
} as const;

export type PosFeatureKey = (typeof POS_FEATURE)[keyof typeof POS_FEATURE];

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ NO BINDINGS YET, because the module has no operations yet (phase 1 of
 * POS-PLAN §6). The server half binds each operation here in the same change
 * that adds it — this module cannot use `@RequireFeature`, so the bindings ARE
 * its guard, and an unbound operation is reachable by anybody signed in.
 */
export const POS_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: POS_FEATURE.read,
    module: 'pos',
    level: 'workspace',
    label: 'Use the point of sale',
    description: 'Open the point-of-sale app, and see its items, orders and customers.',
    tags: ['pos'],
    bindings: [],
  },
  {
    key: POS_FEATURE.sell,
    module: 'pos',
    level: 'workspace',
    label: 'Sell',
    description:
      'Ring up orders at the listed price, hold and resume them, take payment, let a customer pay later, and record customers.',
    tags: ['pos'],
    bindings: [],
  },
  {
    key: POS_FEATURE.discount,
    module: 'pos',
    level: 'workspace',
    label: 'Give discounts',
    description: 'Take an amount or a percentage off a line or a whole order, with a reason.',
    tags: ['pos'],
    bindings: [],
  },
  {
    key: POS_FEATURE.refund,
    module: 'pos',
    /*
     * ⚠ PRIVILEGED because it gives money back out of the drawer, and voids an
     * unpaid order — the two acts a missing sale can hide behind.
     */
    isPrivileged: true,
    level: 'workspace',
    label: 'Refund and void',
    description: 'Refund a paid order, whole or in part, and void an unpaid order whose items came back.',
    tags: ['pos'],
    bindings: [],
  },
  {
    key: POS_FEATURE.manageItems,
    module: 'pos',
    level: 'workspace',
    label: 'Manage items',
    description: 'Add, edit and archive items, their variants and categories, and see what each one costs.',
    tags: ['pos'],
    bindings: [],
  },
  {
    key: POS_FEATURE.reports,
    module: 'pos',
    level: 'workspace',
    label: 'See sales reports',
    description: 'Open the dashboard and the sales reports, including profit, and export them.',
    tags: ['pos'],
    bindings: [],
  },
  {
    key: POS_FEATURE.manageSettings,
    module: 'pos',
    level: 'workspace',
    label: 'Change store settings',
    description: 'Set the store’s time zone, and the keyboard shortcuts every till in it uses.',
    tags: ['pos'],
    bindings: [],
  },
];

export const POS_LIMIT = {
  /** How many active items and variants one store may have. */
  items: 'pos:items',
} as const;

/**
 * The cap, PLAN-SOURCED — every `pos:*` key is workspace level, so an
 * organization's subscription is there to read — and COUNTED OVER THE
 * WORKSPACE: the catalogue is the store's, not a person's.
 *
 * ⚠ ITEMS PLUS VARIANTS, ACTIVE ONLY (POS-PLAN guard rules). Counting items
 * alone lets one item carry 300 variants; counting archived ones means
 * archiving never frees room, when archiving is the only way to remove
 * something (old orders point at it).
 */
export const POS_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: POS_LIMIT.items,
    module: 'pos',
    label: 'Items and variants per store',
    description: 'How many active items and variants a store may have for sale. Archived ones do not count.',
    source: 'plan',
    countedOver: 'workspace',
    required: false,
    defaultValue: 1000,
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface PosRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly PosFeatureKey[];
}

/**
 * ⚠ THE MANAGER HOLDS EVERY CASHIER KEY. Grants add up and there is no deny, so
 * a store with no cashiers runs the till with the manager's role alone
 * (POS-PLAN §4).
 */
export const POS_ROLE_PRESETS: readonly PosRolePreset[] = [
  {
    key: 'pos-cashier',
    label: 'Cashier',
    icon: 'store',
    level: 'workspace',
    features: [POS_FEATURE.read, POS_FEATURE.sell],
  },
  {
    key: 'pos-manager',
    label: 'POS manager',
    icon: 'store',
    level: 'workspace',
    features: [
      POS_FEATURE.read,
      POS_FEATURE.sell,
      POS_FEATURE.discount,
      POS_FEATURE.refund,
      POS_FEATURE.manageItems,
      POS_FEATURE.reports,
      POS_FEATURE.manageSettings,
    ],
  },
];
