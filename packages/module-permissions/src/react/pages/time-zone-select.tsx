'use client';

import { cn } from '@kwtech/web-ui/react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { describeZone, filterTimeZones, timeZoneOptions } from '../view/time-zone-options.js';

export interface TimeZoneSelectProps {
  /** The trigger's id, for the `<label htmlFor>` outside. */
  id: string;
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}

/**
 * A time zone, picked by searching: "manila", "gmt+8" or "new york".
 *
 * A plain `<select>` of the ~420 zones a browser knows asks people to scroll
 * a list they cannot search, sorted by a name ("Asia/…") they may not know.
 * Here they type the place or the offset they do know.
 *
 * The ARIA combobox pattern: the search box is the combobox, the list a
 * listbox, and the highlighted row is `aria-activedescendant`, so a screen
 * reader follows the arrow keys while focus stays in the box where the typing
 * happens. Kept in this module and not in `web-ui` because nothing else picks
 * from a searchable list yet (frontend rules: a second consumer first).
 */
export function TimeZoneSelect({ id, value, onChange, disabled = false }: TimeZoneSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Offsets are today's. Worked out once per open, not on every keystroke.
  const options = useMemo(
    () =>
      open
        ? timeZoneOptions(
            typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [],
            value,
            new Date(),
          )
        : [],
    [open, value],
  );
  const shown = useMemo(() => filterTimeZones(options, query), [options, query]);
  const selected = useMemo(() => describeZone(value, new Date()), [value]);

  /*
   * Opening highlights the saved zone (scrolled into view below), so the list
   * starts where the answer already is. Keyed to opening alone: re-running on
   * each keystroke would drag the highlight back to the saved zone.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed to opening alone
  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.zone === value),
      ),
    );
  }, [open]);

  const activeOption = shown[active];
  const activeId = activeOption ? `${listId}-${activeOption.zone}` : undefined;

  // Keeps the highlighted row on screen as the arrow keys move it.
  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  // A click anywhere else closes it, as a native select does.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
    // Back to the trigger, so a keyboard user is not dropped at the top of the page.
    triggerRef.current?.focus();
  }

  function choose(zone: string) {
    onChange(zone);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.max(0, Math.min(index + 1, shown.length - 1)));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
        return;
      case 'Enter': {
        // ⚠ Never lets Enter reach the form: inside the settings form it would submit a half-made choice.
        event.preventDefault();
        const option = shown[active];
        if (option) choose(option.zone);
        return;
      }
      case 'Escape':
        event.preventDefault();
        close();
        return;
      default:
        return;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{selected.city}</span>
          {selected.region ? <span className="text-muted-foreground"> · {selected.region}</span> : null}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{selected.offset}</span>
        <Glyph path="m6 9 6 6 6-6" className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="relative border-b border-border">
            <Glyph
              path="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              role="combobox"
              aria-label="Search time zones"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                // A new search highlights its first match, so Enter takes the best guess.
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search a city, region or offset (GMT+8)"
              // biome-ignore lint/a11y/noAutofocus: opening the picker is asking to search it
              autoFocus
              className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div id={listId} role="listbox" aria-label="Time zones" className="max-h-64 overflow-y-auto p-1">
            {shown.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>
            ) : (
              shown.map((option, index) => {
                const isActive = index === active;
                const isSelected = option.zone === value;
                return (
                  <div
                    key={option.zone}
                    id={`${listId}-${option.zone}`}
                    role="option"
                    aria-selected={isSelected}
                    // Focus stays in the search box (aria-activedescendant); -1 keeps the option out of the tab order.
                    tabIndex={-1}
                    // mousedown, not click: a click would blur the search box first and could close the list under the pointer.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(option.zone);
                    }}
                    onMouseMove={() => setActive(index)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                      isActive ? 'bg-accent text-accent-foreground' : null,
                    )}
                  >
                    <Glyph
                      path="M20 6 9 17l-5-5"
                      className={cn('size-4 shrink-0', isSelected ? 'text-primary' : 'invisible')}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className={isSelected ? 'font-medium' : undefined}>{option.city}</span>
                      {option.region ? <span className="text-muted-foreground"> · {option.region}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{option.offset}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A lucide-shaped stroke icon, drawn inline: this module does not depend on
 * lucide-react (see the back link in `admin-page.tsx`), and three paths do not
 * justify adding it.
 */
function Glyph({ path, className }: { path: string; className: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={path} />
    </svg>
  );
}
