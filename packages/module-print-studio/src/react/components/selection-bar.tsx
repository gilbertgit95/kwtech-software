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
  ImagePlus,
  Images,
  type LucideIcon,
  Minus,
  MousePointerClick,
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  SquareDashed,
  SquareDashedMousePointer,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { type MouseEvent, type PointerEvent, useEffect, useId, useRef } from 'react';
import { type StudioFrame, zoomFloor, zoomFrameBy } from '../../domain/slot-fit.js';
import { sliderAtZoom, ZOOM_SLIDER_STEPS, zoomAtSlider } from '../view/zoom-slider.js';

/** Where the zoom slider stops. Past it a photo is mostly a blur; the keys still go to `STUDIO_ZOOM_MAX`. */
const SLIDER_ZOOM_MAX = 4;
/**
 * Where the slider starts for a freely placed photo. Below a tenth of its cell
 * a photo is a speck, and a slider that reached down to `STUDIO_FREE_ZOOM_MIN`
 * would spend a third of its track there; the buttons still go all the way.
 */
const SLIDER_FREE_ZOOM_MIN = 0.1;
/** What one press of − or + changes: a point of zoom. A tenth at a time, no photo could be set to a chosen size. */
const BUTTON_ZOOM_STEP = 0.01;
/** A held − or + waits this long, then repeats this often: a point a press, about twenty points a second held. */
const HOLD_DELAY_MS = 350;
const HOLD_EVERY_MS = 50;

