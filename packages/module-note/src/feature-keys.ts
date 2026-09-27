import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * What the notes app lets somebody do.
 *
 * ⚠ A PLACEHOLDER. One key, and all it does today is OFFER the app on the
 * workspace's Apps page — there is no API yet, so there is nothing else to
 * guard. When notes gain operations, split the keys by risk (reading notes vs
 * writing vs deleting other people's) as `QUEUE_FEATURE` does, and bind each
 * operation below.
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 */
export const NOTE_FEATURE = {
  /** Open the notes app on the Apps page. */
  read: 'note:read',
} as const;

export type NoteFeatureKey = (typeof NOTE_FEATURE)[keyof typeof NOTE_FEATURE];

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ NO BINDINGS, because there are no operations to bind. The registry audit
 * reports the key as unbound, which is true: it gates a screen, not a request.
 * The first GraphQL operation this module ships must be bound here in the same
 * change, or it is reachable by anybody signed in — this module cannot use
 * `@RequireFeature`, so the bindings ARE its guard.
 */
export const NOTE_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: NOTE_FEATURE.read,
    module: 'note',
    level: 'workspace',
    label: 'See notes',
    description: 'Open the notes app on the workspace’s Apps page.',
    tags: ['note'],
    bindings: [],
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface NoteRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly NoteFeatureKey[];
}

export const NOTE_ROLE_PRESETS: readonly NoteRolePreset[] = [
  {
    key: 'note-user',
    label: 'Notes user',
    icon: 'pen',
    level: 'workspace',
    features: [NOTE_FEATURE.read],
  },
];
