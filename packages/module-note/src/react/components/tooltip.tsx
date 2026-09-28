'use client';

import { cn } from '@kwtech/web-ui/react';
import { type FocusEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

/** How long a pointer rests on the trigger before the hint shows — a pass over it does not flash one. */
export const TOOLTIP_DELAY_MS = 350;

/** What the trigger must spread onto its element. */
export interface TooltipTriggerProps {
  'aria-describedby': string;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * A hint under a control, drawn in the theme's popover colours.
 *
 * Module-local, and dependency-free: the app's sidebar keeps the native `title`
 * rather than add Radix for one hint, and a second module needing this is when
 * it moves to `@kwtech/web-ui` (PLAN §9 rule 8).
 *
 * - Shows after `TOOLTIP_DELAY_MS` on hover, and at once on KEYBOARD focus
 *   (`:focus-visible`) — never on a click's focus, which would pop it up under
 *   the pointer that just pressed.
 * - Escape dismisses it (WCAG 1.4.13); it stays open while the pointer is on
 *   the trigger.
 * - The text is always in the DOM, `role="tooltip"`, and the trigger's
 *   `aria-describedby` — a screen reader reads it whether or not it is shown.
 * - ⚠ It opens DOWNWARDS and aligns to the trigger's `align` edge, so it stays
 *   inside a clipped page: the triggers it serves sit in the page's top bar.
 */
export function Tooltip({
  text,
  align = 'end',
  children,
}: {
  text: string;
  align?: 'start' | 'end';
  children: (trigger: TooltipTriggerProps) => ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = () => {
    cancel();
    setOpen(false);
  };

  // A pending show must not fire after the trigger is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const trigger: TooltipTriggerProps = {
    'aria-describedby': id,
    onPointerEnter: () => {
      cancel();
      timer.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS);
    },
    onPointerLeave: hide,
    onFocus: (event) => {
      if (event.currentTarget.matches(':focus-visible')) setOpen(true);
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
    <span className="relative inline-flex">
      {children(trigger)}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute top-full z-30 mt-2 w-max max-w-60 rounded-md border border-border bg-popover px-2.5 py-1.5 font-sans text-xs leading-snug text-popover-foreground shadow-md shadow-foreground/10 transition-opacity duration-150 motion-reduce:transition-none',
          align === 'end' ? 'right-0' : 'left-0',
          open ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        {/* The arrow: the tooltip's own colours, a rotated square tucked under its top edge. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute -top-1 size-2 rotate-45 border-t border-l border-border bg-popover',
            align === 'end' ? 'right-3' : 'left-3',
          )}
        />
        {text}
      </span>
    </span>
  );
}
