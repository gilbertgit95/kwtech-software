import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { FILE_FEATURE, FILE_FEATURE_REGISTRY, FILE_LIMIT_REGISTRY } from '../feature-keys.js';
import { FileApp } from './file-app.js';

/**
 * The files web descriptor — its app and its keys, as data the web app composes.
 *
 * ⚠ NO ROUTES and NO DRAWER ENTRY. A sub-app is reached from the workspace's
 * Apps page. The bytes travel through the web app's two route handlers
 * (`@kwtech/module-file-manager/next`), which are files of the app's own.
 */
export function fileWebModule(): WebModuleDescriptor {
  return {
    key: 'file',
    features: FILE_FEATURE_REGISTRY,
    limits: FILE_LIMIT_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts. Never rename it.
        key: 'file',
        label: 'Files',
        description: 'Upload files and share them with the workspace or chosen people. Deleted every night.',
        icon: 'folder',
        feature: FILE_FEATURE.read,
        order: 80,
        component: FileApp,
      },
    ],
  };
}
