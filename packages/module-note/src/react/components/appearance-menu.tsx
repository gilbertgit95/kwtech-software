'use client';

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { Check, Palette } from 'lucide-react';
import {
  NOTE_APPEARANCE_LABELS,
  NOTE_COLORS,
  NOTE_FONTS,
  NOTE_LOOKS,
  type NoteSettings,
} from '../../domain/appearance.js';
import { NOTE_FONT_FACES, notePaperColor } from '../view/appearance.js';

/**
 * The viewer's own appearance: look, font, and the colour new notes start in.
 * Everybody reads every note — shared ones included — in their own settings.
 * A choice applies at once and saves quietly.
 */
export function AppearanceMenu({
  settings,
  onChange,
}: {
  settings: NoteSettings;
  onChange: (settings: NoteSettings) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Appearance"
        className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background/70 px-2 font-sans text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Palette aria-hidden="true" className="size-4" />
        <span className="hidden @md:inline">Appearance</span>
      </DropdownMenuTrigger>
      {/*
       * Sections as WRAPPING ROWS of chips, not one option per line: stacked,
       * the 17 choices ran off the bottom of a short screen (the operator,
       * 2026-09-28). The height cap is the safety net for a very short window —
       * Radix measures the room below the trigger into that variable.
       */}
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="w-[min(20rem,calc(100vw-1rem))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto p-2"
      >
        <Section label="Look">
          {NOTE_LOOKS.map((look) => (
            <Chip key={look} chosen={settings.look === look} onSelect={() => onChange({ ...settings, look })}>
              {NOTE_APPEARANCE_LABELS.look[look]}
            </Chip>
          ))}
        </Section>
        <DropdownMenuSeparator className="my-2" />
        <Section label="Font">
          {NOTE_FONTS.map((font) => (
            <Chip key={font} chosen={settings.font === font} onSelect={() => onChange({ ...settings, font })}>
              {/* The label in its own face, so the menu is the sample. */}
              <span style={{ fontFamily: NOTE_FONT_FACES[font].family, fontSize: `${NOTE_FONT_FACES[font].scale}em` }}>
                {NOTE_APPEARANCE_LABELS.font[font]}
              </span>
            </Chip>
          ))}
        </Section>
        <DropdownMenuSeparator className="my-2" />
        <Section label="New notes start in">
          {NOTE_COLORS.map((color) => (
            <DropdownMenuItem
              key={color}
              role="menuitemradio"
              aria-checked={settings.defaultColor === color}
              // A swatch has no words on it, so its name is its label — and its tooltip.
              aria-label={NOTE_APPEARANCE_LABELS.color[color]}
              title={NOTE_APPEARANCE_LABELS.color[color]}
              onSelect={() => onChange({ ...settings, defaultColor: color })}
              className={cn(
                'size-8 justify-center rounded-full border border-border p-0',
                settings.defaultColor === color && 'ring-2 ring-primary ring-offset-1 ring-offset-popover',
              )}
              style={{ backgroundColor: notePaperColor(color, 'strong') }}
            >
              {settings.defaultColor === color ? <Check aria-hidden="true" className="size-4 text-foreground" /> : null}
            </DropdownMenuItem>
          ))}
        </Section>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A labelled row of choices that wraps, so a section is as short as the menu is wide. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <DropdownMenuLabel className="px-0.5 py-0 text-xs font-medium text-muted-foreground">{label}</DropdownMenuLabel>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** One choice as a chip; the chosen one is outlined and ticked. */
function Chip({ chosen, onSelect, children }: { chosen: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      aria-checked={chosen}
      role="menuitemradio"
      className={cn(
        'gap-1 rounded-full border px-2.5 py-1',
        chosen ? 'border-primary bg-primary/10 font-medium text-foreground' : 'border-border',
      )}
    >
      {chosen ? <Check aria-hidden="true" className="size-3.5" /> : null}
      {children}
    </DropdownMenuItem>
  );
}
