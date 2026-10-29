'use client';

import { BottomSheet, BottomSheetRow, cn } from '@kwtech/web-ui/react';
import { ChevronLeft } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * The phone frame's sheets — the account, the workspace switcher — are
 * web-ui's `BottomSheet`, the one every module's phone screen uses too, so
 * every sheet on a phone looks and behaves the same (swipe to close, a card
 * on a tablet). Named for the frame's own use.
 */
export const MobileSheet = BottomSheet;

/** One row of a sheet. See `BottomSheetRow`. */
export const SheetRow = BottomSheetRow;

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
          <div className="mx-auto flex h-14 max-w-lg items-center gap-1 px-2 md:max-w-2xl">
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
          <div className="mx-auto w-full max-w-lg md:max-w-2xl px-4 pt-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}
