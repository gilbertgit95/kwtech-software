'use client';

import { cn, ResizeGrip, Tooltip } from '@kwtech/web-ui/react';
import { type PointerEvent, useRef, useState } from 'react';
import type { StudioPanelRules } from '../view/panel-width.js';

/**
 * A side panel's resizable EDGE, with the app's three-dot grip (`ResizeGrip`)
 * like every other border a person can drag (the operator, 2026-11-03). The
 * point of sale's `PanelEdgeHandle`, copied structurally: a module never
 * imports another.
 *
 * The ARIA window splitter: focusable, ← → move the edge, Home / End go to the
 * bounds, double-click puts the default back. Shown only where the panel sits
 * beside the sheet (`shownClass`, a container query); stacked, it has the
 * width already. ⚠ Its parent must be `relative`, and must not scroll, or the
 * handle scrolls away with the content.
 */
export function PanelEdgeHandle({
  panelId,
  label,
  width,
  rules,
  shownClass,
  onResize,
}: {
  panelId: string;
  /** "Resize the settings": the handle's accessible name. */
  label: string;
  width: number;
  rules: StudioPanelRules;
  /** The container query from which the panel sits beside the sheet, e.g. `@3xl:flex`. */
  shownClass: string;
  onResize: (width: number) => void;
}) {
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; fromX: number; start: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Stops the press from starting a text selection across the panel beside it.
    event.preventDefault();
    // ⚠ Kept from the sheet: a press here must not also start a selection rectangle around it (`useMarquee`).
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, fromX: event.clientX, start: width };
    setResizing(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    onResize(rules.afterDrag(active.start, active.fromX, event.clientX));
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    onResize(rules.afterDrag(active.start, active.fromX, event.clientX));
  };

  return (
    <Tooltip text="Drag to resize · double-click to reset" side={rules.edge}>
      {(tooltip) => (
        // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or pointer events; a focusable separator is the ARIA window-splitter pattern.
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={label}
          aria-controls={panelId}
          aria-valuenow={width}
          aria-valuemin={rules.bounds.min}
          aria-valuemax={rules.bounds.max}
          tabIndex={0}
          {...tooltip}
          // Both, for the two events the handle and the hint each listen to: a later prop replaces the spread one.
          onPointerDown={(event) => {
            tooltip.onPointerDown();
            onPointerDown(event);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={(event) => {
            tooltip.onKeyDown(event);
            const next = rules.afterKey(width, event.key, event.shiftKey);
            if (next === null) return;
            event.preventDefault();
            // ⚠ The studio reads ← → as its own keys (they move the selection); on the handle they are the edge's.
            event.stopPropagation();
            onResize(next);
          }}
          onDoubleClick={() => onResize(rules.bounds.default)}
          className={cn(
            /*
             * touch-none: a finger dragging the edge resizes instead of scrolling. 12px wide, filling the 12px gap
             * (`gap-3`) between the panel and the sheet, so it covers neither's content.
             */
            'group absolute inset-y-0 z-10 hidden w-3 cursor-col-resize touch-none items-center justify-center rounded-full transition-colors',
            rules.edge === 'left' ? '-left-3' : '-right-3',
            shownClass,
            'hover:bg-primary/20 focus-visible:bg-primary/30 focus-visible:outline-none',
            resizing ? 'bg-primary/30' : null,
          )}
        >
          <ResizeGrip onBorder active={resizing} />
        </div>
      )}
    </Tooltip>
  );
}
