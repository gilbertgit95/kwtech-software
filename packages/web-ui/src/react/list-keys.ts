'use client';

import type { KeyboardEvent, RefObject } from 'react';

/**
 * ↑ ↓ through a list of choices, and Enter on the one in focus — for every list
 * where a person picks one row of several: held orders, a variant, the orders,
 * customers and items lists, investors, loans.
 *
 * ## How a list takes part
 *
 *   <input onKeyDown={searchIntoList(ref)} />  optional: a search box above it
 *   <ul ref={ref} {...LIST_KEYS}>              the list: `data-list` + the handler
 *     <li><button {...LIST_ITEM} …/></li>      each choice: a real <button>
 *
 * - ↑ ↓ move the FOCUS to the previous or next choice, wrapping at the ends so a
 *   short list is never a dead end; Home and End go to the first and last.
 * - ENTER IS THE BUTTON'S OWN: a focused <button> clicks on Enter (and Space)
 *   natively, so "open it" needs nothing here — and a row behaves the same
 *   whether it was reached with the mouse, Tab or an arrow.
 * - Moving never opens anything: focus moves, Enter decides (the operator,
 *   2026-10-03). A list whose rows opened on arrival would load an order per
 *   key press and lose the one the person was heading for.
 * - Disabled choices are skipped (the held order already on the till).
 *
 * ⚠ ONLY WHILE FOCUS IS ON A CHOICE. The handler leaves keys typed into a box
 * alone, so a search field inside the same container still moves its caret; a
 * search box hands over to the list on ↓ with `searchIntoList`.
 *
 * ⚠ IT STOPS THE KEY THERE. The point of sale's till listens for ↑ ↓ to move
 * between cart lines; without `stopPropagation` an arrow in the held-orders
 * dialog would move both.
 *
 * Here rather than in each module because two modules need it (the point of
 * sale and the books), and two copies of "which way does ↑ go" drift.
 */

/** Marks the list whose choices the arrows move between. */
export const LIST_ATTRIBUTE = 'data-list';

/** Marks one choice in a list. Put it on the focusable element itself (the button). */
export const LIST_ITEM_ATTRIBUTE = 'data-list-item';

export type ListMove = 'up' | 'down' | 'first' | 'last';

/**
 * The index to move to among `enabled` choices (true = may take focus), from
 * `current` (null: none focused yet — ↓ takes the first, ↑ the last). Wraps at
 * both ends. Null when no choice can take focus.
 */
export function nextListIndex(enabled: readonly boolean[], current: number | null, move: ListMove): number | null {
  const count = enabled.length;
  if (!enabled.some(Boolean)) return null;
  const step = move === 'up' || move === 'last' ? -1 : 1;
  let index: number;
  if (move === 'first') index = -1;
  else if (move === 'last') index = count;
  else index = current === null || current < 0 || current >= count ? (step > 0 ? -1 : count) : current;
  for (let tried = 0; tried < count; tried += 1) {
    index = (index + step + count) % count;
    if (enabled[index]) return index;
  }
  return null;
}

const MOVES: Readonly<Record<string, ListMove>> = {
  ArrowDown: 'down',
  ArrowUp: 'up',
  Home: 'first',
  End: 'last',
};

/** The choices of `list` itself — not of a list nested inside one of them. */
function choicesOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(`[${LIST_ITEM_ATTRIBUTE}]`)).filter(
    (item) => item.closest(`[${LIST_ATTRIBUTE}]`) === list,
  );
}

function isEnabled(item: HTMLElement): boolean {
  return !(item as HTMLButtonElement).disabled && item.getAttribute('aria-disabled') !== 'true';
}

/** The list's key handler: ↑ ↓ Home End between its choices. See the module comment. */
export function onListKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const move = MOVES[event.key];
  if (!move || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement;
  // A box being typed in keeps its keys: ↑ ↓ move its caret, Home / End its text.
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const list = event.currentTarget;
  const choices = choicesOf(list);
  const current = choices.findIndex((item) => item === target || item.contains(target));
  const next = nextListIndex(choices.map(isEnabled), current === -1 ? null : current, move);
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  choices[next]?.focus();
  choices[next]?.scrollIntoView({ block: 'nearest' });
}

/** Spread on a list: `<ul {...LIST_KEYS}>`. */
export const LIST_KEYS = { [LIST_ATTRIBUTE]: '', onKeyDown: onListKeyDown } as const;

/** Spread on each choice's button: `<button {...LIST_ITEM}>`. */
export const LIST_ITEM = { [LIST_ITEM_ATTRIBUTE]: '' } as const;

/**
 * Moves focus to the first enabled choice of `list`, for a search box's ↓.
 * True when one took it — the caller then prevents the key's default.
 */
export function focusFirstListItem(list: HTMLElement | null): boolean {
  if (!list) return false;
  const first = choicesOf(list).find(isEnabled);
  if (!first) return false;
  first.focus();
  first.scrollIntoView({ block: 'nearest' });
  return true;
}

/**
 * A search box's key handler: ↓ leaves the box for the first choice of the list
 * below it, so finding one and opening it never needs the mouse. Every other
 * key stays the box's own — and so does ↓ while the list is empty.
 */
export function searchIntoList(list: RefObject<HTMLElement | null>): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!focusFirstListItem(list.current)) return;
    event.preventDefault();
    event.stopPropagation();
  };
}
