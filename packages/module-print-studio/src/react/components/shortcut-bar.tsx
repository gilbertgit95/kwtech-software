'use client';

import { Keyboard } from 'lucide-react';
import type { StudioShortcut } from '../view/keys.js';

/**
 * The bar along the bottom: the keys that work RIGHT NOW (the operator,
 * 2026-10-05: "like in the pos sell tab").
 *
 * Drawn from the same functions the key handler asks (`view/keys.ts`), so it
 * can never show a key that does something else. Pressing an entry does what
 * its key does — the bar is also a row of buttons for somebody who would
 * rather click.
 *
 * Unlike the point of sale's bar this one cannot be hidden: hiding is
 * remembered in the browser's storage there, and the studio writes nothing to
 * browser storage at all (`test/web-module.test.ts`).
 */
export function ShortcutBar({
  entries,
  onPress,
}: {
  entries: readonly StudioShortcut[];
  onPress: (key: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Keyboard shortcuts"
      className="flex items-center gap-2 overflow-hidden rounded-md border border-border bg-muted px-2 py-1"
    >
      <Keyboard aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      {/*
       * ⚠ ONE LINE, NEVER WRAPPED: the bar's keys change with the selection, and a bar that wrapped onto a second
       * line and back resized the sheet above it every time (the operator, 2026-11-03). What does not fit scrolls
       * sideways.
       */}
      <ul className="flex min-w-0 flex-1 flex-nowrap gap-x-1 overflow-x-auto [scrollbar-width:none]">
        {entries.map((entry) => (
          <li key={`${entry.keys}:${entry.label}`} className="shrink-0">
            <ShortcutChip entry={entry} onPress={onPress} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShortcutChip({ entry, onPress }: { entry: StudioShortcut; onPress: (key: string) => void }) {
  const content = (
    <>
      <kbd className="rounded border border-border bg-background px-1 font-mono text-[0.7rem]">{entry.keys}</kbd>
      <span>{entry.label}</span>
    </>
  );
  const press = entry.press;
  // The arrows only explain; a bound key can be pressed with the pointer too.
  if (!press) {
    return <span className="inline-flex items-center gap-1 px-1 text-xs text-muted-foreground">{content}</span>;
  }
  return (
    <button
      type="button"
      // The focus stays where it was, so the next real key still goes to the sheet.
      onMouseDown={(event) => event.preventDefault()}
      className="inline-flex items-center gap-1 rounded px-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onPress(press)}
    >
      {content}
    </button>
  );
}
