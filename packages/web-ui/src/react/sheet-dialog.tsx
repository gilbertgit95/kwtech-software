'use client';

import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from './utils.js';

/**
 * The frame the import wizard and the export dialog share: a native modal
 * `<dialog>`, as `ConfirmDialog` is, and for the same reasons — the top layer,
 * a focus trap and Escape come from the platform. Read `confirm-dialog.tsx` for
 * why each class is there; the two must not drift.
 *
 * Not exported: a third caller is the moment to make it a component of its own.
 */
export function SheetDialog({
  open,
  title,
  busy = false,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  /** While true, Escape, the backdrop and × do nothing: an import is not interrupted halfway. */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: only a backdrop press; its keyboard equivalent is Escape, handled as `cancel`.
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !busy) onClose();
      }}
      className={cn(
        // `m-auto` is the centring Tailwind's Preflight removes (confirm-dialog.tsx).
        'm-auto w-[calc(100%-2rem)] max-w-2xl rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg',
        'max-h-[calc(100dvh-2rem)] backdrop:bg-black/40 backdrop:backdrop-blur-[1px]',
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            <h2 id={titleId} className="text-base font-medium">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        </div>
      ) : null}
    </dialog>
  );
}

/** The dialogs' buttons: the main one, and the rest. */
export function sheetButtonClass(variant: 'primary' | 'secondary'): string {
  return cn(
    'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
    variant === 'primary'
      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
      : 'border border-border hover:bg-accent',
  );
}
