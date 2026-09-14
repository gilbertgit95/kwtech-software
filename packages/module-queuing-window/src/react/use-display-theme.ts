'use client';

import { DEFAULT_PALETTE, PALETTES } from '@kwtech/web-ui';
import { useCallback, useEffect, useState } from 'react';
import {
  DISPLAY_THEME_STORAGE_KEY,
  type DisplayTheme,
  type DisplayThemeMode,
  isDarkDisplay,
  parseDisplayTheme,
  serializeDisplayTheme,
} from './view/display-theme.js';

/** The attribute every palette's tokens are scoped to — see @kwtech/web-ui's palette runtime. */
const PALETTE_ATTRIBUTE = 'data-palette';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const PALETTE_IDS = PALETTES.map((palette) => palette.id);

export interface DisplayThemeState {
  /** Undefined until this browser's storage has been read, so nothing is checked wrongly first. */
  mode: DisplayThemeMode | undefined;
  palette: string | undefined;
  setMode: (mode: DisplayThemeMode) => void;
  setPalette: (palette: string) => void;
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(DISPLAY_THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(theme: DisplayTheme): void {
  try {
    globalThis.localStorage?.setItem(DISPLAY_THEME_STORAGE_KEY, serializeDisplayTheme(theme));
  } catch {
    // No storage (a locked-down TV browser): the choice holds until the page reloads.
  }
}

/**
 * The TV screen's own theme, applied to the page while it is open.
 *
 * ## ⚠ Applied to <html>, and HELD there
 *
 * Every palette's tokens and the `dark:` variant hang off the root element, so
 * a wrapper cannot force a light screen inside a dark app. This sets the root
 * while the display is mounted. `next-themes` owns that element for the rest of
 * the app and rewrites its class when the system scheme flips or another tab
 * changes the app's theme; a MutationObserver puts the screen's choice back,
 * writing only when something differs so it cannot loop. On unmount the root
 * is returned exactly as it was found.
 *
 * Read after mount, never during render: localStorage does not exist on the
 * server. A TV therefore paints the browser's app theme for a moment on load,
 * then its own.
 */
export function useDisplayTheme(): DisplayThemeState {
  const [theme, setTheme] = useState<DisplayTheme | null>(null);

  useEffect(() => {
    setTheme(parseDisplayTheme(readStored(), PALETTE_IDS, DEFAULT_PALETTE));
  }, []);

  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (!theme || !root) return;

    const media = globalThis.matchMedia?.(DARK_QUERY);
    const found = {
      dark: root.classList.contains('dark'),
      palette: root.getAttribute(PALETTE_ATTRIBUTE),
      colorScheme: root.style.colorScheme,
    };

    const apply = () => {
      const dark = isDarkDisplay(theme.mode, media?.matches ?? false);
      if (root.classList.contains('dark') !== dark) root.classList.toggle('dark', dark);
      if (root.getAttribute(PALETTE_ATTRIBUTE) !== theme.palette) root.setAttribute(PALETTE_ATTRIBUTE, theme.palette);
      root.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();

    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ['class', PALETTE_ATTRIBUTE] });
    media?.addEventListener?.('change', apply);

    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', apply);
      root.classList.toggle('dark', found.dark);
      if (found.palette) root.setAttribute(PALETTE_ATTRIBUTE, found.palette);
      else root.removeAttribute(PALETTE_ATTRIBUTE);
      root.style.colorScheme = found.colorScheme;
    };
  }, [theme]);

  const update = useCallback(
    (change: Partial<DisplayTheme>) => {
      const next = { ...(theme ?? parseDisplayTheme(null, PALETTE_IDS, DEFAULT_PALETTE)), ...change };
      writeStored(next);
      setTheme(next);
    },
    [theme],
  );

  return {
    mode: theme?.mode,
    palette: theme?.palette,
    setMode: useCallback((mode: DisplayThemeMode) => update({ mode }), [update]),
    setPalette: useCallback((palette: string) => update({ palette }), [update]),
  };
}
