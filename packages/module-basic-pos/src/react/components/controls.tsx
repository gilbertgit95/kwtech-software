'use client';

import { cn } from '@kwtech/web-ui/react';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

/*
 * The POS's controls — module-task's, copied structurally: a module never
 * imports another, and these move to `web-ui` only when a third copy appears.
 */

/** The app's buttons, as a function over a union rather than a variant library. */
export function buttonClass(
  variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary',
  size: 'sm' | 'md' = 'md',
) {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 px-3 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-card hover:bg-accent hover:text-accent-foreground',
    variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
    variant === 'danger' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  );
}

/** The shared look of a text input and a select. */
export const INPUT_CLASS =
  'h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A modal, drawn by the browser's own `<dialog>` so it is in the top layer and
 * traps focus — `ConfirmDialog`'s reasoning. `showModal()` rather than the
 * `open` attribute, which renders inline with no backdrop and no Escape.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click below only detects a backdrop press; its keyboard equivalent is Escape, which <dialog> handles itself. `ConfirmDialog`'s reasoning.
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // Clicking the backdrop targets the <dialog> itself; clicking anything inside targets a descendant.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-foreground/40',
        wide ? 'max-w-xl' : 'max-w-md',
      )}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-5">
          {/*
           * ⚠ Every dialog has a visible way out. Board settings had none —
           * only Escape, which nobody guesses (the operator, 2026-09-28).
           * Closing goes through `dialog.close()`, so it reaches `onClose`
           * exactly as Escape does: one path.
           */}
          <header className="flex items-start justify-between gap-2">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <button
              type="button"
              className={cn(buttonClass('ghost', 'sm'), '-mr-2 shrink-0')}
              onClick={() => ref.current?.close()}
            >
              <X aria-hidden="true" className="size-4" />
              Close
            </button>
          </header>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/** A labelled field; the error replaces the hint. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const noteId = useId();
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id, note ? noteId : undefined)}
      {note ? (
        <p
          id={noteId}
          role={error ? 'alert' : undefined}
          className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
