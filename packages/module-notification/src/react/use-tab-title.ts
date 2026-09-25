'use client';

import { useEffect } from 'react';
import { stripTabTitle, tabTitle } from '../domain/unread.js';

/**
 * "(3) kwtech" — the unread count in the tab's title, which is how people notice
 * a notification in a background tab.
 *
 * ⚠ It WRAPS the title the app sets rather than owning it. Next rewrites
 * `<title>` on every navigation, so an observer re-applies the prefix after each
 * rewrite; `tabTitle` strips its own prefix first, so re-applying never stacks
 * into "(2) (3) kwtech". On unmount the prefix is removed.
 *
 * ⚠ ONE OWNER. If another module ever wants its count in the title too, the two
 * must be summed in one place (a module-kit slot), never prefixed twice.
 */
export function useTabTitle(count: number): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const apply = () => {
      const wanted = tabTitle(document.title, count);
      // The comparison is what stops the observer re-triggering itself forever.
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = stripTabTitle(document.title);
    };
  }, [count]);
}
