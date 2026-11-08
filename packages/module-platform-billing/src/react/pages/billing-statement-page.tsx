'use client';

import { DatePicker } from '@kwtech/web-ui/react';
import { useEffect, useMemo, useState } from 'react';
import {
  type BillingClient,
  type BillingOverviewView,
  type BillingStatementView,
  createBillingClient,
} from '../billing-client.js';
import { buttonClass, Field } from '../components/ui.js';
import { billingPageHref, billingStatementHref } from '../routes.js';
import {
  monthOf,
  statementCsv,
  statementFileName,
  statementLineLabel,
  statementMoney,
  statementRange,
} from '../view/statement-view.js';

export interface BillingStatementPageProps {
  organizationId: string | undefined;
  /** The range's first and last day (`YYYY-MM-DD`), from the address; the current month when absent. */
  from: string | undefined;
  to: string | undefined;
  client?: BillingClient;
}

/**
 * THE STATEMENT OF ACCOUNT (plan §7), printable and downloadable as CSV, on a
 * page without the app's frame so the browser prints the statement alone.
 *
 * The range lives in the address (`?from=&to=`), so a printed statement can
 * be opened again, and a bookmark keeps it. The days are the billing time
 * zone's, as everything billing dates.
 */
export function BillingStatementPage({ organizationId, from, to, client }: BillingStatementPageProps) {
  const api = useMemo(() => client ?? createBillingClient(), [client]);
  const [overview, setOverview] = useState<BillingOverviewView | null>(null);
  const [statement, setStatement] = useState<BillingStatementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    api
      .overview(organizationId)
      .then(async (next) => {
        if (cancelled) return;
        setOverview(next);
        const month = monthOf(next.today);
        const range = { from: from ?? month.from, to: to ?? month.to };
        setDraft(range);
        const read = await api.statement(organizationId, range.from, range.to);
        if (!cancelled) setStatement(read);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the statement.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, organizationId, from, to]);

  /** Offers the statement as a CSV file, built from the lines on the page. */
  function download() {
    if (!statement) return;
    const url = URL.createObjectURL(new Blob([statementCsv(statement)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = statementFileName(statement);
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!organizationId) return <p className="p-6 text-sm text-muted-foreground">No organization in the address.</p>;

  return (
    <div className="mx-auto w-full max-w-4xl p-6 text-foreground print:p-0">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <a href={billingPageHref(organizationId)} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to billing
        </a>
        {draft && overview ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              // The range goes in the address: what is printed can be opened again.
              window.location.assign(billingStatementHref(organizationId, draft.from, draft.to));
            }}
          >
            <Field label="From">
              {(id, note) => (
                <DatePicker
                  id={id}
                  value={draft.from}
                  today={overview.today}
                  // Both days are needed: no Clear that would do nothing.
                  clearable={false}
                  aria-describedby={note}
                  onChange={(day) => setDraft({ ...draft, from: day ?? draft.from })}
                />
              )}
            </Field>
            <Field label="To">
              {(id, note) => (
                <DatePicker
                  id={id}
                  value={draft.to}
                  today={overview.today}
                  clearable={false}
                  aria-describedby={note}
                  onChange={(day) => setDraft({ ...draft, to: day ?? draft.to })}
                />
              )}
            </Field>
            <button type="submit" className={buttonClass()} disabled={draft.from > draft.to}>
              Show
            </button>
          </form>
        ) : null}
        {statement ? (
          <div className="flex gap-2">
            <button type="button" className={buttonClass()} onClick={download}>
              Download CSV
            </button>
            <button type="button" className={buttonClass('primary')} onClick={() => window.print()}>
              Print
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !statement || !overview ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted print:hidden" />
      ) : (
        <article className="rounded-lg border border-border bg-card p-8 print:border-0 print:p-0">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Statement of account</h1>
              <p className="text-sm text-muted-foreground">{overview.organizationName ?? organizationId}</p>
            </div>
            <p className="text-sm">{statementRange(statement)}</p>
          </header>

          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 font-medium">Day</th>
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 text-right font-medium">Billed</th>
                <th className="py-2 text-right font-medium">Paid</th>
                <th className="py-2 text-right font-medium">Credit</th>
                <th className="py-2 text-right font-medium">Credit balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2" />
                <td className="py-2">Opening credit</td>
                <td />
                <td />
                <td />
                <td className="py-2 text-right tabular-nums">{statementMoney(statement, statement.openingCredit)}</td>
              </tr>
              {statement.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border">
                  <td className="py-2 tabular-nums">{entry.day}</td>
                  <td className="py-2">{statementLineLabel(entry)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {entry.billed ? statementMoney(statement, entry.billed) : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {entry.paid ? statementMoney(statement, entry.paid) : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {entry.credit ? statementMoney(statement, entry.credit) : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">{statementMoney(statement, entry.creditBalance)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2" />
                <td className="py-2">Totals</td>
                <td className="py-2 text-right tabular-nums">{statementMoney(statement, statement.billed)}</td>
                <td className="py-2 text-right tabular-nums">{statementMoney(statement, statement.paid)}</td>
                <td />
                <td className="py-2 text-right tabular-nums">{statementMoney(statement, statement.closingCredit)}</td>
              </tr>
            </tbody>
          </table>
          {statement.entries.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing was billed, paid or credited in these days.</p>
          ) : null}
          <p className="mt-6 text-xs text-muted-foreground">
            The credit balance is what the organization holds towards its next bills; a negative balance is owed and
            added to the next bill. Cancelled bills and voided receipts are listed but count for nothing.
          </p>
        </article>
      )}
    </div>
  );
}
