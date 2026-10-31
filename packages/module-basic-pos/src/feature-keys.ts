import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the point of sale lets somebody do, and how much of it (docs/POS-PLAN.md §4).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 *
 * Keys are ATOMIC and split by RISK: taking orders at the listed price;
 * settling them (payment); lowering a price; giving money back; changing the catalogue (and seeing what things
 * cost); reading the takings; changing how every till behaves.
 */
export const POS_FEATURE = {
  /** Open the app; see items (without costs), orders and customers. */
  read: 'pos:read',
  /**
   * Build, hold, resume and edit orders; create and edit customers. At the
   * LISTED price: lowering it is `discount`. ⚠ NOT PAYMENT: since issue #23 an
   * order taker builds and holds, and a cashier settles (`takePayment`).
   */
  sell: 'pos:sell',
  /**
   * Settle an order: pay it, let it be paid later, cancel it, and settle the
   * change owed (issue #23). Every act that decides what happens to the money,
   * or that an order will bring none.
   */
  takePayment: 'pos:take_payment',
  /** Give a ₱ or % discount on a line or the whole order (D16). */
  discount: 'pos:discount',
  /** Refund a paid order, by line or by amount, and void an unpaid one whose items came back (D17). */
  refund: 'pos:refund',
  /**
   * Add, edit and archive items, variants and categories, the order types and
   * the order reference options (the Items tab) — and SEE COSTS (D15).
   */
  manageItems: 'pos:manage_items',
  /** The dashboard and the reports, with profit and CSV export (D22). */
  reports: 'pos:reports',
  /**
   * Mark items and variants "Not available" and back (issue #37): sold out for
   * the day, a machine down. ⚠ AVAILABILITY ONLY, never a price or a name, so
   * a cashier holds it without `manageItems`.
   */
  setAvailability: 'pos:set_availability',
  /** Store settings: the time zone, the hot keys and item keys (D18). */
  manageSettings: 'pos:manage_settings',
} as const;

