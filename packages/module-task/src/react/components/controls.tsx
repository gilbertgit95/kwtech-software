'use client';

import { cn, Tooltip } from '@kwtech/web-ui/react';
import { ArrowDown, ArrowUp, ChevronsUp, Minus, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import type { TaskPersonView } from '../task-client.js';
import { initials, PRIORITY_LABELS } from '../view/board.js';

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
        'm-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg',
        // ⚠ A BLACK backdrop, never the theme's foreground: on a dark theme the foreground is light, so it lit the page up behind the dialog instead of dimming it (the operator, 2026-10-03). As `ConfirmDialog`.
        'backdrop:bg-black/50',
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

/** Initials in a circle, named for screen readers; "a former member" when the app cannot name them. */
export function Avatar({ person, size = 'sm' }: { person: TaskPersonView; size?: 'sm' | 'md' }) {
  const name = person.displayName ?? 'A former member';
  return (
    <Tooltip text={name} side="top" describes={false}>
      {(tooltip) => (
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full border border-card bg-secondary font-medium text-secondary-foreground',
            size === 'sm' ? 'size-6 text-[0.625rem]' : 'size-8 text-xs',
          )}
          {...tooltip}
        >
          <span aria-hidden="true">{initials(person.displayName)}</span>
          <span className="sr-only">{name}</span>
        </span>
      )}
    </Tooltip>
  );
}

const PRIORITY_ICONS = { low: ArrowDown, normal: Minus, high: ArrowUp, urgent: ChevronsUp } as const;

/** A priority as an icon AND a word — never colour alone. `normal` is not shown on a card. */
export function PriorityTag({ priority, always = false }: { priority: string; always?: boolean }) {
  if (priority === 'normal' && !always) return null;
  const Icon = PRIORITY_ICONS[priority as keyof typeof PRIORITY_ICONS] ?? Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 text-xs font-medium',
        priority === 'urgent' && 'bg-destructive/15 text-destructive',
        priority === 'high' && 'bg-primary/15 text-primary',
        (priority === 'normal' || priority === 'low') && 'bg-muted text-muted-foreground',
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  );
}
