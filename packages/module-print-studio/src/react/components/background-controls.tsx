'use client';

import { cn } from '@kwtech/web-ui/react';
import { Check, Crosshair, ImageUp, Maximize, Minimize, Move, Trash2 } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useId, useRef } from 'react';
import {
  centreBackground,
  clampOpacity,
  fitBackground,
  moveBackground,
  resizeBackground,
  STUDIO_BACKGROUND_SCALE_MAX,
  type StudioBackground,
} from '../../domain/background.js';
import type { StudioRect, StudioSize } from '../../domain/layout.js';
import type { StudioPhoto } from '../render/photos.js';
import { STUDIO_PHOTO_ACCEPT } from '../view/work.js';
import { buttonClass } from './controls.js';

/**
 * A picture behind the photos, for this print (`domain/background.ts`): the
 * card in the Print screen's settings, and the layer laid over the sheet while
 * it is being moved.
 *
 * ⚠ THE PICTURE IS A PHOTO LIKE ANY OTHER: read by `loadPhoto`, held in the
 * tab, never uploaded, released with Start over. Only its place and strength
 * are its own.
 */

/** The outline and handle while the picture is moved. ⚠ LITERAL, like every mark on the sheet: it is drawn on paper. */
const MARK = '#2563eb';

/** The card: choose a picture, then how strong, how big and where. */
export function BackgroundCard({
  photo,
  placement,
  area,
  sheet,
  moving,
  loading,
  onChoose,
  onRemove,
  onChange,
  onMoving,
}: {
  photo: StudioPhoto | null;
  placement: StudioBackground | null;
  /** The printable area, in sheet coordinates: what Fill, Fit and Centre measure against. */
  area: StudioRect;
  sheet: StudioSize;
  moving: boolean;
  loading: boolean;
  onChoose: (file: File) => void;
  onRemove: () => void;
  onChange: (placement: StudioBackground) => void;
  onMoving: (moving: boolean) => void;
}) {
  const inputId = useId();
  const opacityId = useId();
  const sizeId = useId();
  const picker = (
    <input
      id={inputId}
      type="file"
      accept={STUDIO_PHOTO_ACCEPT}
      className="sr-only"
      disabled={loading}
      onChange={(event) => {
        const file = event.target.files?.[0];
        // Cleared, so choosing the same file again is a change the input reports.
        event.target.value = '';
        if (file) onChoose(file);
      }}
    />
  );

  if (!photo || !placement) {
    return (
      <section
        aria-label="Background picture"
        className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
      >
        <h3 className="text-sm font-semibold">Background picture</h3>
        <p className="text-xs text-muted-foreground">
          A picture behind the photos on every page — a design, a pattern, a faded logo. For this print only.
        </p>
        {picker}
        <label
          htmlFor={inputId}
          className={cn(
            buttonClass('secondary', 'sm'),
            'cursor-pointer',
            loading ? 'pointer-events-none opacity-50' : null,
          )}
        >
          <ImageUp aria-hidden="true" className="size-3.5" />
          {loading ? 'Reading…' : 'Choose a picture'}
        </label>
      </section>
    );
  }

  const image = { width: photo.width, height: photo.height };
  const sizePercent = Math.round((placement.rect.width / Math.max(sheet.width, 1)) * 100);
  const change = (rect: StudioRect) => onChange({ ...placement, rect });

  return (
    <section
      aria-label="Background picture"
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3"
    >
      <h3 className="text-sm font-semibold">Background picture</h3>
      <div className="flex items-center gap-2">
        <img src={photo.url} alt="" className="size-10 shrink-0 rounded-md object-cover ring-1 ring-border" />
        <p className="min-w-0 flex-1 truncate text-xs" title={photo.name}>
          {photo.name}
        </p>
        {picker}
        <label
          htmlFor={inputId}
          className={cn(buttonClass('ghost', 'sm'), 'cursor-pointer px-2')}
          title="Another picture"
        >
          <ImageUp aria-hidden="true" className="size-3.5" />
          <span className="sr-only">Another picture</span>
        </label>
        <button
          type="button"
          aria-label="Remove the background picture"
          title="Remove the background picture"
          className={cn(buttonClass('ghost', 'sm'), 'px-2 text-destructive hover:bg-destructive/10')}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      <Slider
        id={opacityId}
        label="Opacity"
        value={placement.opacity}
        min={0}
        max={100}
        shown={`${placement.opacity}%`}
        onChange={(value) => onChange({ ...placement, opacity: clampOpacity(value) })}
      />
      <Slider
        id={sizeId}
        label="Size"
        value={sizePercent}
        min={5}
        max={STUDIO_BACKGROUND_SCALE_MAX * 100}
        shown={`${sizePercent}% of the page`}
        onChange={(value) =>
          change(resizeBackground(placement.rect, (value * sheet.width) / 100, image, sheet, 'centre'))
        }
      />

      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          title="Cover the whole printable area; the edges of the picture may be cut"
          className={buttonClass('secondary', 'sm')}
          onClick={() => change(fitBackground(image, area, 'fill'))}
        >
          <Maximize aria-hidden="true" className="size-3.5" />
          Fill
        </button>
        <button
          type="button"
          title="Show the whole picture inside the printable area"
          className={buttonClass('secondary', 'sm')}
          onClick={() => change(fitBackground(image, area, 'fit'))}
        >
          <Minimize aria-hidden="true" className="size-3.5" />
          Fit
        </button>
        <button
          type="button"
          title="Put it in the middle of the page, at this size"
          className={buttonClass('secondary', 'sm')}
          onClick={() => change(centreBackground(placement.rect, area))}
        >
          <Crosshair aria-hidden="true" className="size-3.5" />
          Centre
        </button>
      </div>
      <button
        type="button"
        aria-pressed={moving}
        className={buttonClass(moving ? 'primary' : 'secondary', 'sm')}
        onClick={() => onMoving(!moving)}
      >
        {moving ? <Check aria-hidden="true" className="size-3.5" /> : <Move aria-hidden="true" className="size-3.5" />}
        {moving ? 'Done moving the picture' : 'Move and resize on the sheet'}
      </button>
      <p className="text-xs text-muted-foreground">
        {moving
          ? 'Drag the picture on the sheet, or its corner to resize it. The photos are held still until you press Done.'
          : 'Printed behind the photos on every page, cut at the margins. It stays on this computer.'}
      </p>
    </section>
  );
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  shown,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  shown: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        <span className="text-xs tabular-nums text-muted-foreground">{shown}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={Math.min(Math.max(value, min), max)}
        className="w-full accent-primary"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** What a drag on the mover is doing, in a ref so a pointer move never re-renders by itself. */
interface MoverDrag {
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  /** Units per screen pixel, measured when the drag began. */
  scale: number;
  from: StudioRect;
}

/**
 * The layer over the sheet while the picture is moved: a drag anywhere moves
 * it, a drag of its bottom right corner resizes it at its own shape.
 *
 * ⚠ OVER THE CELLS, so a press here never picks up a photo; that is why it is
 * a mode with a Done, and not always there. ⚠ The drag is captured by the
 * LAYER, which outlives the drag, as `SheetView` does for its cells.
 */
export function BackgroundMover({
  placement,
  image,
  sheet,
  onChange,
  onDone,
}: {
  placement: StudioBackground;
  /** The picture's size in pixels: its shape. */
  image: StudioSize;
  sheet: StudioSize;
  onChange: (placement: StudioBackground) => void;
  onDone: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<MoverDrag | null>(null);
  const { rect } = placement;

  function begin(event: ReactPointerEvent<HTMLElement>, kind: MoverDrag['kind']) {
    const box = layer.current?.getBoundingClientRect();
    if (event.button !== 0 || !box || !(box.width > 0)) return;
    event.stopPropagation();
    layer.current?.setPointerCapture(event.pointerId);
    drag.current = { kind, startX: event.clientX, startY: event.clientY, scale: sheet.width / box.width, from: rect };
  }

  function during(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) * current.scale;
    const dy = (event.clientY - current.startY) * current.scale;
    const next =
      current.kind === 'move'
        ? moveBackground(current.from, { x: current.from.x + dx, y: current.from.y + dy }, sheet)
        : resizeBackground(current.from, current.from.width + dx, image, sheet, 'corner');
    onChange({ ...placement, rect: next });
  }

  function end() {
    drag.current = null;
  }

  const percent = (value: number, of: number) => `${(value / of) * 100}%`;
  return (
    <div
      ref={layer}
      role="application"
      aria-label="Move the background picture: drag it, or its corner to resize it"
      className="absolute inset-0 z-20 cursor-move touch-none select-none overflow-hidden"
      onPointerDown={(event) => begin(event, 'move')}
      onPointerMove={during}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          left: percent(rect.x, sheet.width),
          top: percent(rect.y, sheet.height),
          width: percent(rect.width, sheet.width),
          height: percent(rect.height, sheet.height),
          outline: `2px dashed ${MARK}`,
          outlineOffset: '-1px',
        }}
      />
      <div
        title="Drag to resize"
        className="absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-sm border-2"
        style={{
          borderColor: '#ffffff',
          left: percent(rect.x + rect.width, sheet.width),
          top: percent(rect.y + rect.height, sheet.height),
          backgroundColor: MARK,
        }}
        onPointerDown={(event) => begin(event, 'resize')}
      />
      <button
        type="button"
        className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium shadow-md"
        style={{ backgroundColor: MARK, color: '#ffffff' }}
        // Its own press, not the start of a move.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onDone}
      >
        Done moving the picture
      </button>
    </div>
  );
}
