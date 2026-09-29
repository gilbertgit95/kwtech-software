'use client';

import { cn } from '@kwtech/web-ui/react';
import { EyeOff, Keyboard } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { TillState } from '../use-till.js';
import { allShortcuts, type ShortcutEntry, shortcutBar, type TillZone } from '../view/keys.js';
import { buttonClass, Modal } from './controls.js';

/** Where a person's "hide the bar" is remembered: their browser only — a convenience, not a setting (D21). */
const HIDDEN_KEY = 'kwtech:pos:shortcut-bar-hidden';

function readHidden(): boolean {
  try {
    return globalThis.localStorage?.getItem(HIDDEN_KEY) === '1';
  } catch {
    // Private windows and blocked storage: the bar simply shows.
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    globalThis.localStorage?.setItem(HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    // Not remembered, which is harmless: it is shown again next time.
  }
}

/** "Plastic bag" for an item key, from the catalogue the till already holds. */
function useItemLabels(state: TillState): ReadonlyMap<string, string> {
  return useMemo(() => {
    const labels = new Map<string, string>();
    for (const item of state.catalogue?.items ?? []) {
      labels.set(`${item.id}:`, item.name);
      for (const variant of item.variants) labels.set(`${item.id}:${variant.id}`, `${item.name} — ${variant.name}`);
    }
    return labels;
  }, [state.catalogue]);
}

/**
 * The bar along the bottom of the till (D21): the keys that work RIGHT NOW,
 * read from the same keymap the keys obey. Clicking an entry does what its key
 * does. Narrow, it keeps the first few (a container query); each person may
 * hide it.
 */
export function ShortcutBar({
  zone,
  state,
  onPress,
}: {
  zone: TillZone;
  state: TillState;
  onPress: (key: string) => void;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(readHidden()), []);
  const itemLabels = useItemLabels(state);
  const entries = shortcutBar(zone, state.keymap, { canDiscount: state.canDiscount, itemLabels });

  if (hidden) {
    return (
      <button
        type="button"
        className={cn(buttonClass('ghost', 'sm'), 'self-start')}
        onClick={() => {
          setHidden(false);
          writeHidden(false);
        }}
      >
        <Keyboard aria-hidden="true" className="size-3.5" />
        Show shortcuts
      </button>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label="Keyboard shortcuts"
      className="flex items-center gap-1 overflow-hidden rounded-md border border-border bg-muted px-1.5 py-1"
    >
      <ul className="flex min-w-0 flex-1 flex-wrap gap-1">
        {entries.map((entry, index) => (
          <li key={`${entry.key}:${entry.label}`} className={cn(index >= 4 && 'hidden @2xl:block')}>
            <ShortcutChip entry={entry} onPress={onPress} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        aria-label="Hide shortcuts"
        className={buttonClass('ghost', 'sm')}
        onClick={() => {
          setHidden(true);
          writeHidden(true);
        }}
      >
        <EyeOff aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

function ShortcutChip({ entry, onPress }: { entry: ShortcutEntry; onPress: (key: string) => void }) {
  const content = (
    <>
      <kbd className="rounded border border-border bg-background px-1 font-mono text-[0.7rem]">{entry.key}</kbd>
      <span>{entry.label}</span>
    </>
  );
  // A fixed key ("Enter", "↑") only explains; an action or item key can be clicked.
  if (!entry.action && !entry.item) {
    return <span className="inline-flex items-center gap-1 px-1 text-xs text-muted-foreground">{content}</span>;
  }
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded px-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onPress(entry.key)}
    >
      {content}
    </button>
  );
}

/** Every key, grouped by where it works (the `?` list, D18). */
export function ShortcutHelp({ open, state, onClose }: { open: boolean; state: TillState; onClose: () => void }) {
  const itemLabels = useItemLabels(state);
  const groups = allShortcuts(state.keymap, { canDiscount: state.canDiscount, itemLabels });
  return (
    <Modal open={open} title="Keyboard shortcuts" onClose={onClose} wide>
      <p className="text-sm text-muted-foreground">
        Keys work while the point of sale has focus. Typing in a note or a name types — only function keys act there.
      </p>
      {groups.map((group) => (
        <section key={group.zone} className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{group.zone}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            {group.entries.map((entry) => (
              <div key={`${entry.key}:${entry.label}`} className="contents">
                <dt>
                  <kbd className="rounded border border-border bg-muted px-1 font-mono text-xs">{entry.key}</kbd>
                </dt>
                <dd>{entry.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Modal>
  );
}
