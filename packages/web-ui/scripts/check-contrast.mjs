#!/usr/bin/env node
/**
 * Checks every theme in src/themes against WCAG contrast minimums.
 *
 * The palettes were designed against these numbers rather than by eye, so this
 * is what keeps them honest: a "small" lightness tweak to make something look
 * nicer is exactly how muted text quietly drops below AA, and nothing about the
 * rendered page announces it.
 *
 * It parses the CSS rather than importing a shared table of values, on purpose.
 * A checker fed from the same constants as the output can only ever confirm
 * that a file matches itself; this one reads what the browser will read.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const THEMES_DIR = join(SRC_DIR, 'themes');

/**
 * Pairs that must hold, and why each one.
 *
 * 7.0 where the text is body copy (AAA), 4.5 where it is a control label or a
 * larger/heavier run (AA). Anything below and the theme is not shippable —
 * these are not preferences.
 */
const PAIRS = [
  ['foreground', 'background', 7.0],
  ['card-foreground', 'card', 7.0],
  ['popover-foreground', 'popover', 7.0],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
];

/**
 * The status strip's pairs, checked separately because they live in base.css
 * rather than in a palette — they are the one set of colours deliberately NOT
 * derived from the theme (see that file for why an error must not be green on
 * a green palette).
 *
 * 4.5 rather than 7.0: this is a single short line in a strip, not body copy,
 * and holding it to AAA would force the surfaces so pale that the four levels
 * stop being distinguishable from each other — which is the failure the colour
 * exists to prevent.
 */
const STATUS_PAIRS = [
  ['status-info-foreground', 'status-info', 4.5],
  ['status-success-foreground', 'status-success', 4.5],
  ['status-warning-foreground', 'status-warning', 4.5],
  ['status-error-foreground', 'status-error', 4.5],
];

