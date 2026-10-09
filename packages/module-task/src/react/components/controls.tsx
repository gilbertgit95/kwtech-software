'use client';

import { cn, Tooltip } from '@kwtech/web-ui/react';
import { ArrowDown, ArrowUp, Check, ChevronsUp, type LucideIcon, Minus, Search, X } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';
import type { TaskPersonView } from '../task-client.js';
import { initials, PRIORITY_LABELS } from '../view/board.js';

/** The app's buttons, as a function over a union rather than a variant library. */
export function buttonClass(
  variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary',
  size: 'sm' | 'md' = 'md',
) {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 px-3.5 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-card shadow-xs hover:bg-accent hover:text-accent-foreground',
    variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
    variant === 'danger' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  );
}

/** The shared look of a text input. `Select` and `DatePicker` draw their triggers to match it. */
export const INPUT_CLASS =
  'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm transition-colors placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 read-only:hover:border-border';

/** The shared look of a multi-line box: the description, a comment. */
export const TEXTAREA_CLASS =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed transition-colors placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:hover:border-border';

/**
 * A modal, drawn by the browser's own `<dialog>` so it is in the top layer and
 * traps focus — `ConfirmDialog`'s reasoning. `showModal()` rather than the
 * `open` attribute, which renders inline with no backdrop and no Escape.
 *
 * The title stays at the top and the `footer` (the dialog's buttons) at the
 * bottom while the middle scrolls, so on a short screen the way to finish is
 * never below the fold.
 *
 * ⚠ No transform, filter or animation that uses one on the `<dialog>`: either
 * makes it the containing block of the `position: fixed` lists its selects
 * open (`Popover`), which would then be placed against the dialog and clipped
 * by it.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  /** One line under the title: what the dialog is for, or how it saves. */
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** The dialog's buttons, kept in view under the scrolling middle. */
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // ⚠ `showModal` focuses the first control it finds, which is Close: the
      // dialog then opens with a ring round its way out and Enter one slip from
      // shutting it. The focus goes to the field the dialog is about
      // (`data-autofocus`), or to the dialog itself so Tab starts at the top.
      (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click below only detects a backdrop press; its keyboard equivalent is Escape, which <dialog> handles itself. `ConfirmDialog`'s reasoning.
    <dialog
      ref={ref}
      // Focusable from code only, for the opening focus above.
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      // Clicking the backdrop targets the <dialog> itself; clicking anything inside targets a descendant.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-border bg-card p-0 text-card-foreground shadow-2xl shadow-black/20 outline-none',
        // ⚠ A BLACK backdrop, never the theme's foreground: on a dark theme the foreground is light, so it lit the page up behind the dialog instead of dimming it (the operator, 2026-10-03). As `ConfirmDialog`.
        'backdrop:bg-black/50 backdrop:backdrop-blur-[2px]',
        wide ? 'max-w-xl' : 'max-w-md',
      )}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          {/*
           * ⚠ Every dialog has a visible way out. Board settings had none —
           * only Escape, which nobody guesses (the operator, 2026-09-28).
           * Closing goes through `dialog.close()`, so it reaches `onClose`
           * exactly as Escape does: one path.
           */}
          <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id={titleId} className="text-base font-semibold tracking-tight">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="text-xs text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {/* No tooltip: one drawn on `<body>` would open behind the dialog, which is in the top layer. */}
            <button
              type="button"
              aria-label="Close"
              className={cn(buttonClass('ghost', 'sm'), '-mt-0.5 -mr-1.5 w-7 px-0 text-muted-foreground')}
              onClick={() => ref.current?.close()}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </header>
          {/* `relative`: clips its `sr-only` inputs too — see the board's scroller. */}
          <div className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
              {footer}
            </footer>
          ) : null}
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
    <div className="flex min-w-0 flex-col gap-1.5">
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

/**
 * A tick box in the app's own colours. Still the browser's `<input
 * type="checkbox">` underneath — so a `<label>`, Space, a form and a screen
 * reader all treat it as one — with its own drawing switched off and ours put
 * over it.
 *
 * With `children` it is wrapped in its own `<label>`, so the words are part of
 * the target; without, the caller names it (`aria-label`).
 */
