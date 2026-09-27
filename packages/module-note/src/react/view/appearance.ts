import type { NoteColor, NoteFont, NoteLook } from '../../domain/appearance.js';

/**
 * What each look, colour and font LOOKS like — the web half of the appearance
 * presets (`domain/appearance.ts` holds the keys).
 *
 * ## ⚠ Everything is derived from the app's theme
 *
 * The operator's rule (NOTE-PLAN §6): customisation TINTS the theme, it never
 * replaces it. So no colour here is a fixed value. A note's paper is the
 * theme's own `--card` with its LIGHTNESS KEPT (nudged a little toward the
 * middle) and one hue added, written as CSS relative colour syntax:
 *
 *   oklch(from var(--card) calc(l + (0.5 - l) * PULL) calc(c + CHROMA) HUE)
 *
 * A dark theme's card is dark, so a yellow note there is a dark yellow; switching
 * palette or mode recolours every note with no setting touched. Text stays
 * `--card-foreground`. `test/appearance-contrast.test.ts` reads every palette's
 * real tokens from `@kwtech/web-ui/themes/*.css` and holds every colour, at
 * every strength, to 4.5:1 in light and dark.
 *
 * The alternative — a fixed colour per preset with a dark variant — is how the
 * queue's TV board works, and is right there because the board deliberately has
 * its OWN theme. A note lives inside the app and must not.
 */

/** One colour's tint: a hue, and how much colour it adds at normal strength. */
export interface NoteTint {
  /** OKLCH hue angle, degrees. */
  hue: number;
  /** Chroma ADDED to the card's own, at normal strength. */
  chroma: number;
}

/**
 * The tints. `default` adds nothing: the theme's card as it is.
 *
 * Grey adds no chroma and relies on the lightness pull alone, so it reads as a
 * slightly different sheet rather than a colour.
 */
export const NOTE_TINTS: Record<NoteColor, NoteTint> = {
  default: { hue: 0, chroma: 0 },
  yellow: { hue: 95, chroma: 0.05 },
  pink: { hue: 355, chroma: 0.04 },
  blue: { hue: 245, chroma: 0.035 },
  green: { hue: 150, chroma: 0.04 },
  purple: { hue: 305, chroma: 0.04 },
  grey: { hue: 0, chroma: 0 },
};

/**
 * How far a tinted page moves toward mid-lightness, as a share of the distance.
 * Enough to separate a white or near-black card from its tint; small enough
 * that the theme's text keeps its contrast. `default` does not move.
 */
export const NOTE_TINT_PULL = 0.05;

/**
 * How strongly a look applies the colour. A sticky note is the colour; a
 * notebook page is paper with a hint of it.
 */
export type NoteTintStrength = 'normal' | 'strong';
export const NOTE_TINT_STRENGTH: Record<NoteTintStrength, number> = { normal: 1, strong: 2 };

/**
 * The page colour as a CSS value. Used as the value of `--note-paper`, with
 * `var(--card)` declared first as the fallback for a browser without relative
 * colour syntax (it ignores the declaration it cannot parse).
 */
export function notePaperColor(color: NoteColor, strength: NoteTintStrength = 'normal'): string {
  if (color === 'default') return 'var(--card)';
  const tint = NOTE_TINTS[color];
  const chroma = round(tint.chroma * NOTE_TINT_STRENGTH[strength]);
  return `oklch(from var(--card) calc(l + (0.5 - l) * ${NOTE_TINT_PULL}) calc(c + ${chroma}) ${tint.hue})`;
}

/**
 * The same formula as `notePaperColor`, in numbers — for the contrast test and
 * for the colour dots, which must show what the page will be.
 */
export function tintOklch(
  card: { l: number; c: number; h: number },
  color: NoteColor,
  strength: NoteTintStrength = 'normal',
): { l: number; c: number; h: number } {
  if (color === 'default') return card;
  const tint = NOTE_TINTS[color];
  return {
    l: card.l + (0.5 - card.l) * NOTE_TINT_PULL,
    c: card.c + tint.chroma * NOTE_TINT_STRENGTH[strength],
    h: tint.hue,
  };
}

// ── fonts ───────────────────────────────────────────────────────────────────

