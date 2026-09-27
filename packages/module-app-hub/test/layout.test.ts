import {
  APP_HUB_LAYOUT_VERSION,
  APP_HUB_MAX_CELLS,
  type AppHubGrid,
  type AppHubLayout,
  assignCell,
  cellCap,
  cellCount,
  cellIndex,
  cellPosition,
  defaultLayout,
  effectiveLayout,
  emptyGrid,
  evenSizes,
  fitGrid,
  GRID_PRESETS,
  hasMainView,
  isColumnsAllowed,
  MIN_TRACK_FRACTION,
  moveTab,
  presetOf,
  readLayout,
  reorderTabs,
  reshape,
  resizeTracks,
  startingColumnSizes,
  swapCells,
  validateLayout,
} from '../src/domain/layout.js';

/** The rules the Apps page and the server share — APP-HUB-PLAN §4–§6. */

/** A grid of these columns holding `cells`, column by column. */
const grid = (columns: number[], cells: (string | null)[]): AppHubGrid => ({ ...emptyGrid(columns), cells });

const layout = (over: Partial<AppHubLayout> = {}): AppHubLayout => ({
  ...defaultLayout(['queue', 'booking', 'survey']),
  ...over,
});

describe('the cell cap', () => {
  it('is the number of apps held, up to six', () => {
    expect([0, 1, 2, 3, 6, 7, 40].map(cellCap)).toEqual([0, 1, 2, 3, 6, 6, 6]);
  });

  it('⚠ disables a layout with more cells than the viewer has apps (decision 9)', () => {
    const cap = cellCap(3);
    expect(isColumnsAllowed([1, 2], cap)).toBe(true);
    expect(isColumnsAllowed([1, 3], cap)).toBe(false);
    expect(isColumnsAllowed([1, 2, 2, 2], cellCap(20))).toBe(false);
  });
});

describe('the presets', () => {
  it('⚠ ALL have a main view: a first column of one cell, and secondary views beside it', () => {
    expect(GRID_PRESETS.every((preset) => preset.columns[0] === 1)).toBe(true);
    expect(GRID_PRESETS.every((preset) => hasMainView({ columns: [...preset.columns] }))).toBe(true);
  });

  it('never exceed six cells, are listed fewest first, and are all distinct', () => {
    const counts = GRID_PRESETS.map((preset) => cellCount(preset.columns));
    expect(Math.max(...counts)).toBe(APP_HUB_MAX_CELLS);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(GRID_PRESETS.map((preset) => preset.key)).size).toBe(GRID_PRESETS.length);
  });

  it('start with the ones asked for: main + 1, main + 2 stacked, main + 3 stacked', () => {
    const keys = GRID_PRESETS.map((preset) => preset.key);
    expect(keys).toEqual(expect.arrayContaining(['1-1', '1-2', '1-3', '1-4', '1-5']));
  });

  it('are found again from a grid, and a grid without a main view matches none', () => {
    expect(presetOf(grid([1, 2], [null, null, null]))?.label).toBe('Main view and two stacked beside it');
    expect(presetOf(grid([2, 2], Array(4).fill(null)))).toBeUndefined();
  });

  it('⚠ start the main column WIDER — the working window, with extensions beside it', () => {
    const close = (sizes: number[]) => sizes.map((size) => Math.round(size * 1000) / 1000);
    expect(close(startingColumnSizes([1, 3]))).toEqual([0.667, 0.333]);
    expect(close(startingColumnSizes([1, 2, 2]))).toEqual([0.5, 0.25, 0.25]);
    // No main view, nothing to favour.
    expect(startingColumnSizes([2, 2])).toEqual(evenSizes(2));
  });

  it('are every one valid by the rules the server applies', () => {
    for (const preset of GRID_PRESETS) {
      expect(validateLayout(layout({ grid: emptyGrid(preset.columns) })).ok).toBe(true);
    }
  });
});

describe('cells, column by column', () => {
  it('numbers the main view 0, then each column top to bottom', () => {
    const shape = { columns: [1, 2, 2] };
    expect([0, 1, 2, 3, 4].map((index) => cellPosition(shape, index))).toEqual([
      { column: 0, row: 0, rows: 1 },
      { column: 1, row: 0, rows: 2 },
      { column: 1, row: 1, rows: 2 },
      { column: 2, row: 0, rows: 2 },
      { column: 2, row: 1, rows: 2 },
    ]);
    expect(cellPosition(shape, 5)).toBeNull();
    expect(cellIndex(shape, 2, 1)).toBe(4);
    expect(cellIndex(shape, 0, 1)).toBe(-1);
  });
});

