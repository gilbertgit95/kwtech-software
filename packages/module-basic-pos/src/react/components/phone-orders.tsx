'use client';

import { useMobileSection } from '@kwtech/module-kit/react';
import { BottomSheet, cn, LIST_ITEM, LIST_KEYS, searchIntoList } from '@kwtech/web-ui/react';
import { ChevronRight, Hash, Info, Printer, ReceiptText, RotateCcw, Search, User } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { POS_MOBILE_SECTION } from '../../mobile/sections.js';
import type { PosOrderView } from '../pos-client.js';
import { useOrderList } from '../use-order-list.js';
import { usePosData } from '../use-pos-data.js';
import type { TillState } from '../use-till.js';
import {
  ORDER_FILTERS,
  orderActions,
  orderListTotal,
  orderRowDetail,
  orderStatusChip,
  ordersListEmptyText,
  orderTitle,
  reprintState,
  whenText,
} from '../view/manage.js';
import { formatPeso } from '../view/money.js';
import { phoneOrderNextStep } from '../view/phone-orders.js';
import { receiptHtml } from '../view/receipt.js';
import { lineLabel } from '../view/till.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { Alert, StatusChip } from './layout.js';
import { LineNotes, ListTotal, OrderRefunds, OrderTotals } from './orders-section.js';
import { PhonePeriodPicker } from './phone-period-picker.js';
import { printHtml } from './till.js';

/**
 * ORDERS ON A PHONE (issue #72): the full screen's Orders tab, made for a
 * thumb, so anybody who may see orders finds a past sale, opens it and prints
 * it without a desktop.
 *
 * - **The same list**: `useOrderList` — the days (the reports' picker plus
 *   "All dates", in the WORKSPACE's zone), the status, the search, and how
 *   many outstanding orders other days hold — is the full screen's own. It
 *   opens on today, every status. Live: `usePosData` reads again on any
 *   order event.
 * - **One column of cards**, each a thumb tall, and the list's total under it.
 * - **Tap an order and it rises as a bottom sheet**: its lines, customer,
 *   payment, change and refunds, and Print.
 * - ⚠ **VIEW AND PRINT ONLY** (the operator, 2026-11-05): nothing here changes
 *   an order. An order that still needs somebody says what, and where
 *   (`phoneOrderNextStep`): a held one is a tap from Cashier, for somebody
 *   who may take payment; the rest are the full screen's.
 * - **Print** is the full screen's reprint (`receiptHtml`, marked as a
 *   reprint with the date) through the phone's own print sheet, where it goes
 *   to a printer the phone knows or is saved as a PDF.
 */