export function Checkbox({ className, children, id, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const ownId = useId();
  const inputId = id ?? ownId;
  const box = (
    <span className={cn('relative inline-grid size-4 shrink-0 place-items-center', children ? null : className)}>
      <input
        id={inputId}
        type="checkbox"
        className={cn(
          'peer size-4 cursor-pointer appearance-none rounded-[0.3125rem] border border-foreground/30 bg-background transition-colors',
          'checked:border-primary checked:bg-primary hover:border-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-foreground/30',
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100"
      />
    </span>
  );
  if (!children) return box;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground has-disabled:cursor-not-allowed',
        className,
      )}
    >
      {box}
      {children}
    </label>
  );
}

/** One choice of a `ChoiceCards`. */
export interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: LucideIcon;
}

/**
 * One of a few choices, each a card saying what it means — for a choice worth
 * a sentence (who can open a board), where a row of bare radio dots hides the
 * consequence. Real radio buttons underneath, so ← → move between them and the
 * set is read as one group; the dot is hidden and the whole card is the target.
 *
 * ⚠ CONTROLLED BY `value` ALONE. `onChange` may open a confirmation instead of
 * changing anything (making a board private); the card then stays where it
 * was until the value really changes.
 */
export function ChoiceCards<T extends string>({
  legend,
  value,
  options,
  disabled = false,
  onChange,
}: {
  legend: string;
  value: T;
  options: readonly Choice<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              // `relative`: the hidden radio is positioned inside its own card, not the scroller.
              'relative flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors',
              'hover:bg-accent/50 has-checked:border-primary has-checked:bg-primary/5',
              'has-focus-visible:ring-2 has-focus-visible:ring-ring',
              'has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:bg-transparent',
            )}
          >
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground peer-checked:bg-primary peer-checked:text-primary-foreground"
            >
              <option.icon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Two or three views of the same thing, one showing at a time (Board · List).
 * Pressed buttons rather than radios: each is an action that takes effect at
 * once, and `aria-pressed` says which one is on.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon: LucideIcon }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === option.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <option.icon aria-hidden="true" className="size-3.5" />
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * A filter that is on or off, as a chip: tinted and ticked while it narrows
 * the list, so a filter left on is seen — the reason a short list is short.
 */
export function ToggleChip({
  pressed,
  icon: Icon,
  onChange,
  className,
  children,
}: {
  pressed: boolean;
  icon: LucideIcon;
  onChange: (pressed: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const Shown = pressed ? Check : Icon;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pressed
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      <Shown aria-hidden="true" className="size-3.5" />
      {children}
    </button>
  );
}

/** A search box with its magnifier, and a clear button once there is something to clear. */
export function SearchInput({
  id,
  value,
  placeholder,
  onChange,
  className,
}: {
  id: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <span className={cn('relative flex items-center', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
      <input
        id={id}
        // `text`, not `search`: a search input draws the browser's own clear button beside ours.
        type="text"
        inputMode="search"
        placeholder={placeholder}
        className={cn(INPUT_CLASS, 'h-8 pr-7 pl-8 text-xs')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear the search"
          className="absolute right-1 grid size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onChange('')}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

/** A line across the app saying something about what is shown: read-only, archived, a failure. */
export function Notice({
  tone = 'muted',
  icon: Icon,
  children,
  action,
}: {
  tone?: 'muted' | 'danger';
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        tone === 'danger'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/60 text-muted-foreground',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

const AVATAR_SIZE = { sm: 'size-6 text-[0.625rem]', md: 'size-8 text-xs' } as const;

/**
 * Initials in a circle and nothing else: for beside a name that is already
 * written out (a select's option), where naming the person again would have a
 * screen reader say it twice.
 */
export function Initials({ name, size = 'sm' }: { name: string | null; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-secondary-foreground',
        AVATAR_SIZE[size],
      )}
    >
      {initials(name)}
    </span>
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
            AVATAR_SIZE[size],
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

/** A priority's icon — on a card's tag, and beside the word wherever a priority is chosen. */
export const PRIORITY_ICONS = { low: ArrowDown, normal: Minus, high: ArrowUp, urgent: ChevronsUp } as const;

/** A priority as an icon AND a word — never colour alone. `normal` is not shown on a card. */
export function PriorityTag({ priority, always = false }: { priority: string; always?: boolean }) {
  if (priority === 'normal' && !always) return null;
  const Icon = PRIORITY_ICONS[priority as keyof typeof PRIORITY_ICONS] ?? Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-xs font-medium',
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
