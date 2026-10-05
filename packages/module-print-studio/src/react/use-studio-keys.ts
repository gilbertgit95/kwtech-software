'use client';

import { type RefObject, useEffect, useRef } from 'react';
import { studioKeyOfPress } from '../domain/keymap.js';
import { isTypingTarget } from './view/keys.js';

/**
 * Listen for shortcut keys for one screen.
 *
 * `perform` is given the key's name (`studioKeyOfPress`) and answers whether it
 * did anything; only then is the browser's own handling of the key stopped. A
 * key that does nothing here is left entirely alone.
 *
 * ## Which presses are this screen's
 *
 *   - Inside the screen (`root`), unless somebody is typing or choosing in a
 *     field — a "D" in the copies box is a letter (`isTypingTarget`).
 *   - With the focus on NOTHING (the page body), while the screen is showing:
 *     clicking the sheet's background leaves the focus nowhere, and the keys
 *     should not go deaf for it. The point of sale learnt this the same way.
 *   - Never while the focus is in another app on the Apps page, in a dialog,
 *     or when this screen is hidden behind another tab.
 *
 * ⚠ ONE LISTENER, INSTALLED ONCE. It reads the latest `perform` through a ref,
 * so a screen that re-renders on every drag does not re-subscribe on every drag.
 */
export function useStudioKeys(root: RefObject<HTMLElement | null>, perform: (key: string) => boolean): void {
  const latest = useRef(perform);
  latest.current = perform;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = root.current;
      const target = event.target;
      // Hidden (another section, or another tab of the Apps page): the screen takes nothing.
      if (!element || element.offsetParent === null || !(target instanceof Element)) return;
      const inside = element.contains(target);
      if (!inside && target !== document.body) return;
      if (target.closest('dialog, [contenteditable]')) return;
      const key = studioKeyOfPress(event);
      if (key === null || isTypingTarget(target.tagName, key)) return;
      if (latest.current(key)) event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [root]);
}
