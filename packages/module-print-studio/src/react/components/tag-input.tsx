'use client';

import { cn } from '@kwtech/web-ui/react';
import { Check, ChevronDown, Plus, Tag, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { matchStudioTags, STUDIO_LAYOUT_TAG_MAX, studioTagKey } from '../../domain/tags.js';
import { INPUT_CLASS } from './controls.js';

/**
 * A layout's tag: picked from the ones already in use, or typed new.
 *
 * Its own dropdown rather than an `<input list>`: a `<datalist>` is drawn by
 * the browser, in the browser's colours, and looked like nothing else in the
 * studio (the operator, 2026-10-06).
 *
 * The ARIA combobox pattern, as `module-permissions`' time zone picker: the
 * box is the combobox, the list a listbox, and the highlighted row is
 * `aria-activedescendant`, so focus stays where the typing happens.
 *
 * ⚠ WHAT IS TYPED IS THE VALUE. The list only offers; nothing has to be chosen
 * from it. So no row is highlighted until an arrow key or the pointer asks for
 * one, and Enter with none highlighted keeps the typed text — otherwise typing
 * "Photo" and pressing Enter would silently become "Photo Print".
 */
export function TagInput({
  value,
  onChange,
  tags,
  className,
}: {
  value: string;
  onChange: (tag: string) => void;
  /** The tags to offer: `studioTagSuggestions`. */
  tags: readonly string[];
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  /** The highlighted row, or -1 for none. */
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { matches, isNew } = matchStudioTags(tags, value);
  const typed = value.trim();
  // The typed tag is offered as a row of its own when nothing in use is spelled that way.
  const rows = isNew ? [...matches, typed] : matches;
  const activeId = active >= 0 && active < rows.length ? `${listId}-${active}` : undefined;

  // Keeps the highlighted row on screen as the arrow keys move it.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  // A press anywhere else closes it, as a native select does.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function show() {
    setOpen(true);
    setActive(-1);
  }

  function choose(tag: string) {
    onChange(tag);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) return show();
        setActive((index) => Math.min(index + 1, rows.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(index - 1, -1));
        return;
      case 'Enter': {
        if (!open) return;
        event.preventDefault();
        const row = rows[active];
        if (row !== undefined) choose(row);
        else setOpen(false);
        return;
      }
      case 'Escape':
        if (!open) return;
        // ⚠ Stops here: the editor around it must not also act on the key that only closed a list.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      default:
        return;
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Tag
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Tag"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        maxLength={STUDIO_LAYOUT_TAG_MAX}
        className={cn(INPUT_CLASS, 'pl-8 pr-8')}
        value={value}
        placeholder="Tag"
        title="Layouts with the same tag are shown together"
        onChange={(event) => {
          onChange(event.target.value);
          show();
        }}
        onFocus={show}
        onClick={show}
        // Tabbing away closes it; a press on a row never blurs (its mousedown is prevented).
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {typed ? (
        <button
          type="button"
          aria-label="Remove the tag"
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          // mousedown is prevented so the box keeps focus and the list stays as it is.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose('')}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : (
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      )}

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Tags"
          className="absolute left-0 z-20 mt-1 max-h-64 w-full min-w-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {rows.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Type a tag to file this layout under.</p>
          ) : (
            rows.map((row, index) => {
              const isCreate = isNew && index === rows.length - 1;
              const isSelected = !isCreate && studioTagKey(row) === studioTagKey(value);
              const Icon = isCreate ? Plus : Check;
              return (
                <div
                  key={isCreate ? 'new' : row}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  // Focus stays in the box (aria-activedescendant); -1 keeps the row out of the tab order.
                  tabIndex={-1}
                  // mousedown, not click: a click would blur the box first and close the list under the pointer.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(row);
                  }}
                  onMouseMove={() => setActive(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    index === active ? 'bg-accent text-accent-foreground' : null,
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      'size-4 shrink-0',
                      isCreate ? 'text-muted-foreground' : isSelected ? 'text-primary' : 'invisible',
                    )}
                  />
                  <span className={cn('min-w-0 flex-1 truncate', isSelected ? 'font-medium' : null)}>
                    {isCreate ? `New tag “${row}”` : row}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
