'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useRef, useState } from 'react';
import { EMOJI_GROUPS } from '../emoji.js';

/**
 * A small popover of emoji, opened from the composer.
 *
 * ⚠ NO LIBRARY. See `emoji.ts` for why — every npm picker ships the full
 * Unicode set and usually a sprite sheet, which is 200KB to over 1MB hanging
 * off a text box. This is a few kilobytes of strings, and the OS picker still
 * works for anything not listed.
 *
 * ## What it is responsible for, and what it is not
 *
 * It reports a CHOICE and nothing else. Where the emoji goes — at the caret, in
 * a selection, at the end — is the composer's business, because only the
 * composer owns the textarea and its selection. That split is what lets
 * `insertEmoji` be a pure function with tests.
 */
export function EmojiPicker({
  recent,
  onPick,
  onClose,
}: {
  /** Most recent first. Rendered as its own row above the groups. */
  recent: readonly string[];
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [group, setGroup] = useState(0);
  const panel = useRef<HTMLDivElement>(null);

  /*
   * ⚠ CLOSES ON ESCAPE AND ON A CLICK OUTSIDE, which a popover that traps
   * neither is not. `mousedown` rather than `click`: a click that STARTS inside
   * and ends outside — a drag, or a fast tap on a touchpad — would otherwise
   * close the panel out from under the button somebody just pressed.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    function onDown(event: MouseEvent) {
      if (panel.current && !panel.current.contains(event.target as Node)) onClose();
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const current = EMOJI_GROUPS[group] ?? EMOJI_GROUPS[0];

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose an emoji"
      className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-lg border border-border bg-card p-2 shadow-lg"
    >
      {recent.length > 0 ? (
        <div className="mb-2 border-b border-border pb-2">
          <p className="px-1 pb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Recent
          </p>
          <div className="flex flex-wrap">
            {recent.map((emoji) => (
              <EmojiButton key={`recent-${emoji}`} emoji={emoji} onPick={onPick} />
            ))}
          </div>
        </div>
      ) : null}

      {/*
        Tabs as a row of labels rather than icons: four groups do not need
        pictograms, and a pictogram for "Things" is a guess every reader has to
        decode.
      */}
      <div className="flex gap-1 pb-1">
        {EMOJI_GROUPS.map((one, index) => (
          <button
            key={one.label}
            type="button"
            onClick={() => setGroup(index)}
            aria-pressed={index === group}
            className={cn(
              'rounded px-2 py-0.5 text-xs',
              index === group ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {one.label}
          </button>
        ))}
      </div>

      {/*
        A fixed height with its own scroll, so opening the picker never changes
        the size of the composer beneath it — a panel that resizes as you switch
        tabs moves the send button while somebody is reaching for it.
      */}
      <div className="flex h-44 flex-wrap content-start overflow-y-auto">
        {current?.emoji.map((emoji) => (
          <EmojiButton key={emoji} emoji={emoji} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function EmojiButton({ emoji, onPick }: { emoji: string; onPick: (emoji: string) => void }) {
  return (
    <button
      type="button"
      /*
       * ⚠ `onMouseDown` with `preventDefault`, not `onClick`. A click moves
       * focus to the button, which BLURS the textarea — and a blurred textarea
       * reports a selection of 0, so the emoji would land at the start of the
       * message instead of at the caret. Preventing the default keeps focus
       * where it is, and the pick still fires.
       */
      onMouseDown={(event) => {
        event.preventDefault();
        onPick(emoji);
      }}
      aria-label={emoji}
      className="rounded p-1 text-lg leading-none hover:bg-accent"
    >
      {emoji}
    </button>
  );
}
