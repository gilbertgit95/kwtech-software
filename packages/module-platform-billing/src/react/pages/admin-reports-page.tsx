'use client';

import { DatePicker } from '@kwtech/web-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type BillingAdminClient, type BillingReportView, createBillingAdminClient } from '../billing-admin-client.js';
import { buttonClass, ErrorLine, Field, Reason, Section } from '../components/ui.js';
import { BILLING_ADMIN_ORGANIZATIONS_ROUTE, BILLING_ADMIN_ROUTE, billingAdminReportsHref } from '../routes.js';
import { billingDayOf, formatMoney, paymentMethodLabel } from '../view/billing-view.js';
import {
  type CollectedTable,
  collectedTable,
  collectionsCsv,
  collectionsFileName,
  periodLabel,
  standingKindWords,
} from '../view/report-view.js';
import { monthOf, statementRange } from '../view/statement-view.js';

export interface AdminReportsPageProps {
  /** The range from the address (`?from=&to=`); the current billing month when absent. */
  from: string | undefined;
  to: string | undefined;
  client?: BillingAdminClient;
}

/**
 * `/admin/billing/reports` (phase 7b): what the platform collected over a
 * range of days, by day, month and method, what each plan earned, and every
 * organization's standing counted, with credit held and owed apart.
 *
 * The range lives in the address, as the statement's does, so a report can
 * be bookmarked and opened again. Days are the billing time zone's.
 */