/** oklch() → linear sRGB, via oklab. */
function oklchToLinear(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** WCAG relative luminance. Clamped, because that is what a display does with an out-of-gamut colour. */
function luminance([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function ratio(c1, c2) {
  const [a, b] = [luminance(oklchToLinear(...c1)), luminance(oklchToLinear(...c2))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Perceptual distance in oklab — how different two colours actually look.
 *
 * Used for one question a contrast ratio cannot answer: is the primary action
 * distinguishable from the destructive one? Contrast only compares a colour to
 * its own text; two buttons can each be perfectly legible and still be the same
 * red to the person deciding which one to click.
 */
function perceptualDistance([l1, c1, h1], [l2, c2, h2]) {
  const [a1, b1] = [c1 * Math.cos((h1 * Math.PI) / 180), c1 * Math.sin((h1 * Math.PI) / 180)];
  const [a2, b2] = [c2 * Math.cos((h2 * Math.PI) / 180), c2 * Math.sin((h2 * Math.PI) / 180)];
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * The floor for that distance, CALIBRATED rather than invented: it is what the
 * tightest palette already shipping (ember, in dark mode) measures. Anything
 * looser would pass a red-on-red theme; anything tighter would fail a palette
 * that has been fine in use.
 *
 * This exists because a crimson theme genuinely failed it at 0.043 — its dark
 * primary and the destructive red were the same colour to the eye. It is now
 * deeper than the danger red rather than lighter.
 */
const MIN_DANGER_SEPARATION = 0.12;

/** How far outside sRGB a colour sits, so a palette cannot drift into colours a display cannot show. */
function gamutOverflow(c) {
  return Math.max(...oklchToLinear(...c).map((v) => Math.max(0, -v, v - 1)));
}

/**
 * The most a colour may exceed sRGB before this fails.
 *
 * Not zero: the vivid destructive red these themes inherit sits ~0.013 outside,
 * and every browser clamps it to something correct-looking. The budget exists to
 * catch a palette wandering somewhere a display genuinely cannot follow, not to
 * relitigate a red that has always shipped.
 */
const GAMUT_BUDGET = 0.015;

/**
 * Reads `--token: oklch(L C H);` out of one palette block.
 *
 * The selectors are `[data-palette="x"]` and `[data-palette="x"].dark`, so the
 * light one is matched with a closing bracket followed by ` {` — otherwise it
 * also matches the dark block, which starts with the same prefix, and the two
 * modes would be checked against the same values.
 */
function parseBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return null;
  const body = css.slice(start, css.indexOf('\n}', start));

  const tokens = {};
  for (const [, name, l, c, h] of body.matchAll(/--([a-z-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
    tokens[name] = [Number(l), Number(c), Number(h)];
  }
  return tokens;
}

let failures = 0;
const rows = [];

/*
 * base.css first: every palette imports it, so a failure here is a failure in
 * all ten and it is worth saying so once rather than ten times.
 */
{
  const css = readFileSync(join(SRC_DIR, 'base.css'), 'utf8');

  for (const [selector, mode] of [
    [':root', 'light'],
    // The dark rule is a selector LIST; anchor on the bare class, which is the
    // one that ends in ` {`.
    ['.dark', 'dark'],
  ]) {
    const tokens = parseBlock(css, selector);
    if (!tokens) {
      console.error(`  \u2717 base ${mode}: no ${selector} block`);
      failures++;
      continue;
    }

    for (const [fg, bg, min] of STATUS_PAIRS) {
      if (!tokens[fg] || !tokens[bg]) {
        console.error(`  \u2717 base ${mode}: missing --${tokens[fg] ? bg : fg}`);
        failures++;
        continue;
      }
      const r = ratio(tokens[fg], tokens[bg]);
      if (r < min) {
        console.error(`  \u2717 base ${mode}: ${fg} on ${bg} = ${r.toFixed(2)} (need ${min})`);
        failures++;
      }
    }

    /*
     * A warning that looks like an error is worse than an unstyled bar: it is
     * the same glance producing the wrong answer.
     *
     * Measured on the FOREGROUNDS, not the surfaces. The surfaces are
     * deliberately near-neutral tints — that is the whole point of a strip
     * someone stares at all day — so two of them are always close in oklab and
     * holding them to this floor would force exactly the saturated bar the
     * palette avoids. What actually tells a warning from a failure at a glance
     * is the icon and the text, which take the foreground colour.
     */
    if (tokens['status-warning-foreground'] && tokens['status-error-foreground']) {
      const separation = perceptualDistance(tokens['status-warning-foreground'], tokens['status-error-foreground']);
      if (separation < MIN_DANGER_SEPARATION) {
        console.error(
          `  \u2717 base ${mode}: --status-warning-foreground and --status-error-foreground are ` +
            `${separation.toFixed(3)} apart (need ${MIN_DANGER_SEPARATION}) \u2014 a warning would read as a failure`,
        );
        failures++;
      }
    }

    for (const [name, c] of Object.entries(tokens)) {
      const over = gamutOverflow(c);
      if (over > GAMUT_BUDGET) {
        console.error(`  \u2717 base ${mode}: --${name} is ${over.toFixed(3)} outside sRGB (budget ${GAMUT_BUDGET})`);
        failures++;
      }
    }
  }
}

// all.css is a bundle of the others and declares no tokens of its own.
for (const file of readdirSync(THEMES_DIR)
  .filter((f) => f.endsWith('.css') && f !== 'all.css')
  .sort()) {
  const css = readFileSync(join(THEMES_DIR, file), 'utf8');
  const theme = file.replace('.css', '');

  for (const [selector, mode] of [
    [`[data-palette="${theme}"]`, 'light'],
    // The dark rule is a selector LIST; anchor on the descendant form, which is
    // the one that ends in ` {`.
    [`.dark [data-palette="${theme}"]`, 'dark'],
  ]) {
    const tokens = parseBlock(css, selector);
    if (!tokens) {
      console.error(`  ✗ ${theme} ${mode}: no ${selector} block`);
      failures++;
      continue;
    }

    for (const [fg, bg, min] of PAIRS) {
      // A theme that simply omits a token would otherwise pass by being absent.
      if (!tokens[fg] || !tokens[bg]) {
        console.error(`  ✗ ${theme} ${mode}: missing --${tokens[fg] ? bg : fg}`);
        failures++;
        continue;
      }
      const r = ratio(tokens[fg], tokens[bg]);
      if (r < min) {
        console.error(`  ✗ ${theme} ${mode}: ${fg} on ${bg} = ${r.toFixed(2)} (need ${min})`);
        failures++;
      }
      if (fg === 'foreground') rows.push([theme, mode, r]);
    }

    if (tokens.primary && tokens.destructive) {
      const separation = perceptualDistance(tokens.primary, tokens.destructive);
      if (separation < MIN_DANGER_SEPARATION) {
        console.error(
          `  ✗ ${theme} ${mode}: --primary and --destructive are ${separation.toFixed(3)} apart ` +
            `(need ${MIN_DANGER_SEPARATION}) — a danger button would look like the primary one`,
        );
        failures++;
      }
    }

    for (const [name, c] of Object.entries(tokens)) {
      const over = gamutOverflow(c);
      if (over > GAMUT_BUDGET) {
        console.error(`  ✗ ${theme} ${mode}: --${name} is ${over.toFixed(3)} outside sRGB (budget ${GAMUT_BUDGET})`);
        failures++;
      }
    }
  }
}

if (failures === 0) {
  for (const [theme, mode, r] of rows) {
    console.log(`  ✓ ${theme.padEnd(8)} ${mode.padEnd(5)} body text ${r.toFixed(1)}:1`);
  }
  console.log(
    `  ${rows.length / 2} themes, ${PAIRS.length * rows.length + STATUS_PAIRS.length * 2} contrast pairs and ` +
      `${rows.length + 2} danger-separation checks, all clear.`,
  );
} else {
  console.error(`\n  ${failures} contrast/gamut failure(s).`);
}

process.exit(failures === 0 ? 1 && 0 : 1);
