'use client';

import type {
  CellValueChangedEvent,
  ColDef,
  GridOptions,
  RowDoubleClickedEvent,
  SelectionChangedEvent,
  ThemeDefaultParams,
} from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { type ReactNode, useMemo, useState } from 'react';
import { cn } from './utils.js';

/**
 * The workspace's one AG Grid.
 *
 * Nothing outside this file imports `ag-grid-react` — that is PLAN §8's rule,
 * and the reason is that an Enterprise upgrade, or a swap to TanStack Table,
 * should be a change to ONE file rather than to every screen with a table.
 *
 * ## Theming: CSS variables, not a JS theme object per mode
 *
 * The interesting part. AG Grid v33+ uses the Theming API — JS theme objects
 * rather than the old CSS files — and the obvious way to follow a light/dark
 * toggle with it is to build two theme objects and swap them in React state.
 *
 * That is not what this does, because it would be worse in three ways: the grid
 * would re-render on every theme change, it would know nothing about the TEN
 * palettes (so `data-palette="ocean"` would leave the grid grey), and the swap
 * would lag the rest of the page by a frame.
 *
 * Instead every colour parameter is a `var(--token)` reference into the same
 * token set every other component uses. The Theming API emits them as CSS custom
 * properties, so the browser resolves them against whatever `<html>` currently
 * carries — `data-palette` for the palette, `.dark` for the mode. Changing
 * either repaints the grid with no React involvement at all, in the same frame
 * as everything else.
 *
 * The practical test: switch to Ocean and the grid's header and selection turn
 * blue, without this file knowing Ocean exists.
 */

/**
 * The page sizes offered, and the default.
 *
 * Duplicated from `@kwtech/module-permissions`' own `PAGE_SIZES` rather than
 * imported: web-ui must not depend on a feature module — the dependency runs
 * the other way. Three numbers cost less than that inversion, and the module's
 * tests assert the API cap equals the largest of them, so the two cannot drift
 * without something failing.
 */
