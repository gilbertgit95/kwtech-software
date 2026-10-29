'use client';

import { cn, LIST_ITEM, LIST_KEYS } from '@kwtech/web-ui/react';
import { useNow } from '../use-now.js';
import type { TillState } from '../use-till.js';
import { formatPeso } from '../view/money.js';
import {
  canLeaveOrder,
  heldOrderDetail,
  heldOrderTitle,
  type PosWaitUrgency,
  waitMinutes,
  waitText,
  waitUrgency,
} from '../view/take-orders.js';
import { Till } from './till.js';
import { WaitBadge } from './wait-badge.js';

/**
 * CASHIER (issue #23): the full screen at the cashier's window. Every held
 * order waits in a column of its own, oldest first, and the till beside it is
 * where one is opened, checked, changed if need be, and paid.
 *
 * - **Live.** The column is `state.pending`, which every order write re-reads
 *   (`posEvents`), so an order a seller holds on a phone appears here at once,
 *   and one paid at another till leaves.
 * - **Oldest first, and loudest.** In a restaurant a table pays after it has
 *   eaten, so the order that has waited longest is the one to look at: each
 *   card is coloured by how long it has waited (`waitUrgency`), and its time
 *   ticks on its own (`useNow`), so "12 min" becomes "13 min" untouched.
 * - **The till is the keyboard till** (`Till`), not a copy of it: payment,
 *   change owed, discounts and the receipt are already right there, with
 *   their keys. Opening an order puts it on the till, as Pending always has.
 * - Only for somebody who may take payment; `PosApp` does not offer it to
 *   anybody else, and the bindings refuse them regardless.
 */
export function Cashier({ state }: { state: TillState }) {
  const open = state.order?.status === 'open' ? state.order : null;
  const now = useNow();
  const oldest = state.pending[0];

  const openOrder = (orderId: string) => {
    if (open?.id === orderId) return;
    // ⚠ An order never held is listed nowhere: putting another one on the till would strand it.
    if (!canLeaveOrder(open, state.pending)) {
      state.showError(
        new Error('The till has an order that is not held yet. Pay it or hold it first, so it is not lost.'),
        '',
      );
      return;
    }
    void state.resume(orderId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 @4xl:flex-row">
      <section
        aria-label="Waiting for payment"
        className="flex max-h-64 min-h-0 shrink-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 @4xl:max-h-none @4xl:w-80"
      >
        <div>
          <h2 className="flex items-baseline justify-between text-sm font-semibold">
            Waiting for payment
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{state.pending.length}</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {oldest && now
              ? `Oldest first · the oldest has waited ${waitText(waitMinutes(oldest.createdAt, now))}`
              : 'Oldest first'}
          </p>
        </div>
        {state.pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting. Orders held on the phones and at the counter show here at once.
          </p>
        ) : (
          <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto p-0.5" {...LIST_KEYS}>
            {state.pending.map((held) => {
              const current = held.id === open?.id;
              const minutes = now ? waitMinutes(held.createdAt, now) : null;
              const urgency = minutes === null ? 'new' : waitUrgency(minutes);
              return (
                <li key={held.id}>
                  <button
                    type="button"
                    {...LIST_ITEM}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => openOrder(held.id)}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-md border border-l-4 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      URGENCY_CARD[urgency],
                      current ? 'ring-2 ring-ring ring-offset-1 ring-offset-card' : null,
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold">{heldOrderTitle(held)}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{formatPeso(held.total)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-muted-foreground">
                        {held.label && held.customerName ? `${held.customerName} · ` : ''}
                        {heldOrderDetail(held)}
                        {current ? ' · on the till' : ''}
                      </span>
                      {minutes === null ? null : <WaitBadge minutes={minutes} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Till state={state} />
    </div>
  );
}

/*
 * ── urgency colours ───────────────────────────────────────────────────────
 *
 * ⚠ FROM THE THEME'S PRIMARY, in rising strength — never the status colours.
 * Those are fixed across every palette on purpose (web-ui `base.css`: "error"
 * stays red on the forest theme), so they would ignore the theme picker; and
 * an order waiting is not an error. A tint of `primary` follows whichever
 * palette, light or dark, the person picked (the operator, 2026-10-29).
 */

/** The card's edge and wash, by urgency: calm, then stronger, then solid. */
const URGENCY_CARD: Record<PosWaitUrgency, string> = {
  new: 'border-border border-l-primary/25',
  waiting: 'border-border border-l-primary/60',
  long: 'border-primary/50 border-l-primary bg-primary/5',
  overdue: 'border-primary border-l-primary bg-primary/10',
};
