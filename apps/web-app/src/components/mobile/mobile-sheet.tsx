'use client';

import { cn } from '@kwtech/web-ui/react';
import { ChevronLeft, X } from 'lucide-react';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * A panel that slides up from the bottom of a phone's screen: the account,
 * the workspace switcher, the tabs that did not fit (issue #22).
 *
 * A native modal `<dialog>`, not a positioned div. `showModal()` gives what a
 * hand-built overlay has to remember and usually forgets: focus moves in and
 * is trapped, Esc closes it, the page behind is inert to taps and screen
 * readers, and it sits above everything without a z-index.
 *
 * ⚠ The phone FRAME's, never a screen's. A screen stays inside its box, as a
 * sub-app does; this belongs to the bars around the screens, which own the
 * whole viewport.
 */
export function MobileSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
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
      </div>
    </dialog>
  );
}

/**
 * A FULL-SCREEN panel over the phone frame, sliding in from the right, with
 * "‹ Back" to return (issue #22): the account's Profile, Password and Display,
 * opened from the account sheet. Taller than a sheet because they hold forms,
 * and a keyboard rising under a half-height sheet leaves no room to type.
 *
 * A native modal `<dialog>`, as the sheet is, for the same reasons: focus
 * moves in and stays, Esc closes it, the page behind is inert.
 */
export function MobilePanel({
  open,
  onClose,
  title,
  backLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What "‹ …" returns to: "Account". */
  backLabel: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onClose}
      className={cn(
        'fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground',
        'backdrop:bg-black/40',
        'open:animate-in open:slide-in-from-right open:duration-300 open:ease-out motion-reduce:open:animate-none',
      )}
    >
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b border-border/60 bg-card/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-lg items-center gap-1 px-2">
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-full pr-2.5 pl-1 text-sm font-medium text-primary transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft aria-hidden className="size-5" />
              {backLabel}
            </button>
            <h2 className="truncate text-base font-semibold tracking-tight text-foreground">{title}</h2>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-lg px-4 pt-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** How far a sheet is pulled down before letting go closes it. About a third of a short sheet. */
const SWIPE_CLOSE_PX = 90;

/** One row of a sheet: a link, or a button when `onClick` is given. Large enough for a thumb. */
export function SheetRow({
  icon,
  label,
  detail,
  href,
  onClick,
  current = false,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  detail?: string | null;
  href?: string;
  onClick?: () => void;
  current?: boolean;
  tone?: 'default' | 'danger';
}) {
  const className = cn(
    'flex min-h-14 w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left text-[0.9375rem] transition-all active:scale-[0.99]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} aria-current={current ? 'true' : undefined}>
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
