'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from './utils.js';

/**
 * A modal confirmation, on the native `<dialog>` element.
 *
 * ## Why not a Radix dialog
 *
 * `@radix-ui/react-dropdown-menu` is already here, so a Radix dialog would be
 * the consistent-looking choice. It is a dependency for behaviour the platform
 * now ships: `showModal()` gives focus trapping, an inert background, Escape to
 * close, and the top layer — above every `z-index` on the page, which is the
 * part a hand-rolled overlay usually gets wrong. Radix earns its place for the
 * dropdown, whose keyboard model has no native equivalent. This does not.
 *
 * ## What it is for
 *
 * Destructive, irreversible actions. Not for anything routine: a dialog on a
 * safe action trains people to dismiss dialogs, which is how the one that
 * mattered gets dismissed too.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Say what will happen, in the same words the button uses. */
  description: ReactNode;
  /** The verb, not "OK" — "Delete 3 features" beats "OK" every time. */
  confirmLabel: string;
  cancelLabel?: string;
  /**
   * A THIRD way out, for a question with two real answers rather than one.
   *
   * "Replace what is staged" or "add to it" is a choice, not a confirmation, and
   * forcing it into yes/no makes the reader work out which one "OK" meant. The
   * alternative sits between Cancel and Confirm and is styled neutrally, so the
   * destructive option stays the one that looks destructive.
   *
   * Omitted, the dialog is an ordinary two-button confirmation.
   */
  alternative?: { label: string; onSelect: () => void } | undefined;
  /** Red rather than primary. Defaults on, since that is what this exists for. */
  danger?: boolean;
  /** Disables both buttons and shows the confirm as busy. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  alternative,
  danger = true,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  /*
   * `showModal()` rather than the `open` ATTRIBUTE.
   *
   * `<dialog open>` renders the element inline — visible, but with no backdrop,
   * no focus trap, no Escape handling and no top layer. It looks like it works
   * until something with a z-index sits on top of it. Only the method call
   * promotes the dialog to the top layer, so opening is imperative even though
   * the prop is declarative.
   */
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click below only detects a backdrop press; its keyboard equivalent is Escape, which <dialog> raises as `cancel` and onCancel handles. A key handler here would be a redundant second path.
    <dialog
      ref={ref}
      /*
       * Escape fires `cancel`, not `close`, and preventing it is how a pending
       * action stops being interrupted halfway. Without the guard someone can
       * dismiss the dialog while the delete they confirmed is still in flight.
       */
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      // Clicking the backdrop targets the <dialog> itself; clicking anything
      // inside targets a descendant. That difference is the whole test.
      onClick={(event) => {
        if (event.target === ref.current && !pending) onCancel();
      }}
      className={cn(
        /*
         * `m-auto` IS THE CENTRING, and it is not decorative.
         *
         * The browser centres a modal <dialog> with `margin: auto` against the
         * `inset: 0` its own UA stylesheet gives `dialog:modal`. Tailwind's
         * Preflight then emits
         *
         *   *, ::before, ::after, ::backdrop { margin: 0; padding: 0 }
         *
         * which overrides it — author styles beat the UA sheet — and the dialog
         * collapses into the top-left corner. Nothing about that looks like a
         * CSS reset problem from the outside; it looks like the dialog is
         * broken.
         *
         * Restoring the margin with a class wins on specificity (0,1,0 against
         * the universal selector's 0,0,0), so this is the whole fix.
         */
        'm-auto max-w-md rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg',
        /*
         * The UA caps a modal's height at roughly the viewport, but it does not
         * make the overflow reachable — a long list of selected rows would be
         * clipped with no way to scroll to the buttons underneath it.
         */
        'max-h-[calc(100dvh-4rem)] overflow-y-auto',
        // The backdrop is a pseudo-element, so it cannot be styled from a
        // parent — these utilities are the only way to reach it.
        'backdrop:bg-black/40 backdrop:backdrop-blur-[1px]',
      )}
    >
      <div className="p-6">
        <h2 className="text-base font-medium text-card-foreground">{title}</h2>
        <div className="mt-2 text-sm text-muted-foreground">{description}</div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          {alternative ? (
            <button
              type="button"
              onClick={alternative.onSelect}
              disabled={pending}
              /*
               * Neutral, deliberately. If both options were emphasised the
               * reader would have to read both to find the safe one; giving the
               * destructive choice the colour is what makes a glance enough.
               */
              className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
            >
              {alternative.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            /*
             * NOT autofocused. `showModal()` focuses the first focusable
             * element, which is Cancel — and that is the right default for a
             * destructive dialog: Enter should not delete anything.
             */
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-60',
              danger ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground',
            )}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