export function PhoneOrders({ state }: { state: TillState }) {
  const { timeZone } = state;
  const orders = useOrderList(state);
  const { days, rows, list, selectedId, setSelectedId } = orders;
  const listRef = useRef<HTMLUListElement>(null);
  const selected = selectedId ? rows.find((row) => row.id === selectedId) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <label className="relative block shrink-0">
        <span className="sr-only">Search orders</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-muted-foreground"
        />
        {/* No autofocus: on a phone it would raise the keyboard over the list before anybody asked to type. */}
        <input
          type="search"
          enterKeyHint="search"
          className={cn(INPUT_CLASS, 'h-12 rounded-xl pl-11 text-base')}
          placeholder="Number, customer or reference"
          value={orders.search}
          onChange={(event) => orders.setSearch(event.target.value)}
          onKeyDown={searchIntoList(listRef)}
        />
      </label>

      {/* The phone's own picker (the operator, 2026-11-05): the full screen's is a desktop control. */}
      <div className="shrink-0">
        <PhonePeriodPicker
          days={days}
          today={orders.today}
          preset={orders.preset}
          everyDate={{ active: orders.everyDate, onSelect: orders.showEveryDate }}
          onPreset={orders.onPreset}
          onDays={orders.onDays}
          onCustom={orders.onCustom}
        />
      </div>

      {/*
       * The status, as a row of chips that scrolls sideways rather than wrapping into
       * three rows that push the list off the screen. `aria-pressed`, as the full
       * screen's status bar: one choice among a few.
       */}
      <fieldset className="-mx-3 m-0 flex shrink-0 gap-2 overflow-x-auto border-0 px-3 pb-1 [scrollbar-width:none]">
        <legend className="sr-only">Status</legend>
        {ORDER_FILTERS.map((entry) => {
          const current = entry.key === orders.filter;
          return (
            <button
              key={entry.key}
              type="button"
              aria-pressed={current}
              onClick={() => orders.setFilter(entry.key)}
              className={cn(
                'h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                current
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground active:bg-accent',
              )}
            >
              {entry.label}
            </button>
          );
        })}
        {/* Last in the row, only when something differs from what the screen opens on (today, every status). */}
        {orders.filtered ? (
          <button
            type="button"
            onClick={orders.reset}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            Reset
          </button>
        ) : null}
      </fieldset>

      {orders.otherDays ? (
        <p
          role="status"
          className="flex shrink-0 items-center justify-between gap-2 rounded-xl bg-status-warning px-3 py-2 text-sm text-status-warning-foreground"
        >
          <span>{orders.otherDays}.</span>
          <button type="button" className="shrink-0 font-medium underline" onClick={orders.showEveryDate}>
            Show all dates
          </button>
        </p>
      ) : null}
      <Alert message={list.error ?? orders.countError} />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
            <ReceiptText aria-hidden="true" className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {ordersListEmptyText({
                loading: list.loading,
                problem: orders.problem,
                searching: orders.settled !== '',
                filter: orders.filter,
                days,
              })}
            </p>
          </div>
        ) : (
          <ul ref={listRef} aria-label="Orders" className="flex flex-col gap-2" {...LIST_KEYS}>
            {rows.map((row) => {
              const chip = orderStatusChip(row);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    {...LIST_ITEM}
                    aria-current={row.id === selectedId ? 'true' : undefined}
                    onClick={() => setSelectedId(row.id)}
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-sm active:scale-[0.99] active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-base font-semibold">{orderTitle(row)}</span>
                          <StatusChip {...chip} />
                        </span>
                        <span className="shrink-0 text-base font-semibold tabular-nums">{formatPeso(row.total)}</span>
                      </span>
                      <span className="truncate text-sm text-muted-foreground">{orderRowDetail(row, timeZone)}</span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {rows.length > 0 ? <ListTotal sum={orderListTotal(rows, orders.filter)} filter={orders.filter} /> : null}

      {selectedId ? (
        <PhoneOrderSheet
          key={selectedId}
          orderId={selectedId}
          title={selected ? orderTitle(selected) : 'Order'}
          state={state}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One order, read fresh and kept live, as a bottom sheet: what it is, what it
 * came to, and Print. Looks only: see `PhoneOrders`.
 */
function PhoneOrderSheet({
  orderId,
  title,
  state,
  onClose,
}: {
  orderId: string;
  /** The list row's title, so the sheet is named before the order has loaded. */
  title: string;
  state: TillState;
  onClose: () => void;
}) {
  const { client, scope, timeZone } = state;
  const { open: openSection } = useMobileSection();
  const load = useCallback(() => client.order(scope, orderId), [client, scope, orderId]);
  const detail = usePosData(scope, load, ['order'], 'Could not load this order.');
  const order = detail.data;
  const can = order
    ? orderActions(order, { sell: state.canSell, takePayment: state.canTakePayment, refund: state.canRefund })
    : null;
  const printing = reprintState(detail);

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={order ? orderTitle(order) : title}
      footer={
        order && can?.reprint ? (
          <button
            type="button"
            // ⚠ Only a current copy (`reprintState`): never the one kept while it reads again, or after that failed.
            disabled={printing !== 'ready'}
            className={cn(buttonClass('primary'), 'h-14 w-full rounded-2xl text-base')}
            // ⚠ A reprint says so, with the date (guard rules), as on the full screen.
            onClick={() => printHtml(receiptHtml(order, { timeZone, reprintedAt: new Date() }))}
          >
            <Printer aria-hidden="true" className="size-5" />
            {printing === 'updating' ? 'Updating…' : 'Print receipt'}
          </button>
        ) : null
      }
    >
      {/* A failed re-read leaves the last copy on screen: say so, and Print waits for a good one. */}
      {order && detail.error ? (
        <div className="px-2 pb-2">
          <Alert message={`${detail.error} This may not be the order as it is now.`} />
        </div>
      ) : null}
      {order ? (
        <PhoneOrderBody
          order={order}
          timeZone={timeZone}
          canTakePayment={state.canTakePayment}
          onCashier={() => {
            onClose();
            openSection(POS_MOBILE_SECTION.cashier);
          }}
        />
      ) : detail.error ? (
        <div className="px-2 pb-2">
          <Alert message={detail.error} />
        </div>
      ) : (
        <p className="px-2 pb-4 text-sm text-muted-foreground">
          {detail.loading ? 'Loading…' : 'That order is no longer there.'}
        </p>
      )}
    </BottomSheet>
  );
}

/** The order in the sheet: its status and when, who it was for, its lines, its totals and refunds, what is left to do. */
function PhoneOrderBody({
  order,
  timeZone,
  canTakePayment,
  onCashier,
}: {
  order: PosOrderView;
  timeZone: string;
  canTakePayment: boolean;
  onCashier: () => void;
}) {
  const chip = orderStatusChip(order);
  const next = phoneOrderNextStep(order, { takePayment: canTakePayment });
  return (
    <div className="flex flex-col gap-3 px-2 pb-2">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusChip {...chip} />
        <span className="text-muted-foreground">
          {whenText(order.paidAt ?? order.finalisedAt ?? order.createdAt, timeZone)}
        </span>
        {order.orderTypeName ? <span className="text-muted-foreground">· {order.orderTypeName}</span> : null}
      </p>

      {next ? (
        <div className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">{next.text}</span>
          {next.go === 'cashier' ? (
            <button type="button" className="shrink-0 font-medium underline" onClick={onCashier}>
              Open Cashier
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1 rounded-xl border border-border px-3 py-2 text-sm">
        <p className="flex items-center gap-2">
          <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {order.customerName ? (
            <span className="min-w-0 truncate">
              {order.customerName}
              {order.customerContact ? <span className="text-muted-foreground"> · {order.customerContact}</span> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">Walk-in</span>
          )}
        </p>
        {order.label ? (
          <p className="flex items-center gap-2">
            <Hash aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">Reference:</span> {order.label}
            </span>
          </p>
        ) : null}
      </div>

      {order.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items.</p>
      ) : (
        <ul aria-label="Items" className="flex flex-col divide-y divide-border">
          {order.lines.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">
                  {line.quantity} × {lineLabel(line)}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{formatPeso(line.unitPrice)} each</span>
                <LineNotes line={line} />
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">{formatPeso(line.total)}</span>
            </li>
          ))}
        </ul>
      )}

      <OrderTotals order={order} className="gap-y-1 rounded-xl bg-muted px-3 py-2" />
      <OrderRefunds order={order} timeZone={timeZone} />
      {order.cancelReason ? <p className="text-sm text-muted-foreground">Cancelled: {order.cancelReason}</p> : null}
      {order.voidReason ? <p className="text-sm text-muted-foreground">Voided: {order.voidReason}</p> : null}
    </div>
  );
}
