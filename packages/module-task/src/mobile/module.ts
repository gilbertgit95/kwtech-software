import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { TASK_FEATURE } from '../feature-keys.js';
import { TasksMobileApp } from './tasks-mobile-app.js';

/**
 * What tasks offer the phone layout (issue #22): `TasksMobileApp`, tasks laid
 * out for a phone — one column at a time, then one task full screen — on the
 * same `useTasks` as the Apps page's `TaskApp`. The desktop board squeezed into
 * a phone was a poor fit for a thumb (the operator, 2026-10-29).
 *
 * Gated by `task:read`, the key that offers it on the Apps page.
 */
export function taskMobileModule(): MobileModuleDescriptor {
  return {
    key: 'task',
    screens: [
      {
        key: 'task',
        label: 'Tasks',
        icon: 'checklist',
        feature: TASK_FEATURE.read,
        order: 30,
        component: TasksMobileApp,
      },
    ],
  };
}
