'use client';

import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@kwtech/web-ui/react';
import { Check, Ruler } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { StudioRect } from '../../domain/layout.js';
import {
  rulerReading,
  rulerTicks,
  STUDIO_RULER_UNIT_LABELS,
  STUDIO_RULER_UNITS,
  type StudioRulerUnit,
} from '../view/ruler-ticks.js';

/**
 * Rulers along the top and left of the sheet on screen (the operator,
 * 2026-10-06), in millimetres, centimetres or inches — or none, which is how
 * they start.
 *
 * ⚠ A GUIDE ON THE SCREEN ONLY. They sit on the preview's edges, outside the
 * paper, and nothing of them is drawn into the result. They read from the
 * paper's own edge, the way a ruler laid on the printout would.
 */

/** How thick each ruler is, in screen pixels. */
export const STUDIO_RULER_PX = 20;

/*
 * ⚠ HELD IN MEMORY, NOT IN BROWSER STORAGE. The studio writes nothing to the
 * browser (PRINT-STUDIO-PLAN decision 8, checked by `web-module.test.ts`), and
 * a ruler preference is no reason to start. So the choice lasts while the page
 * is open: shared by the photo and the document previews, and kept across a
 * change of layout, but off again after a reload.
 *
 * A module-level value rather than context because it belongs to no one
 * screen, and `useSyncExternalStore` keeps every preview showing the same.
 */
let chosenRulerUnit: StudioRulerUnit | null = null;
const rulerListeners = new Set<() => void>();

function subscribeRulerUnit(listener: () => void): () => void {
  rulerListeners.add(listener);
  return () => rulerListeners.delete(listener);
}

function setChosenRulerUnit(unit: StudioRulerUnit | null): void {
  chosenRulerUnit = unit;
  for (const listener of rulerListeners) listener();
}

/** The ruler unit chosen while the page is open, null for none (the start), and how to change it. */
export function useRulerUnit(): [StudioRulerUnit | null, (unit: StudioRulerUnit | null) => void] {
  const unit = useSyncExternalStore(
    subscribeRulerUnit,
    () => chosenRulerUnit,
    // The server has no choice to show: the rulers start off.
    () => null,
  );
  return [unit, setChosenRulerUnit];
}

/** Where the paper is in the view, in screen pixels from the rulers' own start, and its scale. */
export interface StudioPaperGeometry {
  left: number;
  top: number;
  /** Screen pixels per unit. */
  perUnit: number;
  /** How long each ruler is: the view's visible width and height. */
  width: number;
  height: number;
}

/**
 * One ruler along an edge of the preview — the top (`x`) or the left (`y`).
 *
 * ⚠ FIXED TO THE VIEW, NOT THE PAPER (the operator, 2026-10-06): it stays on
 * the panel's edge while the sheet scrolls and zooms under it, and its 0
 * follows the paper's edge. Past the paper it is blank, shaded as the panel
 * is, because nothing there will print.
 */
