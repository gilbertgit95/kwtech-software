'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type BillingClient,
  type BillingOverviewView,
  type BillingRequestView,
  createBillingClient,
} from '../billing-client.js';
import { buttonClass } from '../components/ui.js';
import { billingPageHref } from '../routes.js';
import {
  documentStamp,
  formatDay,
  formatMoney,
  lineLabel,
  paymentMethodLabel,
  requestTitle,
} from '../view/billing-view.js';

export interface BillingDocumentPageProps {
  organizationId: string | undefined;
  requestId: string | undefined;
  kind: string | undefined;
  /** The printed number: `B-000012` or `R-000003`. */
  number: string | undefined;
  client?: BillingClient;
}

/**
 * ONE BILL OR RECEIPT, AS PRINTED (plan §7), on a page without the app's
 * frame (`chrome: 'fullscreen'`) so the browser prints the document alone.
 *
 * Everything on it comes from the document's own snapshot (the issuer, the
 * lines, the period, the receipt's title and notice), never from today's
 * settings, so a reprint says what the document said when issued. Only the
 * stamp is today's: a bill paid since it was issued reads PAID.
 */
export function BillingDocumentPage({ organizationId, requestId, kind, number, client }: BillingDocumentPageProps) {
  const api = useMemo(() => client ?? createBillingClient(), [client]);
  const [overview, setOverview] = useState<BillingOverviewView | null>(null);
  const [request, setRequest] = useState<BillingRequestView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId || !requestId) return;
    let cancelled = false;
    Promise.all([api.overview(organizationId), api.request(organizationId, requestId)])
      .then(([nextOverview, nextRequest]) => {
        if (cancelled) return;
        setOverview(nextOverview);
        setRequest(nextRequest);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the document.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, organizationId, requestId]);

  const back = organizationId ? billingPageHref(organizationId) : '/';
  const bill = kind === 'bill' ? (request?.bills.find((one) => one.number === number) ?? null) : null;
  const receipt = kind === 'receipt' ? (request?.receipts.find((one) => one.number === number) ?? null) : null;
  const missing = request === null || (request !== undefined && !bill && !receipt);

  return (
    <div className="mx-auto w-full max-w-3xl p-6 text-foreground print:p-0">
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <a href={back} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to billing
        </a>
        {bill || receipt ? (
          <button type="button" className={buttonClass('primary')} onClick={() => window.print()}>
            Print
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : missing ? (
        <p role="alert" className="text-sm text-muted-foreground">
          That document does not exist, or is not this organization’s. Open it from the Billing page.
        </p>
      ) : !overview || !request ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted print:hidden" />
      ) : (
        <article className="rounded-lg border border-border bg-card p-8 print:border-0 print:p-0">
          <PrintedDocument
            overview={overview}
            request={request}
            bill={bill}
            receipt={receipt}
            organizationId={organizationId}
          />
        </article>
      )}
    </div>
  );
}

/**
 * The document itself: everything from its own snapshot, the stamp from
 * today's status. Shared with the platform's print page, so `overview` is
 * only the two fields it reads (the organization's name and the currency a
 * document without one falls back to).
 */
