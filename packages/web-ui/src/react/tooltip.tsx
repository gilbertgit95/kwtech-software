'use client';

import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { type TooltipAlign, type TooltipPosition, type TooltipSide, tooltipPosition } from './tooltip-position.js';
import { cn } from './utils.js';

/** How long a pointer rests on the trigger before the hint shows — a pass over it does not flash one. */
export const TOOLTIP_DELAY_MS = 350;

/**
 * What the trigger must spread onto its element.
 *
 * ⚠ A trigger with handlers of its own for the same events must call both: a
 * later `onKeyDown` or `onPointerDown` prop replaces the one spread here.
 */
export interface TooltipTriggerProps {
  'aria-describedby'?: string;
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface TooltipProps {
  /**
   * What the hint says. A line break in it is kept.
   *
   * `null` (or empty) is NO hint: for a control that only has one some of the
   * time, so the caller does not render two copies of its trigger.
   */
  text: string | null;
  /** The edge of the trigger it opens on. Pick the one with room: it does not flip. */
  side?: TooltipSide;
  /** Which part of the trigger it lines up with. `start` / `end` for a trigger near the screen's edge. */
  align?: TooltipAlign;
  /**
   * Whether the text is also the trigger's DESCRIPTION for a screen reader.
   *
   * False when the trigger's own name already says it (an icon button whose
   * `aria-label` is the same words): described as well, it is read out twice.
   */
  describes?: boolean;
  children: (trigger: TooltipTriggerProps) => ReactNode;
}

/**
 * A hint beside a control, drawn in the theme's popover colours — instead of
 * the browser's own `title`, which ignores the theme, cannot be styled, takes
 * over a second to appear and never shows for a keyboard.
 *
 * Dependency-free. It started in `module-note`; the Apps page was the second
 * module to need one, which is when it moved here.
 *
 * - Shows after `TOOLTIP_DELAY_MS` on hover, and at once on KEYBOARD focus
 *   (`:focus-visible`) — never on a click's focus, which would pop it up under
 *   the pointer that just pressed.
 * - A press hides it, so it is not left hanging over something being dragged.
 *   Escape dismisses it (WCAG 1.4.13), and so does anything scrolling.
 * - ⚠ Drawn in a portal on `<body>`, `position: fixed`, never inside the
 *   trigger: a hint inside a scrolling list or a clipped panel is cut off by
 *   it, and one inside a transformed element is placed against that element
 *   rather than the screen.
 * - It adds NO wrapper around the trigger, so it can go on an absolutely
 *   positioned or full-width control without changing its layout.
 * - The text is always in the DOM for a screen reader (`describes`), whether
 *   or not the hint is showing.
 *
 * ⚠ A `disabled` button fires no pointer events, so it shows no hint. A control
 * whose hint explains WHY it is unavailable takes `aria-disabled` instead.
 */
export function Tooltip({ text, side = 'bottom', align = 'center', describes = true, children }: TooltipProps) {
  const id = useId();
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = position !== null;

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = () => {
    cancel();
    setPosition(null);
  };
  const show = () => {
    cancel();
    // Measured when it opens, not when the pointer arrived: the trigger may have moved during the delay.
    const element = anchor.current;
    if (text && element?.isConnected) setPosition(tooltipPosition(element.getBoundingClientRect(), side, align));
  };

  // A pending show must not fire after the trigger is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The hint is fixed to the screen, so a scroll would leave it behind, pointing at nothing.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setPosition(null);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const trigger: TooltipTriggerProps = {
    ...(describes && text ? { 'aria-describedby': id } : {}),
    onPointerEnter: (event) => {
      // A finger has no hover: on touch the press itself is the action, and a hint would only cover it.
      if (event.pointerType === 'touch') return;
      anchor.current = event.currentTarget;
      cancel();
      timer.current = setTimeout(show, TOOLTIP_DELAY_MS);
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (event) => {
      if (!event.currentTarget.matches(':focus-visible')) return;
      anchor.current = event.currentTarget;
      show();
    },
    onBlur: hide,
    onKeyDown: (event) => {
      if (event.key === 'Escape' && open) {
        // Only the hint: an Escape with no hint open still reaches whatever else listens.
        event.stopPropagation();
        hide();
      }
    },
  };

  return (
    <>
      {children(trigger)}
      {/*
       * `hidden`, not `sr-only`: a hidden element is still read as a description
       * when `aria-describedby` points at it, and unlike an sr-only one it takes
       * no box — so it cannot add a scrollbar to a list, or a gap to a flex row.
       */}
      {describes && text ? (
        <span id={id} hidden>
          {text}
        </span>
      ) : null}
      {position && text
        ? createPortal(
            <span
              // The screen reader has the text already, from the trigger's name or its description.
              aria-hidden="true"
              // z-[70]: above the toasts (z-[60]), which carry hints of their own.
              style={{ left: position.left, top: position.top, translate: position.translate }}
              className="pointer-events-none fixed z-[70] w-max max-w-60 animate-in whitespace-pre-line rounded-md border border-border bg-popover px-2.5 py-1.5 font-sans text-xs leading-snug font-normal text-popover-foreground shadow-md shadow-foreground/10 fade-in-0 motion-reduce:animate-none"
            >
              {/* The arrow: the hint's own colours, a rotated square tucked under the edge facing the trigger. */}
              <span
                className={cn(
                  'absolute size-2 rotate-45 border-border bg-popover',
                  ARROW_SIDE[side],
                  arrowAlign(side, align),
                )}
              />
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

/** The arrow sits on the hint's edge that FACES the trigger, showing the two borders that point at it. */
const ARROW_SIDE: Record<TooltipSide, string> = {
  bottom: '-top-1 border-t border-l',
  top: '-bottom-1 border-r border-b',
  right: '-left-1 border-b border-l',
  left: '-right-1 border-t border-r',
};

function arrowAlign(side: TooltipSide, align: TooltipAlign): string {
  const horizontal = side === 'top' || side === 'bottom';
  switch (align) {
    case 'start':
      return horizontal ? 'left-3' : 'top-2';
    case 'center':
      return horizontal ? 'left-1/2 -translate-x-1/2' : 'top-1/2 -translate-y-1/2';
    case 'end':
      return horizontal ? 'right-3' : 'bottom-2';
  }
}
