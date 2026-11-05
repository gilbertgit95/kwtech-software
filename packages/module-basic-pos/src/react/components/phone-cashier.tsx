'use client';

import { useMobileSection } from '@kwtech/module-kit/react';
import { BottomSheet, cn, LIST_ITEM, LIST_KEYS } from '@kwtech/web-ui/react';
import { Ban, ChevronRight, CircleCheck, Hash, Inbox, Minus, Plus, Printer, Trash2, User } from 'lucide-react';
import { useState } from 'react';
import { POS_MOBILE_SECTION } from '../../mobile/sections.js';
import type { PosOrderView } from '../pos-client.js';
import { useNow } from '../use-now.js';
import type { TillState } from '../use-till.js';
import { formatPeso } from '../view/money.js';
import { phoneCashierSheet, settledElsewhereText, waitingSummary } from '../view/phone-cashier.js';
import { receiptHtml } from '../view/receipt.js';
import {
  canLeaveOrder,
  heldOrderDetail,
  heldOrderTitle,
  waitMinutes,
  waitText,
  waitUrgency,
} from '../view/take-orders.js';
import { lineLabel } from '../view/till.js';
import { URGENCY_CARD } from './cashier.js';
import { buttonClass, PhoneDialogs } from './controls.js';
import { CustomerDialog, ReferenceDialog, TextDialog } from './dialogs.js';
import { OrderTypePicker } from './order-type-picker.js';
import { PaymentDialog } from './payment-dialog.js';
import { printHtml } from './till.js';
import { WaitBadge } from './wait-badge.js';

/** Which sheet is up over the order: none, the order itself, or one of its dialogs over it. */
type Sheet = 'none' | 'order' | 'pay' | 'cancel' | 'customer' | 'reference';

/**
 * CASHIER ON A PHONE (issue #69): the full screen's Cashier board, made for a
 * thumb, so a cashier or a manager settles a held order without a desktop.
 *
 * - **The same list**: `state.pending`, live and oldest first, coloured by how
 *   long each order has waited (`URGENCY_CARD`, `WaitBadge`) — the desktop
 *   board's own rules. One column of cards, each a whole thumb tall.
 * - **Tap an order and it rises as a bottom sheet**: its type, customer,
 *   reference and lines, the total, and Pay. Payment, the customer, the
 *   reference and Cancel each open as a sheet over it (`PhoneDialogs`).
 * - **Every control follows its key**, as Take orders does: Pay and Cancel
 *   with `pos:take_payment` (the section's own key), changing the order with
 *   `pos:sell`. The API refuses regardless.
 * - **Adding items is Take orders'** — its grouped list, search and sizes —
 *   reached with "Add items": the order stays on the till (`useTill` lives
 *   above both sections), so it is waiting there, open, to add to.
 * - **After a sale, its receipt**, with the change in large type: the moment
 *   the cashier hands money back. Only for a sale THIS phone made
 *   (`phoneCashierSheet`).
 */
