/**
 * How notes LOOK — the looks, fonts and colours on offer (NOTE-PLAN §6).
 *
 * ## Two owners
 *
 *   colour — belongs to a NOTE. Set by whoever may edit it, seen by everybody
 *            who can see it, like the colour of a sticky note.
 *   look, font, default colour — belong to a PERSON, per workspace. Everybody
 *            reads every note, shared ones included, in their own.
 *
 * ## Presets, stored as text
 *
 * Not Prisma enums: adding a look, a font or a colour is then a code change
 * rather than a migration, and a value that stops being offered reads back as
 * its default instead of breaking the app — the queue's `domain/voice.ts`.
 *
 * Only the KEYS and LABELS live here. What each one looks like — hues, font
 * stacks, line heights — is the web half's catalogue, because a server has no
 * use for it.
 *
 * ## ⚠ Everything follows the app's theme
 *
 * A colour or a look TINTS the theme; it never replaces it. `default` is the
 * theme's own card, every other colour is that card with one hue mixed in, and
 * text stays the theme's foreground — so the palette the app picked, and light
 * or dark mode, still decide what a yellow note looks like. A colour stored as a
 * fixed value would be right in one palette and one mode, and wrong in the rest.
 */

export const NOTE_LOOKS = ['notebook', 'plain', 'paper', 'sticky', 'grid'] as const;
export const NOTE_FONTS = ['hand', 'script', 'sans', 'serif', 'mono'] as const;
export const NOTE_COLORS = ['default', 'yellow', 'pink', 'blue', 'green', 'purple', 'grey'] as const;

export type NoteLook = (typeof NOTE_LOOKS)[number];
export type NoteFont = (typeof NOTE_FONTS)[number];
export type NoteColor = (typeof NOTE_COLORS)[number];

/** One person's appearance settings in one workspace. */
export interface NoteSettings {
  look: NoteLook;
  font: NoteFont;
  /** The colour a NEW note starts with. Changing it recolours nothing. */
  defaultColor: NoteColor;
}

/**
 * What somebody who never opened the settings sees: a notebook, written in the
 * semi-handwritten font, on the theme's own paper.
 */
export const DEFAULT_NOTE_SETTINGS: NoteSettings = {
  look: 'notebook',
  font: 'hand',
  defaultColor: 'default',
};

export const NOTE_APPEARANCE_LABELS = {
  look: { notebook: 'Notebook', plain: 'Plain', paper: 'Paper', sticky: 'Sticky notes', grid: 'Grid' },
  font: { hand: 'Handwritten', script: 'Script', sans: 'Sans', serif: 'Serif', mono: 'Mono' },
  color: {
    default: 'Default',
    yellow: 'Yellow',
    pink: 'Pink',
    blue: 'Blue',
    green: 'Green',
    purple: 'Purple',
    grey: 'Grey',
  },
} as const satisfies {
  look: Record<NoteLook, string>;
  font: Record<NoteFont, string>;
  color: Record<NoteColor, string>;
};

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value);

export function isNoteColor(value: unknown): value is NoteColor {
  return oneOf(NOTE_COLORS, value);
}

/** A stored colour as one on offer. One that stopped being offered reads as the default. */
export function normalizeNoteColor(value: unknown): NoteColor {
  return isNoteColor(value) ? value : 'default';
}

type SettingsInput = Partial<Record<keyof NoteSettings, unknown>>;

/**
 * The first setting that is not one of the choices, or null when all are.
 *
 * ⚠ ALL THREE ARE REQUIRED. A write replaces the whole row, so a missing field
 * is refused rather than quietly reset to its default.
 */
export function noteSettingsRefusal(input: SettingsInput): keyof NoteSettings | null {
  if (!oneOf(NOTE_LOOKS, input.look)) return 'look';
  if (!oneOf(NOTE_FONTS, input.font)) return 'font';
  if (!isNoteColor(input.defaultColor)) return 'defaultColor';
  return null;
}

/** Whatever was stored, as settings the app can use. No row, or a retired value, reads as the default. */
export function normalizeNoteSettings(input: SettingsInput | null | undefined): NoteSettings {
  const value = input ?? {};
  return {
    look: oneOf(NOTE_LOOKS, value.look) ? value.look : DEFAULT_NOTE_SETTINGS.look,
    font: oneOf(NOTE_FONTS, value.font) ? value.font : DEFAULT_NOTE_SETTINGS.font,
    defaultColor: isNoteColor(value.defaultColor) ? value.defaultColor : DEFAULT_NOTE_SETTINGS.defaultColor,
  };
}
