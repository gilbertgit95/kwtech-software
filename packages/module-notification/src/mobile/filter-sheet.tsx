'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useRef } from 'react';
import { NotificationIcon } from '../react/components/notification-icons.js';

/** One filter in the sheet: a heading and its choices, one of which is on. */
export interface FilterSheetGroup {
  key: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

/**
 * Every inbox filter in one sheet from the bottom of the phone (issue #22),
 * each as a row of chips to tap rather than a menu to open: Order, Type,
 * Source, From. Choices apply as they are tapped — the list behind updates —
 * and "Done" closes it.
 *
 * A native modal `<dialog>`, as the phone frame's own sheets are: focus moves
 * in and stays, Esc closes it, the page behind is inert. The module draws its
 * own rather than borrowing the frame's: a module never imports the app.
 */
export function FilterSheet({
  open,
  onClose,
  groups,
  active,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  groups: readonly FilterSheetGroup[];
  /** How many filters are on, for the Clear button. */
  active: number;
  onClear: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click below only detects a backdrop press; its keyboard equivalent is Escape, which <dialog> handles itself. `ConfirmDialog`'s reasoning.
    <dialog
      ref={dialog}
      aria-label="Filters"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        'fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none rounded-t-3xl border-t border-border/60 bg-card p-0 text-card-foreground shadow-2xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
        'open:animate-in open:slide-in-from-bottom open:duration-300 motion-reduce:open:animate-none',
      )}
    >
      <div className="flex max-h-[85dvh] flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="shrink-0 px-4 pt-2.5 pb-2">
          <span aria-hidden className="mx-auto block h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Filters</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <NotificationIcon name="close" className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pt-2 pb-4">
          {groups.map((group) => (
            <fieldset key={group.key}>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </legend>
              <div className="flex flex-wrap gap-2">
                {group.options.map((option) => {
                  const on = option.value === group.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => group.onChange(option.value)}
                      className={cn(
                        'inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        on
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted text-foreground active:bg-accent',
                      )}
                    >
                      {on ? <NotificationIcon name="check" className="size-3.5" /> : null}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border/60 px-4 py-3">
          <button
            type="button"
            onClick={onClear}
            disabled={active === 0}
            className="min-h-11 flex-1 rounded-full bg-muted text-sm font-medium text-foreground active:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