export function PhoneCashier({ state }: { state: TillState }) {
  const { client, scope } = state;
  const { open: openSection } = useMobileSection();
  const now = useNow();
  const [sheet, setSheet] = useState<Sheet>('none');
  /** The order this phone just paid or released, so its receipt shows — and another till's never does. */
  const [settledHereId, setSettledHereId] = useState<string | null>(null);
  /** Said when a tap could not open an order (one on the till is not held yet). */
  const [notice, setNotice] = useState<string | null>(null);

  const order = state.order;
  const open = order?.status === 'open' ? order : null;
  const lines = open?.lines ?? [];
  const summary = waitingSummary(state.pending, now);
  const shows = phoneCashierSheet(order, settledHereId);
  const canChange = state.canSell;

  const openOrder = async (orderId: string) => {
    setNotice(null);
    if (open?.id === orderId) {
      setSheet('order');
      return;
    }
    // ⚠ An order never held is listed nowhere: putting another on the till would strand it.
    if (!canLeaveOrder(open, state.pending)) {
      setNotice(
        'The order being taken on this phone is not held yet. Hold it in Take orders first, so it is not lost.',
      );
      return;
    }
    setSettledHereId(null);
    // ⚠ Only once the tapped order is on the till: on a failure the till still holds the last one.
    if (await state.resume(orderId)) setSheet('order');
  };

  /** Closes the sheet; a settled order leaves the till, so the next tap starts clean. */
  const closeSheet = () => {
    setSheet('none');
    if (shows === 'receipt' || shows === 'settled_elsewhere') {
      state.clear();
      setSettledHereId(null);
    }
  };

  const settled = (done: PosOrderView) => {
    setSettledHereId(done.id);
    setSheet('order');
  };

  return (
    <PhoneDialogs>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <WaitingHeader count={summary.count} total={summary.total} oldestMinutes={summary.oldestMinutes} />

        {notice ? (
          <p
            role="status"
            className="flex items-start justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-foreground"
          >
            <span>{notice}</span>
            <button type="button" className="shrink-0 font-medium underline" onClick={() => setNotice(null)}>
              OK
            </button>
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
          {state.pending.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
              <Inbox aria-hidden="true" className="size-10 text-muted-foreground" />
              <p className="text-base font-semibold">Nothing is waiting</p>
              <p className="text-sm text-muted-foreground">
                Orders held on the phones and at the counter show here at once.
              </p>
            </div>
          ) : (
            <ul aria-label="Waiting for payment" className="flex flex-col gap-2" {...LIST_KEYS}>
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
                      disabled={state.busy}
                      onClick={() => void openOrder(held.id)}
                      className={cn(
                        'flex min-h-20 w-full items-center gap-3 rounded-2xl border border-l-4 bg-card px-4 py-3 text-left shadow-sm transition-transform duration-100 active:scale-[0.99] active:bg-accent disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                        URGENCY_CARD[urgency],
                        current ? 'ring-2 ring-ring ring-offset-1 ring-offset-background' : null,
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-base font-semibold">{heldOrderTitle(held)}</span>
                          <span className="shrink-0 text-base font-semibold tabular-nums">
                            {formatPeso(held.total)}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate text-muted-foreground">
                            {held.label && held.customerName ? `${held.customerName} · ` : ''}
                            {heldOrderDetail(held)}
                            {current ? ' · open' : ''}
                          </span>
                          {minutes === null ? null : <WaitBadge minutes={minutes} />}
                        </span>
                      </span>
                      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <BottomSheet
          open={sheet !== 'none' && shows !== 'none'}
          onClose={closeSheet}
          title={sheetTitle(shows, order)}
          footer={
            shows === 'order' && open ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-baseline justify-between">
                  <span className="text-base font-semibold">Total</span>
                  <span className="text-2xl font-semibold tabular-nums">{formatPeso(open.total)}</span>
                </p>
                <button
                  type="button"
                  disabled={lines.length === 0 || state.busy}
                  onClick={() => setSheet('pay')}
                  className={cn(buttonClass('primary'), 'h-14 w-full rounded-2xl text-base')}
                >
                  Pay {formatPeso(open.total)}
                </button>
                <button
                  type="button"
                  disabled={state.busy}
                  onClick={() => setSheet('cancel')}
                  className={cn(buttonClass('ghost'), 'h-11 w-full rounded-2xl text-destructive')}
                >
                  <Ban aria-hidden="true" className="size-4" />
                  Cancel order
                </button>
              </div>
            ) : shows === 'receipt' && order ? (
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <button
                  type="button"
                  className={cn(buttonClass('secondary'), 'h-14 rounded-2xl')}
                  onClick={() => printHtml(receiptHtml(order, { timeZone: state.timeZone }))}
                >
                  <Printer aria-hidden="true" className="size-5" />
                  Print
                </button>
                <button
                  type="button"
                  className={cn(buttonClass('primary'), 'h-14 rounded-2xl text-base')}
                  onClick={closeSheet}
                >
                  Done
                </button>
              </div>
            ) : shows === 'settled_elsewhere' ? (
              <button
                type="button"
                className={cn(buttonClass('primary'), 'h-14 w-full rounded-2xl text-base')}
                onClick={closeSheet}
              >
                Back to the list
              </button>
            ) : null
          }
        >
          {shows === 'order' && open ? (
            <OrderBody
              state={state}
              order={open}
              canChange={canChange}
              onCustomer={() => setSheet('customer')}
              onReference={() => setSheet('reference')}
              onAddItems={() => {
                // The order stays on the till: Take orders opens with it, ready to add to.
                setSheet('none');
                openSection(POS_MOBILE_SECTION.sell);
              }}
            />
          ) : null}
          {shows === 'receipt' && order ? <PhoneReceipt order={order} /> : null}
          {shows === 'settled_elsewhere' && order ? (
            <p role="status" className="px-2 pb-2 text-base">
              {settledElsewhereText(order.status)} It has left the list; nothing was taken on this phone.
            </p>
          ) : null}
        </BottomSheet>

        <PaymentDialog
          open={sheet === 'pay'}
          order={open}
          state={state}
          keymap={state.keymap}
          phone
          onPaid={settled}
          onClose={() => setSheet('order')}
        />
        <TextDialog
          open={sheet === 'cancel'}
          title="Cancel this order"
          label="Reason"
          hint="Kept on the record, with your name: “changed their mind”."
          initial=""
          required={lines.length > 0}
          confirmLabel="Cancel order"
          danger
          onSave={async (reason) => {
            const cancelled = await state.act((current) => client.cancel(scope, current, reason || null));
            if (!cancelled) return;
            state.clear();
            setSheet('none');
            setNotice(`Cancelled ${cancelled.label ? `“${cancelled.label}”` : 'the order'}.`);
          }}
          onClose={() => setSheet('order')}
        />
        <CustomerDialog open={sheet === 'customer'} state={state} onClose={() => setSheet('order')} />
        <ReferenceDialog
          open={sheet === 'reference'}
          title="Order reference"
          label="Reference (optional)"
          hint="Letters or numbers: “table 5”, “T12”, “pickup 3”. Empty removes it."
          initial={open?.label ?? ''}
          options={state.referenceOptions}
          held={state.pending}
          currentId={open?.id ?? null}
          phone
          confirmLabel="Save reference"
          onSave={async (reference) => {
            const done = await state.act((current) => client.setLabel(scope, current, reference.trim() || null));
            if (done) setSheet('order');
          }}
          onClose={() => setSheet('order')}
        />
      </div>
    </PhoneDialogs>
  );
}

function sheetTitle(shows: ReturnType<typeof phoneCashierSheet>, order: PosOrderView | null): string {
  if (!order) return 'Order';
  if (shows === 'receipt') return order.status === 'unpaid' ? 'Released — pay later' : 'Paid';
  if (shows === 'settled_elsewhere') return 'No longer waiting';
  return heldOrderTitle({ label: order.label, customerName: order.customerName, number: order.number });
}

/** The list's head: how many wait, what they come to, and how long the oldest has waited. */
function WaitingHeader({
  count,
  total,
  oldestMinutes,
}: {
  count: number;
  total: number;
  oldestMinutes: number | null;
}) {
  return (
    <section
      aria-label="Waiting for payment"
      className="flex shrink-0 items-center justify-between gap-3 rounded-2xl bg-primary/10 px-4 py-3"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-muted-foreground">Waiting for payment</span>
        <span className="block text-xs text-muted-foreground">
          {oldestMinutes === null ? 'Oldest first' : `Oldest first · the oldest has waited ${waitText(oldestMinutes)}`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-2xl font-semibold tabular-nums leading-tight">
          {count}
          <span className="sr-only"> waiting</span>
        </span>
        {count > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{formatPeso(total)}</span> : null}
      </span>
    </section>
  );
}

/** The order in the sheet: how it is served, who it is for, and its lines — changeable with `pos:sell`. */
function OrderBody({
  state,
  order,
  canChange,
  onCustomer,
  onReference,
  onAddItems,
}: {
  state: TillState;
  order: PosOrderView;
  canChange: boolean;
  onCustomer: () => void;
  onReference: () => void;
  onAddItems: () => void;
}) {
  const { client, scope } = state;
  return (
    <div className="flex flex-col gap-3 px-2 pb-2">
      {canChange ? <OrderTypePicker state={state} order={order} large labelled /> : null}
      {order.orderTypeName && !canChange ? (
        <p className="text-sm text-muted-foreground">{order.orderTypeName}</p>
      ) : null}

      <button type="button" className={detailBoxClass} disabled={!canChange} onClick={onCustomer}>
        <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {order.customerName ? (
          <span className="min-w-0 truncate">
            {order.customerName}
            {order.customerContact ? <span className="text-muted-foreground"> · {order.customerContact}</span> : null}
            {order.customerId ? null : <span className="ml-1 text-xs text-muted-foreground">(walk-in)</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">{canChange ? 'Walk-in — add a customer' : 'Walk-in'}</span>
        )}
      </button>
      <button type="button" className={detailBoxClass} disabled={!canChange} onClick={onReference}>
        <Hash aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {order.label ? (
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">Reference:</span> {order.label}
          </span>
        ) : (
          <span className="text-muted-foreground">{canChange ? 'No reference — add one' : 'No reference'}</span>
        )}
      </button>

      {order.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing on this order yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {order.lines.map((line) => (
            <li key={line.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{lineLabel(line)}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {formatPeso(line.unitPrice)} · {formatPeso(line.total)}
                </span>
                {line.note ? <span className="block truncate text-xs text-muted-foreground">{line.note}</span> : null}
              </span>
              {canChange ? (
                <>
                  <button
                    type="button"
                    aria-label={line.quantity > 1 ? `One fewer ${lineLabel(line)}` : `Remove ${lineLabel(line)}`}
                    disabled={state.busy}
                    className={stepperClass}
                    onClick={() =>
                      void state.act((current) =>
                        line.quantity > 1
                          ? client.updateLine(scope, current, line.id, { quantity: line.quantity - 1 })
                          : client.removeLine(scope, current, line.id),
                      )
                    }
                  >
                    {line.quantity > 1 ? (
                      <Minus aria-hidden="true" className="size-4" />
                    ) : (
                      <Trash2 aria-hidden="true" className="size-4" />
                    )}
                  </button>
                  <span className="w-7 text-center text-base font-semibold tabular-nums">{line.quantity}</span>
                  <button
                    type="button"
                    aria-label={`One more ${lineLabel(line)}`}
                    disabled={state.busy}
                    className={stepperClass}
                    onClick={() =>
                      void state.act((current) =>
                        client.updateLine(scope, current, line.id, { quantity: line.quantity + 1 }),
                      )
                    }
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </button>
                </>
              ) : (
                <span className="text-base font-semibold tabular-nums">× {line.quantity}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {order.discount || order.lineDiscounts > 0 ? (
        <p className="flex justify-between text-sm text-muted-foreground tabular-nums">
          <span>Discounts</span>
          <span>−{formatPeso(order.lineDiscounts + order.orderDiscount)}</span>
        </p>
      ) : null}

      {canChange ? (
        <button
          type="button"
          disabled={state.busy}
          onClick={onAddItems}
          className={cn(buttonClass('secondary'), 'h-12 w-full rounded-xl')}
        >
          <Plus aria-hidden="true" className="size-5" />
          Add items
        </button>
      ) : null}
    </div>
  );
}

/** A sale this phone just made: what it came to and, largest, the change to hand back. */
function PhoneReceipt({ order }: { order: PosOrderView }) {
  const unpaid = order.status === 'unpaid';
  const change = order.change ?? 0;
  return (
    <div className="flex flex-col items-center gap-3 px-2 pb-2 text-center">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-14 items-center justify-center rounded-full motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300',
          unpaid
            ? 'bg-status-warning text-status-warning-foreground'
            : 'bg-status-success text-status-success-foreground',
        )}
      >
        <CircleCheck className="size-8" />
      </span>
      {/* The sheet's title says paid or pay later; this line names the order, for the receipt and a question later. */}
      <p role="status" className="text-base font-semibold">
        Order #{order.number}
        {unpaid ? <span className="font-normal text-muted-foreground"> — to be paid later</span> : null}
      </p>
      {change > 0 ? (
        <div className="w-full rounded-2xl bg-primary/10 px-4 py-3">
          <p className="text-sm text-muted-foreground">Change to hand back</p>
          <p className="text-4xl font-semibold tabular-nums">{formatPeso(change)}</p>
        </div>
      ) : null}
      <dl className="grid w-full grid-cols-2 gap-y-1 text-left text-sm tabular-nums">
        <dt className="text-muted-foreground">Total</dt>
        <dd className="text-right font-semibold">{formatPeso(order.total)}</dd>
        {order.received !== null ? (
          <>
            <dt className="text-muted-foreground">Received</dt>
            <dd className="text-right">{formatPeso(order.received)}</dd>
          </>
        ) : null}
        {order.tip > 0 ? (
          <>
            <dt className="text-muted-foreground">Tip</dt>
            <dd className="text-right">{formatPeso(order.tip)}</dd>
          </>
        ) : null}
        {order.changeOwed > 0 ? (
          <>
            <dt className="font-medium">Change owed</dt>
            <dd className="text-right font-medium">{formatPeso(order.changeOwed)}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/** The customer's and the reference's boxes: Take orders' dashed box, a thumb tall. */
const detailBoxClass =
  'flex min-h-12 w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 text-left text-sm active:bg-accent disabled:border-solid disabled:active:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** A thumb-sized + / − beside a line, as in Take orders. */
const stepperClass =
  'flex size-11 shrink-0 items-center justify-center rounded-full border border-border active:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