describe('the default layout (decision 8)', () => {
  it('is the tab view with every app, and the main view with two stacked beside it', () => {
    expect(defaultLayout(['queue', 'booking', 'survey', 'audit'])).toMatchObject({
      view: 'tabs',
      tabs: { order: ['queue', 'booking', 'survey', 'audit'], active: 'queue' },
      grid: { columns: [1, 2], cells: ['queue', 'booking', 'survey'] },
    });
  });

  it('⚠ keeps to the cap: the main view and one beside it when the viewer holds two apps', () => {
    expect(defaultLayout(['queue', 'booking']).grid).toMatchObject({ columns: [1, 1], cells: ['queue', 'booking'] });
  });

  it('is the main view alone when the viewer holds one app', () => {
    expect(defaultLayout(['queue']).grid).toMatchObject({ columns: [1], cells: ['queue'] });
  });

  it('is valid by the rules the server applies', () => {
    expect(validateLayout(defaultLayout(['queue', 'booking'])).ok).toBe(true);
    expect(validateLayout(defaultLayout([])).ok).toBe(true);
  });
});

describe('validateLayout — the write rule', () => {
  it('accepts a whole six-cell grid', () => {
    const six = layout({ grid: grid([1, 5], ['a', 'b', 'c', 'd', 'e', null]) });
    expect(validateLayout(six)).toEqual({ ok: true, layout: six });
  });

  it('accepts a grid that matches no preset — storage is structural, the presets are what the page offers', () => {
    expect(validateLayout(layout({ grid: grid([2, 2], ['a', 'b', 'c', 'd']) })).ok).toBe(true);
  });

  it.each([
    ['not an object', 'nope'],
    ['a wrong version', { ...layout(), version: 3 }],
    ['an unknown view', { ...layout(), view: 'mosaic' }],
    ['seven cells', layout({ grid: grid([1, 6], Array(7).fill(null)) })],
    ['an empty column', layout({ grid: grid([1, 0], ['a']) })],
    ['no columns', layout({ grid: grid([], []) })],
    ['a fractional cell count', layout({ grid: { ...grid([1], ['a']), columns: [1.5] } })],
    ['the wrong number of cells', layout({ grid: grid([1, 1], ['a']) })],
    ['an app twice in the grid (decision 3)', layout({ grid: grid([1, 1], ['a', 'a']) })],
    ['an app twice in the tabs', layout({ tabs: { order: ['a', 'a'], active: 'a' } })],
    ['sizes that do not sum to 1', layout({ grid: { ...grid([1, 1], ['a', 'b']), columnSizes: [0.5, 0.2] } })],
    ['a track below the minimum', layout({ grid: { ...grid([1, 1], ['a', 'b']), columnSizes: [0.95, 0.05] } })],
    ['row sizes for the wrong column', layout({ grid: { ...grid([1, 2], ['a', 'b', 'c']), rowSizes: [[1], [1]] } })],
    ['an empty app key', layout({ grid: grid([1], ['']) })],
  ])('refuses %s', (_, input) => {
    expect(validateLayout(input).ok).toBe(false);
  });

  it('names what was wrong, for the error the page shows', () => {
    expect(validateLayout(layout({ grid: grid([1, 6], Array(7).fill(null)) }))).toEqual({
      ok: false,
      problem: 'The grid needs at least one cell in every column, and may have at most 6 cells.',
    });
  });

  it('stores only the fields it checked', () => {
    const check = validateLayout({ ...layout(), extra: 'kept?' });
    expect(check.ok && 'extra' in check.layout).toBe(false);
  });

  it('reads an invalid stored layout as absent, never as an error', () => {
    expect(readLayout({ version: 99 })).toBeNull();
    expect(readLayout(null)).toBeNull();
  });
});

