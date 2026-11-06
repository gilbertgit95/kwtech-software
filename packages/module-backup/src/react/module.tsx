import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { BACKUP_FEATURE, BACKUP_FEATURE_REGISTRY } from '../feature-keys.js';
import { BackupsPage } from './pages/backups-page.js';
import { BACKUPS_ADMIN_HREF } from './routes.js';

export { BACKUPS_ADMIN_HREF } from './routes.js';

/**
 * The drawer's Server section, below Administration (50): the server's own
 * tasks, which apply to this installation rather than to an organization.
 * Backups is the first of them, and Local Network (#66) joins it. It was
 * "Database" until Local Network, which is not about the database, needed the
 * same place (#76).
 *
 * The name is a shared STRING, not an import: modules never import each other,
 * so each module in the group declares 'Server' itself and its own
 * web-module test pins the literal, as with ADMINISTRATION_NAV_GROUP. A typo in
 * one of them would split the drawer into two Server sections.
 */
export const SERVER_NAV_GROUP = 'Server';

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
    navGroups: [{ group: SERVER_NAV_GROUP, order: 60 }],
    routes: [
      {
        path: BACKUPS_ADMIN_HREF,
        component: BackupsRoute,
        title: 'Backups',
        // `backup:read`, the key the page's query is bound to. Each control inside checks its own.
        feature: BACKUP_FEATURE.read,
        nav: { group: SERVER_NAV_GROUP, order: 10, icon: 'database' },
      },
    ],
  };
}
