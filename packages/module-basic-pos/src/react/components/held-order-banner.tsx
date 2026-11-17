'use client';

import { cn } from '@kwtech/web-ui/react';
import { Hand, X } from 'lucide-react';
import type { PosOrderSummaryView } from '../pos-client.js';
import { closeHeldOrderLabel, heldOrderBanner } from '../view/held-order.js';

/**
 * The strip every sell view shows while a HELD order is on the till (issue
 * #162): Classic and Cashier above the cart, Phone cashier and Take orders in
 * the order sheet and over the items. One component, so the four can never
 * say it four ways.
 *
 * - **ONE LINE** (the operator, 2026-11-17): the first banner took three lines
 *   of the till's height for a sentence read once. Now the order's name in
 *   bold, a caption cut with "…" where the row is narrow, and Close. The whole
 *   sentence is the row's hover title, and what a screen reader hears.
 * - ⚠ The status-warning colour, as the Pending button uses while orders wait:
 *   a held order on the till is something to notice, and the theme's primary
 *   is already every selected and current thing on these screens.
 *
 * `onClose` null leaves the button out — for a view that may only look.
 */
export function HeldOrderBanner({
  held,
  onClose,
  busy,
  large = false,
  className,
}: {
  held: PosOrderSummaryView;
  onClose: (() => void) | null;
  /** An act is running: closing then would let its answer land on a clear till. */
  busy: boolean;
  /** Sized for a thumb: the phone views. */
  large?: boolean;
  className?: string;
}) {
  const text = heldOrderBanner(held);
  return (
    <div
      role="status"
      title={text.note}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg border border-status-warning bg-status-warning/25 text-foreground',
        large ? 'py-1 pr-1 pl-1.5' : 'py-0.5 pr-0.5 pl-1',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md bg-status-warning text-status-warning-foreground',
          large ? 'size-7' : 'size-6',
        )}
      >
        <Hand className={large ? 'size-4' : 'size-3.5'} />
      </span>
      <p className={cn('min-w-0 flex-1 truncate', large ? 'text-sm' : 'text-xs')}>
        <span className="sr-only">{text.note}</span>
        <span aria-hidden="true">
          <span className="font-semibold">{text.name}</span>
          <span className="text-muted-foreground"> · {text.caption}</span>
        </span>
      </p>
      {onClose ? (
        <button
          type="button"
          aria-label={closeHeldOrderLabel(held)}
          disabled={busy}
          onClick={onClose}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            large ? 'h-9 px-2.5 text-sm' : 'h-7 px-2 text-xs',
          )}
        >
          <X aria-hidden="true" className={large ? 'size-4' : 'size-3.5'} />
          Close
        </button>
      ) : null}
    </div>
  );
}