/**
 * A font: the stack, and how big it sets relative to the app's text.
 *
 * ⚠ THE APP LOADS THE FACES, not this module (`/react` cannot depend on Next).
 * The web app self-hosts them with `next/font` and names them in the three
 * `--note-font-*` variables; a host that does not gets the fallbacks, which
 * degrade rather than break. Sans and mono ARE the app's own variables.
 */
export interface NoteFontFace {
  family: string;
  /**
   * Font size as a multiple of the base, so every font reads at about the same
   * size: Caveat's small x-height needs a larger size to match Geist's.
   */
  scale: number;
}

export const NOTE_FONT_FACES: Record<NoteFont, NoteFontFace> = {
  hand: { family: 'var(--note-font-hand), ui-rounded, var(--font-sans), system-ui, sans-serif', scale: 0.95 },
  script: { family: 'var(--note-font-script), "Segoe Script", cursive', scale: 1.3 },
  sans: { family: 'var(--font-sans), system-ui, sans-serif', scale: 1 },
  serif: { family: 'var(--note-font-serif), ui-serif, Georgia, serif', scale: 1.02 },
  mono: { family: 'var(--font-mono), ui-monospace, monospace', scale: 0.92 },
};

/** The CSS variables the web app must define for the faces above. Documented in the README. */
export const NOTE_FONT_VARIABLES = ['--note-font-hand', '--note-font-script', '--note-font-serif'] as const;

// ── looks ───────────────────────────────────────────────────────────────────

/**
 * ⚠ THE RULE. One line of writing, in rem. Every line of text on a page — the
 * title, paragraphs, list items, headings, code — is exactly this tall, and
 * every gap is a whole number of it, so writing sits on the Notebook's rules
 * and in the Grid's squares whichever font is chosen. The height is FIXED
 * rather than measured from the font, so a face arriving late (they load on
 * demand) moves no line.
 */
export const NOTE_RULE_REM = 1.75;

export interface NoteLookSpec {
  /** Whether the paper carries lines (Notebook) or a grid (Grid) on the rule. */
  lines: 'none' | 'ruled' | 'grid';
  /** How strongly the note's colour is applied. */
  tint: NoteTintStrength;
  /** A notebook opens as two pages when wide; the rest show the index beside a page. */
  spread: boolean;
}

export const NOTE_LOOK_SPECS: Record<NoteLook, NoteLookSpec> = {
  plain: { lines: 'none', tint: 'normal', spread: false },
  paper: { lines: 'none', tint: 'normal', spread: false },
  notebook: { lines: 'ruled', tint: 'normal', spread: true },
  sticky: { lines: 'none', tint: 'strong', spread: false },
  grid: { lines: 'grid', tint: 'normal', spread: false },
};

/**
 * The paper background for a look, as CSS: lines drawn in the theme's own text
 * colour at low opacity, so they flip with it.
 */
export function notePaperBackground(look: NoteLook): string {
  const line = 'color-mix(in oklch, var(--card-foreground) 13%, transparent)';
  const rule = `${NOTE_RULE_REM}rem`;
  switch (NOTE_LOOK_SPECS[look].lines) {
    case 'none':
      return 'none';
    case 'ruled':
      return `repeating-linear-gradient(to bottom, transparent 0, transparent calc(${rule} - 1px), ${line} calc(${rule} - 1px), ${line} ${rule})`;
    case 'grid':
      return [
        `repeating-linear-gradient(to bottom, transparent 0, transparent calc(${rule} - 1px), ${line} calc(${rule} - 1px), ${line} ${rule})`,
        `repeating-linear-gradient(to right, transparent 0, transparent calc(${rule} - 1px), ${line} calc(${rule} - 1px), ${line} ${rule})`,
      ].join(', ');
  }
}

/**
 * Markdown's vertical rhythm, in RULES. Every block is `lines` rules tall per
 * line of text and leaves `after` blank rules below it, so nothing drifts off
 * the lines. Tested: every value is a whole number.
 */
export const NOTE_PROSE_RHYTHM = {
  paragraph: { lines: 1, after: 1 },
  heading: { lines: 1, after: 0 },
  listItem: { lines: 1, after: 0 },
  list: { lines: 1, after: 1 },
  quote: { lines: 1, after: 1 },
  code: { lines: 1, after: 1 },
  rule: { lines: 1, after: 0 },
  tableRow: { lines: 1, after: 0 },
} as const satisfies Record<string, { lines: number; after: number }>;

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
