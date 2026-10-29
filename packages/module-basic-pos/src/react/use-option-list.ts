'use client';

import { type KeyboardEvent, useCallback, useEffect, useId, useState } from 'react';
import { nextOption } from './view/till.js';

/**
 * The keyboard half of the till's combobox (the customer picker, and the
 * order reference options of issue #30): a text box that keeps the focus
 * while ↑ ↓ move through the options under it, Enter takes the one they are
 * on, and Esc closes the list. ONE copy, so the two pickers cannot come to
 * answer the same key two ways.
 *
 * ⚠ ENTER TAKES ONLY AN OPTION CHOSEN WITH ↑ ↓. Nothing is pre-chosen, so an
 * Enter with nothing chosen falls through to the box's own Enter (save what
 * was typed): a walk-in called "Ana" is never rung up to "Ana Cruz", and a
 * typed "red cap" never becomes the first option.
 */
export function useOptionList({
  count,
  initiallyOpen = false,
  onChoose,
}: {
  /** How many options the list shows now. */
  count: number;
  /** Whether the list shows when the box first appears. */
  initiallyOpen?: boolean;
  /** Called with the index of the option Enter took. */
  onChoose: (index: number) => void;
}) {
  const listId = useId();
  const [listOpen, setListOpen] = useState(initiallyOpen);
  /** The option ↑ ↓ are on, as an index; null until one of them is pressed. */
  const [active, setActive] = useState<number | null>(null);

  // ↑ ↓ can move past what the list shows; keep the chosen one in sight.
  useEffect(() => {
    if (active === null) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  /** Shows the list (or hides it) and forgets the chosen option: the list under the cursor changed. Stable, for effects. */
  const show = useCallback((open: boolean) => {
    setListOpen(open);
    setActive(null);
  }, []);
  /** Forgets the chosen option, leaving the list as it is: the options were filtered again. Stable, for effects. */
  const resetActive = useCallback(() => setActive(null), []);

  /** True when the key was the list's, and the box must not act on it as well. */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setListOpen(true);
      setActive(nextOption(count, listOpen ? active : null, event.key === 'ArrowDown' ? 'down' : 'up'));
      return true;
    }
    if (event.key === 'Escape' && listOpen) {
      // ⚠ The first Escape closes the list only. Unprevented, the <dialog> takes it and the whole dialog closes.
      event.preventDefault();
      show(false);
      return true;
    }
    if (event.key !== 'Enter' || !listOpen || active === null || active >= count) return false;
    event.preventDefault();
    onChoose(active);
    return true;
  };

  return {
    listId,
    listOpen,
    active,
    show,
    resetActive,
    optionId: (index: number) => `${listId}-${index}`,
    onKeyDown,
    /** The ARIA the box carries as a combobox. */
    comboboxProps: {
      role: 'combobox' as const,
      'aria-expanded': listOpen,
      'aria-controls': listId,
      'aria-autocomplete': 'list' as const,
      'aria-activedescendant': listOpen && active !== null ? `${listId}-${active}` : undefined,
      autoComplete: 'off',
    },
  };
}
