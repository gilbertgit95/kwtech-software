'use client';

import { cn } from '@kwtech/web-ui/react';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { type PopoverAlign, type PopoverPlacement, popoverPlacement } from '../view/popover.js';

/** Why a popover closed: only a key hands the focus back to the trigger. */
export type PopoverCloseReason = 'key' | 'outside';

/**
 * The floating box under a trigger: the select's list and the date picker's
 * calendar. It only places itself and knows when to go away; what is in it, and
 * where the focus goes, is the caller's.
 *
 * - ⚠ Drawn in a portal, `position: fixed`, never inside the trigger — the
 *   tooltip's reasoning: the task panel and every dialog scroll, and a list
 *   inside one of them is cut off at its edge. The app's root is also an
 *   `@container`, which is the containing block of anything fixed inside it.
 * - ⚠ The portal goes into the trigger's own `<dialog>` when it has one, not
 *   `<body>`. A modal dialog is in the browser's top layer and makes the rest
 *   of the page inert, so a list on `<body>` would open BEHIND the dialog and
 *   could not be clicked. That is also why this is not Radix's dropdown (as
 *   `web-ui`'s menu is): its portal always goes to `<body>`.
 * - Placed by `popoverPlacement`: below the trigger, or above when there is no
 *   room, measured when it opens.
 * - Closes on Escape, on a press anywhere else, and on anything scrolling or
 *   resizing — it is fixed to the screen, so a scroll would leave it behind,
 *   pointing at nothing.
 * - ⚠ Escape stops here. Without that the same key would also close the dialog
 *   the select is in, or put the task panel away.
 *
 * Kept in this module and not in `web-ui` because nothing else uses it yet
 * (frontend rules: a second consumer first).
 */
export function Popover({
  open,
  anchor,
  onClose,
  align = 'start',
  matchWidth = false,
  className,
  children,
  ...rest
}: {
  open: boolean;
  /** The trigger: what the popover hangs off, and what a press on does not count as "elsewhere". */
  anchor: RefObject<HTMLElement | null>;
  onClose: (reason: PopoverCloseReason) => void;
  align?: PopoverAlign;
  /** At least as wide as the trigger — a select's list. */
  matchWidth?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
  role?: 'dialog' | 'listbox';
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<(PopoverPlacement & { minWidth: number }) | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Measured before the browser paints, so it is never seen at the corner it is measured in.
  useLayoutEffect(() => {
    const box = ref.current;
    const trigger = anchor.current;
    if (!open || !box || !trigger) {
      setPlacement(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const minWidth = matchWidth ? rect.width : 0;
    const size = box.getBoundingClientRect();
    setPlacement({
      ...popoverPlacement(
        rect,
        { width: Math.max(size.width, minWidth), height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
        align,
      ),
      minWidth,
    });
  }, [open, anchor, align, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (ref.current?.contains(target) || anchor.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) close.current('outside');
    };
    // Its own list scrolling is not the page scrolling.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target))) close.current('outside');
    };
    const onResize = () => close.current('outside');
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, anchor]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    // preventDefault as well: it is what keeps a <dialog> from closing on the same key.
    event.preventDefault();
    event.stopPropagation();
    onClose('key');
  };

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the key handler only catches Escape from the controls inside; the box itself is never focused.
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      style={
        placement
          ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight, minWidth: placement.minWidth }
          : // ⚠ Transparent, not `visibility: hidden`, while it is measured: a hidden element cannot take the focus the caller gives it on opening.
            { left: 0, top: 0, opacity: 0, pointerEvents: 'none' }
      }
      className={cn(
        // z-50: above the task panel slid over the board (z-10), as `web-ui`'s menu is.
        'fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg shadow-foreground/10',
        className,
      )}
      {...rest}
    >
      {children}
    </div>,
    anchor.current?.closest('dialog') ?? document.body,
  );
}
