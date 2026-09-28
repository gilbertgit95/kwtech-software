import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the notes app lets somebody do, and how much of it (docs/NOTE-PLAN.md §3).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 *
 * Keys are ATOMIC and split by RISK. Reading is one thing; writing your own
 * notes and editing shared ones is another; throwing away SOMEBODY ELSE'S work
 * is a third, and the only one that is privileged.
 */
export const NOTE_FEATURE = {
  /** Open the app; read your own notes and shared ones; pin; your own appearance settings. */
  read: 'note:read',
  /**
   * Create notes; edit your own and shared ones; share or unshare your own;
   * trash, restore and delete forever your own; restore a revision.
   */
  write: 'note:write',
  /** Trash, restore and delete forever OTHER people's SHARED notes. Never their private ones. */
  manageAll: 'note:manage_all',
} as const;

export type NoteFeatureKey = (typeof NOTE_FEATURE)[keyof typeof NOTE_FEATURE];

/*
 * ── no key that reads somebody else's private note ──────────────────────────
 *
 * Not `manage_all`, not a super admin's. "Private" is a promise made to the
 * author, and a key that breaks it would make every private note shared with
 * whoever an organization later hands that key to (NOTE-PLAN decision 12).
 *
 * ── no key for managing tags ────────────────────────────────────────────────
 *
 * A tag is a label on a note, not a row in a shared vocabulary. A vocabulary
 * would list the tags on private notes to everybody who can see it — `#layoffs`
 * says enough on its own (NOTE-PLAN decision 9).
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
export const NOTE_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: NOTE_FEATURE.read,
    module: 'note',
    level: 'workspace',
    label: 'See notes',
    description: 'Open the notes app, read your own notes and the ones shared with the workspace.',
    tags: ['note'],
    bindings: [
      op('Query.notes'),
      op('Query.note'),
      op('Query.noteRevisions'),
      op('Query.myNoteSettings'),
      /*
       * ⚠ The person's OWN pin, order and settings, and still bound. An unbound
       * operation skips the guard's workspace-membership check entirely, and
       * both WRITE a row into the workspace named in the request. The key is
       * what makes "a member of this workspace" true before the row is written.
       */
      op('Mutation.setNotePinned'),
      op('Mutation.moveNote'),
      op('Mutation.setMyNoteSettings'),
      /*
       * ⚠ ITS OWN SURFACE. A subscription is authorised ONCE, here, and then
       * streams — filtered per subscriber, so a private note's changes reach
       * its author alone.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.noteEvents' },
    ],
  },
  {
    key: NOTE_FEATURE.write,
    module: 'note',
    level: 'workspace',
    label: 'Write notes',
    description:
      'Create notes, edit your own and the ones shared with the workspace, share your own, and trash or restore them.',
    tags: ['note'],
    bindings: [
      op('Mutation.createNote'),
      op('Mutation.updateNote'),
      op('Mutation.restoreNoteRevision'),
      op('Mutation.setNoteVisibility'),
      /*
       * Trashing, restoring and deleting forever are ONE operation each,
       * whoever does it: `note:write` lets you bin your own notes, and the
       * service asks `NoteAccessCheck` for `note:manage_all` only when the note
       * is somebody else's shared one.
       */
      op('Mutation.trashNote'),
      op('Mutation.restoreNote'),
      op('Mutation.deleteNoteForever'),
    ],
  },
  {
    key: NOTE_FEATURE.manageAll,
    module: 'note',
    /*
     * ⚠ PRIVILEGED because it throws away work that is not the holder's. It has
     * NO BINDINGS OF ITS OWN: trashing is one operation whoever does it, bound
     * to `note:write`, and the service asks the `NoteAccessCheck` port whether
     * the actor holds this key only when the note is somebody else's.
     */
    isPrivileged: true,
    level: 'workspace',
    label: 'Manage everyone’s shared notes',
    description:
      'Trash, restore and permanently delete notes other people shared with the workspace. Private notes stay private.',
    tags: ['note'],
    bindings: [],
  },
];

export const NOTE_LIMIT = {
  /** How many notes one person may have in a workspace, trashed ones included. */
  notes: 'note:notes',
} as const;

/**
 * The cap, PLAN-SOURCED — every `note:*` key is workspace level, so an
 * organization's subscription is there to read — and COUNTED PER PERSON.
 *
 * ⚠ PER PERSON, NOT PER WORKSPACE. Nobody may read another member's private
 * notes, so nobody could clear them: a workspace-wide cap would let one person,
 * or one departed person, fill everybody's quota with notes no admin can see or
 * delete (NOTE-PLAN §9).
 *
 * ⚠ TRASHED NOTES COUNT. Otherwise trash-then-create is unlimited storage.
 * Deleting forever is what frees a place.
 *
 * The module counts, in the transaction that inserts; the host's `LimitChecker`
 * only resolves the number (`LimitCheckInput.current`).
 */
export const NOTE_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: NOTE_LIMIT.notes,
    module: 'note',
    label: 'Notes per person',
    description: 'How many notes one person may keep in a workspace, counting the ones in the trash.',
    source: 'plan',
    countedOver: 'user',
    required: false,
    defaultValue: 500,
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
    features: [NOTE_FEATURE.read, NOTE_FEATURE.write],
  },
  {
    key: 'note-admin',
    label: 'Notes admin',
    icon: 'pen',
    level: 'workspace',
    features: [NOTE_FEATURE.read, NOTE_FEATURE.write, NOTE_FEATURE.manageAll],
  },
];
