import type { ProcessContribution, ServerModuleDescriptor } from '@kwtech/module-kit';
import { BACKUP_FEATURE_REGISTRY } from '../feature-keys.js';
import { BACKUP_PROCESS, BACKUP_PROCESS_REGISTRY } from '../processes.js';
import { BackupModule } from './backup.module.js';
import type { BackupModuleOptions } from './backup.options.js';
import { BackupDailyProcess } from './backup-daily.process.js';

/** Which class runs each declared process. ⚠ Keyed by the declaration's key; a missing one throws at boot. */
const HANDLERS: Readonly<Record<string, unknown>> = { [BACKUP_PROCESS.daily]: BackupDailyProcess };

function backupProcesses(): ProcessContribution[] {
  return BACKUP_PROCESS_REGISTRY.map((declaration) => {
    const handler = HANDLERS[declaration.key];
    if (!handler) throw new Error(`module-backup declares ${declaration.key} with no handler in server-module.ts.`);
    return { ...declaration, handler };
  });
}

/**
 * Backups as DATA the host composes: the page's resolver, the download route,
 * the keys and the daily process arrive with it.
 *
 * ⚠ The keys and the process must ALSO be composed in the app's
 * `seed/registry.ts`: uncomposed keys are unguarded operations, and an
 * unsynced process never runs. And the app installs `BackupMaintenanceGuard`
 * as its FIRST global guard, or a restore runs under live traffic.
 */
export function backupServerModule(options: BackupModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'backup',
    nestModule: BackupModule.forRoot(options),
    features: BACKUP_FEATURE_REGISTRY,
    processes: backupProcesses(),
  };
}
