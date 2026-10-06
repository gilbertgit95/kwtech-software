'use client';

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@kwtech/web-ui/react';
import {
  ChevronDown,
  ImagePlus,
  Images,
  Info,
  type LucideIcon,
  Minus,
  MousePointerClick,
  Plus,
  RotateCcw,
  RotateCw,
  SquareDashed,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useId } from 'react';
import { type StudioFrame, zoomFloor, zoomFrameBy } from '../../domain/slot-fit.js';

/** Where the zoom slider stops. Past it a photo is mostly a blur; the keys still go to `STUDIO_ZOOM_MAX`. */
const SLIDER_ZOOM_MAX = 4;

export interface SelectionBarProps {
  /** How many cells are selected; 0 shows the bar's resting hint. */
  count: number;
  /** How many of the selected cells hold a photo. */
  filled: number;
  /** The frame of the cell pressed last, or null when that cell is empty. */
  frame: StudioFrame | null;
  warning: string | null;
  /** What the bar says when nothing is selected. */
  idleHint: string;
  /** The name of the photo picked in the tray, when there is one to put in the selection. */
  pickedPhoto: string | null;
  onZoom: (zoom: number) => void;
  onTurn: () => void;
  onReset: () => void;
  onFree: (free: boolean) => void;
  /** Null when the pressed cell is empty: there is no photo to match. */
  onSelectSamePhoto: (() => void) | null;
  onSelectAll: () => void;
  onPut: () => void;
  onClear: () => void;
  onDone: () => void;
}

/**
 * The selection's toolbar, above the sheet where the eye already is: one row
 * of grouped controls, and a quiet line under it saying what dragging does.
 *
 * ⚠ EVERY ACTION HERE APPLIES TO EVERY SELECTED CELL. The count comes first,
 * as a chip the selection is let go from, so nothing moves that the person did
 * not expect. Position is not here: the photo is dragged on the sheet itself.
 *
 * ⚠ THE SAME HEIGHT SELECTED OR NOT. With nothing selected it is the same card
 * holding a hint, so pressing a photo never pushes the sheet down.
 */
export function SelectionBar(props: SelectionBarProps) {
  const { count, frame, warning } = props;
  const free = frame?.free === true;
  const hint = !frame
    ? null
    : free
      ? 'Drag the photo anywhere in its cell; zoom below 100% to make it smaller. What falls outside the cell is not printed.'
      : 'Drag the photo on the sheet to move it inside its cell.';

  return (
    <section aria-label="Selected cells" className="flex flex-col gap-1">
      <div
        className={cn(
          'flex min-h-12 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl border bg-card px-2 py-1.5 shadow-sm transition-colors',
          count > 0 ? 'border-primary/40' : 'border-border',
        )}
      >
        {count === 0 ? (
          <p className="flex items-center gap-2 px-1.5 text-sm text-muted-foreground">
            <MousePointerClick aria-hidden="true" className="size-4 shrink-0" />
            {props.idleHint}
          </p>
        ) : (
          <SelectedTools {...props} free={free} />
        )}
      </div>
      {warning ? (
        <p
          role="status"
          className="flex items-start gap-1.5 rounded-lg bg-status-warning px-2.5 py-1.5 text-xs text-status-warning-foreground"
        >
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {warning}
        </p>
      ) : hint ? (
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          {hint}
        </p>
      ) : null}
    </section>
  );
}

function SelectedTools({
  count,
  filled,
  frame,
  free,
  pickedPhoto,
  onZoom,
  onTurn,
  onReset,
  onFree,
  onSelectSamePhoto,
  onSelectAll,
  onPut,
  onClear,
  onDone,
}: SelectionBarProps & { free: boolean }) {
  const zoomId = useId();
  const zoom = frame?.zoom ?? 1;
  const step = (by: number) => {
    if (frame) onZoom(Math.min(zoomFrameBy(frame, by).zoom, SLIDER_ZOOM_MAX));
  };

  return (
    <>
      {/* The count, and the way to let go of the selection. */}
      <span className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/10 pr-1 pl-3 text-xs font-semibold text-primary">
        {count === 1 ? '1 cell' : `${count} cells`}
        <Tooltip text="Deselect (Esc)" describes={false}>
          {(trigger) => (
            <button
              {...trigger}
              type="button"
              aria-label="Deselect"
              className="flex size-6 items-center justify-center rounded-full transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onDone}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </Tooltip>
      </span>

      {frame ? (
        <>
          <Divider />
          <div className="flex items-center gap-0.5">
            <IconButton icon={Minus} label="Zoom out" onClick={() => step(-0.1)} />
            <label htmlFor={zoomId} className="sr-only">
              Zoom
            </label>
            <input
              id={zoomId}
              type="range"
              className="w-24 accent-primary"
              min={zoomFloor(frame)}
              max={SLIDER_ZOOM_MAX}
              step={0.01}
              value={zoom}
              onChange={(event) => onZoom(Number(event.target.value))}
            />
            <IconButton icon={Plus} label="Zoom in" onClick={() => step(0.1)} />
            <span className="w-11 text-center text-xs font-medium tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
          </div>
          <Divider />
          <IconButton icon={RotateCw} label="Turn a quarter" onClick={onTurn} />
          <IconButton icon={RotateCcw} label="Reset: centred, 100%, upright" onClick={onReset} />
          <Divider />
          <Switch
            on={free}
            label="Free placement"
            hint="Move the photo freely inside its cell, and make it smaller than the cell"
            onChange={onFree}
          />
        </>
      ) : null}

      <div className="ml-auto flex items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-accent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            Select
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            {onSelectSamePhoto ? (
              <DropdownMenuItem onSelect={onSelectSamePhoto}>
                <SquareDashed aria-hidden="true" />
                Every cell with this photo
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onSelectAll}>
              <Images aria-hidden="true" />
              Every photo
            </DropdownMenuItem>
            {pickedPhoto ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onPut}>
                  <ImagePlus aria-hidden="true" />
                  <span className="max-w-56 truncate">
                    Put “{pickedPhoto}” in {count === 1 ? 'this cell' : `these ${count} cells`}
                  </span>
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Or hold Ctrl (⌘ on a Mac) or Shift and press cells one by one.
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
        {filled > 0 ? (
          <IconButton
            icon={Trash2}
            label={count === 1 ? 'Empty this cell' : `Empty these ${count} cells`}
            danger
            onClick={onClear}
          />
        ) : null}
      </div>
    </>
  );
}

/** A square icon button with its name as a themed hint. */
function IconButton({
  icon: Icon,
  label,
  danger = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip text={label} describes={false}>
      {(trigger) => (
        <button
          {...trigger}
          type="button"
          aria-label={label}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent',
          )}
          onClick={onClick}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      )}
    </Tooltip>
  );
}

/** An on/off switch with its words beside it: a setting, not an action, so not a button that looks pressed. */
function Switch({
  on,
  label,
  hint,
  onChange,
}: {
  on: boolean;
  label: string;
  hint: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <Tooltip text={hint}>
      {(trigger) => (
        <button
          {...trigger}
          type="button"
          role="switch"
          aria-checked={on}
          className="flex h-8 items-center gap-2 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onChange(!on)}
        >
          <span
            aria-hidden="true"
            className={cn(
              'relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors',
              on ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-3 rounded-full bg-background shadow-sm transition-transform',
                on ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </span>
          {label}
        </button>
      )}
    </Tooltip>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}
