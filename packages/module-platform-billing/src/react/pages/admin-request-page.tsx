'use client';

import { DEFAULT_TIME_ZONE } from '@kwtech/module-kit';
import { useHoldsFeature } from '@kwtech/module-kit/react';
import { ConfirmDialog, DatePicker } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isPaymentMethod, needsReference, PLATFORM_BILLING_PAYMENT_METHODS } from '../../domain/payments.js';
import { PLATFORM_BILLING_FEATURE } from '../../feature-keys.js';
import {
  type BillingAdminClient,
  type BillingQueueItemView,
  type BillingSettingsView,
  createBillingAdminClient,
} from '../billing-admin-client.js';
import { buttonClass, ErrorLine, Field, inputClass, Reason, Section } from '../components/ui.js';
import { BILLING_ADMIN_ROUTE, billingAdminDocumentHref } from '../routes.js';
import { approvalDraft, checkDecisionReason, queueChecks } from '../view/admin-view.js';
import {
  billingDayOf,
  billStatusLabel,
  eventSentence,
  formatDay,
  formatInstantDay,
  formatMoney,
  lineLabel,
  paymentMethodLabel,
  requestKindLabel,
  requestStateLabel,
} from '../view/billing-view.js';
import { checkPaymentDraft, type PaymentDraft, type PaymentDraftErrors, paymentInput } from '../view/payment-form.js';

export interface AdminRequestPageProps {
  requestId: string | undefined;
  client?: BillingAdminClient;
}

/** Which decision dialog is open. */
type Decision = 'reject' | 'close' | 'void' | null;

/**
 * `/admin/billing/requests/:requestId` (phase 7): one request of any
 * organization, as an approver checks it. Its checks with what triggered
 * each, the bill, every version of the payment details, the timeline, and
 * the decisions: approve with the payment pre-filled from the owner's
 * details, reject or close as credit with a reason, and void an approval.
 *
 * ⚠ Hiding a control is cosmetic: the API authorises every decision again,
 * and approval is refused on details changed since this page read them.
 */
