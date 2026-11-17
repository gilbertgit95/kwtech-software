'use client';

import { cn } from '@kwtech/web-ui/react';
import { Hand, X } from 'lucide-react';
import type { PosOrderSummaryView } from '../pos-client.js';
import { closeHeldOrderLabel, heldOrderBanner } from '../view/held-order.js';
import { buttonClass } from './controls.js';

/**
 * The banner every sell view shows while a HELD order is on the till (issue
 * #162): Classic and Cashier above the cart, Phone cashier and Take orders in
 * the order sheet and over the items. One component, so the four can never
 * say it four ways.
 *
 * ⚠ The status-warning colour, as the Pending button uses while orders wait:
 * a held order on the till is something to notice, and the theme's primary
 * is already every selected and current thing on these screens.
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
      className={cn(
        'flex shrink-0 items-start gap-2 border-2 border-status-warning bg-status-warning/25 text-foreground',
        large ? 'rounded-xl px-3 py-2.5' : 'rounded-md px-2.5 py-2',
        className,
      )}
    >
      <Hand aria-hidden="true" className={cn('mt-0.5 shrink-0', large ? 'size-5' : 'size-4')} />
      <div className={cn('min-w-0 flex-1', large ? 'text-sm' : 'text-xs')}>
        <p className={cn('truncate font-semibold', large ? 'text-base' : 'text-sm')}>{text.heading}</p>
        <p className="truncate text-muted-foreground">{text.detail}</p>
        <p className="mt-0.5">{text.note}</p>
      </div>
      {onClose ? (
        <button
          type="button"
          aria-label={closeHeldOrderLabel(held)}
          disabled={busy}
          onClick={onClose}
          className={cn(buttonClass('secondary', large ? 'md' : 'sm'), 'shrink-0', large ? 'h-11 rounded-xl' : null)}
        >
          <X aria-hidden="true" className={large ? 'size-5' : 'size-3.5'} />
          Close
        </button>
      ) : null}
    </div>
  );
}