export type PosFeatureKey = (typeof POS_FEATURE)[keyof typeof POS_FEATURE];

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
export const POS_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: POS_FEATURE.read,
    module: 'pos',
    level: 'workspace',
    label: 'Use the point of sale',
    description: 'Open the point-of-sale app, and see its items, orders and customers.',
    tags: ['pos'],
    bindings: [
      /*
       * ⚠ The catalogue CARRIES COSTS in its rows; the resolver strips them for
       * anybody without `pos:manage_items` or `pos:reports`. The key opens the
       * catalogue, not its costs.
       */
      op('Query.posCatalogue'),
      /* Counts only, from the stock app, never a cost: every till shows "3 left" (INVENTORY-PLAN I8). */
      op('Query.posStockLevels'),
      op('Query.posCustomers'),
      op('Query.posCustomer'),
      /* Every till reads the keymap and time zone; only `manage_settings` writes them. */
      op('Query.posSettings'),
      op('Query.posOrders'),
      /* ⚠ An order's lines carry unit costs; the resolver strips them as for the catalogue. */
      op('Query.posOrder'),
      /*
       * ⚠ ITS OWN SURFACE. A subscription is authorised ONCE, here, and then
       * streams — ids only, filtered to the workspace.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.posEvents' },
    ],
  },
  {
    key: POS_FEATURE.sell,
    module: 'pos',
    level: 'workspace',
    label: 'Take orders',
    description: 'Ring up orders at the listed price, hold, resume and edit them, and record customers.',
    tags: ['pos'],
    bindings: [
      op('Mutation.createPosOrder'),
      /*
       * ⚠ Changing a line's quantity, adding or removing one: the service asks
       * the access port for `pos:discount` and DROPS FIXED DISCOUNTS when the
       * editor lacks it (guard rules). The key sells at the listed price.
       */
      op('Mutation.addPosOrderLine'),
      op('Mutation.updatePosOrderLine'),
      op('Mutation.removePosOrderLine'),
      op('Mutation.refreshPosOrderLine'),
      op('Mutation.setPosOrderCustomer'),
      op('Mutation.setPosOrderLabel'),
      op('Mutation.setPosOrderType'),
      op('Mutation.holdPosOrder'),
      /* Customers are created where they are met: at the till (D5). */
      op('Mutation.savePosCustomer'),
      op('Mutation.setPosCustomerArchived'),
    ],
  },
  {
    key: POS_FEATURE.takePayment,
    module: 'pos',
    level: 'workspace',
    label: 'Take payment',
    description: 'Take payment for an order, let a customer pay later, cancel an order, and settle change owed.',
    tags: ['pos'],
    /*
     * ⚠ NEVER ALSO BOUND TO `pos:sell`. Several keys on one operation means ALL
     * of them are required (module-permissions' binding index), so a shared
     * binding would lock out whoever holds only one. The order-building
     * operations stay `pos:sell`'s alone; a cashier holds both keys.
     *
     * Cancelling is here, not with selling (the operator, 2026-10-29): an order
     * cancelled is an order that brings no money, and the order taker who
     * built it is not who decides that.
     */
    bindings: [
      op('Mutation.payPosOrder'),
      op('Mutation.payLaterPosOrder'),
      op('Mutation.cancelPosOrder'),
      op('Mutation.settlePosChangeOwed'),
    ],
  },
  {
    key: POS_FEATURE.discount,
    module: 'pos',
    level: 'workspace',
    label: 'Give discounts',
    description: 'Take an amount or a percentage off a line or a whole order, with a reason.',
    tags: ['pos'],
    bindings: [op('Mutation.setPosLineDiscount'), op('Mutation.setPosOrderDiscount')],
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
    bindings: [op('Mutation.refundPosOrder'), op('Mutation.voidPosOrder')],
  },
  {
    key: POS_FEATURE.manageItems,
    module: 'pos',
    level: 'workspace',
    label: 'Manage items',
    description:
      'Add, edit and archive items, their variants and categories, the order types and order references, and see what each item costs.',
    tags: ['pos'],
    bindings: [
      op('Mutation.savePosItem'),
      op('Mutation.setPosItemArchived'),
      op('Mutation.savePosCategory'),
      op('Mutation.setPosCategoryArchived'),
      /* Order types and order references live on the Items tab beside categories (the operator, 2026-10-29). */
      op('Mutation.savePosOrderTypeOption'),
      op('Mutation.setPosOrderTypeOptionArchived'),
      op('Mutation.setPosDefaultOrderType'),
      op('Mutation.savePosReferenceOptions'),
    ],
  },
  {
    key: POS_FEATURE.reports,
    module: 'pos',
    level: 'workspace',
    label: 'See sales reports',
    description: 'Open the dashboard and the sales reports, including profit, and export them.',
    tags: ['pos'],
    bindings: [op('Query.posReport')],
  },
  {
    key: POS_FEATURE.setAvailability,
    module: 'pos',
    level: 'workspace',
    label: 'Mark items not available',
    description:
      'Take items or single variants off sale for a while, and put them back, from the till or the Items tab. Prices and names stay as they are.',
    tags: ['pos'],
    /* One mutation for one item and for a whole selection: one binding, one guard. */
    bindings: [op('Mutation.setPosAvailability')],
  },
  {
    key: POS_FEATURE.manageSettings,
    module: 'pos',
    level: 'workspace',
    label: 'Change store settings',
    description: 'Set the keyboard shortcuts every till in the store uses.',
    tags: ['pos'],
    /*
     * The order reference options moved to the Items tab, under `pos:manage_items`
     * (2026-10-29): bound there, never here as well — two keys on one operation
     * would demand both.
     */
    bindings: [op('Mutation.savePosSettings')],
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
 * ⚠ THE MANAGER HOLDS EVERY CASHIER KEY, and the cashier every order taker's.
 * Grants add up and there is no deny, so a store with no cashiers runs the
 * till with the manager's role alone (POS-PLAN §4).
 */
export const POS_ROLE_PRESETS: readonly PosRolePreset[] = [
  /*
   * Takes orders and holds them for a cashier to settle (issue #23): a waiter,
   * a counter seller. Cannot pay, pay later or cancel.
   */
  {
    key: 'pos-order-taker',
    label: 'Order taker',
    icon: 'store',
    level: 'workspace',
    features: [POS_FEATURE.read, POS_FEATURE.sell],
  },
  {
    key: 'pos-cashier',
    label: 'Cashier',
    icon: 'store',
    level: 'workspace',
    /*
     * `setAvailability` (issue #37): the cashier at the counter is who hears
     * "we ran out". Not the order taker's, for now — a store whose order
     * takers should mark items off builds a role with it.
     */
    features: [POS_FEATURE.read, POS_FEATURE.sell, POS_FEATURE.takePayment, POS_FEATURE.setAvailability],
  },
  {
    key: 'pos-manager',
    label: 'POS manager',
    icon: 'store',
    level: 'workspace',
    features: [
      POS_FEATURE.read,
      POS_FEATURE.sell,
      POS_FEATURE.takePayment,
      POS_FEATURE.discount,
      POS_FEATURE.refund,
      POS_FEATURE.manageItems,
      POS_FEATURE.setAvailability,
      POS_FEATURE.reports,
      POS_FEATURE.manageSettings,
    ],
  },
];
