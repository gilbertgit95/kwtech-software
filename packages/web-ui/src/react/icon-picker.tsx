'use client';

import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from './utils.js';

/**
 * Choosing an icon by NAME, from the set this application can actually draw.
 *
 * ## Why the set is injected rather than owned here
 *
 * Icon names are stored as data — `nav.icon` on a module descriptor,
 * `PermRole.icon` on a role row — precisely so that what `crown` DRAWS is the
 * frontend's decision. A package that shipped its own list would take that
 * decision away from every consumer, and a second frontend could no longer
 * render the same rows in its own set.
 *
 * So this owns the CONTROL and the app owns the VOCABULARY. Same split as the
 * status channel and the feature-access hook: everyone may depend on the
 * contract, the answer comes from whoever has it.
 *
 * ## Why a context and not just a prop
 *
 * The prop exists and wins when given. The context is what makes the picker
 * usable inside a page that arrives from a MODULE package: those are rendered
 * by a route descriptor that hands them `params` and nothing else, so there is
 * no call site to thread an icon set through. The app mounts the provider once
 * and every picker below it works.
 */

export interface IconOption {
  /** The stored value — 'crown', 'sprout'. */
  name: string;
  Icon: LucideIcon;
}

const IconSetContext = createContext<readonly IconOption[] | null>(null);

/**
 * Publishes the icons this app can draw.
 *
 * Accepts the same `Record<name, LucideIcon>` shape an app already keeps for
 * its descriptor icons, so mounting it is one line and there is no second list
 * to keep in step.
 */
export function IconSetProvider({ icons, children }: { icons: Record<string, LucideIcon>; children: ReactNode }) {
  const value = useMemo(
    () =>
      Object.entries(icons)
        .map(([name, Icon]) => ({ name, Icon }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [icons],
  );
  return <IconSetContext.Provider value={value}>{children}</IconSetContext.Provider>;
}

/**
 * The available icons, or null when no provider is mounted.
 *
 * NULL rather than an empty array, so a caller can tell "this app has not said
 * what it can draw" from "it can draw nothing" — the first wants a text box as
 * a fallback, the second wants a disabled control.
 */
export function useIconSet(): readonly IconOption[] | null {
  return useContext(IconSetContext);
}

export interface IconPickerProps {
  /** The stored name, or '' for none. */
  value: string;
  onChange: (name: string) => void;
  /** Overrides the provider. Given neither, the picker renders nothing. */
  options?: readonly IconOption[];
  /** Shown on the trigger when nothing is chosen. */
  placeholder?: string;
  /**
   * Above this many, a search box appears.
   *
   * A search box over eight icons is a control that costs a keystroke and saves
   * none; over sixty it is the only way to find one. The threshold means a
   * small set stays a plain grid without anyone configuring it.
   */
  searchThreshold?: number;
  id?: string;
  className?: string;
}

export function IconPicker({
  value,
  onChange,
  options,
  placeholder = 'No icon',
  searchThreshold = 12,
  id,
  className,
}: IconPickerProps) {
  const fromContext = useIconSet();
  const icons = options ?? fromContext ?? [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const searchId = useId();

  const selected = icons.find((option) => option.name === value);
  const Selected = selected?.Icon;

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? icons.filter((option) => option.name.toLowerCase().includes(term)) : icons;
  }, [icons, query]);

  /*
   * Close on an outside click or Escape.
   *
   * Hand-rolled rather than Radix's DropdownMenu, and that is the one real
   * decision in this component: a menu implements TYPEAHEAD — typing jumps to
   * the item starting with those letters — which fights a search box inside it
   * for every keystroke. The menu would swallow the typing that is supposed to
   * filter. What is lost is the focus trap, so Escape and outside-click are
   * wired here by hand.
   */
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // No vocabulary, no control. A picker over nothing is a button that cannot do
  // anything; the caller renders its own fallback.
  if (icons.length === 0) return null;

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={root} className={cn('relative', className)}>
      {/*
        Two SIBLING buttons in a bordered row, not one button containing
        another. Nesting them is invalid HTML — a <button> may not contain
        interactive content — and browsers recover from it unpredictably, which
        is how a "clear" control ends up also opening the panel. The row carries
        the border so the pair still reads as one field.
      */}
      <div
        className={cn(
          'flex w-full items-center gap-1 rounded-md border border-border bg-background pr-2',
          'focus-within:ring-2 focus-within:ring-ring',
        )}
      >
        <button
          id={id}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-sm focus-visible:outline-none"
        >
          {Selected ? <Selected aria-hidden className="size-4 shrink-0" /> : null}
          <span className={cn('flex-1 truncate text-left', selected ? '' : 'text-muted-foreground')}>
            {selected?.name ?? placeholder}
          </span>
        </button>

        {/* Clearing is a different act from choosing, so it gets its own
            control rather than a sentinel row inside the panel. */}
        {selected ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear icon"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : null}

        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </div>

      {open ? (
        <div
          // A dialog rather than a listbox: it contains a text field, and a
          // listbox that owns a text input is neither one thing nor the other.
          role="dialog"
          aria-label="Choose an icon"
          className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card p-2 shadow-lg"
        >
          {icons.length > searchThreshold ? (
            <div className="relative mb-2">
              <Search aria-hidden className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                id={searchId}
                // Autofocused: the picker was opened to find something, and the
                // set is large enough that a search box appeared at all.
                // biome-ignore lint/a11y/noAutofocus: focus follows the click that opened this panel
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search icons…"
                aria-label="Search icons"
                className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm"
              />
            </div>
          ) : null}

          <div className="max-h-56 overflow-y-auto">
            {matches.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No icon matches “{query}”.</p>
            ) : (
              <ul className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                {matches.map(({ name, Icon }) => {
                  const active = name === value;
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => choose(name)}
                        // The NAME is the accessible label; the glyph alone
                        // announces nothing, and the name is what gets stored.
                        aria-label={name}
                        aria-pressed={active}
                        title={name}
                        className={cn(
                          'flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border p-1',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <Icon aria-hidden className="size-4" />
                        {/* The name under every glyph, not only on hover: it is
                            the value being stored, and a grid of anonymous
                            pictures makes someone guess which one is 'shield'. */}
                        <span className="w-full truncate text-center text-[0.5625rem] leading-none">{name}</span>
                        {active ? <Check aria-hidden className="size-3" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