export function AdminRequestPage({ requestId, client }: AdminRequestPageProps) {
  const api = useMemo(() => client ?? createBillingAdminClient(), [client]);
  const canApprove = useHoldsFeature(PLATFORM_BILLING_FEATURE.approve);
  const canVoid = useHoldsFeature(PLATFORM_BILLING_FEATURE.void);
  const [item, setItem] = useState<BillingQueueItemView | null | undefined>(undefined);
  const [settings, setSettings] = useState<BillingSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [errors, setErrors] = useState<PaymentDraftErrors>({});
  const [decision, setDecision] = useState<Decision>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  /** Reads the request again, with the settings its dates and money follow. */
  const load = useCallback(async () => {
    if (!requestId) return;
    try {
      const [next, nextSettings] = await Promise.all([api.review(requestId), api.settings()]);
      setItem(next);
      setSettings(nextSettings);
      if (next) setDraft(approvalDraft(next.request, billingDayOf(new Date(), nextSettings.timeZone)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the request.');
    }
  }, [api, requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one decision, then reads the request again whatever happened. */
  async function act(action: () => Promise<unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
      return false;
    } finally {
      // ⚠ Busy until the re-read lands: enabled earlier, a second decision would be sent against the page as it was.
      await load();
      setBusy(false);
    }
  }

  /** The payment as the approver confirms it, or null when the form says why not. */
  function confirmedPayment() {
    if (!draft || !item) return null;
    const found = checkPaymentDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return null;
    const input = paymentInput(draft);
    return {
      detailsVersion: item.request.detailsVersion,
      method: input.method,
      amount: input.amount,
      paidOn: input.paidOn,
      reference: input.reference ?? null,
    };
  }

  async function approve() {
    const payment = confirmedPayment();
    if (!payment || !item) return;
    await act(() => api.approve(item.request.id, payment), 'Approved: the plan is applied and a receipt issued.');
  }

  async function decide() {
    if (!item || !decision) return;
    const problem = checkDecisionReason(reason, decision !== 'close');
    setReasonError(problem);
    if (problem) return;
    const id = item.request.id;
    let done = false;
    if (decision === 'reject')
      done = await act(() => api.reject(id, reason.trim()), 'Rejected. Its bill is cancelled.');
    if (decision === 'void') done = await act(() => api.void(id, reason.trim()), 'Voided: the approval is reversed.');
    if (decision === 'close') {
      const payment = confirmedPayment();
      if (!payment) {
        setDecision(null);
        return;
      }
      done = await act(
        () => api.closeAsCredit(id, payment, reason.trim() || null),
        'Closed as credit: the payment received was added to the organization’s credit.',
      );
    }
    // Closed either way: a failure's message is at the top of the page, which the dialog would cover. The
    // reason is kept after a failure, so trying again does not mean typing it again.
    setDecision(null);
    if (done) setReason('');
  }

  if (!requestId) return <p className="text-sm text-muted-foreground">No request in the address.</p>;

  const request = item?.request ?? null;
  const currency = request?.bill?.currency ?? settings?.currency ?? 'PHP';
  const timeZone = settings?.timeZone ?? DEFAULT_TIME_ZONE;
  const money = (amount: number) => formatMoney(amount, currency);
  const edit = (patch: Partial<PaymentDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <a href={BILLING_ADMIN_ROUTE} className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to the queue
      </a>
      {error ? <ErrorLine message={error} onDismiss={() => setError(null)} onReload={() => void load()} /> : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {item === undefined ? (
        error ? null : (
          <div className="h-48 animate-pulse rounded-lg bg-muted" />
        )
      ) : !item || !request ? (
        <p role="alert" className="text-sm text-muted-foreground">
          That request does not exist. Open it from the queue.
        </p>
      ) : (
        <>
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">
              {item.organizationName ?? request.organizationId}: {requestKindLabel(request.kind)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {request.bill?.planLabel ?? request.planKey} · {requestStateLabel(request.state)} · requested{' '}
              {formatInstantDay(request.requestedAt, timeZone)}
            </p>
          </header>

          {request.state === 'pending' ? (
            <Section title="Checks">
              {queueChecks(item.flags, currency).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing flags: the details match the bill.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {queueChecks(item.flags, currency).map((check) => (
                    <li key={check.text} className={check.tone === 'warning' ? 'font-medium' : 'text-muted-foreground'}>
                      {check.text}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          <div className="grid gap-5 md:grid-cols-2">
            <Section title="Bill">
              {request.bills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No bill yet: a downgrade is billed on the day it is approved, with that day’s credit.
                </p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {request.bills.map((bill) => (
                    <li key={bill.id}>
                      <p className="flex justify-between gap-2">
                        <span>
                          {bill.number}{' '}
                          <a
                            href={billingAdminDocumentHref(request.id, 'bill', bill.number)}
                            className="text-xs underline"
                          >
                            Print
                          </a>
                        </span>
                        <span>{billStatusLabel(bill.status)}</span>
                      </p>
                      <table className="mt-1 w-full">
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
                    </li>
                  ))}
                </ul>
              )}
              {request.receipts.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {request.receipts.map((receipt) => (
                    <li key={receipt.id} className="flex justify-between gap-2">
                      <span>
                        Receipt {receipt.number}
                        {receipt.voidedAt ? ' (VOID)' : ''}{' '}
                        <a
                          href={billingAdminDocumentHref(request.id, 'receipt', receipt.number)}
                          className="text-xs underline"
                        >
                          Print
                        </a>
                      </span>
                      <span className="tabular-nums">{money(receipt.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>

            <Section title="Payment details from the organization">
              {request.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">None entered yet.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {[...request.payments].reverse().map((payment) => (
                    <li key={payment.version} className="rounded-md border border-border p-2">
                      <p className="font-medium">
                        Version {payment.version}
                        {payment.version === request.detailsVersion ? ' (latest)' : ''}
                      </p>
                      <p>
                        {money(payment.amount)} by {paymentMethodLabel(payment.method)}, paid{' '}
                        {formatDay(payment.paidOn)}
                        {payment.reference ? `, reference ${payment.reference}` : ''}
                      </p>
                      {payment.sender ? <p className="text-muted-foreground">Sent by {payment.sender}</p> : null}
                      {payment.note ? <p className="text-muted-foreground">{payment.note}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>

          {request.state === 'pending' && draft ? (
            <Section title="Decide">
              {canApprove ? (
                <form
                  className="grid gap-3 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void approve();
                  }}
                >
                  <p className="text-sm text-muted-foreground md:col-span-2">
                    Confirm the payment as it actually arrived. It starts from the organization’s latest details
                    (version {request.detailsVersion}); if they change before you approve, you are asked to review
                    again.
                  </p>
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
                  <Field label="Amount received" error={errors.amount} hint={`In ${currency}.`}>
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
                  <Field label="Day received" error={errors.paidOn}>
                    {(id, note) => (
                      <DatePicker
                        id={id}
                        value={draft.paidOn || null}
                        today={settings ? billingDayOf(new Date(), settings.timeZone) : draft.paidOn}
                        clearable={false}
                        className="w-full"
                        aria-invalid={errors.paidOn ? true : undefined}
                        aria-describedby={note}
                        onChange={(day) => edit({ paidOn: day ?? draft.paidOn })}
                      />
                    )}
                  </Field>
                  <Field
                    label="Reference number"
                    error={errors.reference}
                    hint={
                      isPaymentMethod(draft.method) && needsReference(draft.method) ? 'Required.' : 'Optional for cash.'
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
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    <button type="submit" className={buttonClass('primary')} disabled={busy}>
                      {busy ? 'Working…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className={buttonClass()}
                      disabled={busy}
                      onClick={() => setDecision('close')}
                    >
                      Close as credit
                    </button>
                    <button
                      type="button"
                      className={buttonClass('danger')}
                      disabled={busy}
                      onClick={() => setDecision('reject')}
                    >
                      Reject
                    </button>
                  </div>
                </form>
              ) : (
                <Reason>Deciding requests needs the billing approver role.</Reason>
              )}
            </Section>
          ) : null}

          {request.state === 'approved' && request.kind !== 'adjustment' ? (
            <Section title="Reverse this approval">
              <p className="text-sm text-muted-foreground">
                A mistaken approval is voided: its receipt reads VOID, its bill is unpaid again, its credit is reversed
                and the subscription goes back to what it was. Only the organization’s latest approval can be voided.
              </p>
              {canVoid ? (
                <button
                  type="button"
                  className={`${buttonClass('danger')} mt-3`}
                  disabled={busy}
                  onClick={() => setDecision('void')}
                >
                  Void this approval
                </button>
              ) : (
                <Reason>Voiding needs the billing approver role.</Reason>
              )}
            </Section>
          ) : null}

          <Section title="Timeline">
            <ol className="space-y-1 text-sm text-muted-foreground">
              {request.events.map((event) => (
                <li key={event.id} className="flex gap-2">
                  <time className="shrink-0 tabular-nums" dateTime={event.at}>
                    {formatInstantDay(event.at, timeZone)}
                  </time>
                  <span>{eventSentence(event, currency)}</span>
                </li>
              ))}
            </ol>
            {request.decisionReason ? <p className="mt-2 text-sm">Reason given: {request.decisionReason}</p> : null}
            {request.voidReason ? <p className="mt-1 text-sm">Voided because: {request.voidReason}</p> : null}
          </Section>

          <ConfirmDialog
            open={decision !== null}
            title={
              decision === 'reject'
                ? 'Reject this request?'
                : decision === 'void'
                  ? 'Void this approval?'
                  : 'Keep the payment as credit?'
            }
            confirmLabel={decision === 'reject' ? 'Reject it' : decision === 'void' ? 'Void it' : 'Close as credit'}
            danger={decision !== 'close'}
            pending={busy}
            description={
              <>
                {decision === 'reject'
                  ? 'Its bill is cancelled and nothing changes. The organization reads your reason.'
                  : decision === 'void'
                    ? 'The receipt reads VOID, the bill is unpaid again, its credit is reversed and the subscription goes back.'
                    : `The payment above (${draft?.amount ?? '0'} ${currency}) is recorded and added to the organization’s credit; the plan does not change and the bill is cancelled.`}
                <label htmlFor="billing-decision-reason" className="mt-3 block text-sm font-medium text-foreground">
                  Reason{decision === 'close' ? ' (optional)' : ''}
                </label>
                <textarea
                  id="billing-decision-reason"
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  aria-invalid={reasonError ? true : undefined}
                  aria-describedby="billing-decision-reason-note"
                  className={inputClass(Boolean(reasonError))}
                />
                <span
                  id="billing-decision-reason-note"
                  role={reasonError ? 'alert' : undefined}
                  className={`mt-1 block text-xs ${reasonError ? 'text-destructive' : ''}`}
                >
                  {reasonError ?? 'The organization reads it in its history.'}
                </span>
              </>
            }
            onConfirm={() => void decide()}
            onCancel={() => {
              setDecision(null);
              setReasonError(null);
            }}
          />
        </>
      )}
    </div>
  );
}
