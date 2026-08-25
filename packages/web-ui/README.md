# @kwtech/web-ui

Shared React components, the swappable Tailwind themes and the AG Grid wrapper
for the web apps.

Today its real content is the **theme system**: five palettes that an app picks
between with one import, all of which handle light and dark.

## Choosing a theme

Each palette is scoped to its own `[data-palette="…"]`, so they coexist. Pick
the model that fits the app:

**Fixed at build time** — one palette, smallest CSS:

```css
@import "tailwindcss";
@import "@kwtech/web-ui/themes/ocean.css";
```
```tsx
<html data-palette="ocean">
```

**Chosen by the viewer** — every palette, switchable at runtime:

```css
@import "tailwindcss";
@import "@kwtech/web-ui/themes/all.css";
```
```tsx
// Server renders the fallback; a pre-paint inline script applies the stored
// choice from localStorage, next to the light/dark mode.
<html data-palette={DEFAULT_PALETTE}>
```

Switching is then one attribute — `document.documentElement.dataset.palette` —
with no reload and no React re-render, because every palette is already in the
stylesheet.

**Nothing applies without the attribute**, deliberately: a palette that fell
back to a default when it was missing would hide the wiring mistake rather than
show it. Validate the value before it reaches the DOM (`isPalette`) — it becomes
an attribute selector, and an unknown one matches no rules at all.

`apps/web-app` runs the second model; see its `globals.css`,
`layout.tsx` and `components/layout/theme-toggle.tsx`.

| Theme | Primary (approx.) | Character |
|---|---|---|
| `neutral` | `#171717` | Grayscale. Nothing competes with content — right for dense internal tools and table-heavy screens. **The default.** |
| `crimson` | `#a31b45` | Deep red. See the note below — this is the one palette that needed care. |
| `rose` | `#ab3276` | Warm pink rather than magenta. |
| `ember` | `#a34d00` | Warm amber through terracotta. Warm hues advance, so this reads closer and softer. |
| `clay` | `#6f4829` | Muted brown — Ember's hue at three-quarters chroma, which is what turns amber into earth. |
| `gold` | `#7f6600` | Yellow. Darker than you expect; see below. |
| `forest` | `#0d7648` | Green. Chroma dialled down — the eye is most sensitive here and equal numbers would shout. |
| `teal` | `#017272` | Blue-green. The calmest of the set. |
| `ocean` | `#006bb9` | Cool blue. Calm and institutional; where most admin software lands. |
| `violet` | `#764ab2` | Purple. Carries the most chroma without looking garish, because the eye is least sensitive at this hue. |

Listed around the colour wheel, which is also the order `PALETTES` exports them
in — a picker that maps over it reads as a spectrum rather than a word list.

**Two of these fought their constraints, and the resolutions are load-bearing:**

- **Crimson** is the only palette whose primary sits in the same family as
  `--destructive`. Two red buttons that are each perfectly legible can still be
  the same red to the person deciding which to click, and a contrast ratio
  cannot see that — it only compares a colour to its own text. So crimson's
  dark-mode primary is *deeper* than the danger red rather than lighter, and
  carries light text. The separation is enforced by the checker, not by memory.
- **Gold** is the hardest hue for an action colour: at the lightness where
  yellow looks yellow, white text on it fails contrast. Its primary is therefore
  closer to olive than to lemon. A readable button beats a bright one.

Swatches are indicative: these are oklch, and a browser's conversion can land a
step either side of the number above. The oklch value in the theme file is the
truth.

`PALETTES` is exported from the package root, so a picker is generated rather
than transcribed — a hard-coded list drifts the moment a theme is added, and
silently: the new palette simply never appears in the menu.

## Adding a palette picker to an app

Everything below is what `apps/web-app` does; copy it. The package ships the
**behaviour** — applying, validating, persisting, and the pre-paint script — and
leaves the **presentation** to you, so it stays dependency-free and your menu
looks like the rest of your app.

**1. Import every palette.**

```css
/* globals.css */
@import "tailwindcss";
@import "@kwtech/web-ui/themes/all.css";
```

**2. Render a fallback on the server, and apply the stored choice before paint.**

Both lines are load-bearing. Nothing in these stylesheets applies without the
attribute, so the fallback is what a visitor with JavaScript disabled keeps —
without it they get a blank design, not a default one. And the script must be
**inline and undeferred**, because an external or `defer`red script runs after
the browser has already painted.

