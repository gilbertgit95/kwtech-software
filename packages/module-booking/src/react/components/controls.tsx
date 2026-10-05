'use client';

import { cn } from '@kwtech/web-ui/react';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/*
 * The booking app's controls — the point of sale's, copied structurally: a
 * module never imports another, and these move to `web-ui` only when the
 * copies start to differ in a way that matters.
 */

/** The app's buttons, as a function over a union rather than a variant library. */
export function buttonClass(
  variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary',
  size: 'sm' | 'md' = 'md',
) {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-4 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-card shadow-xs hover:bg-accent hover:text-accent-foreground',
    variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
    variant === 'danger' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  );
}

/** The shared look of a text input and a select. */
export const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** A dialog's row of buttons, set off from the fields above it. */
export const FORM_FOOTER_CLASS = '-mx-5 -mb-5 mt-1 flex justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3';

/**
 * A modal, drawn by the browser's own `<dialog>` so it is in the top layer and
 * traps focus — `ConfirmDialog`'s reasoning. `showModal()` rather than the
 * `open` attribute, which renders inline with no backdrop and no Escape.
 *
 * ⚠ THE CONTENT MOUNTS AFTER `showModal()`, NOT WITH IT, so `autoFocus` inside
 * a dialog works. React does not write an `autofocus` attribute — it calls
 * `.focus()` when the element mounts — and inside a dialog still closed that
 * does nothing; `showModal()` then gives the focus to the first focusable
 * thing, the Close button. A layout effect, so the empty dialog is never
 * painted.
 *
 * ## ⚠ IT NEVER CLOSES ON WHAT SOMEBODY HAS TYPED (the operator, 2026-10-05)
 *
 * Every dialog here is a FORM, and a form that closes by accident throws away
 * what was entered. Two things used to close it without anybody meaning to:
 *
 *   - A PRESS OUTSIDE IT. A click whose target is the `<dialog>` itself was
 *     read as "the backdrop was pressed" — but selecting text in a field and
 *     letting go of the mouse outside the box is also a click on the dialog,
 *     and so is a press that merely misses a button near the edge. So a press
 *     outside does nothing at all: there is a Close button, and it is the way
 *     out.
 *   - ESCAPE. The browser cancels a dialog on Esc, and Esc is also how people
 *     dismiss a suggestion list, a date picker or an open select. So once
 *     anything in the form has been changed, Esc is refused and the dialog
 *     says why. With nothing changed, Esc still closes it.
 *
 * `ConfirmDialog` is unaffected: it holds no input, so closing it loses nothing.
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
  /** Whether anything inside has been typed or chosen since it opened. A ref: typing must not re-render the frame. */
  const changed = useRef(false);
  /** Whether an Escape was just refused, so the dialog can say so instead of seeming stuck. */
  const [keptOpen, setKeptOpen] = useState(false);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    setShown(open);
  }, [open]);
  // A dialog with nothing to type in or choose first still gives focus a home: its way out.
  useEffect(() => {
    if (shown && document.activeElement === ref.current) closeRef.current?.focus();
  }, [shown]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // The browser's Escape. Refused once the form holds something (see above).
      onCancel={(event) => {
        if (!changed.current) return;
        event.preventDefault();
        setKeptOpen(true);
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-border bg-card p-0 text-card-foreground shadow-2xl',
        // ⚠ A BLACK backdrop, never the theme's foreground: on a dark theme the foreground is light, so it would light the page up behind the dialog instead of dimming it. As `ConfirmDialog`.
        'backdrop:bg-black/50 backdrop:backdrop-blur-[2px]',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open && shown ? (
        // `onInput` and `onChange` bubble up from every field inside: one listener knows the form was touched.
        <div
          className="flex max-h-[88vh] flex-col"
          onInput={() => {
            changed.current = true;
          }}
          onChange={() => {
            changed.current = true;
          }}
        >
          {/*
           * ⚠ Every dialog has a visible way out. Closing goes through
           * `dialog.close()`, so it reaches `onClose` on one path.
           */}
          <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            <button
              ref={closeRef}
              type="button"
              aria-label="Close"
              className={cn(buttonClass('ghost', 'sm'), '-mr-1.5 size-8 shrink-0 rounded-full px-0')}
              onClick={() => ref.current?.close()}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </header>
          {keptOpen ? (
            <p role="status" className="bg-status-info px-5 py-2 text-xs text-status-info-foreground">
              Kept open so what you entered is not lost. Use Close to leave without saving.
            </p>
          ) : null}
          <div className="flex flex-col gap-4 overflow-y-auto p-5">{children}</div>
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
  /** May be forwarded as undefined: a hint that depends on what is chosen. */
  hint?: string | undefined;
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
