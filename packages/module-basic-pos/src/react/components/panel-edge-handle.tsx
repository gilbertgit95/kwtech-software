'use client';

import { cn, ResizeGrip, Tooltip } from '@kwtech/web-ui/react';
import { type PointerEvent, useRef, useState } from 'react';
import type { PanelWidthRules } from '../view/order-panel.js';

/**
 * A panel's resizable EDGE, as a handle (the operator, 2026-10-29): the till's
 * order panel by its left edge, the Cashier's waiting column by its right.
 * The ARIA window splitter, as `module-app-hub`'s app list: focusable, ← →
 * move the edge, Home / End go to the bounds, double-click puts the default
 * back. Shown only where the panel sits beside its neighbour (`shownClass`,
 * a container query); stacked, it has the whole width already.
 *
 * Stored once, on release, not on every move: a drag emits a pointer event
 * per frame and nothing reads the stored width until the next visit.
 */
export function PanelEdgeHandle({
  panelId,
  label,
  width,
  rules,
  storageKey,
  shownClass,
  onResize,
}: {
  panelId: string;
  /** "Resize the order": the handle's accessible name. */
  label: string;
  width: number;
  rules: PanelWidthRules;
  storageKey: string;
  /** The container query from which the panel sits beside its neighbour, e.g. `@3xl:flex`. */
  shownClass: string;
  onResize: (width: number) => void;
}) {
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; fromX: number; start: number } | null>(null);

  const resizeTo = (next: number) => {
    onResize(next);
    writePanelWidth(storageKey, next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Stops the press from starting a text selection across the panel beside it.
    event.preventDefault();
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
    resizeTo(rules.afterDrag(active.start, active.fromX, event.clientX));
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
            // ⚠ The till reads ← → and Home / End as its own keys (the cart, the search); here they are the edge's.
            event.stopPropagation();
            resizeTo(next);
          }}
          onDoubleClick={() => resizeTo(rules.bounds.default)}
          className={cn(
            // touch-none: a finger dragging the edge resizes instead of scrolling. Straddles the border, 12px wide.
            'group absolute inset-y-0 z-10 hidden w-3 cursor-col-resize touch-none items-center justify-center rounded-full transition-colors',
            rules.edge === 'left' ? '-left-1.5' : '-right-1.5',
            shownClass,
            'hover:bg-primary/20 focus-visible:bg-primary/30 focus-visible:outline-none',
            resizing && 'bg-primary/30',
          )}
        >
          <ResizeGrip onBorder active={resizing} />
        </div>
      )}
    </Tooltip>
  );
}

/** Storage can throw (a private window, blocked site data); the panel then opens at its default. */
export function readPanelWidth(rules: PanelWidthRules, storageKey: string): number {
  if (typeof window === 'undefined') return rules.bounds.default;
  try {
    return rules.parseStored(window.localStorage.getItem(storageKey));
  } catch {
    return rules.bounds.default;
  }
}

function writePanelWidth(storageKey: string, width: number): void {
  try {
    window.localStorage.setItem(storageKey, String(width));
  } catch {
    // Not remembered on this device; the panel keeps its width for this visit.
  }
}
