/**
 * The Apps page's layout: which view, the order of the tabs, and the grid.
 *
 * Every rule about a layout lives HERE, once. The page uses these functions to
 * arrange the screen, and the server uses `validateLayout` before it saves one,
 * so the 6-cell cap and the "one app once" rule cannot be enforced in one place
 * and forgotten in the other (principle 5).
 *
 * App keys double as instance ids: an app appears at most once in the grid and
 * once in the tabs (APP-HUB-PLAN decision 3). Allowing an app twice would mean
 * giving each cell an id of its own, and every function below would change.
 */

/** The grid never has more cells than this, whatever the viewer holds. */
export const APP_HUB_MAX_CELLS = 6;

/**
 * Bumped when the stored shape changes. Version 1 was a uniform rows × columns
 * grid; `readLayout` still reads it and converts it (`upgradeLayoutV1`), so
 * nobody's saved layout is lost to the change. Any other version reads as absent.
 */
export const APP_HUB_LAYOUT_VERSION = 2;

/**
 * The smallest share of the grid's width (or of one column's height) a column
 * (or a cell in it) may have. Six at this size still fill 60%, so every legal
 * grid can reach it — and a track dragged to nothing would hide an app that is
 * still running.
 */
export const MIN_TRACK_FRACTION = 0.1;

/**
 * Longest app key a layout may name. Keys are code identifiers ('queue'), so
 * this is generous; it exists so a saved layout cannot be an arbitrary blob.
 */
export const MAX_APP_KEY_LENGTH = 64;

/** Most tabs a saved order may list. Far above any real app count, and a bound on the row. */
export const MAX_TAB_ORDER_LENGTH = 100;

export type AppHubView = 'tabs' | 'grid';

/**
 * The grid, COLUMN BY COLUMN. Each column has its own number of cells stacked
 * in it, so `[1, 2]` is one full-height cell beside two stacked ones — which a
 * rows × columns grid (version 1) could not say.
 */
export interface AppHubGrid {
  /** How many cells each column stacks, left to right. At most six cells in all. */
  columns: number[];
  /** One fraction per column, summing to 1. */
  columnSizes: number[];
  /** Per column, one fraction per cell in it, each list summing to 1. */
  rowSizes: number[][];
  /**
   * One entry per cell in COLUMN order — the first column top to bottom, then
   * the next — holding an app key, or null for an empty cell.
   */
  cells: (string | null)[];
}

export interface AppHubLayout {
  version: typeof APP_HUB_LAYOUT_VERSION;
  view: AppHubView;
  tabs: {
    /** App keys, in the order the tab bar shows them. */
    order: string[];
    /** The open tab's key, or null for the first. */
    active: string | null;
  };
  grid: AppHubGrid;
}

/** Where the layout on screen came from — the page says so, and offers to reset. */
export type AppHubLayoutSource = 'user' | 'workspace' | 'default';

// ── presets ─────────────────────────────────────────────────────────────────

/** A grid people can pick: its columns, and the words a screen reader and a tooltip use. */
export interface GridPreset {
  /** Stable, and derived from `columns` ('1-2'), so a preset is found from any grid. */
  key: string;
  label: string;
  columns: readonly number[];
}

function preset(label: string, ...columns: number[]): GridPreset {
  return { key: columns.join('-'), label, columns };
}

/**
 * The grids the page offers, fewest cells first. People PICK one rather than
 * setting rows and columns, and each is drawn as an icon of itself.
 *
 * ⚠ EVERY PRESET HAS A MAIN VIEW: the first column is ONE cell — the working
 * window — and every other cell is a secondary view beside it, an extension of
 * the work rather than its equal. A uniform grid (two by two) has no main view,
 * which is why none is offered. The main column also starts wider
 * (`MAIN_COLUMN_FRACTION`).
 *
 * The stored grid is general, so adding a preset here needs no migration — and a
 * saved grid that matches none (a version-1 two-by-two) still renders; the
 * picker just shows no preset as chosen, and the grid has no main view.
 */
export const GRID_PRESETS: readonly GridPreset[] = [
  preset('Main view only', 1),
  preset('Main view and one beside it', 1, 1),
  preset('Main view and two stacked beside it', 1, 2),
  preset('Main view and two side by side', 1, 1, 1),
  preset('Main view and three stacked beside it', 1, 3),
  preset('Main view and four stacked beside it', 1, 4),
  preset('Main view and two columns of two', 1, 2, 2),
  preset('Main view and five stacked beside it', 1, 5),
];

/**
 * The share of the width the main column starts with, by how many columns the
 * grid has: two thirds beside one secondary column, half beside two. The rest is
 * split evenly. Somebody may drag it anywhere after.
 */