export interface SelectionBarProps {
  /** How many cells are selected; 0 shows the bar's resting hint. */
  count: number;
  /** How many of the selected cells hold a photo. */
  filled: number;
  /** The frame of the cell pressed last, or null when that cell is empty. */
  frame: StudioFrame | null;
  /** Why the pressed photo may print badly, as a sentence; null when it will not. */
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
 * The selection's toolbar: a rail of icons down the LEFT edge of the sheet's
 * card (the operator, 2026-10-07).
 *
 * ## ⚠ A RAIL, NOT A ROW
 *
 * Height is what the sheet is short of: a portrait page in a landscape panel
 * has room to spare on both sides and none above or below. As a strip along
 * the top this toolbar took its height from the sheet; down the side it takes
 * width the sheet was not using. So every control is an icon with its name as
 * a hint to the right of it, and the zoom slider stands upright.
 *
 * ⚠ EVERY ACTION HERE APPLIES TO EVERY SELECTED CELL. The count comes first,
 * as the button the selection is let go from, so nothing moves that the person
 * did not expect. Position is not here: the photo is dragged on the sheet.
 *
 * ⚠ THE SAME WIDTH SELECTED OR NOT. With nothing selected it is the same rail
 * holding one icon whose hint says what to do, so pressing a photo never moves
 * the sheet sideways.
 *
 * The blurry warning is an icon in the rail, with its whole sentence as the
 * hint; floated over the sheet instead, it covered the very photo it was
 * about.
 */
export function SelectionBar(props: SelectionBarProps) {
  const { count } = props;
  const free = props.frame?.free === true;

  return (
    <section
      aria-label="Selected cells"
      className={cn(
        // Scrolls by itself, with no bar drawn, on a panel too short for every control: none is ever out of reach.
        'flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border py-2 transition-colors [scrollbar-width:none]',
        count > 0 ? 'bg-primary/5' : null,
      )}
    >
      {count === 0 ? (
        <Tooltip text={props.idleHint} side="right">
          {(trigger) => (
            <button
              {...trigger}
              type="button"
              aria-label="How to work on a photo"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MousePointerClick aria-hidden="true" className="size-4" />
            </button>
          )}
        </Tooltip>
      ) : (
        <SelectedTools {...props} free={free} />
      )}
    </section>
  );
}

function SelectedTools({
  count,
  filled,
  frame,
  free,
  warning,
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
  const sliderMin = frame && !free ? zoomFloor(frame) : SLIDER_FREE_ZOOM_MIN;
  const step = (by: number) => {
    if (frame) onZoom(Math.min(zoomFrameBy(frame, by).zoom, SLIDER_ZOOM_MAX));
  };
  const zoomOut = useHeldRepeat(() => step(-BUTTON_ZOOM_STEP));
  const zoomIn = useHeldRepeat(() => step(BUTTON_ZOOM_STEP));
  const selected = count === 1 ? '1 cell selected' : `${count} cells selected`;

  return (
    <>
      {/* The count, and the way to let go of the selection: under the pointer or the focus, the number becomes the ×. */}
      <Tooltip text={`${selected}. Press to deselect (Esc)`} side="right" describes={false}>
        {(trigger) => (
          <button
            {...trigger}
            type="button"
            aria-label={`${selected}. Deselect`}
            className="group flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onDone}
          >
            <span aria-hidden="true" className="group-hover:hidden group-focus-visible:hidden">
              {count}
            </span>
            <X aria-hidden="true" className="hidden size-4 group-hover:block group-focus-visible:block" />
          </button>
        )}
      </Tooltip>

      {frame ? (
        <>
          <Divider />
          {/* + above −, as the slider between them reads: up is larger. */}
          <IconButton icon={Plus} label="Zoom in" held={zoomIn} />
          <label htmlFor={zoomId} className="sr-only">
            Zoom
          </label>
          <input
            id={zoomId}
            type="range"
            // Upright, its larger end at the top: the two properties together are how a browser draws a range that way.
            className="h-16 w-4 shrink-0 accent-primary [direction:rtl] [writing-mode:vertical-lr]"
            min={0}
            max={ZOOM_SLIDER_STEPS}
            step={1}
            value={sliderAtZoom(zoom, sliderMin, SLIDER_ZOOM_MAX)}
            // The thumb's place is not the zoom (the scale is proportional): say the zoom.
            aria-valuetext={`${Math.round(zoom * 100)}%`}
            onChange={(event) => onZoom(zoomAtSlider(Number(event.target.value), sliderMin, SLIDER_ZOOM_MAX))}
          />
          <IconButton icon={Minus} label="Zoom out" held={zoomOut} />
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Divider />
          <IconButton icon={RotateCw} label="Turn a quarter" onClick={onTurn} />
          <IconButton icon={RotateCcw} label="Reset: centred, 100%, upright" onClick={onReset} />
          <Divider />
          <Toggle
            on={free}
            icon={Move}
            label="Free placement"
            hint={
              free
                ? 'Free placement is on: drag the photo anywhere in its cell, and zoom below 100% to make it smaller. What falls outside the cell is not printed.'
                : 'Free placement is off: drag the photo on the sheet to move it inside its cell. Turn this on to move it freely and make it smaller than the cell.'
            }
            onChange={onFree}
          />
        </>
      ) : null}

      {warning ? (
        // Not the icon's description as well: the status inside it already says the sentence once.
        <Tooltip text={warning} side="right" describes={false}>
          {(trigger) => (
            <button
              {...trigger}
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-status-warning text-status-warning-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TriangleAlert aria-hidden="true" className="size-4" />
              {/* Said as it appears, in full, to somebody who cannot hover over the icon. */}
              <span role="status" className="sr-only">
                {warning}
              </span>
            </button>
          )}
        </Tooltip>
      ) : null}

      {/* mt-auto: what acts on the cells themselves sits at the rail's foot, apart from what acts on the photo. */}
      <div className="mt-auto flex flex-col items-center gap-1 pt-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Select more cells"
            title="Select more cells"
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <SquareDashedMousePointer aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="right" className="min-w-60">
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

/** What a button that repeats while it is held spreads onto itself. */
interface HeldRepeatProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * An act done once on a press and again and again while the press is held, so
 * a small step is still a quick way across a long range.
 *
 * ⚠ THE PRESS ACTS, NOT THE CLICK that follows it, or every press would step
 * twice. A click with no press before it (Enter or Space, a screen reader)
 * says so with `detail` 0, and that one acts.
 *
 * ⚠ IT READS THE LATEST `act` THROUGH A REF: each step re-renders the bar with
 * a new frame, and a repeat holding the first one would step from the same
 * zoom forever.
 */
function useHeldRepeat(act: () => void): HeldRepeatProps {
  const latest = useRef(act);
  latest.current = act;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // A button that goes away mid-press (the cell emptied by a key) must not keep stepping.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      stop();
      latest.current();
      const again = () => {
        latest.current();
        timer.current = setTimeout(again, HOLD_EVERY_MS);
      };
      timer.current = setTimeout(again, HOLD_DELAY_MS);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (event) => {
      if (event.detail === 0) latest.current();
    },
  };
}

/** A square icon button with its name as a themed hint. Given `held`, it repeats while pressed instead of clicking once. */
function IconButton({
  icon: Icon,
  label,
  danger = false,
  onClick,
  held,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick?: () => void;
  held?: HeldRepeatProps;
}) {
  return (
    <Tooltip text={label} side="right" describes={false}>
      {(trigger) => (
        <button
          {...trigger}
          type="button"
          aria-label={label}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent',
          )}
          onClick={held ? held.onClick : onClick}
          // The hint's own handlers for the same events still run: a later prop replaces the one spread above.
          onPointerDown={(event) => {
            trigger.onPointerDown();
            held?.onPointerDown(event);
          }}
          onPointerLeave={() => {
            trigger.onPointerLeave();
            held?.onPointerLeave();
          }}
          onPointerUp={held?.onPointerUp}
          onPointerCancel={held?.onPointerCancel}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      )}
    </Tooltip>
  );
}

/**
 * An on/off setting as one icon: lit while it is on. Still a `switch` to a
 * screen reader — it is a setting, not an action — and its hint says which
 * way it is now, since an icon alone cannot.
 */
function Toggle({
  on,
  icon: Icon,
  label,
  hint,
  onChange,
}: {
  on: boolean;
  icon: LucideIcon;
  label: string;
  hint: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <Tooltip text={hint} side="right">
      {(trigger) => (
        <button
          {...trigger}
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-accent',
          )}
          onClick={() => onChange(!on)}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      )}
    </Tooltip>
  );
}

/** A short rule across the rail, between two groups of controls. */
function Divider() {
  return <span aria-hidden="true" className="my-0.5 h-px w-5 shrink-0 bg-border" />;
}
