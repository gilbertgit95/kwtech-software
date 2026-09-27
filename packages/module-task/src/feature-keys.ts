import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * What the tasks app lets somebody do.
 *
 * ⚠ A PLACEHOLDER. One key, and all it does today is OFFER the app on the
 * workspace's Apps page — there is no API yet, so there is nothing else to
 * guard. When tasks gain operations, split the keys by risk (reading tasks vs
 * assigning vs deleting other people's) as `QUEUE_FEATURE` does, and bind each
 * operation below.
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 */
export const TASK_FEATURE = {
  /** Open the tasks app on the Apps page. */
  read: 'task:read',
} as const;

export type TaskFeatureKey = (typeof TASK_FEATURE)[keyof typeof TASK_FEATURE];

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ NO BINDINGS, because there are no operations to bind. The registry audit
 * reports the key as unbound, which is true: it gates a screen, not a request.
 * The first GraphQL operation this module ships must be bound here in the same
 * change, or it is reachable by anybody signed in — this module cannot use
 * `@RequireFeature`, so the bindings ARE its guard.
 */
export const TASK_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: TASK_FEATURE.read,
    module: 'task',
    level: 'workspace',
    label: 'See tasks',
    description: 'Open the tasks app on the workspace’s Apps page.',
    tags: ['task'],
    bindings: [],
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface TaskRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly TaskFeatureKey[];
}

export const TASK_ROLE_PRESETS: readonly TaskRolePreset[] = [
  {
    key: 'task-user',
    label: 'Tasks user',
    icon: 'checklist',
    level: 'workspace',
    features: [TASK_FEATURE.read],
  },
];
