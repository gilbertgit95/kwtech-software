import { defaultLayout, evenSizes } from '../src/domain/layout.js';
import { AppHubWriteError } from '../src/server/app-hub.errors.js';
import { AppHubService, MAX_LAYOUT_TEXT_LENGTH } from '../src/server/app-hub.service.js';
import { createFakeClient } from './fake-client.js';

/** Saving and reading layouts, against the in-memory client. */

const scope = { organizationId: 'org-1', workspaceId: 'ws-1' };
const mine = defaultLayout(['queue', 'booking']);
const text = JSON.stringify(mine);

function setup() {
  const fake = createFakeClient();
  return { ...fake, service: new AppHubService(fake.client) };
}

describe('AppHubService', () => {
  it('reads nothing saved as two nulls — the page falls back to the built-in layout', async () => {
    const { service } = setup();
    await expect(service.layouts(scope, 'u1')).resolves.toEqual({ mine: null, workspace: null });
  });

  it('saves a person’s layout and reads it back for them alone', async () => {
    const { service } = setup();
    await service.saveMine(scope, 'u1', text);
    await expect(service.layouts(scope, 'u1')).resolves.toEqual({ mine, workspace: null });
    await expect(service.layouts(scope, 'u2')).resolves.toEqual({ mine: null, workspace: null });
  });

  it('⚠ replaces, never adds: one layout per person per workspace', async () => {
    const { service, state } = setup();
    await service.saveMine(scope, 'u1', text);
    await service.saveMine(scope, 'u1', JSON.stringify({ ...mine, view: 'grid' }));
    expect(state.user).toHaveLength(1);
    expect((await service.layouts(scope, 'u1')).mine?.view).toBe('grid');
  });

  it('resets a person’s layout, and resetting twice is not an error', async () => {
    const { service } = setup();
    await service.saveMine(scope, 'u1', text);
    await service.resetMine(scope, 'u1');
    await service.resetMine(scope, 'u1');
    expect((await service.layouts(scope, 'u1')).mine).toBeNull();
  });

  it('saves the workspace default for everybody, recording who, and resets it', async () => {
    const { service, state } = setup();
    await service.saveWorkspace(scope, 'admin', text);
    expect(state.workspace[0]).toMatchObject({ workspaceId: 'ws-1', organizationId: 'org-1', updatedBy: 'admin' });
    await expect(service.layouts(scope, 'anyone')).resolves.toEqual({ mine: null, workspace: mine });
    await service.resetWorkspace(scope);
    expect((await service.layouts(scope, 'anyone')).workspace).toBeNull();
  });

  it('⚠ leaves people’s own layouts alone when the default is reset', async () => {
    const { service } = setup();
    await service.saveMine(scope, 'u1', text);
    await service.saveWorkspace(scope, 'admin', text);
    await service.resetWorkspace(scope);
    expect((await service.layouts(scope, 'u1')).mine).toEqual(mine);
  });

  it.each([
    ['not JSON', '{nope', 'The layout is not valid JSON.'],
    [
      'over six cells',
      JSON.stringify({
        ...mine,
        grid: { ...mine.grid, rows: 1, columns: 7, columnSizes: evenSizes(7), cells: Array(7).fill(null) },
      }),
      'The grid may have at most 6 cells.',
    ],
    ['too large', `"${'x'.repeat(MAX_LAYOUT_TEXT_LENGTH)}"`, 'The layout is too large.'],
  ])('⚠ refuses a layout that is %s, and writes nothing', async (_, input, message) => {
    const { service, state } = setup();
    const attempt = service.saveMine(scope, 'u1', input);
    await expect(attempt).rejects.toBeInstanceOf(AppHubWriteError);
    await expect(service.saveWorkspace(scope, 'admin', input)).rejects.toThrow(message);
    expect(state).toEqual({ workspace: [], user: [] });
  });

  it('reads a stored layout that no longer validates as absent', async () => {
    const { service, state } = setup();
    state.user.push({ ...scope, userId: 'u1', layout: { version: 0 }, updatedAt: new Date() });
    expect((await service.layouts(scope, 'u1')).mine).toBeNull();
  });

  it('⚠ never shows a row from another organization', async () => {
    const { service, state } = setup();
    state.workspace.push({
      workspaceId: 'ws-1',
      organizationId: 'org-2',
      layout: mine,
      updatedBy: 'x',
      updatedAt: new Date(),
    });
    expect((await service.layouts(scope, 'u1')).workspace).toBeNull();
  });
});
