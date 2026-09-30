'use client';

import { useDebouncedValue } from '@kwtech/web-ui/react';
import { Printer, RotateCcw, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { planRefund } from '../../domain/refunds.js';
import type { PosOrderLineView, PosOrderView, PosRefundInput } from '../pos-client.js';
import { usePosData } from '../use-pos-data.js';
import type { TillState } from '../use-till.js';
import { ORDER_TABS, type OrderTab, orderActions, orderStatusChip, orderTitle, whenText } from '../view/manage.js';
import { formatPercent, formatPeso, parsePeso } from '../view/money.js';
import { METHOD_LABELS, receiptHtml } from '../view/receipt.js';
import { lineLabel } from '../view/till.js';
import { buttonClass, Field, INPUT_CLASS, Modal } from './controls.js';
import { TextDialog } from './dialogs.js';
import { Alert, Empty, ListDetail, RowButton, StatusChip, Tabs } from './layout.js';
import { PaymentDialog } from './payment-dialog.js';
import { printHtml } from './till.js';

/**
 * Orders (D23): Today, Pending, Unpaid, Change owed, Cancelled, All — a list,
 * and the order beside it with what may be done to it: resume an open one,
 * take payment for an unpaid one or void it, refund a paid one, settle owed
 * change, reprint.
 *
 * `openOrderId` opens one from elsewhere (a customer's history), on All.
 */
export function OrdersSection({
  state,
  openOrderId,
  onToSell,
}: {
  state: TillState;
  openOrderId: string | null;
  onToSell: () => void;
}) {
  const { client, scope } = state;
  const [tab, setTab] = useState<OrderTab>('today');
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search);
  const [selectedId, setSelectedId] = useState<string | null>(openOrderId);

  useEffect(() => {
    if (!openOrderId) return;
    setTab('all');
    setSelectedId(openOrderId);
  }, [openOrderId]);

  const load = useCallback(() => client.orders(scope, tab, settled || null), [client, scope, tab, settled]);
  const list = usePosData(scope, load, ['order'], 'Could not load the orders.');
  const rows = list.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Tabs
        label="Which orders"
        tabs={ORDER_TABS}
        current={tab}
        onChange={(next) => {
          setTab(next);
          setSelectedId(null);
        }}
      />
      <Alert message={list.error} />
      <ListDetail
        onBack={() => setSelectedId(null)}
        backLabel="Back to orders"
        list={
          <>
            <label className="relative block">
              <span className="sr-only">Search orders</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              />
              <input
                type="search"
                className={`${INPUT_CLASS} pl-8`}
                placeholder="Order number, customer or label"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
              {rows.length === 0 ? (
                <li>
                  <Empty>{list.loading ? 'Loading…' : 'No orders here.'}</Empty>
                </li>
              ) : null}
              {rows.map((row) => {
                const chip = orderStatusChip(row);
                return (
                  <li key={row.id}>
                    <RowButton selected={row.id === selectedId} onClick={() => setSelectedId(row.id)}>
                      <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{orderTitle(row)}</span>
                          <StatusChip {...chip} />
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {row.number !== null && (row.customerName ?? row.label)
                            ? `${row.customerName ?? row.label} · `
                            : ''}
                          {row.itemCount} {row.itemCount === 1 ? 'item' : 'items'} ·{' '}
                          {whenText(row.paidAt ?? row.finalisedAt ?? row.createdAt, state.timeZone)}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatPeso(row.total)}</span>
                    </RowButton>
                  </li>
                );
              })}
            </ul>
          </>
        }
        detail={
          selectedId ? (
            <OrderDetail
              key={selectedId}
              orderId={selectedId}
              state={state}
              onToSell={onToSell}
              onChanged={() => void list.reload()}
            />
          ) : null
        }
      />
    </div>
  );
}

type Pending = { kind: 'none' } | { kind: 'void' } | { kind: 'refund' } | { kind: 'pay' };

