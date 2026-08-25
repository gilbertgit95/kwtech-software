/**
 * The palettes shipped in ./themes, as data.
 *
 * Exported so a palette picker is generated rather than transcribed: a UI that
 * hard-codes this list drifts the moment a theme is added, and the drift is
 * silent — the new palette simply never appears in the menu.
 *
 * `id` IS the `data-palette` attribute value and the CSS file name. One string,
 * so there is no mapping table to keep in step.
 */
export interface PaletteOption {
  id: string;
  label: string;
  /** One line, for a menu or a settings page. */
  description: string;
}

/**
 * Ordered around the colour wheel, not alphabetically: a picker that maps over
 * this reads as a spectrum, and neighbouring entries are the ones a viewer is
 * most likely to compare.
 */
export const PALETTES: readonly PaletteOption[] = [
  { id: 'neutral', label: 'Neutral', description: 'Grayscale — nothing competes with content' },
  { id: 'crimson', label: 'Crimson', description: 'Deep red' },
  { id: 'rose', label: 'Rose', description: 'Warm pink' },
  { id: 'ember', label: 'Ember', description: 'Warm amber' },
  { id: 'clay', label: 'Clay', description: 'Muted brown' },
  { id: 'gold', label: 'Gold', description: 'Yellow' },
  { id: 'forest', label: 'Forest', description: 'Green' },
  { id: 'teal', label: 'Teal', description: 'Blue-green' },
  { id: 'ocean', label: 'Ocean', description: 'Cool blue' },
  { id: 'violet', label: 'Violet', description: 'Purple' },
];

/**
 * What an app falls back to when nothing is stored — and what the server
 * renders, since it cannot read the viewer's choice.
 *
 * Neutral, because a grayscale palette cannot clash with whatever the app puts
 * on top of it. This value is also what a visitor with JavaScript disabled sees
 * permanently, so the safe answer matters more here than the interesting one.
 */
export const DEFAULT_PALETTE = 'neutral';

/**
 * Guards a stored or user-supplied value before it reaches the DOM.
 *
 * The palette id becomes an attribute selector, so an unknown value silently
 * matches no rules and renders an unstyled page. Falling back is the honest
 * behaviour for a preference read from a cookie a user can edit.
 */
export function isPalette(value: string | undefined | null): boolean {
  return PALETTES.some((palette) => palette.id === value);
}
