import {
  DISPLAY_THEME_STORAGE_KEY,
  isDarkDisplay,
  parseDisplayTheme,
  serializeDisplayTheme,
} from '../src/react/view/display-theme.js';

/**
 * A TV's own theme. It is read back on every visit to that screen, so anything
 * it cannot use must fall back to a theme that works rather than an unstyled
 * board.
 */

const PALETTES = ['neutral', 'ocean', 'forest'];

describe('the screen theme', () => {
  it('⚠ has its own key, never the app’s kwtech_theme or kwtech_palette', () => {
    expect(DISPLAY_THEME_STORAGE_KEY).toBe('kwtech_queue_display_theme');
  });

  it('round-trips what the screen chose', () => {
    const theme = { mode: 'dark', palette: 'ocean' } as const;
    expect(parseDisplayTheme(serializeDisplayTheme(theme), PALETTES, 'neutral')).toEqual(theme);
  });

  it.each([
    ['nothing stored', null],
    ['not JSON', '{oops'],
    ['JSON null', 'null'],
    ['an unknown mode and palette', JSON.stringify({ mode: 'sepia', palette: 'plaid' })],
  ])('falls back to system and the default palette for %s', (_label, raw) => {
    expect(parseDisplayTheme(raw, PALETTES, 'neutral')).toEqual({ mode: 'system', palette: 'neutral' });
  });

  it('keeps the valid half of a half-valid theme', () => {
    expect(parseDisplayTheme(JSON.stringify({ mode: 'light', palette: 'plaid' }), PALETTES, 'neutral')).toEqual({
      mode: 'light',
      palette: 'neutral',
    });
  });

  it('follows the TV’s own setting only for system', () => {
    expect(isDarkDisplay('system', true)).toBe(true);
    expect(isDarkDisplay('system', false)).toBe(false);
    expect(isDarkDisplay('light', true)).toBe(false);
    expect(isDarkDisplay('dark', false)).toBe(true);
  });
});