export const MAIN_COLUMN_FRACTION: Readonly<Record<number, number>> = { 2: 2 / 3, 3: 1 / 2 };

/**
 * Whether the grid has a main view: a first column of one cell. Every preset
 * does; only a saved grid from before the presets may not.
 */
export function hasMainView(grid: Pick<AppHubGrid, 'columns'>): boolean {
  return grid.columns[0] === 1;
}

/** Index of the main view's cell. It is always the first, column by column. */
export const MAIN_CELL_INDEX = 0;

/** How many cells a grid of these columns has. */
export function cellCount(columns: readonly number[]): number {
  return columns.reduce((sum, rows) => sum + rows, 0);
}

/**
 * How many cells the viewer's grid may have: `min(6, apps held)`.
 *
 * An app appears once, so a cell beyond the number of apps could only ever be
 * empty. Zero when the viewer holds no app — the page shows no grid at all.
 */
export function cellCap(appsHeld: number): number {
  return Math.max(0, Math.min(APP_HUB_MAX_CELLS, Math.floor(appsHeld)));
}

/**
 * Whether columns of these heights make a grid this module stores: at least one
 * column, every column at least one cell, and no more than `cap` cells in all.
 */
export function isColumnsAllowed(columns: readonly number[], cap: number): boolean {
  return (
    columns.length >= 1 &&
    columns.every((rows) => Number.isInteger(rows) && rows >= 1) &&
    cellCount(columns) <= Math.min(cap, APP_HUB_MAX_CELLS)
  );
}

/** The preset a grid is laid out as, or undefined when it matches none. */
export function presetOf(grid: Pick<AppHubGrid, 'columns'>): GridPreset | undefined {
  const key = grid.columns.join('-');
  return GRID_PRESETS.find((one) => one.key === key);
}

/** Where cell `index` is: its column, and its row within that column. Null when out of range. */
export function cellPosition(
  grid: Pick<AppHubGrid, 'columns'>,
  index: number,
): { column: number; row: number; rows: number } | null {
  if (!Number.isInteger(index) || index < 0) return null;
  let first = 0;
  for (const [column, rows] of grid.columns.entries()) {
    if (index < first + rows) return { column, row: index - first, rows };
    first += rows;
  }
  return null;
}

/** The index of the cell at `row` in `column`, or -1 when the grid has no such cell. */
export function cellIndex(grid: Pick<AppHubGrid, 'columns'>, column: number, row: number): number {
  const rows = grid.columns[column];
  if (rows === undefined || row < 0 || row >= rows) return -1;
  return cellCount(grid.columns.slice(0, column)) + row;
}

/** `n` equal fractions. */
export function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

/**
 * The starting column widths: the main column's `MAIN_COLUMN_FRACTION` when the
 * grid has a main view, and the rest shared evenly. Even when it has none.
 */
export function startingColumnSizes(columns: readonly number[]): number[] {
  const main = MAIN_COLUMN_FRACTION[columns.length];
  if (main === undefined || columns[0] !== 1) return evenSizes(columns.length);
  const rest = (1 - main) / (columns.length - 1);
  return columns.map((_, index) => (index === 0 ? main : rest));
}

/** An empty grid of these columns: the main column wider, each column's cells the same height. */
export function emptyGrid(columns: readonly number[]): AppHubGrid {
  return {
    columns: [...columns],
    columnSizes: startingColumnSizes(columns),
    rowSizes: columns.map((rows) => evenSizes(rows)),
    cells: Array.from({ length: cellCount(columns) }, () => null),
  };
}

// ── defaults ────────────────────────────────────────────────────────────────

/**
 * The grid a viewer starts with before anybody picks one: the main view with two
 * secondary views stacked beside it. The operator's choice (PLAN §13,
 * 2026-09-27).
 */
export const DEFAULT_GRID_COLUMNS: readonly number[] = [1, 2];

/**
 * What a viewer sees when nobody has saved anything: the tab view, apps in their
 * declared order, and a grid of `DEFAULT_GRID_COLUMNS` holding the first apps.
 *
 * ⚠ The cap still applies (decision 9): a cell beyond the apps held could only
 * ever be empty, so a viewer with two apps gets the main view and one beside it,
 * and a viewer with one app the main view alone.
 *
 * @param appKeys the apps the viewer holds, in the order the tabs should start in.
 */