describe('readLayout — a layout saved as version 1', () => {
  /** The rows × columns shape layouts were saved in before the presets, cells row by row. */
  const v1 = {
    version: 1,
    view: 'grid',
    tabs: { order: ['a', 'b', 'c', 'd'], active: 'a' },
    grid: { rows: 2, columns: 2, rowSizes: [0.7, 0.3], columnSizes: [0.4, 0.6], cells: ['a', 'b', 'c', 'd'] },
  };

  it('⚠ is converted, not lost: every column stacks the old rows, cells re-read column by column', () => {
    expect(readLayout(v1)).toEqual({
      version: APP_HUB_LAYOUT_VERSION,
      view: 'grid',
      tabs: { order: ['a', 'b', 'c', 'd'], active: 'a' },
      grid: {
        columns: [2, 2],
        columnSizes: [0.4, 0.6],
        rowSizes: [
          [0.7, 0.3],
          [0.7, 0.3],
        ],
        cells: ['a', 'c', 'b', 'd'],
      },
    });
  });

  it('turns the old default — two side by side — into the main view with one beside it', () => {
    const old = { ...v1, grid: { rows: 1, columns: 2, rowSizes: [1], columnSizes: [0.5, 0.5], cells: ['a', 'b'] } };
    expect(readLayout(old)?.grid).toMatchObject({ columns: [1, 1], cells: ['a', 'b'] });
    expect(hasMainView(readLayout(old)?.grid ?? { columns: [] })).toBe(true);
  });

  it('still reads a broken version-1 layout as absent', () => {
    expect(readLayout({ ...v1, grid: { ...v1.grid, cells: ['a'] } })).toBeNull();
  });
});

describe('effectiveLayout — what the viewer sees (APP-HUB-PLAN §5)', () => {
  const declared = ['queue', 'booking', 'survey', 'audit'];

  it('prefers the viewer’s own, then the workspace default, then the built-in one', () => {
    const mine = layout({ view: 'grid' });
    const workspace = layout({ view: 'tabs' });
    expect(effectiveLayout({ user: mine, workspace }, declared, declared).source).toBe('user');
    expect(effectiveLayout({ user: null, workspace }, declared, declared).source).toBe('workspace');
    expect(effectiveLayout({ user: null, workspace: null }, declared, declared).source).toBe('default');
  });

  it('shows exactly the apps held as tabs: the saved order, then new ones at the end', () => {
    const saved = layout({ tabs: { order: ['survey', 'queue', 'gone'], active: 'survey' } });
    const { layout: shown } = effectiveLayout({ user: saved, workspace: null }, declared, [
      'queue',
      'booking',
      'survey',
    ]);
    expect(shown.tabs.order).toEqual(['survey', 'queue', 'booking']);
    expect(shown.tabs.active).toBe('survey');
  });

  it('opens the first tab when the saved one is no longer held', () => {
    const saved = layout({ tabs: { order: ['queue', 'booking'], active: 'booking' } });
    expect(effectiveLayout({ user: saved, workspace: null }, declared, ['queue']).layout.tabs.active).toBe('queue');
  });

  it('⚠ keeps a cell whose app the viewer lost — the page says why — but empties an undeclared one', () => {
    const saved = layout({ grid: grid([1, 2], ['queue', 'booking', 'removed-app']) });
    const { layout: shown } = effectiveLayout({ user: saved, workspace: null }, declared, ['queue', 'survey', 'audit']);
    expect(shown.grid.cells).toEqual(['queue', 'booking', null]);
  });

  it('⚠ narrows a grid wider than the viewer’s apps for DISPLAY, to a preset with a main view', () => {
    const wide = layout({ grid: grid([1, 5], ['queue', 'booking', 'survey', 'audit', null, null]) });
    const { layout: shown } = effectiveLayout({ user: null, workspace: wide }, declared, ['booking', 'audit', 'queue']);
    // Three cells, two columns like the saved grid: the main view and two stacked.
    expect(shown.grid).toMatchObject({ columns: [1, 2], cells: ['queue', 'booking', 'audit'] });
    // The saved one is untouched, so access coming back restores it.
    expect(wide.grid.cells).toHaveLength(6);
  });

  it('shows no grid to a viewer with no apps', () => {
    expect(fitGrid(grid([1, 1], ['queue', 'booking']), declared, []).cells).toEqual([null]);
  });
});

