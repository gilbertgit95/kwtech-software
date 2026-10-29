import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { BACKUP_FEATURE, BACKUP_FEATURE_REGISTRY } from '../feature-keys.js';
import { BackupsPage } from './pages/backups-page.js';
import { BACKUPS_ADMIN_HREF } from './routes.js';

export { BACKUPS_ADMIN_HREF } from './routes.js';

/**
 * Its own section of the drawer, below Administration (50): the issue asks
 * for a place the database's other tasks can join later, and Backups is the
 * first of them.
 */
export const DATABASE_NAV_GROUP = 'Database';

export interface BackupWebModuleOptions {
  /** Where the daily backup's schedule lives: the runner's page. */
  processesHref?: string;
}

export function backupWebModule(options: BackupWebModuleOptions = {}): WebModuleDescriptor {
  const processesHref = options.processesHref ?? '/admin/processes';
  function BackupsRoute() {
    return <BackupsPage processesHref={processesHref} />;
  }

  return {
    key: 'backup',
    features: BACKUP_FEATURE_REGISTRY,
    navGroups: [{ group: DATABASE_NAV_GROUP, order: 60 }],
    routes: [
      {
        path: BACKUPS_ADMIN_HREF,
        component: BackupsRoute,
        title: 'Backups',
        // `backup:read`, the key the page's query is bound to. Each control inside checks its own.
        feature: BACKUP_FEATURE.read,
        nav: { group: DATABASE_NAV_GROUP, order: 10, icon: 'database' },
      },
    ],
  };
}
