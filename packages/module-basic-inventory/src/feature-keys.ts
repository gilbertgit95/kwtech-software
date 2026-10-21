import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the stock app lets somebody do, and how much of it
 * (docs/INVENTORY-PLAN.md §8).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 *
 * Keys are split by RISK: looking; recording what came in, went out by hand or
 * was spoiled (done at the counter, by staff); and changing what is counted and
 * how a sale takes it (the lists every sale reads, and the stock takes that
 * overwrite on hand).
 */
export const STOCK_FEATURE = {
  /** Open the app; see on hand, stock value, movements and what uses what. */
  read: 'stock:read',
  /** Receive stock, adjust it with a reason, and record waste (I15). */
  receive: 'stock:receive',
  /** Stock items, categories, materials lists, creating from POS products, and stock takes. */
  manage: 'stock:manage',
} as const;

export type StockFeatureKey = (typeof STOCK_FEATURE)[keyof typeof STOCK_FEATURE];

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
export const STOCK_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: STOCK_FEATURE.read,
    module: 'stock',
    level: 'workspace',
    label: 'See stock',
    description: 'Open the stock app, and see what is on hand, what it is worth, its history, and what uses what.',
    tags: ['stock'],
    bindings: [
      op('Query.stockItems'),
      op('Query.stockItem'),
      op('Query.stockMoves'),
      /* The POS's items, read through a port, to pick what a list hangs on (I2). */
      op('Query.stockSourceItems'),
      op('Query.stockTakes'),
      op('Query.stockTake'),
      /*
       * ⚠ ITS OWN SURFACE. A subscription is authorised ONCE, here, and then
       * streams — ids only, filtered to the workspace.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.stockEvents' },
    ],
  },
  {
    key: STOCK_FEATURE.receive,
    module: 'stock',
    level: 'workspace',
    label: 'Receive and adjust stock',
    description: 'Record deliveries, correct stock with a reason, and record what was spoiled or damaged.',
    tags: ['stock'],
    bindings: [op('Mutation.receiveStock'), op('Mutation.adjustStock'), op('Mutation.recordStockWaste')],
  },
  {
    key: STOCK_FEATURE.manage,
    module: 'stock',
    level: 'workspace',
    label: 'Manage stock',
    description:
      'Add, edit and archive stock items and categories, set what each product uses up, and run and confirm stock takes.',
    tags: ['stock'],
    bindings: [
      op('Mutation.saveStockItem'),
      op('Mutation.setStockItemArchived'),
      op('Mutation.saveStockCategory'),
      op('Mutation.setStockCategoryArchived'),
      /* ⚠ Every later sale of that product reads this list: what it takes is fixed when each sale is recorded. */
      op('Mutation.setStockUses'),
      op('Mutation.createStockFromSource'),
      op('Mutation.startStockTake'),
      op('Mutation.saveStockTakeCounts'),
      /* ⚠ Overwrites on hand for every counted line that differs. */
      op('Mutation.confirmStockTake'),
      op('Mutation.abandonStockTake'),
    ],
  },
];

export const STOCK_LIMIT = {
  /** How many active stock items one store may have. */
  items: 'stock:items',
} as const;

/**
 * The cap, PLAN-SOURCED — every `stock:*` key is workspace level, so an
 * organization's subscription is there to read — and COUNTED OVER THE
 * WORKSPACE: the stock is the store's, not a person's.
 *
 * ⚠ ACTIVE ONLY. Archiving is the only way to remove an item (its movements
 * point at it), so counting archived ones would mean archiving never frees
 * room.
 */
export const STOCK_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: STOCK_LIMIT.items,
    module: 'stock',
    label: 'Stock items per store',
    description:
      'How many active stock items, goods and materials together, a store may count. Archived ones do not count.',
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
export interface StockRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly StockFeatureKey[];
}

/**
 * The keeper records what happens at the counter — a delivery, a damaged
 * board, a misprint — and the manager decides what is counted and how
 * (operator, 2026-10-21, INVENTORY-PLAN §8).
 *
 * ⚠ THE MANAGER HOLDS EVERY KEEPER KEY. Grants add up and there is no deny, so a
 * store with no staff runs stock with the manager's role alone.
 */
export const STOCK_ROLE_PRESETS: readonly StockRolePreset[] = [
  {
    key: 'stock-keeper',
    label: 'Stock keeper',
    icon: 'package',
    level: 'workspace',
    features: [STOCK_FEATURE.read, STOCK_FEATURE.receive],
  },
  {
    key: 'stock-manager',
    label: 'Stock manager',
    icon: 'package',
    level: 'workspace',
    features: [STOCK_FEATURE.read, STOCK_FEATURE.receive, STOCK_FEATURE.manage],
  },
];
