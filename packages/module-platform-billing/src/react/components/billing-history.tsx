'use client';

import { useId } from 'react';
import { HISTORY_STATES } from '../../domain/statement.js';
import type { BillingHistoryFilter, BillingHistoryPageView } from '../billing-client.js';
import { billingDocumentHref, billingStatementHref } from '../routes.js';
import {
  billStatusLabel,
  eventSentence,
  formatInstantDay,
  formatMoney,
  requestKindLabel,
  requestStateLabel,
} from '../view/billing-view.js';
import { monthOf } from '../view/statement-view.js';
import { buttonClass, Section } from './ui.js';

/**
 * The organization's history: one row per request (plan §7), newest first,
 * each with its bills, receipts and every step in words with its reason, so
 * the history explains itself later. Filtered by year and state on the
 * server (so the totals cover every page), and every bill and receipt opens
 * as a printable page.
 */
export function BillingHistory({
  organizationId,
  today,
  history,
  currency,
  timeZone,
  error,
  filter,
  onFilter,
  onRetry,
  onLoadMore,
}: {
  organizationId: string;
  /** Today in the billing time zone: the years offered, and the statement's default month. */
  today: string;
  history: BillingHistoryPageView | null;
  /** The filters in force, and changing them. */
  filter: BillingHistoryFilter;
  onFilter: (filter: BillingHistoryFilter) => void;
  currency: string;
  /** The billing time zone: every instant shows as its day there. */
  timeZone: string;
  /** Why the history could not be read, with `onRetry` to read it again. */
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const money = (amount: number) => formatMoney(amount, currency);
  const yearId = useId();
  const stateId = useId();
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 5 }, (_, back) => thisYear - back);
  const month = monthOf(today);
  return (
    <Section
      title="History"
      actions={
        <a href={billingStatementHref(organizationId, month.from, month.to)} className={buttonClass()}>
          Statement of account
        </a>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
        <div>
          <label htmlFor={yearId} className="mb-1 block font-medium">
            Year
          </label>
          <select
            id={yearId}
            value={filter.year ?? ''}
            onChange={(event) => onFilter({ ...filter, year: event.target.value ? Number(event.target.value) : null })}
            className="rounded-md border border-border bg-background px-2 py-1.5"
          >
            <option value="">All years</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={stateId} className="mb-1 block font-medium">
            State
          </label>
          <select
            id={stateId}
            value={filter.state ?? ''}
            onChange={(event) => onFilter({ ...filter, state: event.target.value || null })}
            className="rounded-md border border-border bg-background px-2 py-1.5"
          >
            <option value="">Any state</option>
            {HISTORY_STATES.map((state) => (
              <option key={state} value={state}>
                {requestStateLabel(state)}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={filter.hideClosed ?? false}
            disabled={Boolean(filter.state)}
            onChange={(event) => onFilter({ ...filter, hideClosed: event.target.checked })}
          />
          Hide withdrawn and rejected
        </label>
      </div>
      {history ? (
        <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
          {history.totals.requests === 1 ? '1 request' : `${history.totals.requests} requests`}
          {history.totals.paidInYear !== null && filter.year
            ? `; ${money(history.totals.paidInYear)} received in ${filter.year}.`
            : '.'}
        </p>
      ) : null}
      {history === null && error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" className={buttonClass()} onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : history === null ? (
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
                          <span>
                            Bill {bill.number}{' '}
                            <a
                              href={billingDocumentHref(organizationId, request.id, 'bill', bill.number)}
                              className="text-xs underline"
                            >
                              Print
                            </a>
                          </span>
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
                            {receipt.voidedAt ? ' (VOID)' : ''}{' '}
                            <a
                              href={billingDocumentHref(organizationId, request.id, 'receipt', receipt.number)}
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
