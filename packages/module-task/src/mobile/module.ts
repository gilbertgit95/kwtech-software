import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { TASK_FEATURE } from '../feature-keys.js';
import { TaskApp } from '../react/task-app.js';

/**
 * What tasks offer the phone layout (issue #22): the same app as the Apps
 * page's, full screen. `TaskApp` is a sub-app, built to work in a box of any
 * size by its container's width — a phone is a narrow box — and never to
 * navigate, which is what a phone screen must not do either.
 *
 * Gated by `task:read`, the key that offers it on the Apps page.
 */
export function taskMobileModule(): MobileModuleDescriptor {
  return {
    key: 'task',
    screens: [
      { key: 'task', label: 'Tasks', icon: 'checklist', feature: TASK_FEATURE.read, order: 30, component: TaskApp },
    ],
  };
}
