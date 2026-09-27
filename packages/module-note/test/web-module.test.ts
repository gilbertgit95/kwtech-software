import { composeApps, composeNav, composeRoutes } from '@kwtech/module-kit';
import { NOTE_FEATURE } from '../src/feature-keys.js';
import { noteWebModule } from '../src/react/module.js';
import { NoteApp } from '../src/react/note-app.js';

/** What adopting notes on the web contributes. */
describe('noteWebModule', () => {
  const module = noteWebModule();

  it('offers notes on the Apps page, gated on note:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({ key: 'note', label: 'Notes', feature: NOTE_FEATURE.read, component: NoteApp }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['note']);
  });

  it('⚠ has no route and nothing in the drawer — a sub-app is reached from the Apps page', () => {
    expect(composeRoutes([module])).toEqual([]);
    expect(composeNav([module], [NOTE_FEATURE.read], { params: {} })).toEqual([]);
  });

  it('carries its keys, so an app composing descriptors sees them', () => {
    expect(module.features?.map((spec) => spec.key)).toEqual(Object.values(NOTE_FEATURE));
  });
});