export function defaultLayout(appKeys: readonly string[]): AppHubLayout {
  const cap = cellCap(appKeys.length);
  const columns = isColumnsAllowed(DEFAULT_GRID_COLUMNS, cap) ? DEFAULT_GRID_COLUMNS : cap >= 2 ? [1, 1] : [1];
  const grid = emptyGrid(columns);
  return {
    version: APP_HUB_LAYOUT_VERSION,
    view: 'tabs',
    tabs: { order: [...appKeys], active: appKeys[0] ?? null },
    grid: { ...grid, cells: grid.cells.map((_, index) => appKeys[index] ?? null) },
  };
}

// ── validation ──────────────────────────────────────────────────────────────

export type LayoutCheck = { ok: true; layout: AppHubLayout } | { ok: false; problem: string };

/**
 * Whether `input` is a layout this module will store, and the reason when not.
 *
 * STRICT, because it guards a write: the server refuses anything this rejects.
 * The cap checked is the absolute one (6), not the viewer's — an admin may save
 * a workspace default wider than one member's apps, and the page narrows it for
 * that member on display (`effectiveLayout`), without rewriting it.
 *
 * ⚠ The grid is checked for STRUCTURE, not against `GRID_PRESETS`: the presets
 * are what the page offers, and tying storage to them would make removing one a
 * data migration.
 *
 * App keys are checked for SHAPE only. The server has no web descriptors to
 * check them against, and a key nobody declares is ignored when read.
 */
export function validateLayout(input: unknown): LayoutCheck {
  const fail = (problem: string): LayoutCheck => ({ ok: false, problem });
  if (!isRecord(input)) return fail('The layout is not an object.');
  if (input.version !== APP_HUB_LAYOUT_VERSION) return fail(`The layout is not version ${APP_HUB_LAYOUT_VERSION}.`);
  if (input.view !== 'tabs' && input.view !== 'grid') return fail("The view must be 'tabs' or 'grid'.");

  const tabs = input.tabs;
  if (!isRecord(tabs)) return fail('The tabs are missing.');
  if (!Array.isArray(tabs.order) || tabs.order.length > MAX_TAB_ORDER_LENGTH) return fail('The tab order is invalid.');
  if (!tabs.order.every(isAppKey)) return fail('The tab order names an invalid app key.');
  if (new Set(tabs.order).size !== tabs.order.length) return fail('The tab order names an app twice.');
  if (tabs.active !== null && !isAppKey(tabs.active)) return fail('The open tab is not an app key.');

  const grid = input.grid;
  if (!isRecord(grid)) return fail('The grid is missing.');
  const columns = grid.columns;
  if (!Array.isArray(columns) || !columns.every((rows) => typeof rows === 'number')) {
    return fail('The grid has no columns.');
  }
  if (!isColumnsAllowed(columns as number[], APP_HUB_MAX_CELLS)) {
    return fail(`The grid needs at least one cell in every column, and may have at most ${APP_HUB_MAX_CELLS} cells.`);
  }
  const shape = columns as number[];
  if (!isSizes(grid.columnSizes, shape.length)) return fail('The column sizes do not fit the grid.');
  if (
    !Array.isArray(grid.rowSizes) ||
    grid.rowSizes.length !== shape.length ||
    !shape.every((rows, column) => isSizes((grid.rowSizes as unknown[])[column], rows))
  ) {
    return fail('The row sizes do not fit the grid.');
  }
  if (!Array.isArray(grid.cells) || grid.cells.length !== cellCount(shape)) {
    return fail('The grid has the wrong number of cells.');
  }
  if (!grid.cells.every((cell) => cell === null || isAppKey(cell))) return fail('A cell names an invalid app key.');
  const placed = grid.cells.filter((cell): cell is string => cell !== null);
  if (new Set(placed).size !== placed.length) return fail('The grid holds an app twice.');

  // Rebuilt field by field, so nothing the check did not look at is stored.
  return {
    ok: true,
    layout: {
      version: APP_HUB_LAYOUT_VERSION,
      view: input.view,
      tabs: { order: [...(tabs.order as string[])], active: tabs.active as string | null },
      grid: {
        columns: [...shape],
        columnSizes: [...(grid.columnSizes as number[])],
        rowSizes: (grid.rowSizes as number[][]).map((sizes) => [...sizes]),
        cells: [...(grid.cells as (string | null)[])],
      },
    },
  };
}

/**
 * A stored layout, or null when it is absent or no longer valid — read as
 * "nobody saved one". A version-1 layout is converted first, so layouts saved
 * before the column grid keep working; the next save writes version 2.
 */
export function readLayout(stored: unknown): AppHubLayout | null {
  const check = validateLayout(upgradeLayoutV1(stored));
  return check.ok ? check.layout : null;
}