export function PrintedDocument({
  overview,
  request,
  bill,
  receipt,
  organizationId,
}: {
  overview: Pick<BillingOverviewView, 'organizationName' | 'currency'>;
  request: BillingRequestView;
  bill: BillingRequestView['bills'][number] | null;
  receipt: BillingRequestView['receipts'][number] | null;
  organizationId: string | undefined;
}) {
  const issuerName = bill?.issuerName ?? receipt?.issuerName ?? '';
  const issuerDetails = bill?.issuerDetails ?? receipt?.issuerDetails ?? '';
  const paidBy = bill
    ? (request.receipts.find((one) => one.billNumber === bill.number && !one.voidedAt)?.number ?? null)
    : null;
  const stamp = bill
    ? documentStamp({ kind: 'bill', status: bill.status, paidBy })
    : documentStamp({ kind: 'receipt', voided: Boolean(receipt?.voidedAt) });
  const currency = bill?.currency ?? receipt?.currency ?? overview.currency;
  const money = (amount: number) => formatMoney(amount, currency);
  const periodStart = bill?.periodStart ?? receipt?.periodStart ?? null;
  const periodEnd = bill?.periodEnd ?? receipt?.periodEnd ?? null;
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-lg font-semibold">{issuerName || 'Issuer not set'}</p>
          {issuerDetails ? <p className="whitespace-pre-line text-sm text-muted-foreground">{issuerDetails}</p> : null}
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-semibold tracking-tight">{bill ? 'Bill' : receipt?.title}</h1>
          <p className="text-sm tabular-nums">{bill?.number ?? receipt?.number}</p>
          <p className="text-sm text-muted-foreground">
            Issued {formatDay(bill?.issuedOn ?? receipt?.issuedOn ?? null)}
          </p>
        </div>
      </header>

      {stamp ? (
        <p className="mt-6 inline-block rounded border-2 border-current px-3 py-1 text-sm font-bold tracking-wide">
          {stamp}
        </p>
      ) : null}

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{bill ? 'Billed to' : 'Received from'}</dt>
        <dd>{overview.organizationName ?? organizationId}</dd>
        <dt className="text-muted-foreground">For</dt>
        <dd>
          {requestTitle(request)}: {bill?.planLabel ?? receipt?.planLabel}
          {bill?.fromPlanLabel ? ` (from ${bill.fromPlanLabel})` : ''}
        </dd>
        {periodStart ? (
          <>
            <dt className="text-muted-foreground">Period</dt>
            <dd>
              {formatDay(periodStart)} – {formatDay(periodEnd)}
            </dd>
          </>
        ) : null}
        {receipt ? (
          <>
            <dt className="text-muted-foreground">Paid</dt>
            <dd>
              {receipt.method === 'credit'
                ? `${formatDay(receipt.paidOn)}, from the organization's credit`
                : `${formatDay(receipt.paidOn)} by ${paymentMethodLabel(receipt.method)}`}
              {receipt.reference ? `, reference ${receipt.reference}` : ''}
            </dd>
            {receipt.billNumber ? (
              <>
                <dt className="text-muted-foreground">Bill</dt>
                <dd>{receipt.billNumber}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>

      <table className="mt-6 w-full text-sm">
        <tbody>
          {bill ? (
            bill.lines.map((line) => (
              <tr key={`${line.kind}-${line.amount}`} className="border-b border-border">
                <td className="py-2">{lineLabel(line.kind, line.days, line.months)}</td>
                <td className="py-2 text-right tabular-nums">{money(line.amount)}</td>
              </tr>
            ))
          ) : receipt && receipt.kind === 'paid_from_credit' ? (
            // An automatic renewal (#129): the credit paid the bill, and no money was received.
            <tr className="border-b border-border">
              <td className="py-2">Paid from credit (nothing was charged)</td>
              <td className="py-2 text-right tabular-nums">{money(creditPaid(request, receipt.billNumber))}</td>
            </tr>
          ) : receipt ? (
            <tr className="border-b border-border">
              <td className="py-2">
                {receipt.kind === 'closed_as_credit' ? 'Payment received, held as credit' : 'Payment received'}
              </td>
              <td className="py-2 text-right tabular-nums">{money(receipt.amount)}</td>
            </tr>
          ) : null}
          <tr className="font-semibold">
            <td className="py-2">{bill ? 'Total to pay' : 'Total received'}</td>
            <td className="py-2 text-right tabular-nums">{money(bill ? bill.total : (receipt?.amount ?? 0))}</td>
          </tr>
        </tbody>
      </table>

      {receipt?.voidedAt ? (
        <p className="mt-4 text-sm">Voided: {receipt.voidReason ?? 'reversed by our staff'}.</p>
      ) : null}
      {bill?.status === 'cancelled' ? (
        <p className="mt-4 text-sm">This bill was cancelled; nothing is owed on it.</p>
      ) : null}
      {receipt ? <p className="mt-8 text-xs text-muted-foreground">{receipt.notice}</p> : null}
    </>
  );
}

/** What the credit paid on the bill a receipt names (#129): its `credit_applied` line, as a positive amount. */
function creditPaid(request: BillingRequestView | null, billNumber: string | null): number {
  const bill = request?.bills.find((one) => one.number === billNumber);
  const line = bill?.lines.find((one) => one.kind === 'credit_applied');
  return line ? -line.amount : 0;
}
