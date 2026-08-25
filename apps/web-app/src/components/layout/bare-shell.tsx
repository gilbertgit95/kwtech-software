import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/layout/theme-toggle';

/**
 * The frame for routes that declare `chrome: 'bare'` — the pages you reach
 * because you have no session yet.
 *
 * It adds exactly one thing to the page: the theme control. Those pages bring
 * their own centred card (module-auth's `AuthShell`), so this does not lay
 * anything out; it only makes sure the appearance choice is reachable before
 * sign-in rather than only after it. Someone who needs dark mode needs it on
 * the sign-in screen too.
 *
 * Pinned to the corner rather than placed in a header, because these pages
 * have no header and a centred card should stay centred.
 */
export function BareShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh">
      {children}
      {/*
       * LAST in the DOM, first in the corner. It is positioned absolutely, so
       * its visual place is independent of its order here — and coming after
       * the card means Tab reaches the e-mail field before it reaches a colour
       * preference.
       */}
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle className="focus-visible:ring-offset-background" />
      </div>
    </div>
  );
}
