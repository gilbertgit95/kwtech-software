import { STUDIO_DEFAULT_KEYMAP } from '../src/domain/keymap.js';
import { STUDIO_CONFLICT_MESSAGE, STUDIO_NOT_FOUND_MESSAGE } from '../src/server/studio.errors.js';
import { ANA, BEN, CAL, harness, OTHER_WORKSPACE, reasonOf, SCOPE, sampleSpec } from './harness.js';

const print = (overrides: Record<string, unknown> = {}) => ({
  action: 'downloaded',
  kind: 'layout',
  layoutId: null,
  layoutName: 'Unsaved',
  paperLabel: '4R',
  paperWidth: 10160,
  paperHeight: 15240,
  pages: 1,
  copies: 1,
  fileNames: ['juan.jpg'],
  ...overrides,
});

describe('creating a layout', () => {
  it('saves it private unless asked otherwise, owned by its maker', async () => {
    const { writes } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: ' ID package ', spec: sampleSpec() });
    expect(layout).toMatchObject({ name: 'ID package', ownerId: ANA, visibility: 'private', version: 1, ...SCOPE });
    expect(layout.spec).toEqual(sampleSpec());
  });

  it('files it under a tidied tag, or under none', async () => {
    const { writes } = harness();
    expect(
      await writes.createLayout(SCOPE, ANA, { name: 'a', spec: sampleSpec(), tag: ' Photo  Print ' }),
    ).toMatchObject({
      tag: 'Photo Print',
    });
    expect(await writes.createLayout(SCOPE, ANA, { name: 'b', spec: sampleSpec() })).toMatchObject({ tag: null });
    expect(await writes.createLayout(SCOPE, ANA, { name: 'c', spec: sampleSpec(), tag: '' })).toMatchObject({
      tag: null,
    });
    expect(
      await reasonOf(writes.createLayout(SCOPE, ANA, { name: 'd', spec: sampleSpec(), tag: 'x'.repeat(31) })),
    ).toBe('invalid_tag');
  });

  it('⚠ changes a tag on a save, takes it off with an empty one, and leaves it alone when none is sent', async () => {
    const { writes } = harness();
    const made = await writes.createLayout(SCOPE, ANA, { name: 'a', spec: sampleSpec(), tag: 'ID' });
    const renamed = await writes.updateLayout(SCOPE, ANA, made.id, made.version, { name: 'b' });
    expect(renamed).toMatchObject({ name: 'b', tag: 'ID', version: 2 });
    const moved = await writes.updateLayout(SCOPE, ANA, made.id, 2, { tag: 'Photo Print' });
    expect(moved).toMatchObject({ tag: 'Photo Print', version: 3 });
    expect(await writes.updateLayout(SCOPE, ANA, made.id, 3, { tag: '' })).toMatchObject({ tag: null, version: 4 });
    // Somebody else may not file your layout somewhere else.
    expect(await reasonOf(writes.updateLayout(SCOPE, BEN, made.id, 4, { tag: 'Theirs' }))).toBe('not_found');
  });

  it('stores only the spec the domain accepted, not what was sent', async () => {
    const { writes } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, {
      name: 'x',
      spec: { ...sampleSpec(), smuggled: 'x'.repeat(1000) },
    });
    expect(layout.spec).toEqual(sampleSpec());
  });

  it.each([
    [
      'a spec whose cells overlap',
      { spec: sampleSpec({ cells: [sampleSpec().cells[0], sampleSpec().cells[0]] as never }) },
      'cell_overlap',
    ],
    ['no spec at all', { spec: undefined }, 'invalid_spec'],
    ['an empty name', { name: '  ' }, 'invalid_name'],
    ['a visibility it has not heard of', { visibility: 'public' }, 'invalid_visibility'],
  ])('refuses %s', async (_name, overrides, reason) => {
    const { writes, prisma } = harness();
    const input = { name: 'ok', spec: sampleSpec(), ...overrides };
    expect(await reasonOf(writes.createLayout(SCOPE, ANA, input))).toBe(reason);
    expect(prisma.state.studioLayout).toHaveLength(0);
  });

  it('counts the cap per person, and leaves nothing behind when it refuses', async () => {
    const limits = {
      check: async ({ current }: { current: number }) => ({
        allowed: current < 2,
        limit: 2,
        current,
        remaining: 2 - current,
      }),
    };
    const { writes, prisma } = harness({ limits });
    await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    await writes.createLayout(SCOPE, ANA, { name: 'two', spec: sampleSpec() });

    expect(await reasonOf(writes.createLayout(SCOPE, ANA, { name: 'three', spec: sampleSpec() }))).toBe(
      'limit_reached',
    );
    expect(prisma.state.studioLayout).toHaveLength(2);
    // Ben has his own count: Ana's layouts do not use his places.
    await expect(writes.createLayout(SCOPE, BEN, { name: 'his', spec: sampleSpec() })).resolves.toBeDefined();
  });

  it('⚠ falls back to the declared default cap when no checker is bound, never to unlimited', async () => {
    const { writes, prisma } = harness();
    for (let made = 0; made < 100; made += 1) {
      prisma.state.studioLayout.push({ id: `seed-${made}`, ...SCOPE, ownerId: ANA, visibility: 'private', version: 1 });
    }
    expect(await reasonOf(writes.createLayout(SCOPE, ANA, { name: 'one more', spec: sampleSpec() }))).toBe(
      'limit_reached',
    );
  });
});