```tsx
// app/layout.tsx  (a Server Component — this imports no browser code)
import { DEFAULT_PALETTE, palettePreloadScript } from '@kwtech/web-ui';

const PALETTE_SCRIPT = palettePreloadScript();

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the script below writes to <html> before React
    // hydrates, so server and client markup genuinely differ by that attribute.
    <html lang="en" data-palette={DEFAULT_PALETTE} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: PALETTE_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
```

The script contains no interpolated input — every value is a build-time constant
from this package — so `dangerouslySetInnerHTML` is safe here.

**3. Drop in the control.**

```tsx
'use client';
import { type ThemeMode, ThemeSwitcher } from '@kwtech/web-ui/react';
import { useTheme } from 'next-themes';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return <ThemeSwitcher mode={theme as ThemeMode | undefined} onModeChange={setTheme} className={className} />;
}
```

That is the whole integration. `ThemeSwitcher` renders both groups — colour
scheme above a rule, Light/Dark/System below — and owns the palette outright:
selecting one applies and persists it with no wiring from you.

**Why the mode is a prop and the palette is not.** The palette is this package's
concern — it defines the palettes, so it owns applying and persisting one. The
mode is not. Depending on `next-themes` here would make it a hard requirement of
this package for every consumer, including a plain React app and the planned
mobile-ui, to solve a problem this package did not define. So the mode arrives
as a prop and goes back as a callback; wire whatever you already use.

Pass `mode` as `undefined` until you know it. A control that checks "Light"
before the real value is read shows a checkmark that may be wrong, and the
correction reads as a flicker.

**Building your own instead** — map over `PALETTES` and call `applyPalette(id)`.
Give each swatch `data-palette={id}` so it previews with the real tokens rather
than a hard-coded colour.

### The API

| Export | What it does |
|---|---|
| `PALETTES` | the palettes as data — build the picker from this, never a hard-coded list |
| `DEFAULT_PALETTE` | what the server renders and what a no-JS visitor keeps |
| `applyPalette(id)` | switch now and remember; `false` if `id` is unknown |
| `readStoredPalette()` | the stored choice, validated; `null` if absent or unreadable |
| `palettePreloadScript()` | the inline pre-paint script, as a string |
| `PALETTE_STORAGE_KEY` | `kwtech_palette` — for anything that needs the raw key |
| `PALETTE_ATTRIBUTE` | `data-palette` — the attribute the stylesheets key off |
| `isPalette(value)` | validate a value before it reaches the DOM |

Every one is safe to import from a Server Component: nothing runs at module
scope, and the browser functions guard on `document` themselves.

### Two entrypoints, two dependency budgets

| Import | Contains | Needs |
|---|---|---|
| `@kwtech/web-ui` | palettes, runtime, `cn`-free helpers | **nothing** |
| `@kwtech/web-ui/react` | `ThemeSwitcher`, `DropdownMenu`, `cn` | Radix, lucide, clsx, tailwind-merge — all OPTIONAL peers |

The split is why an app that only wants the themes, a build script, or a test
can import the root freely: it has **zero runtime dependencies** and nothing
runs at module scope. An app that never imports `/react` never installs the
peers.

`next-themes` is deliberately absent from both. See step 3.

## Palette and mode are two questions, not one

Every palette has both a light and a dark form, so choosing Ocean says nothing
about which of the two you are looking at. A UI offering them should keep them
apart — the app's control puts colour scheme above a rule and Light/Dark/System
below it, because a flat list would make "Ocean" and "Dark" read as competing
options rather than as one answer each to two different questions.

Both persist in **localStorage** — next-themes owns the mode and has no cookie
option, so the palette follows it there and the theme configuration is one
mechanism rather than two.

That has a consequence worth stating plainly: **localStorage is unreadable on
the server**, and nothing in these stylesheets applies without `data-palette`.
So an app must do both of these, or the first paint is an unstyled page:

1. render `DEFAULT_PALETTE` server-side, which is also what a visitor with
   JavaScript disabled keeps;
2. override it from storage in an **inline** script before first paint — an
   external or deferred one runs after the browser has already painted.

Name the mode's entry with `storageKey` on `ThemeProvider`. Left unset it
defaults to a bare `theme`, which two apps on one machine will share.

## Dark mode is not a separate choice