export function ViewRuler({
  axis,
  length,
  unit,
  geometry,
  highlight,
  pointer = null,
}: {
  axis: 'x' | 'y';
  /** The paper's width (`x`) or height (`y`), in units. */
  length: number;
  unit: StudioRulerUnit;
  geometry: StudioPaperGeometry | null;
  /** The selected cell, on the sheet, in units: a band on the ruler. */
  highlight?: StudioRect | null | undefined;
  /** Where the pointer is along this ruler, in screen pixels from its start; null when it is not over the view. */
  pointer?: number | null | undefined;
}) {
  const across = axis === 'x';
  const span = geometry ? (across ? geometry.width : geometry.height) : 0;
  const start = geometry ? (across ? geometry.left : geometry.top) : 0;
  const perUnit = geometry?.perUnit ?? 0;
  const px = (at: number) => start + at * perUnit;
  // Only what can be seen: zoomed in on an A4, most of its ticks are scrolled away.
  const ticks = rulerTicks(length, unit, perUnit).filter((tick) => px(tick.at) >= -30 && px(tick.at) <= span + 30);
  const tickLength = { major: STUDIO_RULER_PX * 0.55, mid: STUDIO_RULER_PX * 0.35, minor: STUDIO_RULER_PX * 0.2 };
  const band = highlight
    ? { from: px(across ? highlight.x : highlight.y), size: (across ? highlight.width : highlight.height) * perUnit }
    : null;
  const paper = { from: px(0), size: length * perUnit };

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden bg-muted text-muted-foreground',
        across ? 'border-b border-border' : 'border-r border-border',
      )}
    >
      {geometry ? (
        <>
          {/* The paper's stretch of the ruler, lighter: where the numbers mean something. */}
          <div
            className="absolute bg-card"
            style={
              across
                ? { left: paper.from, width: paper.size, top: 0, bottom: 0 }
                : { top: paper.from, height: paper.size, left: 0, right: 0 }
            }
          />
          {band ? (
            <div
              className="absolute bg-primary/20"
              style={
                across
                  ? { left: band.from, width: band.size, top: 0, bottom: 0 }
                  : { top: band.from, height: band.size, left: 0, right: 0 }
              }
            />
          ) : null}
          <svg aria-hidden="true" className="absolute inset-0 size-full">
            {ticks.map((tick) => {
              // Half a pixel in, so a one-pixel line lands on one pixel rather than smearing over two.
              const at = Math.round(px(tick.at)) + 0.5;
              const size = tickLength[tick.level];
              return across ? (
                <line
                  key={tick.at}
                  x1={at}
                  x2={at}
                  y1={STUDIO_RULER_PX}
                  y2={STUDIO_RULER_PX - size}
                  stroke="currentColor"
                />
              ) : (
                <line
                  key={tick.at}
                  y1={at}
                  y2={at}
                  x1={STUDIO_RULER_PX}
                  x2={STUDIO_RULER_PX - size}
                  stroke="currentColor"
                />
              );
            })}
          </svg>
          {ticks.map((tick) =>
            tick.label ? (
              <span
                key={`label:${tick.at}`}
                className="absolute text-[9px] leading-none tabular-nums"
                style={
                  across
                    ? { left: px(tick.at) + 2, top: 2 }
                    : // Read bottom to top, as a ruler down the left of a drawing is.
                      { top: px(tick.at) + 2, left: 2, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }
                }
              >
                {tick.label}
              </span>
            ) : null,
          )}
          {pointer !== null ? <PointerMark across={across} at={pointer} reading={pointerReading(pointer)} /> : null}
        </>
      ) : null}
    </div>
  );

  /** The pointer's distance from the paper's edge, in the ruler's unit — or none while it is off the paper. */
  function pointerReading(at: number): string | null {
    if (!(perUnit > 0)) return null;
    const units = (at - start) / perUnit;
    return units >= 0 && units <= length ? rulerReading(units, unit) : null;
  }
}

/**
 * Where the pointer is, on one ruler: a line across it in the primary colour,
 * and, while the pointer is over the paper, a tag reading the exact length.
 */
function PointerMark({ across, at, reading }: { across: boolean; at: number; reading: string | null }) {
  const line = Math.round(at);
  return (
    <>
      <div
        className="pointer-events-none absolute bg-primary"
        style={across ? { left: line, width: 1, top: 0, bottom: 0 } : { top: line, height: 1, left: 0, right: 0 }}
      />
      {reading ? (
        <span
          className="pointer-events-none absolute rounded-sm bg-primary px-0.5 text-[9px] leading-tight font-medium tabular-nums text-primary-foreground shadow-sm"
          style={
            across
              ? { left: line + 3, top: 1 }
              : // Read bottom to top, as the ruler's own numbers are.
                { top: line + 3, left: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }
          }
        >
          {reading}
        </span>
      ) : null}
    </>
  );
}

/** The square where the two rulers meet: it names the unit. */
export function RulerCorner({ unit }: { unit: StudioRulerUnit }) {
  return (
    <div
      title={STUDIO_RULER_UNIT_LABELS[unit]}
      className="flex items-center justify-center border-r border-b border-border bg-muted text-[9px] font-medium text-muted-foreground"
    >
      {unit}
    </div>
  );
}

/** The rulers' switch, for the view's toolbar: none, or one of the units. */
export function RulerMenu({
  unit,
  onUnit,
}: {
  unit: StudioRulerUnit | null;
  onUnit: (unit: StudioRulerUnit | null) => void;
}) {
  const choices: { value: StudioRulerUnit | null; label: string }[] = [
    { value: null, label: 'No rulers' },
    ...STUDIO_RULER_UNITS.map((value) => ({ value, label: STUDIO_RULER_UNIT_LABELS[value] })),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={unit ? `Rulers in ${STUDIO_RULER_UNIT_LABELS[unit].toLowerCase()}` : 'Rulers: off'}
        title="Rulers"
        className={cn(
          'flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          unit ? 'text-primary' : 'text-foreground',
        )}
      >
        <Ruler aria-hidden="true" className="size-4" />
        {unit ?? 'Off'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        {choices.map((choice) => (
          <DropdownMenuItem key={choice.value ?? 'off'} onSelect={() => onUnit(choice.value)}>
            <Check aria-hidden="true" className={cn(choice.value === unit ? 'opacity-100' : 'opacity-0')} />
            {choice.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
