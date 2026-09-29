import { composeApps, composeNav, composeRoutes } from '@kwtech/module-kit';
import { POS_FEATURE } from '../src/feature-keys.js';
import { posWebModule } from '../src/react/module.js';
import { PosApp } from '../src/react/pos-app.js';

/** What adopting the point of sale on the web contributes. */
describe('posWebModule', () => {
  const module = posWebModule();

  it('offers the point of sale on the Apps page, gated on pos:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({ key: 'pos', label: 'Point of sale', feature: POS_FEATURE.read, component: PosApp }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['pos']);
  });

  it('⚠ has no route and nothing in the drawer — a sub-app is reached from the Apps page', () => {
    expect(composeRoutes([module])).toEqual([]);
    expect(composeNav([module], [POS_FEATURE.read], { params: {} })).toEqual([]);
  });

  it('carries its keys, so an app composing descriptors sees them', () => {
    expect(module.features?.map((spec) => spec.key)).toEqual([POS_FEATURE.read]);
  });
});
