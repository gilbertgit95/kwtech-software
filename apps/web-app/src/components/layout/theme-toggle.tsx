'use client';

import { type ThemeMode, ThemeSwitcher } from '@kwtech/web-ui/react';
import { useTheme } from 'next-themes';

/**
 * Wires this app's mode source to the shared control.
 *
 * `@kwtech/web-ui/react` owns the menu and owns the palette outright; the mode
 * arrives as a prop because that package must not require `next-themes` of
 * every consumer — a plain React app, or the planned mobile-ui, would inherit a
 * dependency solving a problem it did not have. This file IS that seam, and it
 * is the whole of it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <ThemeSwitcher
      // `theme` is undefined until next-themes reads storage. Passed straight
      // through rather than defaulted, so the menu checks nothing instead of
      // checking the wrong row and correcting itself a moment later.
      mode={theme as ThemeMode | undefined}
      onModeChange={(mode) => setTheme(mode)}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
