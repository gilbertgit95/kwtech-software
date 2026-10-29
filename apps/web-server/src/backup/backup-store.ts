import { fileURLToPath } from 'node:url';
import type { Env } from '../config/env.js';
import { PgBackupStore } from './pg-backup-store.js';

/**
 * This app's directory, `apps/web-server`: two up from this file in `src/`
 * and in `dist/` alike. A relative BACKUP_DIR is read from here, so the API
 * under pm2 and the command line run from anywhere name the same folder.
 */
export const APP_DIRECTORY = fileURLToPath(new URL('../../', import.meta.url));

/** The backup store for this app's database, as the API and the command line both build it. */
export function createBackupStore(config: Pick<Env, 'DATABASE_URL' | 'BACKUP_DIR' | 'BACKUP_DOCKER_CONTAINER'>) {
  return new PgBackupStore({
    databaseUrl: config.DATABASE_URL,
    directory: config.BACKUP_DIR,
    dockerContainer: config.BACKUP_DOCKER_CONTAINER ?? null,
    appDirectory: APP_DIRECTORY,
  });
}
