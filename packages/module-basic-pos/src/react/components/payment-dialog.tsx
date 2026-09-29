'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useRef, useState } from 'react';
import type { PosPaymentMethod } from '../../types.js';
import type { PosOrderView } from '../pos-client.js';
import type { TillState } from '../use-till.js';
import { formatPeso, parsePeso, pesoInputValue } from '../view/money.js';
import { previewPayment } from '../view/payment.js';
import { METHOD_LABELS } from '../view/receipt.js';
import { buttonClass, Field, INPUT_CLASS, Modal } from './controls.js';

const METHODS: readonly PosPaymentMethod[] = ['cash', 'ewallet', 'card'];

/**
 * Taking payment (D12–D14): cash with change, e-wallet or card recorded with a
 * reference, a tip, change owed, or Pay later — each checked by the same
 * `planPayment` the server runs, so the till never promises change the server
 * will refuse.
 *
 * ⚠ ONE CLIENT ID PER OPEN DIALOG. A double click or a retry after a timeout
 * sends the same id, and the server answers with the order it already paid
 * rather than paying twice.
 */
export function PaymentDialog({
  open,
  order,
  state,
  onPaid,
  onClose,
}: {
  open: boolean;
  order: PosOrderView | null;
  state: TillState;
  onPaid: (order: PosOrderView) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PosPaymentMethod>('cash');
  const [received, setReceived] = useState('');
  const [keepTip, setKeepTip] = useState(false);
  const [owe, setOwe] = useState(false);
  const [reference, setReference] = useState('');
  const clientId = useRef('');
  const receivedRef = useRef<HTMLInputElement>(null);
  const total = order?.total ?? 0;

  useEffect(() => {
    if (!open) return;
    clientId.current = globalThis.crypto.randomUUID();
    setMethod('cash');
    setReceived(pesoInputValue(total));
    setKeepTip(false);
    setOwe(false);
    setReference('');
  }, [open, total]);

  const customer = { name: order?.customerName ?? null, contact: order?.customerContact ?? null };
  const preview = previewPayment(total, { method, received: parsePeso(received), keepTip, owe }, customer);
  const unpaid = order?.status === 'unpaid';

  const pay = async () => {
    if (!order || !preview.ok) return;
    const amount = parsePeso(received) ?? 0;
    const paid = await state.act((current) =>
      state.client.pay(state.scope, current, {
        method,
        received: amount,
        tip: preview.tip,
        changeOwed: preview.changeOwed,
        reference: reference || null,
        clientId: clientId.current,
      }),
    );
    if (paid) onPaid(paid);
  };

  const payLater = async () => {
    const released = await state.act((current) => state.client.payLater(state.scope, current));
    if (released) onPaid(released);
  };

  const choose = (next: PosPaymentMethod) => {
    setMethod(next);
    if (next !== 'cash') setOwe(false);
    receivedRef.current?.focus();
  };

  return (
    <Modal open={open} title={`Payment — ${formatPeso(total)}`} onClose={onClose}>
      <fieldset
        className="grid grid-cols-3 gap-1"
        onKeyDown={(event) => {
          // D18: 1 2 3 choose the method while focus is on the choice.
          const index = ['1', '2', '3'].indexOf(event.key);
          const picked = METHODS[index];
          if (picked) {
            event.preventDefault();
            choose(picked);
          }
        }}
      >
        <legend className="sr-only">Paid by</legend>
        {METHODS.map((option, index) => (
          <button
            key={option}
            type="button"
            aria-pressed={method === option}
            // biome-ignore lint/a11y/noAutofocus: a dialog opens where the person will type or choose next (D20: focus always has a home).
            autoFocus={index === 0}
            className={buttonClass(method === option ? 'primary' : 'secondary')}
            onClick={() => choose(option)}
          >
            <span className="text-xs opacity-70">{index + 1}</span> {METHOD_LABELS[option]}
          </button>
        ))}
      </fieldset>

      <Field label="Received (₱)" error={preview.ok ? null : preview.problem}>
        {(id, describedBy) => (
          <input
            id={id}
            ref={receivedRef}
            inputMode="decimal"
            aria-invalid={!preview.ok}
            aria-describedby={describedBy}
            className={cn(INPUT_CLASS, 'text-lg tabular-nums')}
            value={received}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setReceived(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void pay();
              }
            }}
          />
        )}
      </Field>

      {method !== 'cash' ? (
        <Field label="Reference" hint="The e-wallet or card reference number, if there is one.">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={INPUT_CLASS}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </Field>
      ) : null}

      <div className="flex flex-col gap-1.5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={keepTip} onChange={(event) => setKeepTip(event.target.checked)} />
          Keep what is over as a tip
        </label>
        {method === 'cash' ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={owe} onChange={(event) => setOwe(event.target.checked)} />
            Change owed — hand it over later (needs the customer)
          </label>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm tabular-nums">
        <dt>Total</dt>
        <dd className="text-right">{formatPeso(total)}</dd>
        {preview.ok ? (
          <>
            <dt className="font-semibold">Change</dt>
            <dd className="text-right text-lg font-semibold">{formatPeso(preview.change)}</dd>
            {preview.tip > 0 ? (
              <>
                <dt>Tip</dt>
                <dd className="text-right">{formatPeso(preview.tip)}</dd>
              </>
            ) : null}
            {preview.changeOwed > 0 ? (
              <>
                <dt>Change owed</dt>
                <dd className="text-right">{formatPeso(preview.changeOwed)}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {unpaid ? (
          <span className="text-xs text-muted-foreground">Taking payment for an unpaid order.</span>
        ) : (
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={state.busy}
            title={customer.name && customer.contact ? undefined : 'Needs the customer’s name and contact'}
            onClick={() => void payLater()}
          >
            Pay later
          </button>
        )}
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={!preview.ok || state.busy}
          onClick={() => void pay()}
        >
          {state.busy ? 'Paying…' : `Pay ${formatPeso(total)}`}
        </button>
      </div>
    </Modal>
  );
}
