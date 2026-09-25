'use client';

import { cn, useDebouncedValue } from '@kwtech/web-ui/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { NotificationClient } from '../../notification-client.js';
import { type ComposeRecipient, initialsOf, moveHighlight } from '../../view/compose-view.js';
import { NotificationIcon } from '../notification-icons.js';

export interface RecipientPickerProps {
  id: string;
  client: NotificationClient;
  value: readonly ComposeRecipient[];
  onChange: (next: ComposeRecipient[]) => void;
  error?: string | undefined;
}

/**
 * Choosing people: a search box that lists matches as you type, and a chip per
 * person chosen.
 *
 * An ARIA combobox, so it works without a mouse: ↑/↓ move through the matches,
 * Enter adds the highlighted one, Escape closes the list, and Backspace in an
 * empty box removes the last chip.
 */
export function RecipientPicker({ id, client, value, onChange, error }: RecipientPickerProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 250);
  const [matches, setMatches] = useState<ComposeRecipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const term = debounced.trim();
    if (term.length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    client
      .searchRecipients(term)
      .then((found) => {
        if (!cancelled) setMatches(found);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, debounced]);

  // Close on a press outside, like every other popover in the app.
  useEffect(() => {
    if (!open) return;
    const onPress = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [open]);

  const chosen = new Set(value.map((person) => person.userId));
  const options = matches.filter((person) => !chosen.has(person.userId));
  const showList = open && query.trim().length >= 2;

  const add = (person: ComposeRecipient) => {
    onChange([...value, person]);
    setQuery('');
    setMatches([]);
    setHighlight(-1);
    inputRef.current?.focus();
  };
  const remove = (userId: string) => onChange(value.filter((person) => person.userId !== userId));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        setOpen(true);
        setHighlight((current) => moveHighlight(current, event.key === 'ArrowDown' ? 1 : -1, options.length));
        return;
      }
      case 'Enter': {
        const person = options[highlight] ?? (options.length === 1 ? options[0] : undefined);
        // Enter never submits the form from here: a half-typed name is not a send.
        event.preventDefault();
        if (person) add(person);
        return;
      }
      case 'Escape':
        setOpen(false);
        return;
      case 'Backspace': {
        const last = value.at(-1);
        if (!query && last) remove(last.userId);
        return;
      }
      default:
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 transition-colors focus-within:ring-2 focus-within:ring-ring',
          error ? 'border-destructive' : 'border-input',
        )}
      >
        {value.map((person) => (
          <span
            key={person.userId}
            title={person.email}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted py-0.5 pl-0.5 pr-1.5 text-xs font-medium"
          >
            <span
              aria-hidden
              className="grid size-5 place-items-center rounded-full bg-primary/15 text-[0.625rem] font-semibold text-primary"
            >
              {initialsOf(person.displayName)}
            </span>
            {person.displayName}
            <button
              type="button"
              onClick={() => remove(person.userId)}
              aria-label={`Remove ${person.displayName}`}
              className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <NotificationIcon name="close" className="size-3" />
            </button>
          </span>
        ))}
        <span className="flex min-w-[12rem] flex-1 items-center gap-1.5 px-1">
          <NotificationIcon name="search" className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            id={id}
            type="text"
            role="combobox"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setHighlight(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={value.length === 0 ? 'Search people by name or email' : 'Add another person'}
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint`}
            {...(highlight >= 0 && options[highlight] ? { 'aria-activedescendant': `${listId}-${highlight}` } : {})}
            className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </span>
      </div>

      {showList ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {searching && options.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">Searching…</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              {matches.length > 0 ? 'Everyone who matches is already added.' : 'Nobody matches that.'}
            </p>
          ) : (
            <div id={listId} role="listbox" aria-label="Matching people" className="max-h-64 overflow-y-auto py-1">
              {options.map((person, index) => (
                <div
                  key={person.userId}
                  id={`${listId}-${index}`}
                  role="option"
                  // Focus stays in the input (aria-activedescendant points here);
                  // -1 only makes the option focusable, which the role requires.
                  tabIndex={-1}
                  aria-selected={index === highlight}
                  // mousedown, not click: a click would blur the input first and
                  // close the list before the choice lands.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    add(person);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm',
                    index === highlight ? 'bg-accent' : null,
                  )}
                >
                  <span
                    aria-hidden
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
                  >
                    {initialsOf(person.displayName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{person.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{person.email}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
        <p id={`${id}-hint`} className={error ? 'text-destructive' : 'text-muted-foreground'}>
          {error ?? 'Type at least two characters. Use ↑ ↓ and Enter to pick.'}
        </p>
        {value.length > 1 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
        ) : null}
      </div>
    </div>
  );
}
