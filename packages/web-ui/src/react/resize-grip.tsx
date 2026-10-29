'use client';

import { cn } from './utils.js';

export interface ResizeGripProps {
  /** The way the border runs. A vertical border (a column's edge) stacks the dots; a horizontal one lays them in a row. */
  orientation?: 'vertical' | 'horizontal';
  /**
   * The grip sits ON a panel's border rather than in a gap between two
   * panels: the dots get a pill of the card's colour, or the border's line
   * would run straight through them.
   */
  onBorder?: boolean;
  /** A drag is under way: the dots stay lit while the pointer is elsewhere. */
  active?: boolean;
}

/**
 * The ellipsis that marks a border as something to drag: three dots at the
 * middle of every resizable edge (the operator, 2026-10-29: "uniform"). A
 * bare border, or a line that shows only on hover, looks like no handle at
 * all, and on a touch screen there is no hover to reveal it.
 *
 * Decorative only: the element it sits in is the `role="separator"` with the
 * label, the value and the keys (the ARIA window splitter). Put it INSIDE that
 * element, and give the element `group` — the dots light up with its hover
 * and its keyboard focus.
 *
 * Used by the main navigation's edge, the Apps page's app list and its grid
 * borders, and the point of sale's order panel.
 */
export function ResizeGrip({ orientation = 'vertical', onBorder = false, active = false }: ResizeGripProps) {
  const vertical = orientation === 'vertical';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none flex shrink-0 gap-0.5',
        vertical ? 'flex-col' : 'flex-row',
        onBorder && 'rounded-full border border-border bg-card shadow-sm',
        onBorder && (vertical ? 'px-0.5 py-1.5' : 'px-1.5 py-0.5'),
      )}
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className={cn(
            'size-1 rounded-full bg-muted-foreground/60 transition-colors group-hover:bg-primary group-focus-visible:bg-primary',
            active && 'bg-primary',
          )}
        />
      ))}
    </span>
  );
}
