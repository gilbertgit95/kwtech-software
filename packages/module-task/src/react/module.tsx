import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { TASK_FEATURE, TASK_FEATURE_REGISTRY } from '../feature-keys.js';
import { TaskApp } from './task-app.js';

/**
 * The tasks web descriptor — its app and its key, as data the web app composes:
 *
 *   const FEATURE_MODULES = [..., taskWebModule()];
 *
 * A function, as `queueWebModule` is, so options can arrive without changing
 * the call site.
 *
 * ⚠ NO ROUTES and NO DRAWER ENTRY. A sub-app is reached from the workspace's
 * Apps page. A full-page route for direct links (a notification, a bookmark)
 * comes with the real screens, as the queue's console route did.
 */
export function taskWebModule(): WebModuleDescriptor {
  return {
    key: 'task',
    features: TASK_FEATURE_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts. Never rename it.
        key: 'task',
        label: 'Tasks',
        description: 'Track what needs doing in this workspace, and who is on it.',
        icon: 'checklist',
        feature: TASK_FEATURE.read,
        // After the queue (10) and notes (20).
        order: 30,
        component: TaskApp,
      },
    ],
  };
}
