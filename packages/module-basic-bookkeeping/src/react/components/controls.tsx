'use client';

import { cn } from '@kwtech/web-ui/react';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/*
 * The books' controls — the point of sale's, copied structurally: a module
 * never imports another. ⚠ This is the THIRD copy (tasks, POS, books), which is
 * the point at which they move to `web-ui`; that move is PLAN §12.87, not
 * done as a side effect of this module.
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
 *
 * ⚠ THE CONTENT MOUNTS AFTER `showModal()`, NOT WITH IT, so `autoFocus` inside
 * a dialog works. React does not write an `autofocus` attribute — it calls
 * `.focus()` when the element mounts — and inside a dialog still closed that
 * does nothing; `showModal()` then gave the focus to the first focusable
 * thing, the Close button. Every dialog opened on Close instead of the box
 * the person was about to type in (the operator, 2026-10-02). A layout
 * effect, so the empty dialog is never painted.
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
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  /** True once the dialog is really open: only then does the content mount (see above). */
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    setShown(open);
  }, [open]);
  // A dialog with nothing to type in or choose first (the key list) still gives focus a home (D20): its way out.
  useEffect(() => {
    if (shown && document.activeElement === ref.current) closeRef.current?.focus();
  }, [shown]);
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
        'm-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg',
        // ⚠ A BLACK backdrop, never the theme's foreground: on a dark theme the foreground is light, so it lit the page up behind the dialog instead of dimming it (the operator, 2026-10-03). As `ConfirmDialog`.
        'backdrop:bg-black/50',
        wide ? 'max-w-xl' : 'max-w-md',
      )}
    >
      {open && shown ? (
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
              ref={closeRef}
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
  hint?: string | undefined;
  error?: string | null | undefined;
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
