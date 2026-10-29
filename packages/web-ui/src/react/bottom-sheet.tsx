'use client';

import { X } from 'lucide-react';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
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
  const drag = useRef<{ startY: number } | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) setDragY(0);
  }, [open]);

  /*
   * SWIPE DOWN TO CLOSE, from the handle and the title: the gesture a phone
   * user already tries on any sheet. Only downwards, and only from the top
   * strip — dragging inside the list must scroll it, not move the sheet.
   * Past SWIPE_CLOSE_PX it closes; short of it, it springs back.
   */
  const dragHandlers = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      // The close button is in this strip; a press there is a press, not the start of a drag.
      if ((event.target as HTMLElement).closest('button')) return;
      drag.current = { startY: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      setDragY(Math.max(0, event.clientY - drag.current.startY));
    },
    onPointerUp: () => {
      if (!drag.current) return;
      drag.current = null;
      if (dragY > SWIPE_CLOSE_PX) onClose();
      else setDragY(0);
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragY(0);
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
      style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      className={cn(
        'fixed inset-x-0 top-auto bottom-0 m-0 max-h-[88dvh] w-full max-w-none rounded-t-3xl border-t border-border/60 bg-card p-0 text-card-foreground shadow-2xl',
        // A tablet: a card floating above the bottom edge, not a strip the width of the screen.
        'md:mx-auto md:bottom-6 md:max-w-lg md:rounded-3xl md:border',
        'backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
        // Rises on open — the animation replays whenever the dialog goes from hidden to shown.
        'open:animate-in open:slide-in-from-bottom open:duration-300 open:ease-out motion-reduce:open:animate-none',
        dragY ? null : 'transition-transform duration-200 ease-out',
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
