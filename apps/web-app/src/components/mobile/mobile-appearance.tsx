'use client';

import { applyPalette, DEFAULT_PALETTE, PALETTES, readStoredPalette } from '@kwtech/web-ui';
import { cn, type ThemeMode } from '@kwtech/web-ui/react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const MODES: readonly { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Light, dark or the system's, and the colour scheme — laid out IN the account
 * sheet rather than behind the desktop's theme button.
 *
 * ⚠ That button opens a dropdown portalled into `<body>`, and the sheet is a
 * modal `<dialog>` in the browser's TOP LAYER, which paints above everything
 * in the page however high its z-index: the menu opened behind the sheet, out
 * of sight and out of reach (reported by the operator, 2026-10-29). Inline
 * controls have no layer to lose, and on a phone two rows of large targets are
 * easier than a menu anyway.
 *
 * The same two stores the desktop switcher writes — next-themes for the mode,
 * `applyPalette` for the scheme — so a choice made here holds on the full site.
 */
export function MobileAppearance() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [palette, setPalette] = useState<string>(DEFAULT_PALETTE);

  useEffect(() => {
    setMounted(true);
    // After mount: localStorage does not exist on the server, and reading it while rendering would mismatch.
    setPalette(readStoredPalette() ?? DEFAULT_PALETTE);
  }, []);

  // Nothing is marked chosen until the stored values are known, rather than marking the wrong one and moving it.
  const activeMode = mounted ? theme : undefined;
  const activePalette = mounted ? palette : undefined;

  return (
    <div className="space-y-4 px-3 py-2">
      <fieldset className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        <legend className="sr-only">Appearance</legend>
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            aria-pressed={activeMode === mode.value}
            onClick={() => setTheme(mode.value)}
            className={cn(
              'flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              activeMode === mode.value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground active:text-foreground',
            )}
          >
            <mode.icon aria-hidden className="size-4" />
            {mode.label}
          </button>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap gap-2.5">
        <legend className="sr-only">Colour scheme</legend>
        {PALETTES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={activePalette === option.id}
            aria-label={option.label}
            title={option.label}
            onClick={() => {
              if (applyPalette(option.id)) setPalette(option.id);
            }}
            className={cn(
              'grid size-10 place-items-center rounded-full border-2 transition-transform active:scale-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              activePalette === option.id ? 'border-foreground' : 'border-transparent',
            )}
          >
            {/* The palette's own primary: `data-palette` scopes the same tokens the page uses, so it cannot drift. */}
            <span
              data-palette={option.id}
              aria-hidden
              className="grid size-7 place-items-center rounded-full border border-border bg-primary text-primary-foreground"
            >
              {activePalette === option.id ? <Check className="size-3.5" /> : null}
            </span>
          </button>
        ))}
      </fieldset>
    </div>
  );
}
