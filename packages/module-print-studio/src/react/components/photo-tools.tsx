'use client';

import { cn } from '@kwtech/web-ui/react';
import { ChevronDown, FlipHorizontal2, FlipVertical2, RotateCcw } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { isNeutralLighting, type StudioLighting } from '../../domain/adjust.js';
import { FULL_CROP, type StudioCrop } from '../../domain/slot-fit.js';
import { NO_PHOTO_EDIT, type StudioPhotoEdit } from '../view/work.js';
import { buttonClass } from './controls.js';

/*
 * The basic image tools (PRINT-STUDIO-PLAN decision 9): framing a photo in its
 * cell, and cropping, flipping and lighting the photo itself.
 *
 * Deliberately basic. Retouching, backgrounds and text are done in other
 * software, by the operator's decision — these are what a counter needs to fix
 * a photo that is slightly dark or slightly off-centre.
 */

/**
 * A card that is one line until opened. The photo's adjustments are for the
 * photo that needs them — most do not — so they stay out of the way.
 */
function Panel({
  title,
  summary,
  action,
  children,
}: {
  title: string;
  /** What is inside, said in a line while it is closed. */
  summary: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen(!open)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">{summary}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open ? 'rotate-180' : null)}
          />
        </button>
        {action}
      </div>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-2.5 border-t border-border p-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="font-medium text-muted-foreground">
          {label}
        </label>
        <span className="tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full accent-primary"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * What was done to THE PHOTO: its crop, flips and lighting. Every cell holding
 * this photo follows — fixing a dark photo once fixes all eight copies of it.
 *
 * ⚠ THE ORIGINAL FILE IS NEVER CHANGED. These are settings, applied when the
 * sheet is drawn.
 */
export function PhotoPanel({
  name,
  edit,
  onChange,
}: {
  name: string;
  edit: StudioPhotoEdit;
  onChange: (edit: StudioPhotoEdit) => void;
}) {
  const light = (patch: Partial<StudioLighting>) => onChange({ ...edit, lighting: { ...edit.lighting, ...patch } });
  const changed = !isNeutralLighting(edit.lighting) || edit.flipH || edit.flipV || !isFullCrop(edit.crop);

  return (
    <Panel
      title="Adjust this photo"
      summary={changed ? `Edited — ${name}` : 'Brightness, colour, crop and flip'}
      action={
        changed ? (
          <button
            type="button"
            className={cn(buttonClass('ghost', 'sm'), 'h-7')}
            onClick={() => onChange(NO_PHOTO_EDIT)}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Reset
          </button>
        ) : null
      }
    >
      <p className="truncate text-xs text-muted-foreground" title={name}>
        {name} — changes apply wherever this photo is used.
      </p>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={edit.flipH}
          className={buttonClass(edit.flipH ? 'primary' : 'secondary', 'sm')}
          onClick={() => onChange({ ...edit, flipH: !edit.flipH })}
        >
          <FlipHorizontal2 aria-hidden="true" className="size-3.5" />
          Flip sideways
        </button>
        <button
          type="button"
          aria-pressed={edit.flipV}
          className={buttonClass(edit.flipV ? 'primary' : 'secondary', 'sm')}
          onClick={() => onChange({ ...edit, flipV: !edit.flipV })}
        >
          <FlipVertical2 aria-hidden="true" className="size-3.5" />
          Flip upside down
        </button>
      </div>

      <Slider
        label="Brightness"
        min={-100}
        max={100}
        value={edit.lighting.brightness}
        format={signed}
        onChange={(brightness) => light({ brightness })}
      />
      <Slider
        label="Contrast"
        min={-100}
        max={100}
        value={edit.lighting.contrast}
        format={signed}
        onChange={(contrast) => light({ contrast })}
      />
      <Slider
        label="Colour"
        min={-100}
        max={100}
        value={edit.lighting.saturation}
        format={signed}
        onChange={(saturation) => light({ saturation })}
      />
      <Slider
        label="Warmth"
        min={-100}
        max={100}
        value={edit.lighting.warmth}
        format={signed}
        onChange={(warmth) => light({ warmth })}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={edit.lighting.grayscale}
          onChange={(event) => light({ grayscale: event.target.checked })}
        />
        Black and white
      </label>

      <CropSliders crop={edit.crop} onChange={(crop) => onChange({ ...edit, crop })} />
    </Panel>
  );
}

/** The most that can be trimmed from one side: 45%, so two opposite sides always leave something. */
const TRIM_MAX = 0.45;

/**
 * Cropping, as how much to trim from each side. Four sliders rather than a box
 * dragged over the photo: it is exact, it works in a panel of any width, and
 * the preview on the sheet shows the effect as it is moved.
 */
function CropSliders({ crop, onChange }: { crop: StudioCrop; onChange: (crop: StudioCrop) => void }) {
  const left = crop.x;
  const top = crop.y;
  const right = 1 - crop.x - crop.width;
  const bottom = 1 - crop.y - crop.height;
  const set = (next: { left?: number; top?: number; right?: number; bottom?: number }) => {
    const l = next.left ?? left;
    const t = next.top ?? top;
    const r = next.right ?? right;
    const b = next.bottom ?? bottom;
    onChange({ x: l, y: t, width: 1 - l - r, height: 1 - t - b });
  };
  return (
    <fieldset className="flex flex-col gap-1.5 border-t border-border pt-2.5">
      <legend className="sr-only">Crop</legend>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Crop</span>
        {isFullCrop(crop) ? null : (
          <button
            type="button"
            className={cn(buttonClass('ghost', 'sm'), 'h-6 px-1.5')}
            onClick={() => onChange(FULL_CROP)}
          >
            Whole photo
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Slider
          label="Trim left"
          min={0}
          max={TRIM_MAX}
          step={0.01}
          value={left}
          format={percent}
          onChange={(value) => set({ left: value })}
        />
        <Slider
          label="Trim right"
          min={0}
          max={TRIM_MAX}
          step={0.01}
          value={right}
          format={percent}
          onChange={(value) => set({ right: value })}
        />
        <Slider
          label="Trim top"
          min={0}
          max={TRIM_MAX}
          step={0.01}
          value={top}
          format={percent}
          onChange={(value) => set({ top: value })}
        />
        <Slider
          label="Trim bottom"
          min={0}
          max={TRIM_MAX}
          step={0.01}
          value={bottom}
          format={percent}
          onChange={(value) => set({ bottom: value })}
        />
      </div>
    </fieldset>
  );
}

function isFullCrop(crop: StudioCrop): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
}

/** Whether an edit is the untouched one — used to mark an edited photo in the tray. */
export function isEdited(edit: StudioPhotoEdit | undefined): boolean {
  if (!edit) return false;
  return !isNeutralLighting(edit.lighting) || edit.flipH || edit.flipV || !isFullCrop(edit.crop);
}
