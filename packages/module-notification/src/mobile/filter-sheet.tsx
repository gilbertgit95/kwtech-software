'use client';

import { BottomSheet, cn } from '@kwtech/web-ui/react';
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
 * web-ui's `BottomSheet`, as every sheet on the phone is: focus moves in and
 * stays, Esc or a swipe down closes it, the page behind is inert.
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
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="flex gap-2">
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
      }
    >
      <div className="space-y-5 px-2 pt-2 pb-2">
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
                      on ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-foreground active:bg-accent',
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
    </BottomSheet>
  );
}
