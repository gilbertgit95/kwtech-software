import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { type BackupModuleOptions, resolveBackupOptions } from './backup.options.js';
import { BackupService } from './backup.service.js';
import { BACKUP_END_SESSIONS, BACKUP_OPTIONS, BACKUP_PASSWORD_CHECK, BACKUP_STORE } from './backup.tokens.js';
import { BackupDailyProcess } from './backup-daily.process.js';
import { BackupMaintenanceGuard } from './backup-maintenance.guard.js';
import { BackupResolver } from './graphql/backup.resolver.js';
import { BackupDownloadController } from './http/backup-download.controller.js';

@Module({})
export class BackupModule {
  static forRoot(options: BackupModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      // Resolved HERE, so a bad `keep` fails the boot, not the first backup.
      { provide: BACKUP_OPTIONS, useValue: resolveBackupOptions(options) },
      BackupService,
      BackupDailyProcess,
      BackupMaintenanceGuard,
    ];
    // Optional ports are bound to undefined, never left out, so the service names the fix instead of Nest.
    const ports: Array<[unknown, string]> = [
      [options.storeProvider, BACKUP_STORE],
      [options.passwordCheckProvider, BACKUP_PASSWORD_CHECK],
      [options.endSessionsProvider, BACKUP_END_SESSIONS],
    ];
    for (const [provider, token] of ports) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }
    if (options.expose?.graphql ?? true) providers.push(BackupResolver);

    return {
      module: BackupModule,
      controllers: (options.expose?.rest ?? true) ? [BackupDownloadController] : [],
      providers,
      // The guard and its service, for the app's APP_GUARD; the process, for the runner.
      exports: [BackupService, BackupMaintenanceGuard, BackupDailyProcess],
    };
  }
}
