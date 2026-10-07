'use client';

import { cn } from '@kwtech/web-ui/react';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { buttonClass } from '../ui.js';

/**
 * A dialog for a small task done in place: pairing a computer, a test print.
 *
 * The native `<dialog>`, as `ConfirmDialog` in `web-ui` is: it traps focus,
 * closes on Escape and dims the page with no code of ours. `web-ui` has only
 * the confirm kind (a question and two buttons); this one holds a form. It
 * moves there when a second module needs it.
 *
 * ⚠ `busy` keeps it open: a dialog closed mid-request leaves the person not
 * knowing whether the thing happened.
 */
export function Modal({
  open,
  title,
  description,
  busy = false,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only detects a press on the backdrop; its keyboard equivalent is Escape, which <dialog> raises as `cancel`.
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      // A press on the backdrop targets the <dialog> itself; anything inside targets a descendant.
      onClick={(event) => {
        if (event.target === ref.current && !busy) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-xl',
        'max-h-[calc(100dvh-4rem)] overflow-y-auto',
        'backdrop:bg-black/40 backdrop:backdrop-blur-[1px]',
      )}
    >
      {/* Rendered only while open: a closed dialog's form must not keep what was typed into it. */}
      {open ? (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Close"
              className={cn(buttonClass('ghost', 'sm'), '-mr-1.5 -mt-1 size-8 px-0')}
              disabled={busy}
              onClick={onClose}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          {children}
          {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
