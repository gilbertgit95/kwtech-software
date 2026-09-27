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
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Look</DropdownMenuLabel>
        {NOTE_LOOKS.map((look) => (
          <Choice key={look} chosen={settings.look === look} onSelect={() => onChange({ ...settings, look })}>
            {NOTE_APPEARANCE_LABELS.look[look]}
          </Choice>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Font</DropdownMenuLabel>
        {NOTE_FONTS.map((font) => (
          <Choice key={font} chosen={settings.font === font} onSelect={() => onChange({ ...settings, font })}>
            {/* The label in its own face, so the menu is the sample. */}
            <span style={{ fontFamily: NOTE_FONT_FACES[font].family, fontSize: `${NOTE_FONT_FACES[font].scale}em` }}>
              {NOTE_APPEARANCE_LABELS.font[font]}
            </span>
          </Choice>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>New notes start in</DropdownMenuLabel>
        {NOTE_COLORS.map((color) => (
          <Choice
            key={color}
            chosen={settings.defaultColor === color}
            onSelect={() => onChange({ ...settings, defaultColor: color })}
          >
            <span
              aria-hidden="true"
              className="size-3 rounded-full border border-border"
              style={{ backgroundColor: notePaperColor(color, 'strong') }}
            />
            {NOTE_APPEARANCE_LABELS.color[color]}
          </Choice>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Choice({ chosen, onSelect, children }: { chosen: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <DropdownMenuItem onSelect={onSelect} aria-checked={chosen} role="menuitemradio" className="gap-2">
      <Check aria-hidden="true" className={cn('size-3.5', chosen ? 'opacity-100' : 'opacity-0')} />
      {children}
    </DropdownMenuItem>
  );
}
