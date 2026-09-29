import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * What the point-of-sale app lets somebody do.
 *
 * ⚠ A PLACEHOLDER. One key, and all it does today is OFFER the app on the
 * workspace's Apps page — there is no API yet, so there is nothing else to
 * guard. When the till gains operations, split the keys by risk (ringing up a sale vs
 * refunding vs changing prices) as `QUEUE_FEATURE` does, and bind each
 * operation below.
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 */
export const POS_FEATURE = {
  /** Open the point-of-sale app on the Apps page. */
  read: 'pos:read',
} as const;

export type PosFeatureKey = (typeof POS_FEATURE)[keyof typeof POS_FEATURE];

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ NO BINDINGS, because there are no operations to bind. The registry audit
 * reports the key as unbound, which is true: it gates a screen, not a request.
 * The first GraphQL operation this module ships must be bound here in the same
 * change, or it is reachable by anybody signed in — this module cannot use
 * `@RequireFeature`, so the bindings ARE its guard.
 */
export const POS_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: POS_FEATURE.read,
    module: 'pos',
    level: 'workspace',
    label: 'Use the point of sale',
    description: 'Open the point-of-sale app on the workspace’s Apps page.',
    tags: ['pos'],
    bindings: [],
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

export const POS_ROLE_PRESETS: readonly PosRolePreset[] = [
  {
    key: 'pos-cashier',
    label: 'Cashier',
    icon: 'store',
    level: 'workspace',
    features: [POS_FEATURE.read],
  },
];
