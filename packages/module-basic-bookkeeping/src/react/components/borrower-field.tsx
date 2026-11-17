'use client';

import { cn, LIST_ITEM, LIST_KEYS, searchIntoList } from '@kwtech/web-ui/react';
import { type FocusEvent, type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import type { BooksBorrowerView, BooksLoanView } from '../books-client.js';
import {
  type BooksBorrowerSuggestion,
  borrowerSuggestions,
  existingBorrower,
  moreBorrowersText,
} from '../view/borrower-suggestions.js';
import { Field, INPUT_CLASS } from './controls.js';

/**
 * "Borrower" in Lend money, with the borrowers already recorded right under it
 * (issue #167): they show the moment the field takes focus, BEFORE anything is
 * typed, so lending again to somebody is one tap — and typing narrows them. A
 * name that matches nobody is still a new borrower, as before.
 *
 * - **Not a `<datalist>`:** a browser shows one only once something is typed
 *   (or after a second click, on some), and a phone often not at all — the
 *   very thing this field is for.
 * - **A dropdown, floating under the box** (the operator, 2026-11-17: in the
 *   flow it pushed the form down and read as part of it). Positioned inside
 *   the field rather than in a portal, so it scrolls with the dialog and never
 *   drifts from the box. Borrower is the dialog's first field, so the form below
 *   it always gives the list room inside the dialog.
 * - **Keys** are web-ui's list keys: ↓ from the box into the list, ↑ ↓ through
 *   it, Enter picks, Esc closes it (not the dialog).
 * - **Picking** fills the name, and the contact when its box is empty — never
 *   over a contact somebody typed.
 */
export function BorrowerField({
  value,
  onChange,
  onPick,
  borrowers,
  loans,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** A recorded borrower was picked: their name, and their newest loan's contact. */
  onPick: (picked: BooksBorrowerSuggestion) => void;
  borrowers: readonly BooksBorrowerView[];
  loans: readonly Pick<BooksLoanView, 'id' | 'contact' | 'createdAt'>[];
  error?: string | undefined;
  autoFocus?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Set while a pick hands the focus back to the box, so the list does not open again at once. */
  const picking = useRef(false);
  const { shown: suggestions, matched } = useMemo(
    () => borrowerSuggestions(borrowers, loans, value),
    [borrowers, loans, value],
  );
  const more = moreBorrowersText(suggestions.length, matched, value);
  const existing = existingBorrower(borrowers, value);
  const shown = open && suggestions.length > 0;
  // Said when the typed name already IS somebody: the loan joins theirs, rather than leaving them to wonder.
  const hint = existing ? `Adds to ${existing.borrowerName}’s loans.` : undefined;

  /**
   * Back to the box with the list shut. ⚠ The flag only when focus really
   * moves: a mouse pick or Esc leaves it in the box already, no focus event
   * would clear the flag, and the NEXT visit to the field would then open
   * nothing (self-review on #168).
   */
  const backToBox = () => {
    setOpen(false);
    if (document.activeElement === input.current) return;
    picking.current = true;
    input.current?.focus();
  };

  const pick = (suggestion: BooksBorrowerSuggestion) => {
    onPick(suggestion);
    backToBox();
  };

  /** Closes the list once focus leaves the box AND the list — not when it moves from one to the other. */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setOpen(false);
  };

  const intoList = searchIntoList(list);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // ⚠ Esc closes the list, not the dialog: a native dialog cancels on Esc's keydown unless it is stopped here.
    if (event.key === 'Escape' && shown) {
      event.preventDefault();
      event.stopPropagation();
      backToBox();
    }
  };

  return (
    <Field label="Borrower" hint={shown ? undefined : hint} error={error}>
      {(id, describedBy) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: the box and its list's shared Esc and focus-leaving; each control inside is a real input or button.
        <div className="relative" onBlur={onBlur} onKeyDown={onKeyDown}>
          <input
            ref={input}
            id={id}
            className={INPUT_CLASS}
            value={value}
            autoComplete="off"
            // biome-ignore lint/a11y/noAutofocus: a dialog's first field; `Modal` mounts the content after showModal() so this lands.
            autoFocus={autoFocus}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            aria-controls={shown ? listId : undefined}
            placeholder={borrowers.length > 0 ? 'Pick one below, or type a new name' : undefined}
            onFocus={() => {
              if (picking.current) {
                picking.current = false;
                return;
              }
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && !shown) setOpen(true);
              intoList(event);
            }}
          />
          {shown ? (
            <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
              <p className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {value.trim() ? 'Matching borrowers' : 'Recorded borrowers'}
              </p>
              <ul
                ref={list}
                id={listId}
                aria-label="Recorded borrowers"
                className="max-h-56 overflow-y-auto py-1"
                {...LIST_KEYS}
              >
                {suggestions.map((suggestion) => (
                  <li key={suggestion.key}>
                    <button
                      type="button"
                      {...LIST_ITEM}
                      // Keeps the focus in the box while the mouse is down, so the list is still there to click.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pick(suggestion)}
                      className={cn(
                        'flex min-h-11 w-full flex-col justify-center px-3 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                        existing?.key === suggestion.key ? 'bg-accent/60' : null,
                      )}
                    >
                      <span className="truncate text-sm font-medium">{suggestion.borrowerName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {suggestion.detail}
                        {suggestion.contact ? ` · ${suggestion.contact}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {more ? <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{more}</p> : null}
            </div>
          ) : null}
        </div>
      )}
    </Field>
  );
}
