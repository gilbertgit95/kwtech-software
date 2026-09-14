/**
 * A TV screen's own theme — pure, and tested without a browser.
 *
 * ## ⚠ Its own key, not the app's
 *
 * The app keeps light/dark in `kwtech_theme` and the palette in
 * `kwtech_palette`. A waiting-room TV is often a browser somebody also signs in
 * on to set it up, and a theme picked for the room must not repaint the app for
 * them — or the reverse. So the screen's choice lives under one key of its own,
 * in this browser only: nothing is sent to the server, and the next visit on
 * this TV finds it again.
 */

export type DisplayThemeMode = 'light' | 'dark' | 'system';

export interface DisplayTheme {
  mode: DisplayThemeMode;
  palette: string;
}

export const DISPLAY_THEME_STORAGE_KEY = 'kwtech_queue_display_theme';

const MODES: readonly DisplayThemeMode[] = ['light', 'dark', 'system'];

/**
 * The stored theme, or the defaults for anything missing, malformed or no
 * longer offered — a palette removed from the app reads as the default rather
 * than leaving the screen unstyled.
 */
export function parseDisplayTheme(
  raw: string | null,
  palettes: readonly string[],
  defaultPalette: string,
): DisplayTheme {
  const fallback: DisplayTheme = { mode: 'system', palette: defaultPalette };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof DisplayTheme, unknown>> | null;
    return {
      mode: MODES.includes(value?.mode as DisplayThemeMode) ? (value?.mode as DisplayThemeMode) : fallback.mode,
      palette:
        typeof value?.palette === 'string' && palettes.includes(value.palette) ? value.palette : fallback.palette,
    };
  } catch {
    return fallback;
  }
}

export function serializeDisplayTheme(theme: DisplayTheme): string {
  return JSON.stringify({ mode: theme.mode, palette: theme.palette });
}

/** Whether the screen should be dark: `system` follows the TV's own setting. */
export function isDarkDisplay(mode: DisplayThemeMode, systemPrefersDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark);
}
