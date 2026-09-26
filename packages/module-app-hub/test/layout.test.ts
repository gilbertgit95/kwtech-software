import {
  APP_HUB_MAX_CELLS,
  type AppHubGrid,
  type AppHubLayout,
  allShapes,
  assignCell,
  cellCap,
  defaultLayout,
  effectiveLayout,
  evenSizes,
  fitGrid,
  isShapeAllowed,
  MIN_TRACK_FRACTION,
  moveTab,
  readLayout,
  reorderTabs,
  reshape,
  resizeTracks,
  swapCells,
  validateLayout,
} from '../src/domain/layout.js';

/** The rules the Apps page and the server share — APP-HUB-PLAN §4–§6. */

const grid = (rows: number, columns: number, cells: (string | null)[]): AppHubGrid => ({
  rows,
  columns,
  rowSizes: evenSizes(rows),
  columnSizes: evenSizes(columns),
  cells,
});

const layout = (over: Partial<AppHubLayout> = {}): AppHubLayout => ({
  ...defaultLayout(['queue', 'booking', 'survey']),
  ...over,
});

describe('the cell cap', () => {
  it('is the number of apps held, up to six', () => {
    expect([0, 1, 2, 3, 6, 7, 40].map(cellCap)).toEqual([0, 1, 2, 3, 6, 6, 6]);
  });

  it('offers exactly the shapes of at most six cells', () => {
    const shapes = allShapes();
    expect(shapes.every((shape) => shape.rows * shape.columns <= APP_HUB_MAX_CELLS)).toBe(true);
    // 1×1..1×6, 2×1..2×3, 3×1..3×2, 4×1, 5×1, 6×1
    expect(shapes).toHaveLength(14);
    expect(shapes[0]).toEqual({ rows: 1, columns: 1 });
  });

  it('⚠ disables a shape with more cells than the viewer has apps (decision 9)', () => {
    const cap = cellCap(3);
    expect(isShapeAllowed({ rows: 1, columns: 3 }, cap)).toBe(true);
    expect(isShapeAllowed({ rows: 2, columns: 2 }, cap)).toBe(false);
    expect(isShapeAllowed({ rows: 3, columns: 3 }, cellCap(20))).toBe(false);
  });
});

describe('the default layout (decision 8)', () => {
  it('is the tab view with every app, and a grid of two cells side by side', () => {
    expect(defaultLayout(['queue', 'booking', 'survey'])).toMatchObject({
      view: 'tabs',
      tabs: { order: ['queue', 'booking', 'survey'], active: 'queue' },
      grid: { rows: 1, columns: 2, cells: ['queue', 'booking'] },
    });
  });

  it('is one cell when the viewer holds one app', () => {
    expect(defaultLayout(['queue']).grid).toMatchObject({ rows: 1, columns: 1, cells: ['queue'] });
  });

  it('is valid by the rules the server applies', () => {
    expect(validateLayout(defaultLayout(['queue', 'booking'])).ok).toBe(true);
    expect(validateLayout(defaultLayout([])).ok).toBe(true);
  });
});

