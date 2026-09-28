'use client';

import { cn } from '@kwtech/web-ui/react';
import type { CSSProperties, ReactNode } from 'react';
import { type NoteColor, type NoteFont, type NoteLook, normalizeNoteColor } from '../../domain/appearance.js';
import {
  NOTE_FONT_FACES,
  NOTE_LOOK_SPECS,
  NOTE_RULE_REM,
  notePaperBackground,
  notePaperColor,
} from '../view/appearance.js';

/**
 * The variables every page of the app reads: the rule, the font and its scale.
 * Set once on the app's root, so the index and the page write in the same hand.
 */
export function noteRootStyle(font: NoteFont): CSSProperties {
  const face = NOTE_FONT_FACES[font];
  return {
    '--note-rule': `${NOTE_RULE_REM}rem`,
    fontFamily: face.family,
    fontSize: `${face.scale}rem`,
  } as CSSProperties;
}

/**
 * The Notebook's rules and the Grid's squares, for the element that SCROLLS.
 *
 * ⚠ ON THE SCROLLER, with `background-attachment: local`, never on the page
 * behind it: lines painted behind a scrolling list stay put while the writing
 * moves, and after one scroll no line of text sits on a rule.
 */
export function noteLinesStyle(look: NoteLook): CSSProperties {
  const image = notePaperBackground(look);
  return image === 'none' ? {} : { backgroundImage: image, backgroundAttachment: 'local' };
}

/**
 * One sheet of paper in a look and a colour — the index's page or the note's.
 *
 * ⚠ THE COLOUR IS A TINT OF THE THEME. The paper is `--note-paper`, derived from
 * `--card` (`notePaperColor`), over a `bg-card` fallback: a browser without
 * relative colour syntax computes the variable as invalid, the paper goes
 * transparent, and the theme's card shows through untinted rather than wrong.
 *
 * `side` places the Notebook's binding: spiral holes on a single page. The two
 * halves of a spread meet at a plain border, with no shadow between them — the
 * operator's call (2026-09-28): the index and the note read as one surface.
 */
export function Paper({
  look,
  color,
  side,
  className,
  children,
}: {
  look: NoteLook;
  color: string;
  side: 'single' | 'left' | 'right';
  className?: string;
  children: ReactNode;
}) {
  const tint: NoteColor = normalizeNoteColor(color);
  const spec = NOTE_LOOK_SPECS[look];
  const style = { '--note-paper': notePaperColor(tint, spec.tint) } as CSSProperties;

  return (
    <div className={cn('relative min-h-0 overflow-hidden bg-card text-card-foreground', frameClass(look), className)}>
      <div className="absolute inset-0 bg-(--note-paper)" style={style} aria-hidden="true" />
      {look === 'notebook' ? <Binding side={side} /> : null}
      <div className={cn('relative flex h-full min-h-0 flex-col', look === 'notebook' && side !== 'left' && 'pl-8')}>
        {children}
      </div>
    </div>
  );
}

/** Each look's frame. Tokens only — the shadows are the theme's own text colour, faint. */
function frameClass(look: NoteLook): string {
  switch (look) {
    case 'plain':
      return 'rounded-lg border border-border';
    case 'paper':
      return 'rounded-sm shadow-md shadow-foreground/10';
    case 'notebook':
      return 'rounded-md border border-border shadow-sm shadow-foreground/10';
    case 'sticky':
      return 'rounded-none shadow-lg shadow-foreground/15';
    case 'grid':
      return 'rounded-sm border border-border';
  }
}

/**
 * The Notebook's binding and margin.
 *
 *   single — punched spiral holes down the left edge, and the red margin line
 *   left   — the index half of a spread: nothing; the halves meet at a border
 *   right  — the page half: the margin
 *
 * The holes are the app's own `--background` showing through; the margin is the
 * theme's `--destructive`, faint, like the red line on school paper.
 */
function Binding({ side }: { side: 'single' | 'left' | 'right' }) {
  return (
    <>
      {side === 'single' ? (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-1.5 w-3"
          style={{
            backgroundImage: 'radial-gradient(circle, var(--background) 0.32rem, transparent 0.36rem)',
            backgroundSize: `100% ${NOTE_RULE_REM}rem`,
            backgroundRepeat: 'repeat-y',
          }}
        />
      ) : null}
      {side !== 'left' ? (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-6 w-px"
          style={{ backgroundColor: 'color-mix(in oklch, var(--destructive) 40%, transparent)' }}
        />
      ) : null}
    </>
  );
}