Every theme ships its own `.dark` block. Toggling is `next-themes` with
`attribute="class"`, and the palette follows:

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
```

`attribute="class"` is load-bearing: the themes declare
`@custom-variant dark (&:where(.dark, .dark *))`, so the whole palette swaps on
a `.dark` class and nothing else. Switching to next-themes' default
`data-theme` attribute leaves every `dark:` utility dead with no error.

The dark block is a **re-decision, not a filter**. `--primary` is lighter and
less saturated there, and `--destructive-foreground` flips from light to dark,
because the same colour on a dark ground reads muddy or loses contrast. An
algorithmic inversion gets both wrong.

## Using the tokens

Write utilities, never raw colours:

```tsx
<div className="bg-card text-card-foreground border-border rounded-md" />
```

| Token | For |
|---|---|
| `background` / `foreground` | the page |
| `card` / `card-foreground` | raised surfaces |
| `popover` / `popover-foreground` | menus, dialogs |
| `primary` / `primary-foreground` | the main action |
| `secondary` / `secondary-foreground` | the lesser action |
| `muted` / `muted-foreground` | quiet surfaces and secondary text |
| `accent` / `accent-foreground` | hover and selected states |
| `destructive` / `destructive-foreground` | danger |
| `border`, `input`, `ring` | edges and focus |

A component written against these works under every theme, which is what makes
switching safe. **A hard-coded `bg-slate-100` is what breaks it** — it will not
follow the palette and will not follow dark mode.

Red stays red in every theme: danger is not a branding decision, and a
destructive button matching the palette is one nobody notices.

## Contrast is measured, not eyeballed

```
pnpm --filter @kwtech/web-ui check:contrast
```

Every foreground/background pair in both modes against WCAG minimums — 7:1 for
body copy, 4.5:1 for control labels — plus an sRGB gamut budget so a palette
cannot drift into colours a display cannot show, plus a **danger-separation**
check that `--primary` and `--destructive` are far enough apart in oklab to be
told apart. 10 themes, 180 pairs, 20 separation checks.

The separation floor is **calibrated, not invented**: it is what the tightest
palette already shipping measures. It exists because crimson genuinely failed it
at 0.043 — its dark primary and the danger red were the same colour to the eye.

`scripts/check-contrast.mjs` **parses the CSS** rather than importing a shared
table of values. A checker fed from the same constants as the output can only
confirm that a file matches itself; this one reads what the browser reads.

It earns its keep: it caught two failures in the grayscale palette this repo had
already shipped — `muted-foreground` reached only 4.34:1 on `muted` (it cleared
AA against white, which is not the surface it usually sits on), and white
`destructive-foreground` on the dark-mode red was 2.77:1. Both are fixed, and
both were invisible in review.

## Adding a theme

Copy any file in `src/themes/`, change the hue, run the checker. The palettes
share one recipe — identical lightness and chroma per role, differing only in
hue — which is why they have consistent visual weight, and why a new one is a
find-and-replace rather than a design exercise.

Then add it to `exports` in `package.json` if you are outside the
`./themes/*.css` pattern, and to the table above.

## Layout

```
src/base.css            the machinery: dark variant, @theme mapping, base layer
src/themes/*.css        the palettes; each imports base.css itself
src/themes/all.css      every palette, for runtime switching
src/styles.css          alias for the default palette
src/palettes.ts         the list as data
src/palette-runtime.ts  applying and persisting a choice — headless, no deps
src/react/              the components: ThemeSwitcher, DropdownMenu, cn
```

`palette-runtime.ts` is deliberately headless: no JSX, no icon set, no dropdown
library. That is what lets this package own the error-prone half of a palette
picker while keeping **zero runtime dependencies** — and it is why a second app
gets the behaviour for free without inheriting this app's menu.

Each palette's dark rule is a selector LIST — `[data-palette="x"].dark` **and**
`.dark [data-palette="x"]`. The first matches `<html>`, which carries both; the
second matches an element inside a dark page naming a palette it is not in,
which is what makes a swatch preview show the right colours.

The split is why an app cannot end up with utilities that resolve to nothing
(mapping without a palette) or custom properties nothing can reach (palette
without the mapping).

## Scope rule

Anything in this package must be useful to **more than one app**. A component
with exactly one consumer belongs in that app until a second one needs it —
extracting early is how component libraries fill with abstractions nobody
wanted.

The themes qualify by construction. `ThemeSwitcher` and `DropdownMenu` were
moved here as a deliberate exception, because the switcher is the UI of a system
this package already owns — leaving it out meant `web-ui` defined the palettes
while each app separately worked out how to present them.

The app shell — `AppShell`, `Header`, `Sidebar`, `UserMenu` — deliberately stays
in `apps/web-app`. It is layout, not vocabulary, and there is no second app yet
to show which parts are genuinely shared. PLAN §11 Phase 7 (`apps/admin`) is
what should drive that, with evidence rather than anticipation.