describe('validateLayout — the write rule', () => {
  it('accepts a whole six-cell grid', () => {
    const six = layout({ grid: grid(2, 3, ['a', 'b', 'c', 'd', 'e', null]) });
    expect(validateLayout(six)).toEqual({ ok: true, layout: six });
  });

  it.each([
    ['not an object', 'nope'],
    ['a wrong version', { ...layout(), version: 2 }],
    ['an unknown view', { ...layout(), view: 'mosaic' }],
    ['seven cells', layout({ grid: grid(1, 7, ['a', 'b', 'c', 'd', 'e', 'f', 'g']) })],
    ['a 3 × 3 grid', layout({ grid: grid(3, 3, Array(9).fill(null)) })],
    ['the wrong number of cells', layout({ grid: grid(1, 2, ['a']) })],
    ['an app twice in the grid (decision 3)', layout({ grid: grid(1, 2, ['a', 'a']) })],
    ['an app twice in the tabs', layout({ tabs: { order: ['a', 'a'], active: 'a' } })],
    ['sizes that do not sum to 1', layout({ grid: { ...grid(1, 2, ['a', 'b']), columnSizes: [0.5, 0.2] } })],
    ['a track below the minimum', layout({ grid: { ...grid(1, 2, ['a', 'b']), columnSizes: [0.95, 0.05] } })],
    ['an empty app key', layout({ grid: grid(1, 1, ['']) })],
    ['a fractional row count', layout({ grid: { ...grid(1, 1, ['a']), rows: 1.5 } })],
  ])('refuses %s', (_, input) => {
    expect(validateLayout(input).ok).toBe(false);
  });

  it('names what was wrong, for the error the page shows', () => {
    expect(validateLayout(layout({ grid: grid(1, 7, Array(7).fill(null)) }))).toEqual({
      ok: false,
      problem: 'The grid may have at most 6 cells.',
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
    const saved = layout({ grid: grid(1, 3, ['queue', 'booking', 'removed-app']) });
    const { layout: shown } = effectiveLayout({ user: saved, workspace: null }, declared, ['queue', 'survey', 'audit']);
    expect(shown.grid.cells).toEqual(['queue', 'booking', null]);
  });

  it('⚠ narrows a grid wider than the viewer’s apps for DISPLAY, keeping the ones still held', () => {
    const wide = layout({ grid: grid(2, 3, ['queue', 'booking', 'survey', 'audit', null, null]) });
    const { layout: shown } = effectiveLayout({ user: null, workspace: wide }, declared, ['booking', 'audit', 'queue']);
    expect(shown.grid).toMatchObject({ rows: 1, columns: 3, cells: ['queue', 'booking', 'audit'] });
    // The saved one is untouched, so access coming back restores it.
    expect(wide.grid.cells).toHaveLength(6);
  });

  it('shows no grid to a viewer with no apps', () => {
    expect(fitGrid(grid(1, 2, ['queue', 'booking']), declared, []).cells).toEqual([null]);
  });
});

describe('reshape', () => {
  it('keeps each app in its row and column when the new shape still has them', () => {
    const { grid: next, dropped } = reshape(grid(1, 2, ['a', 'b']), { rows: 2, columns: 2 });
    expect(next.cells).toEqual(['a', 'b', null, null]);
    expect(dropped).toEqual([]);
  });

  it('moves an app whose cell is gone into the first empty one', () => {
    const { grid: next } = reshape(grid(2, 2, ['a', null, 'c', null]), { rows: 1, columns: 2 });
    expect(next.cells).toEqual(['a', 'c']);
  });

  it('⚠ reports what no longer fits, so the page can ask first', () => {
    const { grid: next, dropped } = reshape(grid(2, 2, ['a', 'b', 'c', 'd']), { rows: 1, columns: 2 });
    expect(next.cells).toEqual(['a', 'b']);
    expect(dropped).toEqual(['c', 'd']);
  });

  it('keeps dragged widths when the column count does not change', () => {
    const start = { ...grid(1, 2, ['a', 'b']), columnSizes: [0.7, 0.3] };
    expect(reshape(start, { rows: 2, columns: 2 }).grid.columnSizes).toEqual([0.7, 0.3]);
    expect(reshape(start, { rows: 1, columns: 3 }).grid.columnSizes).toEqual(evenSizes(3));
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
  it('swaps two cells, which is a move when one is empty', () => {
    expect(swapCells(grid(1, 3, ['a', 'b', null]), 0, 1).cells).toEqual(['b', 'a', null]);
    expect(swapCells(grid(1, 3, ['a', 'b', null]), 0, 2).cells).toEqual([null, 'b', 'a']);
  });

  it('assigns an app to a cell, or empties it', () => {
    expect(assignCell(grid(1, 2, ['a', null]), 1, 'b').cells).toEqual(['a', 'b']);
    expect(assignCell(grid(1, 2, ['a', 'b']), 0, null).cells).toEqual([null, 'b']);
  });

  it('⚠ SWAPS an app already elsewhere, so it can never be in the grid twice', () => {
    expect(assignCell(grid(1, 3, ['a', 'b', 'c']), 0, 'c').cells).toEqual(['c', 'b', 'a']);
  });

  it('ignores a cell outside the grid', () => {
    const start = grid(1, 2, ['a', 'b']);
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
