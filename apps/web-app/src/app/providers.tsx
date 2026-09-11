'use client';

import { RealtimeProvider, StatusProvider } from '@kwtech/module-kit/react';
import { createRealtimeConnection } from '@kwtech/module-kit/realtime';
import { ThemeProvider } from 'next-themes';
import { type ReactNode, useMemo } from 'react';

import { THEME_STORAGE_KEY } from '@/lib/preferences';

/**
 * The client providers mounted around every page.
 *
 * `attribute="class"` is load-bearing: @kwtech/web-ui's stylesheet declares
 * `@custom-variant dark (&:where(.dark, .dark *))`, so the whole palette swaps
 * on a `.dark` class and nothing else. Switching this to next-themes' default
 * `data-theme` attribute would leave every `dark:` utility dead with no error
 * to notice.
 *
 * `enableSystem` with `defaultTheme="system"` is what makes "System" a real
 * option in the toggle rather than a label with nothing behind it.
 *
 * `disableTransitionOnChange` suppresses CSS transitions for the instant the
 * class flips. Without it, every element with a colour transition animates its
 * own way to the new palette and the switch arrives as a ripple.
 *
 * `storageKey` names the localStorage entry `kwtech_theme`, matching the
 * `kwtech_` prefix on the two preference cookies. Left unset it would default
 * to a bare `theme`, which two of these apps on one machine would share — and
 * `pnpm dev` runs exactly that arrangement.
 *
 * PermissionsProvider is deliberately NOT here: it needs a value fetched on
 * the server per request, so it is mounted by AppShell, which has one.
 *
 * StatusProvider IS here, and for the mirror-image reason: it starts empty and
 * fills up from the client, and it has to sit above BOTH shells. Mounting it in
 * AppShell would leave the sign-in page — where "cannot reach the server" is the
 * single most useful thing the app could say — with nowhere to say it.
 *
 * RealtimeProvider is here for BOTH reasons at once — see below.
 */
export function Providers({ children }: { children: ReactNode }) {
  /*
   * ⚠ ONE SOCKET PER TAB, OPENED HERE, and this is the only place in the whole
   * repo that calls `createRealtimeConnection` (PLAN §12.39).
   *
   * Every module subscribes through `useRealtime()` and none of them opens
   * anything. A module that called this for itself would get a second socket,
   * with its own ticket, its own reconnect and its own share of the server's
   * connection budget — and nothing would fail, which is what makes it worth
   * preventing structurally rather than by convention.
   *
   * The factory's identity has to be STABLE — the provider reopens the socket
   * when it changes, and a new function on every render would reopen it on
   * every render. `useMemo` over the URL is that, and it also makes "no URL" an
   * absent factory rather than one that throws.
   *
   * ⚠ `NEXT_PUBLIC_WS_URL` read INLINE rather than through `config/env.ts`.
   * That file is a server-side boot assertion over `process.env`, and this
   * value is inlined into the client bundle at build time — reaching it through
   * a server module would give the browser `undefined`. Its absence is not an
   * error: the app runs without a socket and every screen still reads over
   * HTTP, which is the property that lets realtime be an enhancement.
   */
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  const connect = useMemo(
    () =>
      wsUrl
        ? () =>
            createRealtimeConnection({
              wsUrl,
              /*
               * Reported, never thrown. A failed upgrade — a proxy that blocks
               * them, a server restart — must not take a page down; it means
               * the screens stop updating by themselves, which is exactly what
               * they do in an app with no socket at all.
               */
              onError: (error) => console.warn('Realtime:', error.message),
            })
        : undefined,
    [wsUrl],
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
    >
      <StatusProvider>
        <RealtimeProvider connect={connect}>{children}</RealtimeProvider>
      </StatusProvider>
    </ThemeProvider>
  );
}
