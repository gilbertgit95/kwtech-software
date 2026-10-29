import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * Who may do what with the database's backups (issue #2). Split by risk, as
 * every registry here is: seeing the list is not making a copy, and making a
 * copy is not taking every password hash home or replacing the database.
 *
 * ⚠ ALL APP LEVEL, and granted to nobody by this module. `super-admin` holds
 * every registered key (seed/app-roles.ts derives it from the registry), so
 * after `db:sync` it is the only role that has these — the issue's "only
 * possible for super admin". Granting one to another role is a choice made on
 * the Roles page, by somebody who can already do all of this.
 */
export const BACKUP_FEATURE = {
  /** The Backups page: the folder's list, and what the server is doing. */
  read: 'backup:read',
  /** Back up now. */
  create: 'backup:create',
  /** Download a backup to this computer. */
  download: 'backup:download',
  /** Delete a backup from the folder. */
  delete: 'backup:delete',
  /** Replace the whole database with a backup. */
  restore: 'backup:restore',
} as const;

export type BackupFeatureKey = (typeof BACKUP_FEATURE)[keyof typeof BACKUP_FEATURE];

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

export const BACKUP_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: BACKUP_FEATURE.read,
    module: 'backup',
    level: 'app',
    label: 'See database backups',
    description: 'See the backups in the server’s backup folder, and whether a backup or restore is running.',
    tags: ['backup'],
    bindings: [op('Query.backups')],
  },
  {
    key: BACKUP_FEATURE.create,
    module: 'backup',
    level: 'app',
    label: 'Back up the database',
    description: 'Make a full copy of the database into the server’s backup folder now.',
    tags: ['backup'],
    bindings: [op('Mutation.createBackup')],
  },
  {
    key: BACKUP_FEATURE.download,
    module: 'backup',
    /*
     * PRIVILEGED: a backup is every row — password hashes, encrypted 2FA
     * secrets, every organization's data. Downloading one takes all of it off
     * the server.
     */
    isPrivileged: true,
    level: 'app',
    label: 'Download database backups',
    description: 'Download a backup file. It holds every row of the database, password hashes included.',
    tags: ['backup'],
    bindings: [op('Mutation.issueBackupDownload')],
  },
  {
    key: BACKUP_FEATURE.delete,
    module: 'backup',
    // PRIVILEGED: a deleted backup is gone, and it may be the only copy of a day.
    isPrivileged: true,
    level: 'app',
    label: 'Delete database backups',
    description: 'Delete a backup from the server’s backup folder. It cannot be brought back.',
    tags: ['backup'],
    bindings: [op('Mutation.deleteBackup')],
  },
  {
    key: BACKUP_FEATURE.restore,
    module: 'backup',
    // PRIVILEGED above all: it replaces every organization's data at once and signs everybody out.
    isPrivileged: true,
    level: 'app',
    label: 'Restore the database from a backup',
    description:
      'Replace the whole database with a backup. Everything since that backup is lost, and everybody is signed out.',
    tags: ['backup'],
    bindings: [op('Mutation.restoreBackup')],
  },
];
