'use client';

import { cn } from '@kwtech/web-ui/react';
import { Minus, Plus } from 'lucide-react';
import {
  type DragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  printableArea,
  type StudioLayoutSpec,
  type StudioRect,
  type StudioSize,
  sheetSize,
} from '../../domain/layout.js';
import type { StudioRulerUnit } from '../view/ruler-ticks.js';
import { cellLabelSize } from '../view/summary.js';
import { STUDIO_VIEW_ZOOMS, stepViewZoom } from '../view/work.js';
import { RulerCorner, STUDIO_RULER_PX, type StudioPaperGeometry, ViewRuler } from './sheet-rulers.js';

/**
 * A layout drawn to scale: the sheet, the part of it that cannot print, and
 * the cells.
 *
 * An SVG whose `viewBox` IS the sheet in the domain's own units, so nothing
 * here converts a length: a cell at `x: 2540` is drawn at 2540, and the
 * browser scales the whole drawing to whatever box it is given. The same
 * component is the thumbnail in a list and the canvas of the editor.
 *
 * ⚠ THE SHEET IS WHITE WHATEVER THE THEME. It is a picture of paper, not a
 * surface of the app — a dark-theme sheet would show a layout on paper nobody
 * owns. So its two fills are literal, and everything drawn ON it uses colours
 * that read on white.
 */
export interface SheetViewProps {
  spec: StudioLayoutSpec;
  /** The selected cell's index, in the editor. */
  selected?: number | null;
  /** Given, the cells can be picked, dragged and resized. */
  onSelect?: (index: number | null) => void;
  /** A drag in progress: the cell's wanted top left, in units from the printable area's. */
  onMove?: (index: number, position: { x: number; y: number }) => void;
  /** A resize in progress: the cell's wanted size, in units. */
  onResize?: (index: number, size: { width: number; height: number }) => void;
  /**
   * Given, something may be dropped on the sheet (a size from the editor's palette). Called with the point it was
   * dropped at, in units from the printable area's top left. `accepts` says whether a drag is one of ours.
   */
  onDropAt?: (event: DragEvent<SVGSVGElement>, point: { x: number; y: number }) => void;
  accepts?: (event: DragEvent<SVGSVGElement>) => boolean;
  /** Whether to write each cell's size label on it. Off for thumbnails, where it would be a smudge. */
  labels?: boolean;
  className?: string;
  /**
   * Size the drawing to FIT its parent, both ways, keeping the paper's shape. The parent must be a size container
   * (`container-type: size`) — see `SheetFrame`.
   */
  fit?: boolean;
  /** With `fit`: how much larger than fitted to draw it. The frame scrolls. */
  zoom?: number;
  /** What the drawing is, for a screen reader. */
  label: string;
}

/** What a drag is doing, held in a ref so a pointer move never re-renders by itself. */
interface Drag {
  index: number;
  kind: 'move' | 'resize';
  /** Units per screen pixel, measured when the drag began. */
  scale: number;
  startX: number;
  startY: number;
  /** The cell's x/y (a move) or width/height (a resize) when the drag began. */
  fromA: number;
  fromB: number;
}

const PAPER = '#ffffff';
/** The unprintable border: a grey that reads as "not here" on white. */
const MARGIN = '#e5e7eb';
/**
 * A cell on the sheet. ⚠ LITERAL, like the paper: the theme's primary is nearly white on a dark theme, and a
 * near-white cell on white paper cannot be seen. A blue that reads on white in every theme.
 */
const CELL = '#2563eb';

