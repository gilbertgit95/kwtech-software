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

/** Bumped when the stored shape changes. A layout of another version is read as absent. */
export const APP_HUB_LAYOUT_VERSION = 1;

/**
 * The smallest share of the grid's width (or height) one column (or row) may
 * have. Six columns at this size still fill 60%, so every legal shape can reach
 * it — and a track dragged to nothing would hide an app that is still running.
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

export interface GridShape {
  rows: number;
  columns: number;
}

export interface AppHubGrid extends GridShape {
  /** One fraction per row, summing to 1. */
  rowSizes: number[];
  /** One fraction per column, summing to 1. */
  columnSizes: number[];
  /** `rows × columns` entries in reading order: an app key, or null for an empty cell. */
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

// ── shapes ──────────────────────────────────────────────────────────────────

/**
 * How many cells the viewer's grid may have: `min(6, apps held)`.
 *
 * An app appears once, so a cell beyond the number of apps could only ever be
 * empty. Zero when the viewer holds no app — the page shows no grid at all.
 */
export function cellCap(appsHeld: number): number {
  return Math.max(0, Math.min(APP_HUB_MAX_CELLS, Math.floor(appsHeld)));
}

/** Every shape the grid can take, fewest cells first, then fewest rows. */
export function allShapes(): GridShape[] {
  const shapes: GridShape[] = [];
  for (let rows = 1; rows <= APP_HUB_MAX_CELLS; rows += 1) {
    for (let columns = 1; rows * columns <= APP_HUB_MAX_CELLS; columns += 1) shapes.push({ rows, columns });
  }
  return shapes.sort((a, b) => a.rows * a.columns - b.rows * b.columns || a.rows - b.rows);
}

/** Whether a shape fits under `cap` cells (see `cellCap`). */
export function isShapeAllowed(shape: GridShape, cap: number): boolean {
  return (
    Number.isInteger(shape.rows) &&
    Number.isInteger(shape.columns) &&
    shape.rows >= 1 &&
    shape.columns >= 1 &&
    shape.rows * shape.columns <= Math.min(cap, APP_HUB_MAX_CELLS)
  );
}

/** `n` equal fractions. */
export function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

// ── defaults ────────────────────────────────────────────────────────────────

/**
 * What a viewer sees when nobody has saved anything: the tab view, apps in their
 * declared order, and a grid of TWO cells side by side holding the first two
 * apps — or ONE cell when the viewer holds a single app (decision 8).
 *
 * @param appKeys the apps the viewer holds, in the order the tabs should start in.
 */
export function defaultLayout(appKeys: readonly string[]): AppHubLayout {
  const columns = appKeys.length >= 2 ? 2 : 1;
  return {
    version: APP_HUB_LAYOUT_VERSION,
    view: 'tabs',
    tabs: { order: [...appKeys], active: appKeys[0] ?? null },
    grid: {
      rows: 1,
      columns,
      rowSizes: evenSizes(1),
      columnSizes: evenSizes(columns),
      cells: Array.from({ length: columns }, (_, index) => appKeys[index] ?? null),
    },
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
  const shape = { rows: grid.rows, columns: grid.columns };
  if (typeof shape.rows !== 'number' || typeof shape.columns !== 'number') return fail('The grid has no shape.');
  if (!isShapeAllowed(shape as GridShape, APP_HUB_MAX_CELLS)) {
    return fail(`The grid may have at most ${APP_HUB_MAX_CELLS} cells.`);
  }
  const { rows, columns } = shape as GridShape;
  if (!isSizes(grid.rowSizes, rows)) return fail('The row sizes do not fit the grid.');
  if (!isSizes(grid.columnSizes, columns)) return fail('The column sizes do not fit the grid.');
  if (!Array.isArray(grid.cells) || grid.cells.length !== rows * columns) {
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
        rows,
        columns,
        rowSizes: [...(grid.rowSizes as number[])],
        columnSizes: [...(grid.columnSizes as number[])],
        cells: [...(grid.cells as (string | null)[])],
      },
    },
  };
}

/** A stored layout, or null when it is absent or no longer valid — read as "nobody saved one". */
export function readLayout(stored: unknown): AppHubLayout | null {
  const check = validateLayout(stored);
  return check.ok ? check.layout : null;
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
 * When it must shrink, it takes the largest allowed shape closest to the saved
 * one's proportions, and keeps the apps the viewer still holds in reading order.
 */
export function fitGrid(grid: AppHubGrid, declared: readonly string[], held: readonly string[]): AppHubGrid {
  const declaredSet = new Set(declared);
  const cells = grid.cells.map((cell) => (cell !== null && declaredSet.has(cell) ? cell : null));
  const cap = cellCap(held.length);

  if (cap === 0) return { rows: 1, columns: 1, rowSizes: [1], columnSizes: [1], cells: [null] };
  if (grid.rows * grid.columns <= cap) return { ...grid, cells };

  const shape = closestShape(grid, cap);
  const heldSet = new Set(held);
  const kept = cells.filter((cell): cell is string => cell !== null && heldSet.has(cell));
  const size = shape.rows * shape.columns;
  return {
    ...shape,
    rowSizes: evenSizes(shape.rows),
    columnSizes: evenSizes(shape.columns),
    cells: Array.from({ length: size }, (_, index) => kept[index] ?? null),
  };
}

/** The allowed shape with the most cells, breaking ties by how close its proportions are to `from`'s. */
function closestShape(from: GridShape, cap: number): GridShape {
  const aspect = Math.log(from.columns / from.rows);
  const candidates = allShapes().filter((shape) => isShapeAllowed(shape, cap));
  candidates.sort(
    (a, b) =>
      b.rows * b.columns - a.rows * a.columns ||
      Math.abs(Math.log(a.columns / a.rows) - aspect) - Math.abs(Math.log(b.columns / b.rows) - aspect) ||
      a.rows - b.rows,
  );
  return candidates[0] ?? { rows: 1, columns: 1 };
}

// ── changing the grid ───────────────────────────────────────────────────────

export interface Reshaped {
  grid: AppHubGrid;
  /** Apps that no longer fit. The page asks before applying a reshape that drops any. */
  dropped: string[];
}

/**
 * The grid in a new shape. An app keeps its row and column where the new shape
 * still has them; the rest move into empty cells in reading order, and whatever
 * still does not fit is reported in `dropped`.
 *
 * Track sizes survive when the count of rows (or columns) is unchanged, so
 * adding a row does not undo the widths somebody dragged.
 */
export function reshape(grid: AppHubGrid, shape: GridShape): Reshaped {
  const size = shape.rows * shape.columns;
  const cells: (string | null)[] = Array.from({ length: size }, () => null);
  const homeless: string[] = [];

  for (const [index, cell] of grid.cells.entries()) {
    if (cell === null) continue;
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    if (row < shape.rows && column < shape.columns) cells[row * shape.columns + column] = cell;
    else homeless.push(cell);
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
      rows: shape.rows,
      columns: shape.columns,
      rowSizes: shape.rows === grid.rows ? [...grid.rowSizes] : evenSizes(shape.rows),
      columnSizes: shape.columns === grid.columns ? [...grid.columnSizes] : evenSizes(shape.columns),
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
