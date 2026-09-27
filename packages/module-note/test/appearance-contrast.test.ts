import { readFileSync } from 'node:fs';
import { PALETTES } from '@kwtech/web-ui';
import { NOTE_COLORS, NOTE_LOOKS } from '../src/domain/appearance.js';
import {
  NOTE_LOOK_SPECS,
  NOTE_PROSE_RHYTHM,
  NOTE_TINTS,
  notePaperBackground,
  notePaperColor,
  tintOklch,
} from '../src/react/view/appearance.js';

/**
 * ⚠ THE THEME RULE, TESTED AGAINST THE REAL THEMES.
 *
 * A note's colour tints the app's `--card`; its text stays `--card-foreground`.
 * This reads both tokens for every palette `@kwtech/web-ui` ships, in light and
 * dark, from its public `themes/*.css`, applies every tint at every strength a
 * look uses, and holds the text to WCAG AA (4.5:1). A new palette or a new
 * colour is tested the day it lands.
 */

interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** `--card: oklch(1 0 250);` → the triple, from one block of a theme file. */
function token(block: string, name: string): Oklch {
  const match = new RegExp(`${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(block);
  if (!match) throw new Error(`${name} not found — the theme file changed shape; update this parser`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function themeTokens(palette: string): { mode: 'light' | 'dark'; card: Oklch; text: Oklch }[] {
  const css = readFileSync(require.resolve(`@kwtech/web-ui/themes/${palette}.css`), 'utf8');
  const darkAt = css.indexOf(`.dark [data-palette="${palette}"]`);
  if (darkAt < 0) throw new Error(`${palette} has no dark block`);
  const light = css.slice(0, darkAt);
  const dark = css.slice(darkAt);
  return [
    { mode: 'light', card: token(light, '--card'), text: token(light, '--card-foreground') },
    { mode: 'dark', card: token(dark, '--card'), text: token(dark, '--card-foreground') },
  ];
}

/** OKLCH → relative luminance (sRGB, clamped into gamut as a browser does). */
function luminance({ l, c, h }: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const r = clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  // These are LINEAR sRGB already, which is what relative luminance weighs.
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(x: Oklch, y: Oklch): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const strengths = [...new Set(NOTE_LOOKS.map((look) => NOTE_LOOK_SPECS[look].tint))];

describe('note colours follow the theme', () => {
  it('reads every palette the app can pick', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(10);
  });

  it.each(PALETTES.map((palette) => palette.id))('⚠ every colour keeps text readable in %s, light and dark', (id) => {
    for (const { mode, card, text } of themeTokens(id)) {
      for (const color of NOTE_COLORS) {
        for (const strength of strengths) {
          const ratio = contrast(tintOklch(card, color, strength), text);
          expect([id, mode, color, strength, ratio >= 4.5]).toEqual([id, mode, color, strength, true]);
        }
      }
    }
  });

  it('⚠ never names a fixed colour — every paper is derived from --card', () => {
    for (const color of NOTE_COLORS) {
      for (const strength of strengths) expect(notePaperColor(color, strength)).toMatch(/var\(--card\)/);
    }
  });

  it('keeps the default colour exactly the theme’s card', () => {
    expect(notePaperColor('default')).toBe('var(--card)');
  });

  it('gives every colour a tint entry', () => {
    expect(Object.keys(NOTE_TINTS).sort()).toEqual([...NOTE_COLORS].sort());
  });

  it('draws lines from the theme’s text colour, never a fixed one', () => {
    for (const look of NOTE_LOOKS) {
      const background = notePaperBackground(look);
      if (background !== 'none') expect(background).toMatch(/var\(--card-foreground\)/);
    }
  });
});

describe('the rule', () => {
  it('⚠ keeps every Markdown block on whole rules, so writing sits on the lines', () => {
    for (const [block, rhythm] of Object.entries(NOTE_PROSE_RHYTHM)) {
      expect([block, Number.isInteger(rhythm.lines), Number.isInteger(rhythm.after)]).toEqual([block, true, true]);
    }
  });
});
