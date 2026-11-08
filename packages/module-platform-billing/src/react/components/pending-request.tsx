'use client';

import { ConfirmDialog, DatePicker } from '@kwtech/web-ui/react';
import { useState } from 'react';
import { isPaymentMethod, needsReference, PLATFORM_BILLING_PAYMENT_METHODS } from '../../domain/payments.js';
import type { BillingOverviewView, BillingPaymentInput, BillingRequestView } from '../billing-client.js';
import {
  billStatusLabel,
  formatDay,
  formatMoney,
  lineLabel,
  paymentMethodLabel,
  requestKindLabel,
} from '../view/billing-view.js';
import { checkPaymentDraft, type PaymentDraft, type PaymentDraftErrors, paymentInput } from '../view/payment-form.js';
import { buttonClass, Field, inputClass, Reason, Section } from './ui.js';

/**
 * The request waiting for approval: its bill, where to pay, the payment
 * details (a new version each time they are saved), and Withdraw.
 *
 * ⚠ The amount is pre-filled with the bill and the day with today, but never
 * sent until the person saves: a payment is what THEY say they paid, and an
 * approver checks it against what arrived.
 */
export function PendingRequest({
  overview,
  request,
  canEnterPayment,
  busy,
  onSavePayment,
  onWithdraw,
}: {
  overview: BillingOverviewView;
  request: BillingRequestView;
  canEnterPayment: boolean;
  busy: boolean;
  onSavePayment: (payment: BillingPaymentInput) => Promise<boolean>;
  onWithdraw: () => Promise<boolean>;
}) {
  const bill = request.bill;
  const latest = request.payments.at(-1) ?? null;
  const money = (amount: number) => formatMoney(amount, overview.currency);
  const [draft, setDraft] = useState<PaymentDraft>(() => ({
    method: latest?.method ?? 'cash',
    amount: latest ? (latest.amount / 100).toFixed(2) : bill ? (bill.total / 100).toFixed(2) : '',
    paidOn: latest?.paidOn ?? overview.today,
    reference: latest?.reference ?? '',
    sender: latest?.sender ?? '',
    note: latest?.note ?? '',
  }));
  const [errors, setErrors] = useState<PaymentDraftErrors>({});
  const [withdrawing, setWithdrawing] = useState(false);
  const edit = (patch: Partial<PaymentDraft>) => setDraft((current) => ({ ...current, ...patch }));

  /** Checks the draft as the server will, then saves it as a new version of the details. */
  async function save() {
    const found = checkPaymentDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    await onSavePayment(paymentInput(draft));
  }

  return (
    <Section title={`${requestKindLabel(request.kind)}: waiting for approval`}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Bill</h3>
          {bill ? (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="flex justify-between">
                <span>{bill.number}</span>
                <span className="font-medium">{billStatusLabel(bill.status)}</span>
              </p>
              <table className="mt-2 w-full">
                <tbody>
                  {bill.lines.map((line) => (
                    <tr key={`${line.kind}-${line.amount}`}>
                      <td className="py-0.5">{lineLabel(line.kind, line.days)}</td>
                      <td className="py-0.5 text-right tabular-nums">{money(line.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-semibold">
                    <td className="py-1">To pay</td>
                    <td className="py-1 text-right tabular-nums">{money(bill.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              A downgrade is billed on the day it is approved, with that day’s credit. Nothing needs paying before then.
            </p>
          )}

          <h3 className="mb-2 mt-4 text-sm font-semibold">Where to pay</h3>
          {overview.paymentAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The payment accounts have not been set up yet. Contact us for how to pay.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {overview.paymentAccounts.map((account) => (
                <li key={`${account.method}-${account.label}`} className="rounded-md border border-border p-2">
                  <p className="font-medium">
                    {account.label}{' '}
                    <span className="text-muted-foreground">({paymentMethodLabel(account.method)})</span>
                  </p>
                  <p className="whitespace-pre-line text-muted-foreground">{account.details}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Your payment details</h3>
          {latest ? (
            <p className="mb-3 text-sm text-muted-foreground">
              Saved: {paymentMethodLabel(latest.method)}, {money(latest.amount)}, paid {formatDay(latest.paidOn)}
              {request.coveredOn
                ? '. It covers the bill; we will check it and approve.'
                : '. It does not cover the bill yet.'}
            </p>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">
              Nothing can be approved until you add how and when you paid.
            </p>
          )}
          {canEnterPayment ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field label="Paid by" error={errors.method}>
                {(id, note) => (
                  <select
                    id={id}
                    value={draft.method}
                    aria-invalid={errors.method ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ method: event.target.value })}
                    className={inputClass(Boolean(errors.method))}
                  >
                    {PLATFORM_BILLING_PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {paymentMethodLabel(method)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Amount paid" error={errors.amount} hint={`In ${overview.currency}, as sent.`}>
                {(id, note) => (
                  <input
                    id={id}
                    inputMode="decimal"
                    value={draft.amount}
                    aria-invalid={errors.amount ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ amount: event.target.value })}
                    className={inputClass(Boolean(errors.amount))}
                  />
                )}
              </Field>
              <Field label="Day paid" error={errors.paidOn}>
                {(id, note) => (
                  <DatePicker
                    id={id}
                    value={draft.paidOn || null}
                    today={overview.today}
                    className="w-full"
                    aria-invalid={errors.paidOn ? true : undefined}
                    aria-describedby={note}
                    onChange={(day) => edit({ paidOn: day ?? '' })}
                  />
                )}
              </Field>
              <Field
                label="Reference number"
                error={errors.reference}
                hint={
                  isPaymentMethod(draft.method) && needsReference(draft.method)
                    ? 'Required: copy it from the payment confirmation.'
                    : 'Optional for cash.'
                }
              >
                {(id, note) => (
                  <input
                    id={id}
                    value={draft.reference}
                    aria-invalid={errors.reference ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ reference: event.target.value })}
                    className={inputClass(Boolean(errors.reference))}
                  />
                )}
              </Field>
              <Field label="Sent by" hint="The name on the payment, if it is not yours." error={errors.sender}>
                {(id, note) => (
                  <input
                    id={id}
                    value={draft.sender}
                    aria-invalid={errors.sender ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ sender: event.target.value })}
                    className={inputClass(Boolean(errors.sender))}
                  />
                )}
              </Field>
              <Field label="Note" error={errors.note}>
                {(id, note) => (
                  <textarea
                    id={id}
                    rows={2}
                    value={draft.note}
                    aria-invalid={errors.note ? true : undefined}
                    aria-describedby={note}
                    onChange={(event) => edit({ note: event.target.value })}
                    className={inputClass(Boolean(errors.note))}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={buttonClass('primary')} disabled={busy}>
                  {busy ? 'Saving…' : latest ? 'Save new payment details' : 'Save payment details'}
                </button>
                <button
                  type="button"
                  className={buttonClass('danger')}
                  disabled={busy}
                  onClick={() => setWithdrawing(true)}
                >
                  Withdraw request
                </button>
              </div>
            </form>
          ) : (
            <Reason>Your role does not include adding payment details. Ask the owner or an admin.</Reason>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={withdrawing}
        title="Withdraw this request?"
        confirmLabel="Withdraw it"
        danger
        pending={busy}
        description="Its bill is cancelled and nothing changes on your plan. You can make a new request after."
        onConfirm={() => {
          void onWithdraw().then((done) => {
            if (done) setWithdrawing(false);
          });
        }}
        onCancel={() => setWithdrawing(false)}
      />
    </Section>
  );
}
