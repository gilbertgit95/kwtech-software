/**
 * @kwtech/module-backup — the pure core: the file-name rules, the keys, the
 * daily process and the GraphQL documents. Imports no framework and no Node
 * built-in, so the browser and the app's seed task can both read it.
 *
 *   import { BACKUP_FEATURE } from '@kwtech/module-backup';
 *   import { backupServerModule } from '@kwtech/module-backup/server';
 *   import { backupWebModule } from '@kwtech/module-backup/react';
 *   import { createBackupDownloadRouteHandlers } from '@kwtech/module-backup/next';
 */
export * from './domain/index.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './processes.js';
export * from './types.js';
