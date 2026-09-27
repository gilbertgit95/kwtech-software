import { composeApps, composeNav, composeRoutes } from '@kwtech/module-kit';
import { TASK_FEATURE } from '../src/feature-keys.js';
import { taskWebModule } from '../src/react/module.js';
import { TaskApp } from '../src/react/task-app.js';

/** What adopting tasks on the web contributes. */
describe('taskWebModule', () => {
  const module = taskWebModule();

  it('offers tasks on the Apps page, gated on task:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({ key: 'task', label: 'Tasks', feature: TASK_FEATURE.read, component: TaskApp }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['task']);
  });

  it('⚠ has no route and nothing in the drawer — a sub-app is reached from the Apps page', () => {
    expect(composeRoutes([module])).toEqual([]);
    expect(composeNav([module], [TASK_FEATURE.read], { params: {} })).toEqual([]);
  });

  it('carries its keys, so an app composing descriptors sees them', () => {
    expect(module.features?.map((spec) => spec.key)).toEqual([TASK_FEATURE.read]);
  });
});
