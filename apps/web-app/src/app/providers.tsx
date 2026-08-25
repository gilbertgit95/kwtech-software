'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

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
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
    >
      {children}
    </ThemeProvider>
  );
}
