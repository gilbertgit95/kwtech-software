import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the file manager lets somebody do, and how much of it (issue #138).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: the app lives under a workspace,
 * and a workspace key is filtered by the organization's plan.
 *
 * ⚠ A KEY SAYS WHAT, A FILE SAYS WHO. The keys decide what a person may do in
 * this workspace; the file's sharing decides which files they may do it to
 * (`canSeeFile`). Both must agree, and no key opens somebody else's private
 * file.
 *
 * Split by risk: seeing files; putting files here and sharing your own; and
 * deciding how long EVERYBODY's files are kept.
 */
export const FILE_FEATURE = {
  /** Open the app; list and download the files you can see; see how long files are kept. */
  read: 'file:read',
  /** Upload files, and share or delete your own. */
  write: 'file:write',
  /** Change how long this workspace's files are kept before the nightly clean-up deletes them. */
  manage: 'file:manage',
} as const;

export type FileFeatureKey = (typeof FILE_FEATURE)[keyof typeof FILE_FEATURE];

/*
 * ── no key that deletes somebody else's file ──────────────────────────────────
 *
 * Every file is deleted by tonight's clean-up anyway, and a key that deleted
 * other people's would have to see them first — which no key may do to a
 * private file. Not built until somebody asks for it.
 */

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ THE BINDINGS ARE THE GUARD: this module cannot use `@RequireFeature`, so
 * `FeatureGuard` enforces each operation through its binding, and an unbound
 * operation is unguarded. `surface-coverage.test.ts` fails on one.
 */
export const FILE_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: FILE_FEATURE.read,
    module: 'file',
    level: 'workspace',
    label: 'See files',
    description:
      'Open the files app, and list and download the files shared with the workspace or with you, and your own.',
    tags: ['file'],
    bindings: [
      op('Query.files'),
      op('Query.fileSettings'),
      /*
       * A MUTATION, and still a read: it hands out a one-time download ticket,
       * and that is the act of reading a file. The service checks the file is
       * one the person can see.
       */
      op('Mutation.issueFileDownload'),
      // Authorised once, here, then filtered per subscriber (`fileEventReaches`).
      { surface: 'graphql_subscription', identifier: 'Subscription.fileEvents' },
    ],
  },
  {
    key: FILE_FEATURE.write,
    module: 'file',
    level: 'workspace',
    label: 'Upload and share files',
    description:
      'Upload files here, and share or delete your own: privately, with the workspace, or with chosen people.',
    tags: ['file'],
    /*
     * ⚠ EVERY ONE OF THESE ALSO CHECKS OWNERSHIP in the service. The key says
     * "may put files here"; it does not make you the owner of this one.
     */
    bindings: [
      op('Mutation.startFileUpload'),
      op('Mutation.setFileSharing'),
      op('Mutation.deleteFile'),
      // The people to choose from: somebody who cannot share has no reason to read the member list.
      op('Query.fileShareableMembers'),
    ],
  },
  {
    key: FILE_FEATURE.manage,
    module: 'file',
    level: 'workspace',
    label: 'Manage file settings',
    description: 'Choose how long this workspace’s files are kept before the nightly clean-up deletes them.',
    tags: ['file'],
    bindings: [op('Mutation.setFileSettings')],
  },
];

export const FILE_LIMIT = {
  /** The largest one file may be, in MB. */
  fileSize: 'file:file_size_mb',
  /** How much the workspace's files may take together, in MB. */
  storage: 'file:storage_mb',
} as const;

/**
 * The caps, PLAN-SOURCED, IN MEGABYTES (MiB), and COUNTED OVER THE WORKSPACE.
 *
 * ⚠ SIZES, NOT COUNTS. The `LimitChecker` resolves a cap for a count; here the
 * module asks it for the cap only and compares bytes itself
 * (`FileTransferService.checkRoom`), because "one more" is not the question —
 * "this many more bytes" is.
 *
 * ⚠ PER WORKSPACE, not per person: the folder is shared, and the clean-up
 * empties it every night, so no person's files can fill it for long.
 */
export const FILE_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: FILE_LIMIT.fileSize,
    module: 'file',
    label: 'Largest file (MB)',
    description: 'The largest one uploaded file may be, in megabytes. At most 2047.',
    source: 'plan',
    countedOver: 'workspace',
    required: false,
    defaultValue: 25,
  },
  {
    key: FILE_LIMIT.storage,
    module: 'file',
    label: 'File storage (MB)',
    description: 'How much room the workspace’s uploaded files may take together, in megabytes.',
    source: 'plan',
    countedOver: 'workspace',
    required: false,
    defaultValue: 500,
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface FileRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly FileFeatureKey[];
}

export const FILE_ROLE_PRESETS: readonly FileRolePreset[] = [
  {
    key: 'file-user',
    label: 'Files user',
    icon: 'folder',
    level: 'workspace',
    features: [FILE_FEATURE.read, FILE_FEATURE.write],
  },
  {
    key: 'file-admin',
    label: 'Files admin',
    icon: 'folder',
    level: 'workspace',
    features: [FILE_FEATURE.read, FILE_FEATURE.write, FILE_FEATURE.manage],
  },
];
