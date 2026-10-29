'use client';

import { cn } from '@kwtech/web-ui/react';
import { type PosWaitUrgency, waitText, waitUrgency } from '../view/take-orders.js';

/*
 * ⚠ URGENCY IS A TINT OF THE THEME'S PRIMARY, in rising strength — never the
 * status colours. Those are fixed across every palette on purpose (web-ui
 * `base.css`: "error" stays red on the forest theme), so they would ignore the
 * theme picker; and an order waiting is not an error. A tint of `primary`
 * follows whichever palette, light or dark, the person picked (the operator,
 * 2026-10-29). The card colours in `cashier.tsx` follow the same rule.
 */

const URGENCY_BADGE: Record<PosWaitUrgency, string> = {
  new: 'text-muted-foreground',
  waiting: 'bg-primary/10 text-primary',
  long: 'bg-primary/20 text-primary',
  overdue: 'bg-primary text-primary-foreground',
};

const URGENCY_DOT: Record<PosWaitUrgency, string> = {
  new: 'bg-primary/30',
  waiting: 'bg-primary/60',
  long: 'bg-primary',
  // Only the forgotten ones pulse, and only for somebody who has not asked for less motion.
  overdue: 'bg-primary-foreground motion-safe:animate-pulse',
};

/**
 * How long an order has waited, coloured by how pressing that is (issue #23).
 * The words carry the meaning too, so the colour is never the only signal.
 */
export function WaitBadge({
  minutes,
  inverted = false,
}: {
  minutes: number;
  /** On a primary-coloured chip (the order on the screen): the badge drops its own colour so it stays legible. */
  inverted?: boolean;
}) {
  const urgency = waitUrgency(minutes);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular-nums',
        inverted ? 'bg-primary-foreground/20 text-primary-foreground' : URGENCY_BADGE[urgency],
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', inverted ? 'bg-primary-foreground' : URGENCY_DOT[urgency])}
      />
      {waitText(minutes)}
      {urgency === 'overdue' ? <span className="sr-only"> — waiting a long time</span> : null}
    </span>
  );
}