export function AdminReportsPage({ from, to, client }: AdminReportsPageProps) {
  const api = useMemo(() => client ?? createBillingAdminClient(), [client]);
  const [report, setReport] = useState<BillingReportView | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped per read: only the latest answer is shown. */
  const ticket = useRef(0);

  useEffect(() => {
    const mine = ++ticket.current;
    setReport(null);
    setError(null);
    api
      .settings()
      .then(async (settings) => {
        const day = billingDayOf(new Date(), settings.timeZone);
        const month = monthOf(day);
        const range = { from: from ?? month.from, to: to ?? month.to };
        if (mine !== ticket.current) return;
        setToday(day);
        setDraft(range);
        const read = await api.report(range.from, range.to);
        if (mine === ticket.current) setReport(read);
      })
      .catch((cause: unknown) => {
        if (mine === ticket.current) setError(cause instanceof Error ? cause.message : 'Could not load the report.');
      });
    return () => {
      // A newer read (or leaving the page) makes this one's answer stale.
      ticket.current += 1;
    };
  }, [api, from, to]);

  /** The collections as a CSV file, the same rows the page shows. */
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([collectionsCsv(report)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = collectionsFileName(report);
    link.click();
    URL.revokeObjectURL(url);
  }

  const money = (amount: number) => formatMoney(amount, report?.currency ?? 'PHP');

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 print:max-w-none">
      <a href={BILLING_ADMIN_ROUTE} className="text-sm text-muted-foreground hover:text-foreground print:hidden">
        ← Back to the billing queue
      </a>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Money is counted on the day its receipt was issued, in the billing time zone, so a closed month never changes.
          A voided receipt is never counted.
        </p>
      </header>

      {draft && today ? (
        <form
          className="flex flex-wrap items-end gap-3 print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            window.location.assign(billingAdminReportsHref(draft.from, draft.to));
          }}
        >
          <Field label="From">
            {(id, note) => (
              <DatePicker
                id={id}
                value={draft.from}
                today={today}
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
                today={today}
                clearable={false}
                aria-describedby={note}
                onChange={(day) => setDraft({ ...draft, to: day ?? draft.to })}
              />
            )}
          </Field>
          <button type="submit" className={buttonClass()} disabled={draft.from > draft.to}>
            Show
          </button>
          {report ? (
            <>
              <button type="button" className={buttonClass()} onClick={download}>
                Download CSV
              </button>
              <button type="button" className={buttonClass()} onClick={() => window.print()}>
                Print
              </button>
            </>
          ) : null}
        </form>
      ) : null}

      {error ? (
        <ErrorLine message={error} onDismiss={() => setError(null)} onReload={() => window.location.reload()} />
      ) : null}

      {!report ? (
        error ? null : (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        )
      ) : (
        <>
          <p className="text-sm font-medium">{statementRange(report)}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Collected" value={money(report.total)} note={`${report.receipts} receipts`} />
            <Figure
              label="Credit held for organizations"
              value={money(report.standings.creditHeld)}
              note={`${report.standings.organizationsWithCredit} organizations, today`}
            />
            <Figure label="Owed to us" value={money(report.standings.creditOwed)} note="Today" />
            <Figure
              label="Need attention"
              value={String(report.standings.overdue + report.standings.expired)}
              note={`${report.standings.overdue} overdue, ${report.standings.expired} expired`}
              href={`${BILLING_ADMIN_ORGANIZATIONS_ROUTE}?filter=attention`}
            />
          </div>
          {!report.standings.available ? (
            <Reason>The app does not list organizations to billing, so standings and credit cannot be counted.</Reason>
          ) : !report.standings.complete ? (
            <Reason>
              Counted over the first {report.standings.organizations} organizations only: past that, the count is too
              large to work out on request.
            </Reason>
          ) : null}

          <Section title="Collected by month">
            <CollectedTableView table={collectedTable(report.byMonth)} money={money} />
          </Section>
          <Section title="Collected by day">
            <CollectedTableView table={collectedTable(report.byDay)} money={money} />
          </Section>

          <Section title="Collected per plan">
            {report.perPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing was collected in this range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1 font-medium">Plan</th>
                    <th className="py-1 text-right font-medium">Receipts</th>
                    <th className="py-1 text-right font-medium">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {report.perPlan.map((plan) => (
                    <tr key={plan.planKey ?? 'credit'} className="border-b border-border">
                      <td className="py-1">{plan.planLabel}</td>
                      <td className="py-1 text-right tabular-nums">{plan.receipts}</td>
                      <td className="py-1 text-right tabular-nums">{money(plan.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Organizations today">
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              <li>{report.standings.organizations} organizations</li>
              <li>{report.standings.pending} with a request waiting</li>
              {report.standings.byKind.map((one) => (
                <li key={one.kind}>
                  {one.count} {standingKindWords(one.kind)}
                </li>
              ))}
            </ul>
            <a href={BILLING_ADMIN_ORGANIZATIONS_ROUTE} className="mt-3 inline-block text-sm underline print:hidden">
              See every organization
            </a>
          </Section>
        </>
      )}
    </div>
  );
}

/** One headline number, with what it counts. */
function Figure({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </>
  );
  return href ? (
    <a
      href={href}
      className="rounded-lg border border-border p-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </a>
  ) : (
    <div className="rounded-lg border border-border p-3">{body}</div>
  );
}

/** A collections table: one row per period, one column per method, totals at the foot. */
function CollectedTableView({ table, money }: { table: CollectedTable; money: (amount: number) => string }) {
  if (table.rows.length === 0)
    return <p className="text-sm text-muted-foreground">Nothing was collected in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1 font-medium">Period</th>
            {table.methods.map((method) => (
              <th key={method} className="py-1 text-right font-medium">
                {paymentMethodLabel(method)}
              </th>
            ))}
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.period} className="border-b border-border">
              <td className="py-1">{periodLabel(row.period)}</td>
              {table.methods.map((method) => (
                <td key={method} className="py-1 text-right tabular-nums">
                  {row.byMethod[method] ? money(row.byMethod[method]) : '—'}
                </td>
              ))}
              <td className="py-1 text-right tabular-nums">{money(row.total)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1">Total</td>
            {table.methods.map((method) => (
              <td key={method} className="py-1 text-right tabular-nums">
                {money(table.totals.byMethod[method] ?? 0)}
              </td>
            ))}
            <td className="py-1 text-right tabular-nums">{money(table.totals.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
