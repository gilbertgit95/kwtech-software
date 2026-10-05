import { composeApps, composeNav, composeRoutes } from '@kwtech/module-kit';
import { JOBS_FEATURE } from '../src/feature-keys.js';
import { ADMINISTRATION_NAV_GROUP, jobsWebModule } from '../src/react/module.js';
import { JOBS_ADMIN_HREF } from '../src/react/routes.js';

/** What adopting the runner on the web contributes. */
describe('jobsWebModule', () => {
  const module = jobsWebModule({ moduleLabels: { task: 'Tasks' } });

  it('contributes one page, at app level — no organization or workspace in its path', () => {
    expect(composeRoutes([module]).map((route) => route.path)).toEqual([JOBS_ADMIN_HREF]);
    expect(JOBS_ADMIN_HREF).toBe('/admin/processes');
  });

  it('⚠ gates the page on jobs:read — seeing, not control', () => {
    expect(composeRoutes([module])[0]?.feature).toBe(JOBS_FEATURE.read);
  });

  it('lists it in the drawer under Administration, for who holds the key and nobody else', () => {
    const [route] = composeRoutes([module]);
    expect(route?.nav).toMatchObject({ group: ADMINISTRATION_NAV_GROUP, icon: 'clock' });
    expect(ADMINISTRATION_NAV_GROUP).toBe('Administration');

    const held = composeNav([module], [JOBS_FEATURE.read], {});
    expect(held.map((entry) => [entry.label, entry.href])).toEqual([['Processes', JOBS_ADMIN_HREF]]);
    expect(composeNav([module], [], {})).toEqual([]);
    // A control key without the read key is not a way onto the page.
    expect(composeNav([module], [JOBS_FEATURE.pause], {})).toEqual([]);
  });

  it('⚠ is no sub-app: nothing on a workspace’s Apps page (JOBS-PLAN D9)', () => {
    expect(composeApps([module])).toEqual([]);
    expect(module.apps).toBeUndefined();
  });

  it('carries its keys, so an app composing descriptors sees them', () => {
    expect(module.features?.map((spec) => spec.key).sort()).toEqual(Object.values(JOBS_FEATURE).sort());
  });

  it('works with no options at all', () => {
    expect(composeRoutes([jobsWebModule()])).toHaveLength(1);
  });
});
