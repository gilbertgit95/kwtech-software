'use client';

import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
import { cn } from './utils.js';

/**
 * A filter facet as a dropdown, showing only how many are chosen.
 *
 * ## Why a dropdown rather than a row of chips
 *
 * Chips are better while a facet is short and stable — everything is visible,
 * and the available groupings are discoverable without a click. They stop being
 * better the moment the list grows: eight tags fit on a line, twenty wrap into a
 * block that pushes the grid off screen, and the bar becomes the page.
 *
 * A trigger reading `Tags (2)` costs one click and takes constant space
 * whatever the vocabulary does. The count is the important half — a collapsed
 * facet that does not say it is active is how someone spends a minute wondering
 * why a list is short.
 */
export interface MultiSelectProps {
  /** The facet's name, shown on the trigger and as the menu's heading. */
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  /** Omitted, no clear entry is offered. */
  onClear?: () => void;
  /** Rendered under the heading — e.g. "all of these" versus "any of these". */
  hint?: string;
  className?: string;
}

export function MultiSelect({ label, options, selected, onToggle, onClear, hint, className }: MultiSelectProps) {
  // A facet with nothing to choose from is a control that cannot do anything.
  if (options.length === 0) return null;

  const count = selected.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        /*
         * The count lives in the accessible name too, not only in the visible
         * text — a screen reader user needs "Tags, 2 selected" for the same
         * reason a sighted one needs the badge: to know the facet is narrowing
         * before wondering why the list is short.
         */
        aria-label={count > 0 ? `${label}, ${count} selected` : label}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          count > 0
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
          className,
        )}
      >
        {label}
        {count > 0 ? (
          /*
            The NUMBER, not the values. Listing them would put the facet's
            contents back on the trigger and undo the reason it collapsed.
          */
          <span
            className={cn(
              'grid min-w-4 place-items-center rounded-full px-1 text-[0.625rem] leading-4',
              'bg-primary-foreground/20',
            )}
          >
            {count}
          </span>
        ) : null}
        <ChevronDown aria-hidden className="size-3" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="max-h-72 w-56 overflow-y-auto rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {hint ? <p className="px-2 pb-1 text-[0.6875rem] text-muted-foreground">{hint}</p> : null}
        <DropdownMenuSeparator className="mb-1" />

        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <DropdownMenuItem
              key={option}
              /*
               * THE MENU MUST NOT CLOSE. Radix dismisses on select by default,
               * which for a multi-select means one click per re-open — the
               * control would technically work and be unusable for its whole
               * purpose.
               */
              onSelect={(event) => {
                event.preventDefault();
                onToggle(option);
              }}
              // Checkbox semantics by hand: the primitive exports only Item, and
              // adding CheckboxItem for this would be a wider change than it needs.
              role="menuitemcheckbox"
              aria-checked={on}
              className={cn('gap-2.5 rounded-lg px-2 py-1.5 text-sm', on ? 'text-foreground' : 'text-muted-foreground')}
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded border',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                )}
              >
                {on ? <Check className="size-3" /> : null}
              </span>
              <span className="flex-1 truncate">{option}</span>
            </DropdownMenuItem>
          );
        })}

        {onClear && count > 0 ? (
          <>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              onSelect={(event) => {
                // Kept open here too: clearing is often followed by choosing
                // something else, and closing would cost a second click.
                event.preventDefault();
                onClear();
              }}
              className="gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground"
            >
              Clear {label.toLowerCase()}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