describe('reshape — picking another preset', () => {
  it('keeps each app in its column and row when the new layout still has them', () => {
    const { grid: next, dropped } = reshape(grid([1, 1], ['a', 'b']), [1, 3]);
    expect(next.cells).toEqual(['a', 'b', null, null]);
    expect(dropped).toEqual([]);
  });

  it('⚠ keeps the main view’s app in the main view', () => {
    expect(reshape(grid([1, 2], ['main', 'b', 'c']), [1, 1, 1]).grid.cells[0]).toBe('main');
  });

  it('moves an app whose cell is gone into the first empty one', () => {
    const { grid: next } = reshape(grid([1, 3], ['a', null, null, 'd']), [1, 1]);
    expect(next.cells).toEqual(['a', 'd']);
  });

  it('⚠ reports what no longer fits, so the page can ask first', () => {
    const { grid: next, dropped } = reshape(grid([1, 3], ['a', 'b', 'c', 'd']), [1, 1]);
    expect(next.cells).toEqual(['a', 'b']);
    expect(dropped).toEqual(['c', 'd']);
  });

  it('keeps dragged sizes where the counts do not change', () => {
    const start = { ...grid([1, 2], ['a', 'b', 'c']), columnSizes: [0.8, 0.2], rowSizes: [[1], [0.3, 0.7]] };
    const same = reshape(start, [1, 2]).grid;
    expect(same.columnSizes).toEqual([0.8, 0.2]);
    expect(same.rowSizes).toEqual([[1], [0.3, 0.7]]);
    expect(reshape(start, [1, 3]).grid).toMatchObject({ columnSizes: [0.8, 0.2], rowSizes: [[1], evenSizes(3)] });
    expect(reshape(start, [1, 2, 2]).grid.columnSizes).toEqual(startingColumnSizes([1, 2, 2]));
  });
});

describe('resizeTracks', () => {
  it('moves one border, taking from one neighbour what it gives the other', () => {
    const [a, b, c] = resizeTracks([0.25, 0.25, 0.5], 0, 0.1);
    expect([a, b, c].map((size) => Math.round((size ?? 0) * 100))).toEqual([35, 15, 50]);
  });

  it('⚠ stops at the minimum rather than hiding a running app', () => {
    const sizes = resizeTracks([0.5, 0.5], 0, 0.9);
    expect(sizes[1]).toBeCloseTo(MIN_TRACK_FRACTION);
    expect((sizes[0] ?? 0) + (sizes[1] ?? 0)).toBeCloseTo(1);
  });

  it('ignores a border that does not exist', () => {
    expect(resizeTracks([1], 0, 0.2)).toEqual([1]);
  });
});

describe('moving apps in the grid', () => {
  it('⚠ makes a secondary view the main one by swapping it into cell 0', () => {
    expect(swapCells(grid([1, 2], ['main', 'b', 'c']), 2, 0).cells).toEqual(['c', 'b', 'main']);
  });

  it('swaps two cells, which is a move when one is empty', () => {
    expect(swapCells(grid([1, 2], ['a', 'b', null]), 0, 1).cells).toEqual(['b', 'a', null]);
    expect(swapCells(grid([1, 2], ['a', 'b', null]), 0, 2).cells).toEqual([null, 'b', 'a']);
  });

  it('assigns an app to a cell, or empties it', () => {
    expect(assignCell(grid([1, 1], ['a', null]), 1, 'b').cells).toEqual(['a', 'b']);
    expect(assignCell(grid([1, 1], ['a', 'b']), 0, null).cells).toEqual([null, 'b']);
  });

  it('⚠ SWAPS an app already elsewhere, so it can never be in the grid twice', () => {
    expect(assignCell(grid([1, 2], ['a', 'b', 'c']), 0, 'c').cells).toEqual(['c', 'b', 'a']);
  });

  it('ignores a cell outside the grid', () => {
    const start = grid([1, 1], ['a', 'b']);
    expect(assignCell(start, 5, 'c')).toBe(start);
    expect(swapCells(start, 0, 9)).toBe(start);
  });
});

describe('reordering tabs', () => {
  it('moves a dragged tab to where the target is', () => {
    expect(reorderTabs(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderTabs(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves one place from the keyboard, and stops at either end', () => {
    expect(moveTab(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveTab(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});
