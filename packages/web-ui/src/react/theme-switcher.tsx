'use client';

import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyPalette, readStoredPalette } from '../palette-runtime.js';
import { DEFAULT_PALETTE, PALETTES } from '../palettes.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
import { cn } from './utils.js';

/**
 * The whole theme control: which palette, and light/dark/system within it.
 * Colour scheme above, mode below, a rule between them.
 *
 * They are separated because they are not alternatives — every palette has both
 * a light and a dark form, so picking Ocean says nothing about which of the two
 * you are looking at. A single flat list would imply otherwise, and "Ocean" and
 * "Dark" would read as competing options rather than as one answer each to two
 * different questions.
 *
 * ── why the mode is CONTROLLED and the palette is not ───────────────────────
 *
 * The palette is this package's own concern: it defines the palettes, so it can
 * own applying and persisting one, and does (../palette-runtime.ts).
 *
 * The mode is not. Depending on `next-themes` here would make it a hard
 * requirement of this package for every consumer — including a plain React app
 * and the planned mobile-ui — to solve a problem this package did not define.
 * So the mode arrives as a prop and goes back out as a callback, and the app
 * wires whatever it already uses. `next-themes` is one line away; so is
 * anything else.
 */

const MODES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

export type ThemeMode = (typeof MODES)[number]['value'];

export interface ThemeSwitcherProps {
  /**
   * The active mode, or undefined until the app knows it.
   *
   * Undefined rather than a default on purpose: a control that renders "Light"
   * as checked before the real value is known shows a checkmark that may be
   * wrong, and the correction reads as a flicker. Undefined checks nothing.
   */
  mode?: ThemeMode | undefined;
  onModeChange: (mode: ThemeMode) => void;
  /** Merged onto the trigger, for ring-offset colours that depend on the surface behind it. */
  className?: string;
}

export function ThemeSwitcher({ mode, onModeChange, className }: ThemeSwitcherProps) {
  const [mounted, setMounted] = useState(false);
  const [palette, setPalette] = useState<string>(DEFAULT_PALETTE);

  useEffect(() => {
    setMounted(true);
    // After mount, never during render: localStorage does not exist on the
    // server, so reading it while rendering would be a hydration mismatch.
    const stored = readStoredPalette();
    if (stored) setPalette(stored);
  }, []);

  /*
   * The trigger's two icons are swapped by CSS on the `dark` class, not by
   * reading the mode in JS — so the button renders identically on the server
   * and on the client and needs no mounted placeholder to avoid a hydration
   * mismatch. Only the check marks below, which cannot be derived from a class,
   * wait for mount; the menu is not open before then anyway.
   */
  const activeMode = mounted ? mode : undefined;

  function choosePalette(id: string) {
    // The attribute IS the switch: every palette is already in the stylesheet,
    // scoped to its own selector, so this repaints instantly — no reload, no
    // re-render of anything below this component.
    if (applyPalette(id)) setPalette(id);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Change appearance"
        className={cn(
          'group relative grid size-9 place-items-center rounded-full text-muted-foreground',
          'transition-colors hover:bg-accent hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'data-[state=open]:bg-accent data-[state=open]:text-foreground',
          className,
        )}
      >
        <Sun className="size-[1.05rem] rotate-0 scale-100 transition-transform duration-300 dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute size-[1.05rem] rotate-90 scale-0 transition-transform duration-300 dark:rotate-0 dark:scale-100" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-52 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          Colour scheme
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mb-1" />

        {PALETTES.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => choosePalette(option.id)}
            // Radio semantics by hand: the dropdown primitive exports only Item,
            // and adding RadioGroup to it for two menus would be a wider change
            // than this needs.
            role="menuitemradio"
            aria-checked={mounted && palette === option.id}
            className={cn(
              'gap-2.5 rounded-lg px-2 py-2 text-sm',
              mounted && palette === option.id ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {/*
             * A swatch of the palette's own primary, not a generic icon. The
             * whole choice is "what colour is this app", and a menu that
             * describes five colours in words while showing none of them makes
             * the reader open each one to find out.
             *
             * `data-palette` on the swatch scopes the SAME tokens the page uses,
             * so it cannot drift from what selecting it will do.
             */}
            <span
              data-palette={option.id}
              aria-hidden
              className="size-3.5 shrink-0 rounded-full border border-border bg-primary"
            />
            <span className="flex-1">{option.label}</span>
            {mounted && palette === option.id ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}

        {/* The rule the two questions sit either side of. */}
        <DropdownMenuSeparator className="my-1.5" />

        <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mb-1" />

        {MODES.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onModeChange(option.value)}
            role="menuitemradio"
            aria-checked={activeMode === option.value}
            className={cn(
              'gap-2.5 rounded-lg px-2 py-2 text-sm',
              activeMode === option.value ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            <option.icon aria-hidden className="opacity-80" />
            <span className="flex-1">{option.label}</span>
            {activeMode === option.value ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