/** One order, read fresh, with the actions its status and the viewer's keys allow. */
export function OrderDetail({
  orderId,
  state,
  onToSell,
  onChanged,
}: {
  orderId: string;
  state: TillState;
  onToSell: () => void;
  onChanged: () => void;
}) {
  const { client, scope, timeZone } = state;
  const load = useCallback(() => client.order(scope, orderId), [client, scope, orderId]);
  const detail = usePosData(scope, load, ['order'], 'Could not load this order.');
  const [dialog, setDialog] = useState<Pending>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const order = detail.data;

  if (!order) {
    return detail.error ? (
      <Alert message={detail.error} />
    ) : (
      <Empty>{detail.loading ? 'Loading…' : 'That order is no longer there.'}</Empty>
    );
  }

  const can = orderActions(order, { sell: state.canSell, refund: state.canRefund });
  const ref = { id: order.id, version: order.version };

  /** One act at a time; the order and the list read again after it. */
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setError(null);
      setDialog({ kind: 'none' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
      await detail.reload();
      onChanged();
    }
  };

  const toTill = async (then: 'sell' | 'pay') => {
    await state.resume(order.id);
    if (then === 'sell') onToSell();
    else setDialog({ kind: 'pay' });
  };

  const chip = orderStatusChip(order);
  return (
    <section aria-label={`Order ${orderTitle(order)}`} className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{orderTitle(order)}</h2>
        <StatusChip {...chip} />
        <span className="text-xs text-muted-foreground">
          {whenText(order.paidAt ?? order.finalisedAt ?? order.createdAt, timeZone)}
        </span>
      </header>
      <Alert message={error} onDismiss={() => setError(null)} />

      <p className="text-sm">
        {order.customerName ? (
          <>
            <span className="font-medium">{order.customerName}</span>
            {order.customerContact ? <span className="text-muted-foreground"> · {order.customerContact}</span> : null}
          </>
        ) : (
          <span className="text-muted-foreground">Walk-in</span>
        )}
        {order.label ? <span className="text-muted-foreground"> · {order.label}</span> : null}
      </p>

      <ul className="flex flex-col gap-1 text-sm">
        {order.lines.length === 0 ? <li className="text-muted-foreground">No items.</li> : null}
        {order.lines.map((line) => (
          <li key={line.id} className="flex flex-col">
            <span className="flex justify-between gap-2">
              <span className="min-w-0">
                {line.quantity} × {lineLabel(line)}
              </span>
              <span className="tabular-nums">{formatPeso(line.total)}</span>
            </span>
            <LineNotes line={line} />
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-y-0.5 border-t border-border pt-2 text-sm tabular-nums">
        {order.orderDiscount > 0 ? (
          <>
            <dt>Subtotal</dt>
            <dd className="text-right">{formatPeso(order.subtotal)}</dd>
            <dt>Discount ({order.discount?.reason})</dt>
            <dd className="text-right">−{formatPeso(order.orderDiscount)}</dd>
          </>
        ) : null}
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">{formatPeso(order.total)}</dd>
        {order.paymentMethod ? (
          <>
            <dt>{METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}</dt>
            <dd className="text-right">{formatPeso(order.received ?? 0)}</dd>
          </>
        ) : null}
        {(order.change ?? 0) > 0 ? (
          <>
            <dt>Change</dt>
            <dd className="text-right">{formatPeso(order.change ?? 0)}</dd>
          </>
        ) : null}
        {order.tip > 0 ? (
          <>
            <dt>Tip</dt>
            <dd className="text-right">{formatPeso(order.tip)}</dd>
          </>
        ) : null}
        {order.changeOwed > 0 ? (
          <>
            <dt>Change owed</dt>
            <dd className="text-right">
              {formatPeso(order.changeOwed)}
              {order.changeSettlement === 'given' ? ' · given' : null}
              {order.changeSettlement === 'tip' ? ' · kept as tip' : null}
            </dd>
          </>
        ) : null}
        {order.paymentReference ? (
          <>
            <dt>Reference</dt>
            <dd className="text-right">{order.paymentReference}</dd>
          </>
        ) : null}
        {order.refunded > 0 ? (
          <>
            <dt className="text-destructive">Refunded</dt>
            <dd className="text-right text-destructive">−{formatPeso(order.refunded)}</dd>
          </>
        ) : null}
      </dl>

      {order.refunds.length > 0 ? (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-medium">Refunds</h3>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            {order.refunds.map((refund) => (
              <li key={refund.id}>
                {formatPeso(refund.amount)} by {METHOD_LABELS[refund.method] ?? refund.method} — {refund.reason} ·{' '}
                {whenText(refund.refundedAt, timeZone)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {order.cancelReason ? <p className="text-sm text-muted-foreground">Cancelled: {order.cancelReason}</p> : null}
      {order.voidReason ? <p className="text-sm text-muted-foreground">Voided: {order.voidReason}</p> : null}

      <div className="flex flex-wrap gap-2">
        {can.resume ? (
          <button type="button" className={buttonClass('primary')} onClick={() => void toTill('sell')}>
            Resume at the till
          </button>
        ) : null}
        {can.takePayment ? (
          <button type="button" className={buttonClass('primary')} onClick={() => void toTill('pay')}>
            Take payment
          </button>
        ) : null}
        {can.settleChange ? (
          <>
            <button
              type="button"
              disabled={busy}
              className={buttonClass('primary')}
              onClick={() =>
                void run(() => client.settleChangeOwed(scope, ref, 'given'), 'Could not record the change as given.')
              }
            >
              Change given
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonClass('secondary')}
              onClick={() =>
                void run(() => client.settleChangeOwed(scope, ref, 'tip'), 'Could not keep the change as a tip.')
              }
            >
              Customer let us keep it
            </button>
          </>
        ) : null}
        {can.refund ? (
          <button type="button" className={buttonClass('secondary')} onClick={() => setDialog({ kind: 'refund' })}>
            <RotateCcw aria-hidden="true" className="size-4" />
            Refund
          </button>
        ) : null}
        {can.voidOrder ? (
          <button type="button" className={buttonClass('danger')} onClick={() => setDialog({ kind: 'void' })}>
            Void
          </button>
        ) : null}
        {can.reprint ? (
          <button
            type="button"
            className={buttonClass('ghost')}
            // ⚠ A reprint says so, with the date (guard rules).
            onClick={() => printHtml(receiptHtml(order, { timeZone, reprintedAt: new Date() }))}
          >
            <Printer aria-hidden="true" className="size-4" />
            Reprint
          </button>
        ) : null}
      </div>

      <TextDialog
        open={dialog.kind === 'void'}
        title={`Void ${orderTitle(order)}`}
        label="Why are the items back?"
        hint="The order keeps its number and leaves the unpaid list."
        initial=""
        required
        danger
        confirmLabel="Void order"
        onSave={(reason) => run(() => client.void(scope, ref, reason), 'Could not void the order.')}
        onClose={() => setDialog({ kind: 'none' })}
      />
      <RefundDialog
        open={dialog.kind === 'refund'}
        order={order}
        onRefund={(input) => run(() => client.refund(scope, order.id, input), 'Could not record the refund.')}
        onClose={() => setDialog({ kind: 'none' })}
      />
      <PaymentDialog
        open={dialog.kind === 'pay' && state.order?.id === order.id}
        order={state.order?.id === order.id ? state.order : null}
        state={state}
        keymap={state.keymap}
        onPaid={() => {
          setDialog({ kind: 'none' });
          onChanged();
          // The receipt is on the till now, ready to print.
          onToSell();
        }}
        onClose={() => setDialog({ kind: 'none' })}
      />
    </section>
  );
}

function LineNotes({ line }: { line: PosOrderLineView }) {
  const parts: string[] = [];
  if (line.discount) {
    const what = line.discount.kind === 'percent' ? formatPercent(line.discount.value) : 'Discount';
    parts.push(`${what} (${line.discount.reason}) −${formatPeso(line.discountAmount)}`);
  }
  if (line.note) parts.push(`Note: ${line.note}`);
  if (line.refundedQuantity > 0) parts.push(`${line.refundedQuantity} refunded`);
  if (parts.length === 0) return null;
  return <span className="text-xs text-muted-foreground">{parts.join(' · ')}</span>;
}

/**
 * A refund (D17): by line (how many of each came back) or by amount (money
 * back, nothing returned), a reason, and how the money went back. The amount
 * shown is the same `planRefund` the server runs, so what the admin sees is
 * what is recorded.
 *
 * ⚠ ONE CLIENT ID PER OPEN DIALOG: a double click refunds once.
 */
function RefundDialog({
  open,
  order,
  onRefund,
  onClose,
}: {
  open: boolean;
  order: PosOrderView;
  onRefund: (input: PosRefundInput) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'lines' | 'amount'>('lines');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(order.paymentMethod ?? 'cash');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const clientId = useRef('');

  useEffect(() => {
    if (!open) return;
    clientId.current = globalThis.crypto.randomUUID();
    setMode('lines');
    setQuantities({});
    setAmount('');
    setMethod(order.paymentMethod ?? 'cash');
    setReason('');
    setProblem(null);
  }, [open, order.paymentMethod]);

  const wanted = Object.entries(quantities)
    .map(([lineId, text]) => ({ lineId, quantity: Number(text) }))
    .filter((line) => Number.isInteger(line.quantity) && line.quantity > 0);
  const soFar = {
    quantities: Object.fromEntries(order.lines.map((line) => [line.id, line.refundedQuantity])),
    amount: order.refunded,
  };
  const request =
    mode === 'amount'
      ? { kind: 'amount' as const, amount: parsePeso(amount) ?? 0 }
      : { kind: 'lines' as const, lines: wanted };
  const plan = planRefund(
    { status: 'paid', total: order.total, lines: order.lines.map(({ id, quantity, net }) => ({ id, quantity, net })) },
    soFar,
    request,
  );
  const left = order.total - order.refunded;

  const submit = async () => {
    if ('refused' in plan) {
      setProblem(REFUND_PROBLEMS[plan.refused] ?? 'That refund is not possible.');
      return;
    }
    if (reason.trim() === '') {
      setProblem('A refund needs a reason.');
      return;
    }
    await onRefund({
      ...(mode === 'amount' ? { amount: plan.amount } : { lines: wanted }),
      method,
      reason,
      clientId: clientId.current,
    });
  };

  return (
    <Modal open={open} title={`Refund ${orderTitle(order)}`} onClose={onClose} wide>
      <p className="text-sm text-muted-foreground">
        Up to {formatPeso(left)} can still be refunded. A tip is never refunded.
      </p>
      <Tabs
        label="Refund by"
        tabs={[
          { key: 'lines', label: 'Items came back' },
          { key: 'amount', label: 'Money only' },
        ]}
        current={mode}
        onChange={setMode}
      />
      {mode === 'lines' ? (
        <ul className="flex flex-col gap-1.5">
          {order.lines.map((line) => {
            const most = line.quantity - line.refundedQuantity;
            return (
              <li key={line.id} className="flex items-center justify-between gap-2 text-sm">
                <label htmlFor={`refund-${line.id}`} className="min-w-0 flex-1">
                  {lineLabel(line)}
                  <span className="text-muted-foreground">
                    {' '}
                    · {most} of {line.quantity} can come back
                  </span>
                </label>
                <input
                  id={`refund-${line.id}`}
                  type="number"
                  min={0}
                  max={most}
                  disabled={most === 0}
                  className={`${INPUT_CLASS} w-20`}
                  value={quantities[line.id] ?? ''}
                  placeholder="0"
                  onChange={(event) => setQuantities({ ...quantities, [line.id]: event.target.value })}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <Field label="Amount to give back">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              inputMode="decimal"
              className={INPUT_CLASS}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
      )}
      <Field label="How the money went back">
        {(id) => (
          <select id={id} className={INPUT_CLASS} value={method} onChange={(event) => setMethod(event.target.value)}>
            {Object.entries(METHOD_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Reason" error={problem}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-invalid={problem !== null}
            aria-describedby={describedBy}
            className={INPUT_CLASS}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm tabular-nums">
          {'refused' in plan ? null : (
            <>
              Refund <strong>{formatPeso(plan.amount)}</strong>
            </>
          )}
        </span>
        <button type="button" className={buttonClass('danger')} onClick={() => void submit()}>
          Record refund
        </button>
      </div>
    </Modal>
  );
}

/** `planRefund`'s refusals, as the admin reads them. */
const REFUND_PROBLEMS: Readonly<Record<string, string>> = {
  not_paid: 'Only a paid order can be refunded.',
  invalid_amount: 'Type the amount to give back, such as 50.',
  exceeds_paid: 'That is more than is left to refund.',
  invalid_quantity: 'Say how many of which item came back.',
  exceeds_sold: 'That is more than was sold, counting earlier refunds.',
  unknown_line: 'That item is not on this order.',
};
