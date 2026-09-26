import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand/brand-logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { ConnectivityMonitor } from '@/components/status/connectivity-monitor';
import { StatusBarHost } from '@/components/status/status-bar-host';
import { appBrand } from '@/config/env';

/**
 * The frame for routes that declare `chrome: 'bare'` — the pages you reach
 * because you have no session yet.
 *
 * It adds the theme control, and the logo in the other corner. Those pages bring
 * their own centred card (module-auth's `AuthShell`), so this does not lay
 * anything out; it only makes sure the appearance choice is reachable before
 * sign-in rather than only after it. Someone who needs dark mode needs it on
 * the sign-in screen too.
 *
 * Pinned to the corner rather than placed in a header, because these pages
 * have no header and a centred card should stay centred.
 *
 * ── and the status bar ──────────────────────────────────────────────────────
 *
 * The other thing it adds, and the reason it is not merely a convenience here:
 * a sign-in that fails because the API is down looks exactly like a sign-in
 * that fails because the password is wrong. This is the one screen where
 * "cannot reach the server" changes what the reader should do next, so leaving
 * the bar to the signed-in shell would omit it precisely where it matters most.
 */
export function BareShell({ children }: { children: ReactNode }) {
  const { name } = appBrand();
  return (
    <div className="relative min-h-dvh">
      <ConnectivityMonitor />
      {children}
      {/*
       * The logo and the product name, in the corner OPPOSITE the theme
       * control: these pages have no header to carry them, and pinning them
       * absolutely keeps the card exactly where it was. After the card in the
       * DOM for the same reason as the toggle — it is not what Tab should reach
       * first. The logo is decoration here; the name beside it is the label.
       */}
      <div className="absolute left-4 top-4 flex items-center gap-2 sm:left-6 sm:top-6">
        <BrandLogo className="h-8" />
        <span className="text-sm font-semibold tracking-tight text-foreground">{name}</span>
      </div>
      {/*
       * LAST in the DOM, first in the corner. It is positioned absolutely, so
       * its visual place is independent of its order here — and coming after
       * the card means Tab reaches the e-mail field before it reaches a colour
       * preference.
       */}
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle className="focus-visible:ring-offset-background" />
      </div>

      {/*
       * FIXED here, where the app shell has it as a flex item.
       *
       * These pages centre a card in the viewport rather than laying out a
       * column, so there is no bottom of a flow for the bar to sit at — and
       * giving this one a flex column purely to place it would move the card
       * off centre. Nothing scrolls on these pages, so a fixed strip covers
       * nothing.
       */}
      <StatusBarHost className="fixed inset-x-0 bottom-0 z-40" />
    </div>
  );
}
