'use client';

import { cn, Tooltip } from '@kwtech/web-ui/react';
import {
  APP_HUB_MAX_CELLS,
  type AppHubGrid,
  cellCount,
  GRID_PRESETS,
  type GridPreset,
  isColumnsAllowed,
  presetOf,
  startingColumnSizes,
} from '../../domain/layout.js';

/**
 * A preset drawn as itself: its columns side by side at their starting widths,
 * each stacking its cells. The main view — the first column's single cell — is
 * filled, so the icon says which cell is the working window before anybody
 * reads the label.
 *
 * Drawn with boxes rather than an SVG so it uses the theme tokens and flips with
 * dark mode like everything else.
 */
export function LayoutIcon({ columns, className }: { columns: readonly number[]; className?: string }) {
  const widths = startingColumnSizes(columns);
  return (
    <span aria-hidden className={cn('flex h-6 w-9 gap-0.5', className)}>
      {columns.map((rows, column) => (
        <span
          // A column's position is its identity: presets never reorder their columns.
          // biome-ignore lint/suspicious/noArrayIndexKey: columns have no id of their own.
          key={column}
          className="flex min-w-0 flex-col gap-0.5"
          style={{ flexGrow: widths[column] ?? 1, flexBasis: 0 }}
        >
          {Array.from({ length: rows }, (_, row) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a cell in the icon is only a position.
              key={row}
              className={cn(
                'min-h-0 flex-1 rounded-[2px] border border-current',
                column === 0 && rows === 1 ? 'bg-current' : 'opacity-60',
              )}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * The grid presets, as a row of icon buttons — pick one, rather than setting
 * rows and columns.
 *
 * A preset with more cells than `cap` — six, or fewer when the viewer holds
 * fewer apps — is DISABLED and says why, rather than accepted and then refused.
 * A saved grid that matches no preset (one from before them) leaves none chosen.
 */
export function LayoutPicker({
  grid,
  cap,
  onChoose,
}: {
  grid: AppHubGrid;
  cap: number;
  onChoose(preset: GridPreset): void;
}) {
  const current = presetOf(grid)?.key;
  const why =
    cap < APP_HUB_MAX_CELLS
      ? `You have ${cap} app${cap === 1 ? '' : 's'}, so a layout may have up to ${cap} cell${cap === 1 ? '' : 's'}.`
      : `A layout has at most ${APP_HUB_MAX_CELLS} cells.`;

  return (
    <fieldset className="inline-flex min-w-0 items-center gap-0.5 overflow-x-auto">
      <legend className="sr-only">Grid layout</legend>
      {GRID_PRESETS.map((preset) => {
        const allowed = isColumnsAllowed(preset.columns, cap);
        const chosen = preset.key === current;
        const cells = cellCount(preset.columns);
        return (
          // The reason a preset is unavailable is a description; an available one's hint only repeats its name.
          <Tooltip
            key={preset.key}
            text={allowed ? preset.label : `${preset.label} — ${why}`}
            align="start"
            describes={!allowed}
          >
            {(tooltip) => (
              <button
                type="button"
                aria-pressed={chosen}
                aria-label={`${preset.label} (${cells} cell${cells === 1 ? '' : 's'})`}
                /*
                 * ⚠ `aria-disabled`, not `disabled`: a disabled button fires no
                 * pointer events and takes no focus, so the hint saying WHY the
                 * preset is unavailable could never show. The click is refused
                 * here instead.
                 */
                aria-disabled={!allowed}
                onClick={() => {
                  if (allowed) onChoose(preset);
                }}
                className={cn(
                  'grid h-8 w-11 shrink-0 place-items-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  chosen
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  'aria-disabled:cursor-not-allowed aria-disabled:opacity-30 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground',
                )}
                {...tooltip}
              >
                <LayoutIcon columns={preset.columns} />
              </button>
            )}
          </Tooltip>
        );
      })}
    </fieldset>
  );
}
