'use client';

import type { BillingHistoryPageView } from '../billing-client.js';
import {
  billStatusLabel,
  eventSentence,
  formatInstantDay,
  formatMoney,
  requestKindLabel,
  requestStateLabel,
} from '../view/billing-view.js';
import { buttonClass, Section } from './ui.js';

/**
 * The organization's history: one row per request (plan §7), newest first,
 * each with its bills, receipts and every step in words with its reason, so
 * the history explains itself later. Printing, filters and totals arrive in
 * phase 6b.
 */
export function BillingHistory({
  history,
  currency,
  timeZone,
  onLoadMore,
}: {
  history: BillingHistoryPageView | null;
  currency: string;
  /** The billing time zone: every instant shows as its day there. */
  timeZone: string;
  onLoadMore: () => void;
}) {
  const money = (amount: number) => formatMoney(amount, currency);
  return (
    <Section title="History">
      {history === null ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : history.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {history.items.map((request) => (
            <li key={request.id} className="rounded-md border border-border">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="font-medium">
                    {requestKindLabel(request.kind)}: {request.bills.at(-1)?.planLabel ?? request.planKey}
                  </span>
                  <span className="text-muted-foreground">
                    {requestStateLabel(request.state)} · {formatInstantDay(request.requestedAt, timeZone)}
                  </span>
                </summary>
                <div className="border-t border-border p-3 text-sm">
                  {request.bills.length > 0 ? (
                    <ul className="mb-2 space-y-1">
                      {request.bills.map((bill) => (
                        <li key={bill.id} className="flex flex-wrap justify-between gap-2">
                          <span>Bill {bill.number}</span>
                          <span className="tabular-nums">
                            {money(bill.total)} · {billStatusLabel(bill.status)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {request.receipts.length > 0 ? (
                    <ul className="mb-2 space-y-1">
                      {request.receipts.map((receipt) => (
                        <li key={receipt.id} className="flex flex-wrap justify-between gap-2">
                          <span>
                            Receipt {receipt.number}
                            {receipt.voidedAt ? ' (VOID)' : ''}
                          </span>
                          <span className="tabular-nums">{money(receipt.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {request.decisionReason && request.state !== 'approved' ? (
                    <p className="mb-2">Reason given: {request.decisionReason}</p>
                  ) : null}
                  {request.voidReason ? <p className="mb-2">Reversed because: {request.voidReason}</p> : null}
                  <ol className="space-y-1 text-muted-foreground">
                    {request.events.map((event) => (
                      <li key={event.id} className="flex gap-2">
                        <time className="shrink-0 tabular-nums" dateTime={event.at}>
                          {formatInstantDay(event.at, timeZone)}
                        </time>
                        <span>{eventSentence(event, currency)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
      {history?.nextCursor ? (
        <button type="button" className={`${buttonClass()} mt-3`} onClick={onLoadMore}>
          Show older requests
        </button>
      ) : null}
    </Section>
  );
}
