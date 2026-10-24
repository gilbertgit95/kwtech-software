# Seasonal effects — plan

Status: **planned, not built, 2026-10-24.** Nothing below exists in code yet.
§8 lists the decisions still open; the first build waits on them, or on "go
with the defaults".

## 1. What it is

A purely decorative animation over the whole app for annual events —
Christmas snow, Halloween bats, New Year confetti — that **never gets in the
way**: every click, scroll, hover, drag and text selection reaches the page
underneath, as if the layer were not there.

The set of events is **open**. Christmas, Halloween and New Year are the first
entries, not a fixed list: a birthday, a shop's anniversary or a local holiday
later is one more entry in a registry, not new code. While an event is on, its
animation loops for as long as the event lasts.

## 2. Where it lives: `@kwtech/web-ui`, not a new package

- **It is pure UI.** No rows, no GraphQL, no feature keys, no server. A
  `module-*` is a whole feature vertically (CLAUDE.md, "The one architectural
  idea"), and this one would be empty wiring around a component.
- **`web-ui` depends on nothing** (docs/DEPENDENCIES.md), which is right for a
  decoration layer every page carries.
- **Principle 9:** extract a package when a second consumer exists, not on
  speculation. A new package also adds one more `tsc --watch` (~300 MB) to
  `pnpm dev`.

| Piece | File |
|---|---|
| Event and effect types, the built-in events, "which event is on this day" | `packages/web-ui/src/seasonal.ts` (root entry, no React), jest tests in `packages/web-ui/test/seasonal.test.ts` |
| The overlay, and the per-browser on/off preference | `packages/web-ui/src/react/seasonal-overlay.tsx` |
| The keyframes | web-ui's CSS (`base.css`) |
| The "Seasonal effects" item | the existing appearance menu, `ThemeSwitcher` (opt-in prop, so the queue TV's switcher does not show it) |
| Mounted once, given the day | `apps/web-app` — wiring only |

### When it becomes a module

As soon as an event depends on **data**: whose birthday it is (per-person
data), events an owner adds for a shop, or effects switched on or off for a
whole workspace. That needs tables, a resolver and feature keys, so it becomes
a real `module-celebrations` (name open). The module then decides **which**
event is on and hands it to the same `web-ui` overlay, which only draws. What
is built now is the part the module would reuse, not a dead end.

## 3. The event registry

```ts
// packages/web-ui/src/seasonal.ts — shape, not final code
interface SeasonalEvent {
  id: string;            // 'christmas', 'halloween', later 'birthday:<userId>'
  label: string;         // shown in the menu: "Christmas"
  window: DayWindow;     // when it is on
  effect: SeasonalEffect;
}

/** Inclusive, month-day; a window may wrap the year (Dec 31 → Jan 2). */
interface DayWindow { from: `${number}-${number}`; to: `${number}-${number}` }

interface SeasonalEffect {
  kind: 'glyphs' | 'confetti';
  glyphs?: readonly string[];      // '❄', '🦇', '🎃', '🎈' …
  motion: 'fall' | 'rise' | 'drift';
  count: number;                   // particles at 1280 px wide, scaled down on small screens
  size: readonly [number, number]; // px, min and max
  speed: readonly [number, number];// seconds per pass, min and max
}

/** The event on `dayKey` ('YYYY-MM-DD'), or null. Pure: the day is passed in. */
function activeSeasonalEvent(dayKey: string, events: readonly SeasonalEvent[]): SeasonalEvent | null;
```

- **The app can pass extra events** (`events` prop merged over the built-ins),
  which is how a later module supplies birthdays without `web-ui` knowing.
- **Moving dates** (Easter, Lunar New Year) do not fit a fixed month-day. They
  take either a small per-year table or a formula; only added if §8.1 asks for
  them.
- **Two events on one day:** the first in the registry wins. One overlay at a
  time; stacking two would be noise.

First entries:

| Event | Window | Effect |
|---|---|---|
| Christmas | Dec 1 – Dec 26 | snow, falling, slow |
| Halloween | Oct 25 – Nov 1 | bats and leaves, drifting |
| New Year | Dec 31 – Jan 2 | confetti, falling, fast |

## 4. The overlay

```tsx
<div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden motion-reduce:hidden print:hidden">
  {/* particles */}
</div>
```

- **`pointer-events-none`** is what keeps the app usable: the browser hit-tests
  straight through it. The repo already relies on it (`tooltip.tsx`).
- **`aria-hidden`**: a screen reader never announces a snowflake.
- **CSS animations, not a canvas loop.** Each particle is one element with
  `transform` / `opacity` keyframes and `animation-iteration-count: infinite`,
  its start, delay, size, speed and drift set as CSS variables. Compositor-only
  properties, so no layout work per frame, and the browser throttles them in a
  hidden tab by itself. A `<canvas>` is the fallback only if an effect ever
  needs hundreds of particles.
- **Rendered after mount only.** The day and the preference are browser facts;
  rendering on the server would be a hydration mismatch for every visitor.
- **Nothing at all on a day with no event** — no element, no CSS running.

## 5. Never in the way

- **Reduced motion:** `prefers-reduced-motion: reduce` hides it entirely.
  Falling things make some people unwell; this is not optional.
- **Print:** `print:hidden`, so it never lands on paper or a print-studio PDF.
- **Readability:** small, partly transparent particles; fewer on narrow screens.
- **Opted out:** the queue's TV board (on screen all day, legibility first) and
  the print studio's editor (placing things to the millimetre). A page opts out
  by rendering `<NoSeasonalEffects />` from `@kwtech/web-ui/react`, so a module
  can do it without knowing the app.
- **Stacking:** a fixed z-index, decided in §8.3.

## 6. The off switch

A "Seasonal effects" item in the appearance menu, **per browser**, stored in
localStorage as `kwtech_seasonal_effects`, following the `kwtech_` prefix rule
(`apps/web-app/src/lib/preferences.ts`). On by default. The menu and the
overlay share it through one small store in `web-ui`, the way the palette is
owned there (`palette-runtime.ts`), so flipping it hides the overlay at once.

A workspace-wide setting for owners is the module of §2, not this.

## 7. Dates and time zones

"Christmas starts" means the **workspace's** midnight, per
`.claude/rules/typescript.md`, "Days, times and time zones".

- `web-ui` cannot import `module-kit`, so `seasonal.ts` takes a **day key**
  and never reads a clock or a zone.
- The app computes that day with `zonedDayKey(now, useWorkspaceTimeZone())`
  from `module-kit`, so the zone rule stays implemented once. Outside a
  workspace (sign-in, account pages) it is the viewer's own zone.
- The day is re-checked once a minute, so an event starts or ends at midnight
  without a reload.
- Tests cross a boundary: an instant that is Dec 1 in Manila but Nov 30 in
  UTC, asserting the event in both.

## 8. Open decisions

1. **Which events, and which dates**, for the first version. Also Valentine's,
   Easter, Lunar New Year, or local holidays?
2. **The off switch:** per browser only (§6), or a workspace setting for owners
   now? The second is database and server work, so it starts the module of §2.
3. **Over dialogs or under them.** It cannot be clicked either way; this only
   decides whether snow falls over an open dialog and the toasts.

## 9. Build order

1. `seasonal.ts`: types, built-in events, `activeSeasonalEvent`, tests
   (windows, year wrap, zone boundary).
2. The overlay and keyframes, then the preference store and the menu item.
3. Mount in `apps/web-app`; `<NoSeasonalEffects />` on the TV board and the
   print studio editor.
4. Check it in the running app (`pnpm dev:focus web-ui --web`): clicking
   through the overlay, reduced motion, print preview, the toggle.
5. `web-ui` README section, and a dated entry in PLAN §13.
