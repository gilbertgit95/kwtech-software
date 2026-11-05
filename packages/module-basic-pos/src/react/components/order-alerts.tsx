'use client';

import { cn } from '@kwtech/web-ui/react';
import { Bell, BellOff } from 'lucide-react';
import { effectiveAlertTones } from '../../domain/alert-tones.js';
import type { TillState } from '../use-till.js';
import type { PosOrderChange } from '../view/order-changes.js';

/*
 * What both Cashier screens draw for a waiting order that changed (issue #68),
 * so the desktop board and the phone look and behave the same.
 *
 * ⚠ FROM THE THEME'S PRIMARY, as the urgency colours are (`URGENCY_CARD`), so
 * the light follows whichever palette the person picked.
 */

/**
 * Always on a card, so the light FADES when the highlight ends rather than
 * snapping off. Nothing moves for somebody who asked for less motion.
 */
export const HIGHLIGHT_TRANSITION =
  'transition-[background-color,box-shadow,transform] duration-700 motion-reduce:transition-none';

/**
 * A changed card: lit in the theme's primary while `POS_HIGHLIGHT_MS` runs.
 * A NEW one also slides in from above; for less motion it only lights up.
 */
export const HIGHLIGHT_CARD: Record<PosOrderChange, string> = {
  new: 'bg-primary/15 ring-2 ring-primary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-3 motion-safe:duration-500',
  updated: 'bg-primary/15 ring-2 ring-primary',
};

/** "New" or "Updated" on a lit card: the change in words, not in colour alone. */
export function ChangeBadge({ change }: { change: PosOrderChange }) {
  return (
    <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
      {change === 'new' ? 'New' : 'Updated'}
    </span>
  );
}

/** The Cashier screen's sound button: says whether order sounds are on, and opens "My order sounds". */
export function SoundsButton({
  state,
  onOpen,
  large = false,
}: {
  state: TillState;
  onOpen: () => void;
  large?: boolean;
}) {
  const tones = effectiveAlertTones(state.alertTones.store, state.alertTones.mine);
  const on = tones.newOrder.on || tones.updatedOrder.on;
  const Icon = on ? Bell : BellOff;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={on ? 'Order sounds are on — change them' : 'Order sounds are off — change them'}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        large ? 'size-11' : 'size-8',
      )}
    >
      <Icon aria-hidden="true" className={large ? 'size-5' : 'size-4'} />
    </button>
  );
}

/**
 * ⚠ BROWSERS BLOCK SOUND UNTIL THE PAGE IS TOUCHED: right after a reload the
 * first order would arrive in silence. Said, rather than left a mystery, and
 * the tap on this note — or anywhere on the page — turns sound on.
 */
export function SoundsBlockedNote({ large = false }: { large?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded-xl border border-dashed border-primary/50 bg-primary/5 text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        large ? 'min-h-12 px-4 text-sm' : 'px-3 py-1.5 text-xs',
      )}
    >
      <Bell aria-hidden="true" className="size-4 shrink-0 text-primary motion-safe:animate-pulse" />
      <span>
        <span className="font-semibold">Tap to turn on order sounds.</span>{' '}
        <span className="text-muted-foreground">Your browser keeps them off until you touch the page.</span>
      </span>
    </button>
  );
}