describe('listing and reading layouts', () => {
  async function seeded() {
    const h = harness();
    const mine = await h.writes.createLayout(SCOPE, ANA, { name: 'B mine', spec: sampleSpec() });
    const shared = await h.writes.createLayout(SCOPE, BEN, {
      name: 'A shared',
      spec: sampleSpec(),
      visibility: 'workspace',
    });
    const hidden = await h.writes.createLayout(SCOPE, BEN, { name: 'Ben private', spec: sampleSpec() });
    const elsewhere = await h.writes.createLayout(OTHER_WORKSPACE, ANA, {
      name: 'Other workspace',
      spec: sampleSpec(),
    });
    return { ...h, mine, shared, hidden, elsewhere };
  }

  it('lists your own and the shared ones, and never somebody else’s private layout', async () => {
    const { studio } = await seeded();
    const list = await studio.layouts(SCOPE, ANA);
    expect(list.mine.map((layout) => layout.name)).toEqual(['B mine']);
    expect(list.shared.map((layout) => layout.name)).toEqual(['A shared']);
  });

  it('⚠ answers null alike for a private layout that is not yours, another workspace’s, and none at all', async () => {
    const { studio, hidden, elsewhere, mine } = await seeded();
    expect(await studio.layout(SCOPE, ANA, hidden.id)).toBeNull();
    expect(await studio.layout(SCOPE, ANA, elsewhere.id)).toBeNull();
    expect(await studio.layout(SCOPE, ANA, 'no-such-layout')).toBeNull();
    expect(await studio.layout(SCOPE, ANA, mine.id)).toMatchObject({ id: mine.id });
  });

  it('renders a layout with whose it is, and leaves out a row whose spec cannot be read', async () => {
    const { resolver, prisma, mine } = await seeded();
    prisma.state.studioLayout.push({
      id: 'broken',
      ...SCOPE,
      ownerId: ANA,
      name: 'A broken',
      visibility: 'private',
      version: 1,
      updatedById: ANA,
      spec: { version: 99 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const listed = await resolver.layouts({ req: { userId: ANA } }, SCOPE.organizationId, SCOPE.workspaceId);
    expect(listed.map((layout) => [layout.id === mine.id, layout.mine])).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(listed.some((layout) => layout.id === 'broken')).toBe(false);
    expect(listed[0]?.spec.cells[0]?.label).toBe('1 × 1');
  });
});

describe('changing a layout', () => {
  it('saves from the version it was opened at and moves the version on', async () => {
    const { writes } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    const saved = await writes.updateLayout(SCOPE, ANA, layout.id, 1, {
      name: 'renamed',
      spec: sampleSpec({ guides: false }),
    });
    expect(saved).toMatchObject({ name: 'renamed', version: 2, updatedById: ANA });
    expect((saved.spec as { guides: boolean }).guides).toBe(false);
  });

  it('⚠ refuses a stale save with the conflict message the app compares', async () => {
    const { writes } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    await writes.updateLayout(SCOPE, ANA, layout.id, 1, { name: 'first' });
    await expect(writes.updateLayout(SCOPE, ANA, layout.id, 1, { name: 'second' })).rejects.toMatchObject({
      reason: 'conflict',
      message: STUDIO_CONFLICT_MESSAGE,
    });
  });

  it('refuses a save that lost the race between its read and its write', async () => {
    const { writes, prisma } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    prisma.beforeNextLayoutWrite(() => {
      const row = prisma.state.studioLayout[0];
      if (row) row.version = 2;
    });
    expect(await reasonOf(writes.updateLayout(SCOPE, ANA, layout.id, 1, { name: 'late' }))).toBe('conflict');
  });

  it('does not move the version when nothing was sent to change', async () => {
    const { writes } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    expect(await writes.updateLayout(SCOPE, ANA, layout.id, 1, {})).toMatchObject({ version: 1 });
  });

  it('refuses a bad spec and keeps what was there', async () => {
    const { writes, prisma } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    const outside = sampleSpec({ cells: [{ x: 0, y: 0, width: 99999, height: 2540 }] });
    expect(await reasonOf(writes.updateLayout(SCOPE, ANA, layout.id, 1, { spec: outside }))).toBe('cell_outside');
    expect(prisma.state.studioLayout[0]?.version).toBe(1);
  });

  it('⚠ lets only the owner change a shared layout — others are told to duplicate', async () => {
    const { writes, accessCalls } = harness({ managers: [] });
    const shared = await writes.createLayout(SCOPE, ANA, {
      name: 'shared',
      spec: sampleSpec(),
      visibility: 'workspace',
    });
    expect(await reasonOf(writes.updateLayout(SCOPE, BEN, shared.id, 1, { name: 'mine now' }))).toBe('not_permitted');
    expect(await reasonOf(writes.deleteLayout(SCOPE, BEN, shared.id))).toBe('not_permitted');
    expect(accessCalls).toEqual([BEN, BEN]);
  });

  it('lets a holder of manage_all change and delete somebody else’s shared layout', async () => {
    const { writes, prisma } = harness({ managers: [CAL] });
    const shared = await writes.createLayout(SCOPE, ANA, {
      name: 'shared',
      spec: sampleSpec(),
      visibility: 'workspace',
    });
    expect(await writes.updateLayout(SCOPE, CAL, shared.id, 1, { name: 'fixed' })).toMatchObject({
      name: 'fixed',
      ownerId: ANA,
      updatedById: CAL,
    });
    await writes.deleteLayout(SCOPE, CAL, shared.id);
    expect(prisma.state.studioLayout).toHaveLength(0);
  });

  it('⚠ fails closed with no access port: manage_all is held by nobody', async () => {
    const { writes } = harness();
    const shared = await writes.createLayout(SCOPE, ANA, {
      name: 'shared',
      spec: sampleSpec(),
      visibility: 'workspace',
    });
    expect(await reasonOf(writes.deleteLayout(SCOPE, BEN, shared.id))).toBe('not_permitted');
  });

  it('⚠ never asks about manage_all for a private layout: it is not_found first, with the one message', async () => {
    const { writes, accessCalls } = harness({ managers: [CAL] });
    const hidden = await writes.createLayout(SCOPE, ANA, { name: 'private', spec: sampleSpec() });
    for (const act of [
      writes.updateLayout(SCOPE, CAL, hidden.id, 1, { name: 'x' }),
      writes.deleteLayout(SCOPE, CAL, hidden.id),
      writes.setVisibility(SCOPE, CAL, hidden.id, 'workspace'),
      writes.duplicateLayout(SCOPE, CAL, hidden.id),
      writes.updateLayout(SCOPE, CAL, 'no-such-layout', 1, { name: 'x' }),
    ]) {
      await expect(act).rejects.toMatchObject({ reason: 'not_found', message: STUDIO_NOT_FOUND_MESSAGE });
    }
    expect(accessCalls).toEqual([]);
  });

  it('finds no layout through another workspace’s scope', async () => {
    const { writes } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    expect(await reasonOf(writes.deleteLayout(OTHER_WORKSPACE, ANA, layout.id))).toBe('not_found');
  });
});

describe('sharing and duplicating', () => {
  it('shares and unshares, the owner’s alone — manage_all does not change who sees it', async () => {
    const { writes } = harness({ managers: [CAL] });
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    expect(await writes.setVisibility(SCOPE, ANA, layout.id, 'workspace')).toMatchObject({
      visibility: 'workspace',
      version: 2,
    });
    expect(await reasonOf(writes.setVisibility(SCOPE, CAL, layout.id, 'private'))).toBe('not_owner');
    expect(await reasonOf(writes.setVisibility(SCOPE, ANA, layout.id, 'everyone'))).toBe('invalid_visibility');
  });

  it('does not move the version when the visibility is already what was asked', async () => {
    const { writes } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    expect(await writes.setVisibility(SCOPE, ANA, layout.id, 'private')).toMatchObject({ version: 1 });
  });

  it('reads the layout again when a share loses a race, and still lands', async () => {
    const { writes, prisma } = harness();
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    prisma.beforeNextLayoutWrite(() => {
      const row = prisma.state.studioLayout[0];
      if (row) row.version = 5;
    });
    expect(await writes.setVisibility(SCOPE, ANA, layout.id, 'workspace')).toMatchObject({
      visibility: 'workspace',
      version: 6,
    });
  });

  it('duplicates a shared layout as a private copy of your own', async () => {
    const { writes } = harness();
    const shared = await writes.createLayout(SCOPE, ANA, {
      name: 'ID package',
      spec: sampleSpec(),
      visibility: 'workspace',
      tag: 'ID',
    });
    const copy = await writes.duplicateLayout(SCOPE, BEN, shared.id);
    expect(copy.tag).toBe('ID');
    expect(copy).toMatchObject({ name: 'ID package (copy)', ownerId: BEN, visibility: 'private', version: 1 });
    expect(copy.spec).toEqual(shared.spec);
    expect(copy.id).not.toBe(shared.id);
    expect(await writes.duplicateLayout(SCOPE, BEN, shared.id, 'Mine')).toMatchObject({ name: 'Mine' });
  });

  it('counts a duplicate against the cap', async () => {
    const limits = {
      check: async ({ current }: { current: number }) => ({
        allowed: current < 1,
        limit: 1,
        current,
        remaining: 1 - current,
      }),
    };
    const { writes } = harness({ limits });
    const layout = await writes.createLayout(SCOPE, ANA, { name: 'one', spec: sampleSpec() });
    expect(await reasonOf(writes.duplicateLayout(SCOPE, ANA, layout.id))).toBe('limit_reached');
  });
});

describe('calibration profiles', () => {
  const profile = { name: 'Epson, 4R', scaleX: 10050, scaleY: 9990, offsetX: 20, offsetY: -30 };

  it('creates, changes and deletes the person’s own', async () => {
    const { writes, studio } = harness();
    const made = await writes.saveCalibration(SCOPE, ANA, profile);
    expect(made).toMatchObject({ ...profile, ownerId: ANA });
    const changed = await writes.saveCalibration(SCOPE, ANA, { ...profile, id: made.id, scaleX: 10000 });
    expect(changed).toMatchObject({ id: made.id, scaleX: 10000 });
    expect(await studio.calibrations(SCOPE, ANA)).toHaveLength(1);
    await writes.deleteCalibration(SCOPE, ANA, made.id);
    expect(await studio.calibrations(SCOPE, ANA)).toHaveLength(0);
  });

  it('⚠ is its maker’s alone: nobody else lists, changes or deletes it', async () => {
    const { writes, studio } = harness();
    const made = await writes.saveCalibration(SCOPE, ANA, profile);
    expect(await studio.calibrations(SCOPE, BEN)).toEqual([]);
    expect(await reasonOf(writes.saveCalibration(SCOPE, BEN, { ...profile, id: made.id }))).toBe('not_found');
    expect(await reasonOf(writes.deleteCalibration(SCOPE, BEN, made.id))).toBe('not_found');
  });

  it('refuses a second profile of the same name, by the database’s own constraint', async () => {
    const { writes } = harness();
    await writes.saveCalibration(SCOPE, ANA, profile);
    expect(await reasonOf(writes.saveCalibration(SCOPE, ANA, profile))).toBe('duplicate_name');
    // Ben may use the same name: the constraint is per person.
    await expect(writes.saveCalibration(SCOPE, BEN, profile)).resolves.toBeDefined();
  });

  it('refuses a correction too far from 100% to be a tolerance', async () => {
    const { writes } = harness();
    expect(await reasonOf(writes.saveCalibration(SCOPE, ANA, { ...profile, scaleX: 15000 }))).toBe(
      'invalid_calibration',
    );
  });
});

describe('the print log', () => {
  it('records who, what and the file names — without the folder they came from', async () => {
    const { writes } = harness();
    const row = await writes.recordPrint(SCOPE, ANA, print({ fileNames: ['C:\\Customers\\juan.jpg'] }));
    expect(row).toMatchObject({ userId: ANA, action: 'downloaded', pages: 1, fileNames: ['juan.jpg'], ...SCOPE });
  });

  it('takes the layout’s name from the row, and drops an id the person may not see', async () => {
    const { writes } = harness();
    const mine = await writes.createLayout(SCOPE, ANA, { name: 'Real name', spec: sampleSpec() });
    const hidden = await writes.createLayout(SCOPE, BEN, { name: 'Ben’s secret', spec: sampleSpec() });

    expect(await writes.recordPrint(SCOPE, ANA, print({ layoutId: mine.id, layoutName: 'Lie' }))).toMatchObject({
      layoutId: mine.id,
      layoutName: 'Real name',
    });
    expect(await writes.recordPrint(SCOPE, ANA, print({ layoutId: hidden.id, layoutName: 'Guess' }))).toMatchObject({
      layoutId: null,
      layoutName: 'Guess',
    });
  });

  it('refuses an entry that is not one', async () => {
    const { writes } = harness();
    expect(await reasonOf(writes.recordPrint(SCOPE, ANA, print({ pages: 0 })))).toBe('invalid_log');
  });

  it('shows a person their own history, newest first', async () => {
    const { writes, studio } = harness();
    await writes.recordPrint(SCOPE, ANA, print({ paperLabel: 'first' }));
    await writes.recordPrint(SCOPE, BEN, print({ paperLabel: 'ben' }));
    await writes.recordPrint(SCOPE, ANA, print({ paperLabel: 'second' }));
    const page = await studio.log(SCOPE, ANA, {});
    expect(page.entries.map((entry) => entry.paperLabel)).toEqual(['second', 'first']);
    expect(page.everyone).toBe(false);
  });

  it('⚠ shows everybody’s only to a holder of manage_all — anybody else quietly gets their own', async () => {
    const { writes, studio } = harness({ managers: [CAL] });
    await writes.recordPrint(SCOPE, ANA, print());
    await writes.recordPrint(SCOPE, BEN, print());

    const asManager = await studio.log(SCOPE, CAL, { everyone: true });
    expect(asManager.entries).toHaveLength(2);
    expect(asManager.everyone).toBe(true);

    const asBen = await studio.log(SCOPE, BEN, { everyone: true });
    expect(asBen.entries.map((entry) => entry.userId)).toEqual([BEN]);
    expect(asBen.everyone).toBe(false);
  });

  it('never shows another workspace’s history', async () => {
    const { writes, studio } = harness({ managers: [CAL] });
    await writes.recordPrint(OTHER_WORKSPACE, ANA, print());
    expect((await studio.log(SCOPE, CAL, { everyone: true })).entries).toEqual([]);
  });

  it('pages by time through an opaque cursor', async () => {
    const { writes, resolver } = harness();
    for (const label of ['a', 'b', 'c']) await writes.recordPrint(SCOPE, ANA, print({ paperLabel: label }));
    const context = { req: { userId: ANA } };
    const first = await resolver.log(context, SCOPE.organizationId, SCOPE.workspaceId, false, null, 2);
    expect(first.entries.map((entry) => entry.paperLabel)).toEqual(['c', 'b']);
    expect(first.nextCursor).not.toBeNull();
    const second = await resolver.log(context, SCOPE.organizationId, SCOPE.workspaceId, false, first.nextCursor, 2);
    expect(second.entries.map((entry) => entry.paperLabel)).toEqual(['a']);
    expect(second.nextCursor).toBeNull();
    // A cursor that is not one pages from the start rather than failing.
    const garbage = await resolver.log(context, SCOPE.organizationId, SCOPE.workspaceId, false, '!!!', 2);
    expect(garbage.entries).toHaveLength(2);
  });
});

describe('the resolver', () => {
  it('refuses a request with nobody on it', async () => {
    const { resolver } = harness();
    await expect(resolver.layouts({ req: {} }, SCOPE.organizationId, SCOPE.workspaceId)).rejects.toMatchObject({
      reason: 'not_permitted',
    });
  });

  it('creates from a structured spec input and renders it back', async () => {
    const { resolver } = harness({ directory: { describe: async () => [{ userId: ANA, displayName: 'Ana' }] } });
    const spec = sampleSpec();
    const made = await resolver.createLayout({ req: { userId: ANA } }, SCOPE.organizationId, SCOPE.workspaceId, {
      name: 'From the editor',
      spec: { ...spec, cells: spec.cells.map((cell) => ({ ...cell })) },
    });
    expect(made).toMatchObject({ name: 'From the editor', mine: true, ownerName: 'Ana', visibility: 'private' });
    expect(made.spec.cells).toHaveLength(2);
    expect(made.spec.paper.key).toBe('4r');
  });
});

describe('the workspace’s shortcut keys', () => {
  it('are the defaults until somebody saves, at version 0', async () => {
    const { settings } = harness();
    expect(await settings.get(SCOPE)).toEqual({ keymap: STUDIO_DEFAULT_KEYMAP, version: 0 });
  });

  it('are saved for the workspace, in one spelling, and the version moves', async () => {
    const { settings } = harness();
    const first = await settings.save(SCOPE, ANA, { ...STUDIO_DEFAULT_KEYMAP, turnPhoto: 'shift+t' });
    expect(first).toMatchObject({ version: 1 });
    expect(first.keymap.turnPhoto).toBe('Shift+T');
    expect((await settings.save(SCOPE, ANA, { ...STUDIO_DEFAULT_KEYMAP, turnPhoto: 'T' })).version).toBe(2);
    expect((await settings.get(SCOPE)).keymap.turnPhoto).toBe('T');
    // Another workspace still has the defaults.
    expect((await settings.get(OTHER_WORKSPACE)).keymap.turnPhoto).toBe('R');
  });

  it('⚠ refuses a keymap with every reason at once, and saves nothing', async () => {
    const { settings, prisma } = harness();
    const bad = { ...STUDIO_DEFAULT_KEYMAP, download: 'Ctrl+P', turnPhoto: 'S' };
    await expect(settings.save(SCOPE, ANA, bad)).rejects.toMatchObject({ reason: 'invalid_keymap' });
    await expect(settings.save(SCOPE, ANA, bad)).rejects.toThrow(/belongs to the browser/u);
    await expect(settings.save(SCOPE, ANA, bad)).rejects.toThrow(/used twice/u);
    expect(prisma.state.studioSettings).toHaveLength(0);
  });

  it('goes back to the defaults when asked to reset', async () => {
    const { settings } = harness();
    await settings.save(SCOPE, ANA, { ...STUDIO_DEFAULT_KEYMAP, turnPhoto: 'T' });
    expect((await settings.save(SCOPE, ANA, null)).keymap).toEqual(STUDIO_DEFAULT_KEYMAP);
  });

  it('⚠ never trusts what was stored: a row that no longer validates reads as the defaults', async () => {
    const { settings, prisma } = harness();
    prisma.state.studioSettings.push({ ...SCOPE, keymap: { turnPhoto: 'S' }, version: 3, updatedById: ANA });
    expect(await settings.get(SCOPE)).toEqual({ keymap: STUDIO_DEFAULT_KEYMAP, version: 3 });
  });

  it('crosses the wire as JSON text, and refuses text that is not JSON', async () => {
    const { resolver } = harness();
    const context = { req: { userId: ANA } };
    const custom = JSON.stringify({ ...STUDIO_DEFAULT_KEYMAP, print: 'Shift+P' });
    const saved = await resolver.saveSettings(context, SCOPE.organizationId, SCOPE.workspaceId, custom);
    expect(JSON.parse(saved.keymap).print).toBe('Shift+P');
    const read = await resolver.readSettings(context, SCOPE.organizationId, SCOPE.workspaceId);
    expect(read).toEqual(saved);
    await expect(
      resolver.saveSettings(context, SCOPE.organizationId, SCOPE.workspaceId, '{not json'),
    ).rejects.toMatchObject({
      reason: 'invalid_keymap',
    });
  });
});
