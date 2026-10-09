'use client';

import { cn, focusFirstListItem, LIST_ITEM, LIST_KEYS } from '@kwtech/web-ui/react';
import { Check, ChevronDown } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Popover, type PopoverCloseReason } from './popover.js';

/** One choice of a `Select`. */
export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Drawn before the label, in the list and on the trigger. Decorative: the label names the choice. */
  icon?: ReactNode;
  /** Options sharing a `group` are listed together under it as a heading. Ungrouped ones come first. */
  group?: string;
}

export interface SelectProps<T extends string = string> {
  /** The trigger's id, for a `<label htmlFor>` outside. */
  id?: string;
  /** The chosen value, or null for none — the trigger then shows `placeholder`. */
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Said in the list when there is nothing to choose, so an empty list is never a blank box. */
  emptyText?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string | undefined;
}

/**
 * One choice of several, in the app's own colours — instead of the browser's
 * `<select>`, whose open list ignores the theme, cannot show an icon or a group
 * heading the way the rest of the app does, and looks different on every
 * system (the operator's request, 2026-10-09).
 *
 * The ARIA select-only combobox: the trigger is the `combobox`, the list a
 * `listbox` of `option`s.
 *
 * - Opens on a click, Enter, Space, or ↑ ↓ on the trigger, with the focus on
 *   the chosen option so the list starts where the answer already is.
 * - ↑ ↓ Home End move through the options (`LIST_KEYS`, as every list in the
 *   app); Enter or Space chooses, because an option is a real button. A letter
 *   jumps to the next option starting with it, as a native select does.
 * - Escape and Tab close it; choosing or a key hands the focus back to the
 *   trigger, a press elsewhere leaves it where the press put it.
 * - ⚠ Choosing the option already chosen calls nothing: every `onChange` here
 *   is a write, and re-picking "Normal" must not send one.
 */
export function Select<T extends string = string>({
  id,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  disabled = false,
  size = 'md',
  emptyText = 'Nothing to choose from.',
  className,
  ...aria
}: SelectProps<T>) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  // Opening puts the focus on the chosen option, or the first: the arrows start from there.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const chosen = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!chosen) {
      focusFirstListItem(list);
      return;
    }
    chosen.focus({ preventScroll: true });
    chosen.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const close = (reason: PopoverCloseReason) => {
    setOpen(false);
    if (reason === 'key') triggerRef.current?.focus();
  };

  const choose = (next: T) => {
    close('key');
    if (next !== value) onChange(next);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      // Not prevented: with the focus back on the trigger, Tab goes on to the next field from there.
      close('key');
      return;
    }
    if (event.key.length !== 1 || event.key === ' ' || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
    // The key came from the option in focus (or from the list itself, which is then -1: start at the top).
    const from = items.indexOf(event.target as HTMLElement);
    const letter = event.key.toLowerCase();
    // From the option after the one in focus, wrapping, so a letter pressed again reaches the next match.
    const next = [...items.slice(from + 1), ...items.slice(0, from + 1)].find((item) =>
      (item.textContent ?? '').trim().toLowerCase().startsWith(letter),
    );
    next?.focus();
  };

  const ungrouped = options.filter((option) => option.group === undefined);
  const groups = [...new Set(options.flatMap((option) => (option.group === undefined ? [] : [option.group])))];

  const row = (option: SelectOption<T>) => {
    const chosen = option.value === value;
    return (
      <button
        key={option.value}
        type="button"
        role="option"
        aria-selected={chosen}
        {...LIST_ITEM}
        onClick={() => choose(option.value)}
        // The pointer moves the FOCUS, as the arrows do, so there is one highlighted row and never two.
        onPointerMove={(event) => {
          if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true });
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none',
          'focus:bg-accent focus:text-accent-foreground',
          chosen && 'font-medium',
        )}
      >
        {option.icon ? (
          <span aria-hidden="true" className="flex shrink-0 items-center text-muted-foreground">
            {option.icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        <Check aria-hidden="true" className={cn('size-4 shrink-0 text-primary', chosen ? null : 'invisible')} />
      </button>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-background text-left transition-colors',
          'hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-60',
          size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm',
          open && 'border-ring',
          className,
        )}
        {...aria}
      >
        {selected?.icon ? (
          <span aria-hidden="true" className="flex shrink-0 items-center text-muted-foreground">
            {selected.icon}
          </span>
        ) : null}
        <span className={cn('min-w-0 flex-1 truncate', selected ? null : 'text-muted-foreground')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      <Popover open={open} anchor={triggerRef} onClose={close} matchWidth className="max-w-[min(22rem,90vw)]">
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={aria['aria-label']}
          aria-labelledby={aria['aria-label'] ? undefined : id}
          {...LIST_KEYS}
          // After the spread, on purpose: the list's own keys first, then the select's.
          onKeyDown={(event) => {
            LIST_KEYS.onKeyDown(event);
            onListKeyDown(event);
          }}
          className="max-h-72 min-h-0 overflow-y-auto p-1"
        >
          {options.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{emptyText}</p> : null}
          {ungrouped.map(row)}
          {groups.map((group) => (
            <SelectGroup key={group} label={group}>
              {options.filter((option) => option.group === group).map(row)}
            </SelectGroup>
          ))}
        </div>
      </Popover>
    </>
  );
}

function SelectGroup({ label, children }: { label: string; children: ReactNode }) {
  const headingId = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <optgroup> only exists inside the <select> this replaces.
    <div
      role="group"
      aria-labelledby={headingId}
      className="mt-1 border-t border-border pt-1 first:mt-0 first:border-0 first:pt-0"
    >
      <p
        id={headingId}
        className="px-2 pt-1 pb-0.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </p>
      {children}
    </div>
  );
}