export const PAGE_SIZES = [10, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 100;

/**
 * ONCE, at module scope, in a 'use client' file — PLAN §8.
 *
 * AG Grid v33+ refuses to render with a clear console error if its modules are
 * unregistered, and registering per component would repeat work on every mount.
 * Module scope in a client-only file is the one place it happens exactly once
 * per browser session.
 */
ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * The shared theme, built once.
 *
 * `themeQuartz` rather than Alpine or Balham: it is the modern default and the
 * one whose spacing already matches the rest of this design system.
 */
const gridTheme = themeQuartz.withParams({
  /*
   * Every one of these is a REFERENCE, never a literal. A literal here would be
   * a colour the app cannot restyle — exactly what this package's other
   * components avoid — and it would be wrong on nine of the ten palettes.
   */
  backgroundColor: 'var(--background)',
  foregroundColor: 'var(--foreground)',
  borderColor: 'var(--border)',
  accentColor: 'var(--primary)',

  // The header and the toolbar sit on the muted surface, like every other
  // secondary chrome in the system.
  chromeBackgroundColor: 'var(--muted)',
  headerBackgroundColor: 'var(--muted)',
  headerTextColor: 'var(--muted-foreground)',
  headerFontWeight: 500,

  /*
   * Zebra striping OFF — transparent rather than a second colour.
   *
   * `--muted` is the only candidate and it is already the header's, so striped
   * rows would read as a repeating header. Density comes from spacing here, not
   * from alternating fills.
   */
  oddRowBackgroundColor: 'transparent',
  rowHoverColor: 'var(--accent)',
  selectedRowBackgroundColor: 'var(--accent)',

  /*
   * Native widgets INSIDE the grid — scrollbars, date pickers, the filter
   * inputs — are painted by the browser and ignore CSS custom properties.
   * `inherit` makes them follow the page's own `color-scheme`, which next-themes
   * sets alongside the `.dark` class. Without it a dark grid keeps light
   * scrollbars.
   */
  browserColorScheme: 'inherit',

  // Inherit the app's font stack rather than shipping one: the grid is part of
  // the page, not a widget embedded in it.
  fontFamily: 'inherit',
  fontSize: 13,
  borderRadius: 'var(--radius)',
  wrapperBorderRadius: 'var(--radius)',
} satisfies Partial<ThemeDefaultParams>);

/**
 * A column definition, re-exported under our own name.
 *
 * So that PLAN §8's rule — nothing outside this file imports `ag-grid-react` —
 * holds for TYPES too. A page writing `ColDef` from 'ag-grid-community' would
 * satisfy the letter of that rule while making the same swap just as expensive:
 * every screen would still name AG Grid's type.
 *
 * It is an alias rather than a hand-written interface because AG Grid's column
 * API is genuinely large and re-declaring a subset would be a second thing to
 * maintain. The alias is the seam; a future swap redefines it here.
 */
export type DataGridColumn<Row> = ColDef<Row>;

export interface DataGridProps<Row> {
  rows: readonly Row[];
  columns: readonly DataGridColumn<Row>[];
  /**
   * Renders a search box above the grid, wired to AG Grid's quick filter —
   * which matches across EVERY column at once rather than per column, and is
   * what someone means by "search this table".
   *
   * Omit it for a grid that should not be searchable; the box disappears with
   * it rather than sitting there doing nothing.
   */
  searchPlaceholder?: string | undefined;
  /** Rendered to the right of the search box — a "New" button, a filter chip. */
  toolbar?: ReactNode;
  /**
   * How tall the grid is.
   *
   *   number   fixed pixels
   *   'auto'   sized to the row count, no internal scrollbar
   *   'fill'   every pixel the parent has left over
   *
   * No percentage option, deliberately. AG Grid needs a RESOLVED height, and
   * `height: 100%` inside a parent that has none collapses the grid to nothing —
   * the single most common way to render an invisible table. `'fill'` asks for
   * the same thing through flexbox, which degrades to a short grid rather than
   * to no grid when an ancestor forgets its own height.
   */
  height?: number | 'auto' | 'fill';
  /**
   * Turns on checkbox row selection and reports what is selected.
   *
   * A callback rather than a `selectedRows` prop, because AG Grid owns the
   * selection state internally — mirroring it into React and feeding it back
   * would be two sources of truth for one fact, and they would disagree the
   * first time a filter hid a selected row.
   */
  onSelectionChange?: (rows: Row[]) => void;
  /**
   * Which field makes a row unique.
   *
   * Worth supplying whenever selection is on: without it AG Grid identifies
   * rows by index, so re-sorting or filtering moves the selection onto whatever
   * now sits in that position — and a delete confirmed on three rows removes
   * three different ones.
   */
  getRowId?: (row: Row) => string;
  /**
   * Double-clicking a row — the shortcut to whatever "open this one" means.
   *
   * DOUBLE click, not single: single-click is how a row gets selected, and
   * making it navigate as well would mean nobody could tick a checkbox without
   * leaving the page. Double-click is the long-standing convention for
   * "activate" in a grid, and it composes with selection instead of fighting it.
   *
   * Not a replacement for a visible control. It is unfindable on its own and
   * impossible on a touchscreen, so whatever it does must also be reachable
   * some other way — an Edit action, a link in a cell.
   */
  onRowActivate?: (row: Row) => void;
  /**
   * Fired after a cell edit is committed, with the whole updated row.
   *
   * Editing is turned on PER COLUMN (`editable: true` on a `DataGridColumn`);
   * this is only how the result gets back out. AG Grid mutates its own copy of
   * the row in place, so a caller holding the rows in React state must write the
   * change back or the two quietly diverge — and the divergence only shows up
   * when something re-renders and the edit vanishes.
   */
  onCellEdit?: (row: Row) => void;
  /**
   * Rows per page. `false` renders the whole list with no pager.
   *
   * ON BY DEFAULT, at 100. A grid handed ten thousand rows without pagination
   * builds ten thousand rows of DOM and the tab stops responding — and the list
   * that grows past the point of pain always does so in production, not in the
   * fixture somebody tested with. Defaulting to bounded means a new grid is
   * safe before anyone has thought about it.
   */
  pageSize?: number | false;
  /**
   * The choices in the size selector. Defaults to 10 / 50 / 100, matching the
   * API's own `PAGE_SIZES` so the interface cannot offer a page the server
   * would refuse to fill.
   */
  pageSizes?: readonly number[];
  /** Escape hatch for anything not worth a prop. Merged last, so it wins. */
  gridOptions?: GridOptions<Row>;
  className?: string;
}

/**
 * Applied to every column unless a column overrides it.
 *
 * Sorting and resizing on by default because a table nobody can sort is a list;
 * `filter` gives each column its own menu on top of the quick filter above.
 */
const DEFAULT_COL_DEF: ColDef = {
  sortable: true,
  resizable: true,
  filter: true,
  // Long values wrap rather than being clipped with no indication there was
  // more — a truncated description reads as a complete short one.
  autoHeight: true,
  wrapText: true,
  flex: 1,
  minWidth: 120,
};

export function DataGrid<Row>({
  rows,
  columns,
  searchPlaceholder,
  toolbar,
  height = 480,
  onSelectionChange,
  getRowId,
  onRowActivate,
  onCellEdit,
  pageSize = DEFAULT_PAGE_SIZE,
  pageSizes = PAGE_SIZES,
  gridOptions,
  className,
}: DataGridProps<Row>) {
  const [query, setQuery] = useState('');

  /*
   * `fill` is a flex arrangement rather than a height value, so it has to be
   * applied to two elements: this component's root becomes a full-height column,
   * and the grid's own wrapper takes whatever the toolbar above it did not.
   */
  const fills = height === 'fill';

  /*
   * `'auto'` sizes the grid to its rows, so a pager underneath a grid that has
   * already rendered everything is a control with nothing to control. Turning
   * it off there rather than making the caller remember keeps the two props
   * from combining into a contradiction.
   */
  const paginate = pageSize !== false && height !== 'auto';

  /*
   * Memoised because AG Grid treats a new `columnDefs` identity as a column
   * change and rebuilds its header — which would happen on every keystroke in
   * the search box without this.
   */
  const colDefs = useMemo(() => [...columns], [columns]);
  const rowData = useMemo(() => [...rows], [rows]);

  return (
    <div className={cn('flex flex-col gap-3', fills && 'h-full min-h-0', className)}>
      {searchPlaceholder || toolbar ? (
        <div className="flex items-center gap-3">
          {searchPlaceholder ? (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              // A label the box's own placeholder cannot provide: a placeholder
              // vanishes on focus, which is exactly when a screen reader user
              // needs to know what the field is.
              aria-label={searchPlaceholder}
              className="w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : null}
          {toolbar ? <div className="ml-auto flex items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {/*
        `min-h-0` next to `flex-1`: a flex item will not shrink below its content
        by default, and AG Grid's content is as tall as its rows — so without it
        a hundred rows push this box past the viewport and the page scrolls
        instead of the grid.
      */}
      <div className={cn(fills && 'min-h-0 flex-1')} style={fills || height === 'auto' ? undefined : { height }}>
        <AgGridReact<Row>
          theme={gridTheme}
          rowData={rowData}
          columnDefs={colDefs}
          defaultColDef={DEFAULT_COL_DEF}
          /*
           * The quick filter: one box, every column. AG Grid re-filters
           * internally on this prop changing, so there is no derived row array
           * to keep in sync and no debounce to tune.
           */
          quickFilterText={query}
          /*
           * `'multiRow'` with header checkboxes: the header box selects what is
           * CURRENTLY VISIBLE rather than everything, so "search, select all,
           * delete" acts on what the person is looking at. Selecting rows a
           * filter is hiding is how a bulk action takes out more than intended.
           */
          {...(onSelectionChange
            ? {
                rowSelection: { mode: 'multiRow' as const },
                onSelectionChanged: (event: SelectionChangedEvent<Row>) =>
                  onSelectionChange(event.api.getSelectedRows()),
              }
            : {})}
          {...(getRowId ? { getRowId: ({ data }: { data: Row }) => getRowId(data) } : {})}
          {...(onCellEdit
            ? {
                onCellValueChanged: (event: CellValueChangedEvent<Row>) => {
                  if (event.data) onCellEdit(event.data);
                },
                /*
                 * COMMITS AN OPEN EDITOR when focus leaves the grid, and this
                 * is a correctness fix rather than a nicety: without it,
                 * typing in a cell and then clicking Save discards what was
                 * typed. AG Grid's default is to keep the editor open, so the
                 * value never reaches the row and the button acts on stale
                 * data — the edit looks accepted and is not.
                 */
                stopEditingWhenCellsLoseFocus: true,
                /*
                 * One click to edit. A staging grid exists to be corrected, and
                 * requiring a double click there fights the double-click-to-open
                 * convention used on read-only grids in this app.
                 */
                singleClickEdit: true,
              }
            : {})}
          {...(onRowActivate
            ? {
                onRowDoubleClicked: (event: RowDoubleClickedEvent<Row>) => {
                  // `data` is undefined for a group or loading row — neither of
                  // which is a thing to open.
                  if (event.data) onRowActivate(event.data);
                },
              }
            : {})}
          // Sizes to the row count instead of the fixed height above. Only ever
          // with height 'auto' — combining it with a fixed height gives a grid
          // that scrolls inside a box it has already outgrown.
          domLayout={height === 'auto' ? 'autoHeight' : 'normal'}
          // Shown when a search matches nothing, rather than an empty grid that
          // looks broken.
          overlayNoRowsTemplate={NO_ROWS}
          {...(paginate
            ? {
                pagination: true,
                paginationPageSize: pageSize,
                /*
                 * The selector's options must INCLUDE the current size or AG
                 * Grid throws — so a caller passing `pageSize={25}` without
                 * matching `pageSizes` would break the grid rather than get a
                 * sensible pager.
                 */
                paginationPageSizeSelector: pageSizes.includes(pageSize)
                  ? [...pageSizes]
                  : [...pageSizes, pageSize].sort((a, b) => a - b),
              }
            : {})}
          {...gridOptions}
        />
      </div>
    </div>
  );
}

/**
 * AG Grid takes this as an HTML STRING, not a component, so it cannot use the
 * Tailwind utilities the rest of this file does — the string is injected into
 * the grid's own DOM and Tailwind never sees it to generate the classes.
 * Inline styles against the same tokens instead.
 */
const NO_ROWS = '<span style="color: var(--muted-foreground); font-size: 0.875rem">No matching rows</span>';
