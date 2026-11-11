'use client';

import { X } from 'lucide-react';
import { type PointerEvent, type ReactNode, useEffect, useRef } from 'react';
import { cn } from './utils.js';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's heading, and its accessible name. */
  title: string;
  children: ReactNode;
  /** Kept in view below the scrolling body: the sheet's own buttons (Clear, Done). */
  footer?: ReactNode;
}

/**
 * A panel that slides up from the bottom of a phone's screen (issue #22): an
 * account menu, a list of actions, a set of filters. On a tablet it floats as
 * a card above the bottom edge instead of a strip the width of the screen.
 *
 * A native modal `<dialog>`, not a positioned div. `showModal()` gives what a
 * hand-built overlay has to remember and usually forgets: focus moves in and
 * is trapped, Esc closes it, the page behind is inert to taps and screen
 * readers, and it sits above everything without a z-index — including above
 * the phone frame's bars, which is why a module's phone screen may use it.
 *
 * Swipe down to close, from the handle and the title. Shared by the phone
 * frame and every module's phone screens (notes, tasks, the inbox's filters),
 * so every sheet on a phone looks and behaves the same.
 */
export function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ startY: number; distance: number } | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    // A sheet closed mid-drag (Esc, a parent closing it) opens next time where it belongs.
    if (!open) placeSheet(element, 0, false);
  }, [open]);

  /*
   * SWIPE DOWN TO CLOSE, from the handle and the title: the gesture a phone
   * user already tries on any sheet. Only downwards, and only from the top
   * strip — dragging inside the list must scroll it, not move the sheet.
   * Past SWIPE_CLOSE_PX it closes; short of it, it springs back.
   *
   * ⚠ The drag moves the element's style DIRECTLY, never through React state
   * (#131). A state update per pointer move re-rendered the sheet and every
   * row in it about 60 times a second, and the sheet lagged behind the finger
   * on a phone. The distance lives in the ref, so letting go reads where the
   * finger really was, not the distance of the last render.
   */
  const dragHandlers = {
    /** Starts a drag from the handle strip, unless the press is on its close button. */
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      // The close button is in this strip; a press there is a press, not the start of a drag.
      if ((event.target as HTMLElement).closest('button')) return;
      drag.current = { startY: event.clientY, distance: 0 };
      event.currentTarget.setPointerCapture(event.pointerId);
      /*
       * A swipe that starts while the sheet is still rising: end the rise
       * where it was headed. A running animation outranks the inline
       * transform, so without this the sheet ignored the finger for what
       * was left of the 280 ms.
       */
      if (dialog.current) finishRise(dialog.current);
    },
    /** Moves the sheet with the finger, downwards only. */
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const element = dialog.current;
      if (!drag.current || !element) return;
      drag.current.distance = Math.max(0, event.clientY - drag.current.startY);
      placeSheet(element, drag.current.distance, false);
    },
    /** Closes the sheet past the threshold, or springs it back. */
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const element = dialog.current;
      const released = drag.current;
      drag.current = null;
      if (!released || !element) return;
      // Measured at the release, not the last move: a browser coalesces moves,
      // and a quick flick past the threshold could otherwise spring back.
      const distance = Math.max(0, event.clientY - released.startY);
      if (distance > SWIPE_CLOSE_PX) onClose();
      else placeSheet(element, 0, true);
    },
    /** The browser took the pointer (a scroll, a system gesture): spring back, never close. */
    onPointerCancel: () => {
      drag.current = null;
      if (dialog.current) placeSheet(dialog.current, 0, true);
    },
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click below only detects a backdrop press; its keyboard equivalent is Escape, which <dialog> handles itself. `ConfirmDialog`'s reasoning.
    <dialog
      ref={dialog}
      aria-label={title}
      // Esc and the browser's own close both arrive here; the parent's state follows.
      onClose={onClose}
      // A tap on the backdrop lands on the dialog element itself, never on its content.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        'fixed inset-x-0 top-auto bottom-0 m-0 max-h-[88dvh] w-full max-w-none rounded-t-3xl border-t border-border/60 bg-card p-0 text-card-foreground shadow-xl',
        // A tablet: a card floating above the bottom edge, not a strip the width of the screen.
        'md:mx-auto md:bottom-6 md:max-w-lg md:rounded-3xl md:border',
        /*
         * A plain dim backdrop that fades in with the rise. ⚠ No backdrop
         * blur (#131): the phone re-blurred the whole page behind the sheet
         * on every frame of the animation, for a 2px blur nobody could see,
         * and that was most of the lag on opening.
         */
        'backdrop:bg-black/40 backdrop:animate-sheet-fade motion-reduce:backdrop:animate-none',
        /*
         * Rises on open — the animation replays whenever the dialog goes from
         * hidden to shown. Transform only (base.css says why not tw-animate),
         * and `will-change` puts the sheet on its own GPU layer before the
         * first frame, so neither the rise nor a drag repaints it.
         */
        'open:animate-sheet-rise open:will-change-transform motion-reduce:open:animate-none',
      )}
    >
      <div className="flex max-h-[88dvh] flex-col pb-[env(safe-area-inset-bottom)]">
        <div {...dragHandlers} className="shrink-0 touch-none select-none px-4 pt-2.5 pb-2">
          {/* The handle: says "this can be pulled down" before anybody tries. */}
          <span aria-hidden className="mx-auto block h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-2">{children}</div>
        {footer ? <div className="shrink-0 border-t border-border/60 px-4 py-3">{footer}</div> : null}
      </div>
    </dialog>
  );
}

/** How far a sheet is pulled down before letting go closes it. About a third of a short sheet. */
const SWIPE_CLOSE_PX = 90;

/**
 * Moves the sheet `distance` pixels down from where it rests, written straight
 * to its style (see the drag handlers for why not state). `spring` animates the
 * move, for the return when a drag is let go short of closing; while the finger
 * is down it follows with no transition, or it would trail behind. Someone who
 * asked for reduced motion gets no spring: the inline transition is out of
 * reach of the `motion-reduce:` classes, so it asks the media query itself.
 */
function placeSheet(element: HTMLElement, distance: number, spring: boolean) {
  element.style.transition = spring && !prefersReducedMotion() ? 'transform 200ms ease-out' : '';
  element.style.transform = distance > 0 ? `translate3d(0, ${distance}px, 0)` : '';
}

/** Whether the viewer asked the system for less motion. False where the query cannot be asked. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Ends the sheet's own rise at its resting place, so a drag can move it. Only
 * the dialog's animations (`getAnimations()` without `subtree`): the backdrop's
 * fade carries on. `getAnimations` is guarded because jsdom has none.
 */
function finishRise(element: HTMLElement) {
  if (typeof element.getAnimations !== 'function') return;
  for (const animation of element.getAnimations()) animation.finish();
}

/** One row of a sheet: a large target with an icon tile. A link, or a button when `onClick` is given. */
export function BottomSheetRow({
  icon,
  label,
  detail,
  href,
  onClick,
  current = false,
  tone = 'default',
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  detail?: string | null | undefined;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  current?: boolean;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) {
  const className = cn(
    'flex min-h-14 w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left text-[0.9375rem] transition-all active:scale-[0.99]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
    tone === 'danger' ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent',
    current ? 'bg-accent font-medium' : null,
  );
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-xl',
          tone === 'danger' ? 'bg-destructive/10' : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </>
  );

  if (onClick || !href) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={className}
        aria-current={current ? 'true' : undefined}
      >
        {body}
      </button>
    );
  }
  return (
    <a href={href} className={className} aria-current={current ? 'page' : undefined}>
      {body}
    </a>
  );
}