/**
 * A version-1 layout (a uniform `rows × columns` grid, cells row by row) as
 * version 2: every column stacks `rows` cells, each keeps the old row sizes, and
 * the cells are re-read column by column. Anything else is returned untouched,
 * for `validateLayout` to judge.
 */
export function upgradeLayoutV1(stored: unknown): unknown {
  if (!isRecord(stored) || stored.version !== 1 || !isRecord(stored.grid)) return stored;
  const { rows, columns, rowSizes, columnSizes, cells } = stored.grid;
  if (typeof rows !== 'number' || typeof columns !== 'number' || !Number.isInteger(rows * columns)) return stored;
  if (!Array.isArray(cells) || cells.length !== rows * columns) return stored;

  const reordered: unknown[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) reordered.push(cells[row * columns + column]);
  }
  return {
    ...stored,
    version: APP_HUB_LAYOUT_VERSION,
    grid: {
      columns: Array.from({ length: columns }, () => rows),
      columnSizes,
      rowSizes: Array.from({ length: columns }, () => rowSizes),
      cells: reordered,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_APP_KEY_LENGTH;
}

/**
 * `count` fractions, each at least the minimum, summing to 1. The tolerance
 * absorbs floating point from repeated drags, not a real mistake.
 */
function isSizes(value: unknown, count: number): value is number[] {
  if (!Array.isArray(value) || value.length !== count) return false;
  if (!value.every((size) => typeof size === 'number' && Number.isFinite(size))) return false;
  const sizes = value as number[];
  if (sizes.some((size) => size < MIN_TRACK_FRACTION - 1e-6)) return false;
  return Math.abs(sizes.reduce((sum, size) => sum + size, 0) - 1) < 1e-3;
}

// ── what the viewer sees ────────────────────────────────────────────────────

export interface EffectiveLayout {
  layout: AppHubLayout;
  source: AppHubLayoutSource;
}

/**
 * The layout on screen: the viewer's own, else the workspace default, else the
 * built-in one — then fitted to the apps the viewer holds (APP-HUB-PLAN §5).
 *
 *  - Tabs are exactly the apps held: the saved order first, then any app it
 *    does not mention (new, or newly granted) at the end.
 *  - A cell naming an app nobody DECLARES is emptied; a cell naming an app the
 *    viewer does not HOLD is kept, so the page can say why it is not shown.
 *  - A grid with more cells than the viewer's cap is narrowed for display only.
 *    The saved layout is not touched, so access coming back restores it.
 *
 * @param declared every app the page knows, held or not.
 * @param held the apps the viewer holds, in default order.
 */
export function effectiveLayout(
  saved: { user: AppHubLayout | null; workspace: AppHubLayout | null },
  declared: readonly string[],
  held: readonly string[],
): EffectiveLayout {
  const source: AppHubLayoutSource = saved.user ? 'user' : saved.workspace ? 'workspace' : 'default';
  const base = saved.user ?? saved.workspace ?? defaultLayout(held);
  const heldSet = new Set(held);

  const order = [
    ...base.tabs.order.filter((key) => heldSet.has(key)),
    ...held.filter((key) => !base.tabs.order.includes(key)),
  ];
  const active = base.tabs.active !== null && heldSet.has(base.tabs.active) ? base.tabs.active : (order[0] ?? null);

  return {
    source,
    layout: { ...base, tabs: { order, active }, grid: fitGrid(base.grid, declared, held) },
  };
}

/**
 * The grid, fitted to what the viewer holds — see `effectiveLayout`.
 *
 * When it must shrink, it becomes the preset with the most cells that fits,
 * preferring one with as many columns as the saved grid, and keeps the apps the
 * viewer still holds in cell order.
 */
export function fitGrid(grid: AppHubGrid, declared: readonly string[], held: readonly string[]): AppHubGrid {
  const declaredSet = new Set(declared);
  const cells = grid.cells.map((cell) => (cell !== null && declaredSet.has(cell) ? cell : null));
  const cap = cellCap(held.length);

  if (cap === 0) return emptyGrid([1]);
  if (cells.length <= cap) return { ...grid, cells };

  const heldSet = new Set(held);
  const kept = cells.filter((cell): cell is string => cell !== null && heldSet.has(cell));
  const fitted = emptyGrid(closestPreset(grid, cap));
  return { ...fitted, cells: fitted.cells.map((_, index) => kept[index] ?? null) };
}

/**
 * The allowed preset with the most cells, breaking ties by the same column
 * count, then list order. Always one with a main view, since every preset has one.
 */
function closestPreset(from: Pick<AppHubGrid, 'columns'>, cap: number): readonly number[] {
  const candidates = GRID_PRESETS.filter((one) => isColumnsAllowed(one.columns, cap));
  const sameWidth = (one: GridPreset) => (one.columns.length === from.columns.length ? 0 : 1);
  const [best] = [...candidates].sort(
    (a, b) => cellCount(b.columns) - cellCount(a.columns) || sameWidth(a) - sameWidth(b),
  );
  return best?.columns ?? [1];
}

// ── changing the grid ───────────────────────────────────────────────────────

export interface Reshaped {
  grid: AppHubGrid;
  /** Apps that no longer fit. The page asks before applying a reshape that drops any. */
  dropped: string[];
}

/**
 * The grid laid out as `columns` (a preset's). An app keeps its column and row
 * where the new grid still has them; the rest move into empty cells in cell
 * order, and whatever still does not fit is reported in `dropped`.
 *
 * Sizes survive where the count is unchanged — the column widths when there are
 * as many columns, and a column's row heights when it stacks as many cells — so
 * picking a neighbouring preset does not undo what somebody dragged.
 */
export function reshape(grid: AppHubGrid, columns: readonly number[]): Reshaped {
  const next = emptyGrid(columns);
  const cells = next.cells;
  const homeless: string[] = [];

  for (const [index, cell] of grid.cells.entries()) {
    if (cell === null) continue;
    const at = cellPosition(grid, index);
    const target = at ? cellIndex(next, at.column, at.row) : -1;
    if (target === -1) homeless.push(cell);
    else cells[target] = cell;
  }

  const dropped: string[] = [];
  for (const app of homeless) {
    const free = cells.indexOf(null);
    if (free === -1) dropped.push(app);
    else cells[free] = app;
  }

  return {
    dropped,
    grid: {
      columns: next.columns,
      columnSizes: columns.length === grid.columns.length ? [...grid.columnSizes] : next.columnSizes,
      rowSizes: columns.map((rows, column) =>
        grid.columns[column] === rows ? [...(grid.rowSizes[column] ?? evenSizes(rows))] : evenSizes(rows),
      ),
      cells,
    },
  };
}

/**
 * Moves the border after track `index` by `delta` (a fraction of the whole),
 * taking from one neighbour what it gives the other. Neither may drop below
 * `MIN_TRACK_FRACTION`; the move stops there rather than being refused, which
 * is what a dragged border should do.
 */
export function resizeTracks(sizes: readonly number[], index: number, delta: number): number[] {
  const next = [...sizes];
  const before = next[index];
  const after = next[index + 1];
  if (before === undefined || after === undefined || !Number.isFinite(delta)) return next;
  const pair = before + after;
  const moved = Math.min(Math.max(before + delta, MIN_TRACK_FRACTION), pair - MIN_TRACK_FRACTION);
  next[index] = moved;
  next[index + 1] = pair - moved;
  return next;
}

/**
 * Puts `appKey` in cell `index`, or empties it with null. An app already in
 * another cell SWAPS with whatever was here, so dropping an app onto a cell can
 * never leave it in the grid twice.
 */
export function assignCell(grid: AppHubGrid, index: number, appKey: string | null): AppHubGrid {
  if (index < 0 || index >= grid.cells.length) return grid;
  const from = appKey === null ? -1 : grid.cells.indexOf(appKey);
  if (from !== -1) return swapCells(grid, from, index);
  const cells = [...grid.cells];
  cells[index] = appKey;
  return { ...grid, cells };
}

/** Swaps two cells — a move, when one of them is empty. */
export function swapCells(grid: AppHubGrid, a: number, b: number): AppHubGrid {
  const size = grid.cells.length;
  if (a === b || a < 0 || b < 0 || a >= size || b >= size) return grid;
  const cells = [...grid.cells];
  [cells[a], cells[b]] = [cells[b] ?? null, cells[a] ?? null];
  return { ...grid, cells };
}

// ── changing the tabs ───────────────────────────────────────────────────────

/** Moves tab `key` to where tab `to` is, shifting the ones between — what a drag does. */
export function reorderTabs(order: readonly string[], key: string, to: string): string[] {
  const from = order.indexOf(key);
  const target = order.indexOf(to);
  if (from === -1 || target === -1 || from === target) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(target, 0, key);
  return next;
}

/** Moves tab `key` one place left (-1) or right (+1) — the keyboard's version of a drag. */
export function moveTab(order: readonly string[], key: string, step: -1 | 1): string[] {
  const from = order.indexOf(key);
  const to = order[from + step];
  return from === -1 || to === undefined ? [...order] : reorderTabs(order, key, to);
}
