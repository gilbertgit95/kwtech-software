import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * What the Apps page lets somebody do.
 *
 * ⚠ BOTH KEYS ARE WORKSPACE LEVEL, so every resolver declares workspace scope
 * (§12.13) — without it the guard resolves at app level, where neither key
 * participates, and the page refuses everybody.
 *
 * ⚠ WORKSPACE KEYS ARE FILTERED BY THE PLAN. The page is free (APP-HUB-PLAN
 * decision 6), so `plans.ts` puts both keys in EVERY plan, `free` included. A
 * key no plan carries grants nothing.
 *
 * `_` rather than `-` in `app_hub`: a feature key's area is
 * `[a-z][a-z0-9_.]*` (`FEATURE_KEY_PATTERN`), and the role editor refuses a
 * key outside it.
 */
export const APP_HUB_FEATURE = {
  /** Open the Apps page, and save, or reset, your OWN layout of it. */
  read: 'app_hub:read',
  /** Save the workspace's DEFAULT layout — what everybody without their own sees. */
  layoutManage: 'app_hub:layout_manage',
} as const;

export type AppHubFeatureKey = (typeof APP_HUB_FEATURE)[keyof typeof APP_HUB_FEATURE];

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature` (it
 * belongs to `module-permissions`, PLAN §9), so `FeatureGuard` enforces each
 * operation through the binding below. Every operation is bound, the person's
 * own ones included: an unbound operation skips the guard's workspace
 * membership check, and saving your layout WRITES a row into the workspace
 * named in the request. `surface-coverage.test.ts` fails on an unbound one.
 */
export const APP_HUB_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: APP_HUB_FEATURE.read,
    module: 'app_hub',
    level: 'workspace',
    label: 'Use the Apps page',
    description: "Open the workspace's Apps page, and arrange it for yourself.",
    tags: ['apps'],
    bindings: [
      op('Query.appHubLayouts'),
      op('Mutation.saveMyAppHubLayout'),
      // Your own row, and still bound — see above.
      op('Mutation.resetMyAppHubLayout'),
    ],
  },
  {
    key: APP_HUB_FEATURE.layoutManage,
    module: 'app_hub',
    level: 'workspace',
    label: "Set the Apps page's default layout",
    description: 'Choose the layout everybody in the workspace sees until they arrange their own.',
    tags: ['apps'],
    bindings: [op('Mutation.saveWorkspaceAppHubLayout'), op('Mutation.resetWorkspaceAppHubLayout')],
  },
];