export function SheetView({
  spec,
  selected = null,
  onSelect,
  onMove,
  onResize,
  onDropAt,
  accepts,
  labels = true,
  fit = false,
  zoom = 1,
  className,
  label,
}: SheetViewProps) {
  const sheet = sheetSize(spec);
  const area = printableArea(spec);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const interactive = onSelect !== undefined;

  // Line weights in units, relative to the sheet, so a thumbnail and the editor both read.
  const hair = Math.max(sheet.width, sheet.height) / 400;
  const handle = Math.max(sheet.width, sheet.height) / 45;

  /*
   * ⚠ THE DRAG IS CAPTURED BY THE SVG, NOT BY THE CELL. A cell is keyed by where
   * it is, so it is a new element after every step of a drag; a capture held by
   * the cell would be dropped with it on the first move. The drawing itself
   * outlives the drag.
   */
  function begin(event: ReactPointerEvent<SVGElement>, index: number, kind: Drag['kind']) {
    if (!interactive) return;
    const cell = spec.cells[index];
    const box = svg.current?.getBoundingClientRect();
    if (!cell || !box || box.width === 0) return;
    event.stopPropagation();
    svg.current?.setPointerCapture(event.pointerId);
    onSelect?.(index);
    drag.current = {
      index,
      kind,
      scale: sheet.width / box.width,
      startX: event.clientX,
      startY: event.clientY,
      fromA: kind === 'move' ? cell.x : cell.width,
      fromB: kind === 'move' ? cell.y : cell.height,
    };
  }

  function during(event: ReactPointerEvent<SVGElement>) {
    const current = drag.current;
    if (!current) return;
    const a = current.fromA + (event.clientX - current.startX) * current.scale;
    const b = current.fromB + (event.clientY - current.startY) * current.scale;
    if (current.kind === 'move') onMove?.(current.index, { x: a, y: b });
    else onResize?.(current.index, { width: a, height: b });
  }

  function end() {
    drag.current = null;
  }

  return (
    <svg
      ref={svg}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${sheet.width} ${sheet.height}`}
      // As wide as the frame, or as wide as its height allows — whichever is less — so a tall paper never scrolls.
      style={fit ? { width: fitWidth(sheet, zoom) } : undefined}
      className={cn('block h-auto w-full touch-none select-none rounded-sm shadow-md ring-1 ring-border', className)}
      // A press on the paper itself, not a cell, lets go of the selection.
      onPointerDown={interactive ? () => onSelect?.(null) : undefined}
      onPointerMove={interactive ? during : undefined}
      onPointerUp={interactive ? end : undefined}
      onPointerCancel={interactive ? end : undefined}
      onDragOver={
        onDropAt
          ? (event) => {
              if (accepts?.(event) ?? true) event.preventDefault();
            }
          : undefined
      }
      onDrop={
        onDropAt
          ? (event) => {
              const box = svg.current?.getBoundingClientRect();
              if (!box || box.width === 0) return;
              const scale = sheet.width / box.width;
              onDropAt(event, {
                x: (event.clientX - box.left) * scale - area.x,
                y: (event.clientY - box.top) * scale - area.y,
              });
            }
          : undefined
      }
    >
      <rect width={sheet.width} height={sheet.height} fill={MARGIN} />
      <rect x={area.x} y={area.y} width={Math.max(area.width, 0)} height={Math.max(area.height, 0)} fill={PAPER} />

      <g transform={`translate(${area.x} ${area.y})`}>
        {spec.cells.map((cell, index) => {
          const chosen = index === selected;
          // Sized to the label as well as the cell, so a long one stays inside its own cell.
          const text = cell.label ? cellLabelSize(cell, cell.label) : 0;
          return (
            // Cells never overlap, so a cell's top left names it and no other.
            <g key={`${cell.x}:${cell.y}`}>
              <rect
                x={cell.x}
                y={cell.y}
                width={cell.width}
                height={cell.height}
                strokeWidth={chosen ? hair * 3 : hair}
                stroke={CELL}
                fill={CELL}
                fillOpacity={chosen ? 0.32 : 0.1}
                className={cn(interactive ? 'cursor-move hover:[fill-opacity:0.2]' : null)}
                onPointerDown={(event) => begin(event, index, 'move')}
              />
              {labels && cell.label ? (
                <text
                  x={cell.x + cell.width / 2}
                  y={cell.y + cell.height / 2}
                  fontSize={text}
                  textAnchor="middle"
                  dominantBaseline="central"
                  // Dark on the white sheet whatever the theme — see the note on the sheet's colour.
                  fill="#111827"
                  opacity={0.75}
                  pointerEvents="none"
                >
                  {cell.label}
                </text>
              ) : null}
              {chosen && interactive ? (
                <rect
                  x={cell.x + cell.width - handle / 2}
                  y={cell.y + cell.height - handle / 2}
                  width={handle}
                  height={handle}
                  rx={handle / 5}
                  strokeWidth={hair}
                  stroke={PAPER}
                  fill={CELL}
                  className="cursor-nwse-resize"
                  onPointerDown={(event) => begin(event, index, 'resize')}
                >
                  <title>Drag to resize</title>
                </rect>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/**
 * A box a sheet is fitted into: it takes whatever room it is given and tells
 * its content how big that is (`container-type: size`), so a `fit` sheet — or a
 * canvas sized the same way — is as large as it can be without scrolling.
 *
 * ## Zooming (the operator, 2026-10-05)
 *
 * Fitted, an A4 on a laptop is small, and placing a cell to the millimetre on
 * it is guesswork. Given `zoom` and `onZoom`, the frame shows the sheet larger
 * and SCROLLS inside itself; the buttons in its corner step in and out, and
 * Ctrl (⌘ on a Mac) with the mouse wheel does the same. Zoom is how closely
 * the person is looking — it changes nothing in the layout or the result.
 */
export function SheetFrame({
  children,
  className,
  zoom = 1,
  onZoom,
  tools,
  rulers,
}: {
  children: ReactNode;
  className?: string;
  /** 1 fits the panel. Larger scrolls. */
  zoom?: number;
  /** Given, the frame offers zoom controls. */
  onZoom?: (zoom: number) => void;
  /** More controls for how the sheet is looked at (the rulers), in the same floating bar, before the zoom. */
  tools?: ReactNode;
  /**
   * Rulers along the frame's top and left edges, measuring the paper inside it — the element marked
   * `data-studio-paper`. A null unit is no rulers.
   */
  rulers?: { unit: StudioRulerUnit | null; sheet: StudioSize; highlight?: StudioRect | null };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const unit = rulers?.unit ?? null;
  const sheetWidth = rulers?.sheet.width ?? 0;
  /*
   * ⚠ A NATIVE LISTENER, NOT `onWheel`. React registers wheel handlers as
   * passive, and a passive handler cannot stop the browser zooming the whole
   * page on Ctrl + wheel — which is exactly the gesture being borrowed here.
   */
  useEffect(() => {
    const element = scroller.current;
    if (!element || !onZoom) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      onZoom(stepViewZoom(zoom, event.deltaY < 0 ? 1 : -1));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom, onZoom]);

  /*
   * Where the paper is under the rulers, measured rather than worked out: the
   * frame centres it, pads it and scrolls it, and its own size follows the
   * zoom. Read again on every scroll and whenever the view or the paper
   * changes size; set only when it moved, so a scroll that changed nothing
   * renders nothing.
   */
  const [geometry, setGeometry] = useState<StudioPaperGeometry | null>(null);
  useEffect(() => {
    const view = scroller.current;
    if (!view || !unit) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const paper = view.querySelector('[data-studio-paper]');
        if (!paper || !(sheetWidth > 0)) return setGeometry(null);
        const box = view.getBoundingClientRect();
        const sheetBox = paper.getBoundingClientRect();
        const next: StudioPaperGeometry = {
          left: sheetBox.left - box.left,
          top: sheetBox.top - box.top,
          perUnit: sheetBox.width / sheetWidth,
          width: view.clientWidth,
          height: view.clientHeight,
        };
        setGeometry((current) => (current && sameGeometry(current, next) ? current : next));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    const paper = view.querySelector('[data-studio-paper]');
    if (paper) observer.observe(paper);
    view.addEventListener('scroll', measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      view.removeEventListener('scroll', measure);
    };
  }, [unit, sheetWidth]);

  /*
   * Where the pointer is over the view, in pixels from its top left, for the
   * marks on the rulers. Only while the rulers are on: otherwise a move
   * re-renders nothing. Moves during a drag still arrive — a photo's drag
   * captures the pointer on its cell, and the event bubbles up through here.
   */
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  function track(event: ReactPointerEvent<HTMLDivElement>) {
    const box = scroller.current?.getBoundingClientRect();
    if (!box) return;
    setPointer({ x: event.clientX - box.left, y: event.clientY - box.top });
  }

  /*
   * ⚠ THE SHEET STAYS THE SAME ELEMENT WITH THE RULERS ON OR OFF. The rulers
   * are grid cells beside it whose slots stay as null when off; moving the
   * sheet in the tree instead would make React build a NEW canvas, blank,
   * because nothing it draws has changed.
   */
  return (
    <div
      className={cn('relative grid min-h-0 min-w-0 flex-1', className)}
      style={
        unit
          ? {
              gridTemplateColumns: `${STUDIO_RULER_PX}px minmax(0, 1fr)`,
              gridTemplateRows: `${STUDIO_RULER_PX}px minmax(0, 1fr)`,
            }
          : { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' }
      }
    >
      {unit ? <RulerCorner unit={unit} /> : null}
      {unit && rulers ? (
        <ViewRuler
          axis="x"
          length={rulers.sheet.width}
          unit={unit}
          geometry={geometry}
          highlight={rulers.highlight}
          pointer={pointer?.x ?? null}
        />
      ) : null}
      {unit && rulers ? (
        <ViewRuler
          axis="y"
          length={rulers.sheet.height}
          unit={unit}
          geometry={geometry}
          highlight={rulers.highlight}
          pointer={pointer?.y ?? null}
        />
      ) : null}
      {/*
       * ⚠ `isolate`: the sheet's own layers (a selected cell is z-10) stack INSIDE the view and can never rise over
       * the floating bar below — which they did, and its buttons could not be pressed with a photo under them.
       */}
      <div
        ref={scroller}
        className="isolate min-h-0 min-w-0 overflow-auto p-4"
        onPointerMove={unit ? track : undefined}
        onPointerLeave={unit ? () => setPointer(null) : undefined}
      >
        {/* The size the sheet is fitted to: the view less its padding (`fitWidth` reads it as `cqw` / `cqh`). */}
        <div className="size-full" style={{ containerType: 'size' }}>
          {/* `w-fit` with auto margins: centred while it fits, and scrollable from its left edge once it does not. */}
          <div className="mx-auto w-fit">{children}</div>
        </div>
      </div>
      {onZoom ? <ZoomControl zoom={zoom} onZoom={onZoom} tools={tools} /> : null}
    </div>
  );
}

function sameGeometry(a: StudioPaperGeometry, b: StudioPaperGeometry): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.perUnit - b.perUnit) < 1e-9 &&
    a.width === b.width &&
    a.height === b.height
  );
}

function ZoomControl({ zoom, onZoom, tools }: { zoom: number; onZoom: (zoom: number) => void; tools?: ReactNode }) {
  const first = STUDIO_VIEW_ZOOMS[0];
  const last = STUDIO_VIEW_ZOOMS[STUDIO_VIEW_ZOOMS.length - 1] ?? first;
  const button =
    'flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <fieldset
      // ⚠ z-30, over everything in the view: the controls must stay pressable whatever is drawn under them.
      className="absolute right-2 bottom-2 z-30 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-0.5 shadow-md"
      title="Hold Ctrl (⌘ on a Mac) and turn the mouse wheel to zoom"
    >
      <legend className="sr-only">Zoom the view</legend>
      {tools ? (
        <>
          {tools}
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
        </>
      ) : null}
      <button
        type="button"
        aria-label="Zoom the view out"
        className={button}
        disabled={zoom <= first}
        onClick={() => onZoom(stepViewZoom(zoom, -1))}
      >
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Fit the sheet to the panel"
        className={cn(button, 'w-auto px-2 text-xs font-medium tabular-nums')}
        onClick={() => onZoom(1)}
      >
        {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
      </button>
      <button
        type="button"
        aria-label="Zoom the view in"
        className={button}
        disabled={zoom >= last}
        onClick={() => onZoom(stepViewZoom(zoom, 1))}
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </fieldset>
  );
}

/**
 * The width that fits a sheet of this shape into a `SheetFrame`, as a CSS
 * length — times `zoom` when the person is looking closer.
 */
export function fitWidth(sheet: { width: number; height: number }, zoom = 1): string {
  const fitted = `min(100cqw, calc(100cqh * ${sheet.width / sheet.height}))`;
  return zoom === 1 ? fitted : `calc(${fitted} * ${zoom})`;
}
