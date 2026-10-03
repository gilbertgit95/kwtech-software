'use client';

import { cn } from '@kwtech/web-ui/react';
import { moneyRows } from '../../domain/balances.js';
import type { BooksOverviewView } from '../books-client.js';
import { formatDay, formatMonth, PLACE_LABEL } from '../view/labels.js';
import { formatPercent, formatPeso } from '../view/money.js';
import { activeMonths, overviewNotices } from '../view/overview.js';
import { buttonClass } from './controls.js';

/**
 * Where the money is, who is owed what, and how the business is doing — the
 * answers to the operator's questions, on one screen (BOOKKEEPING-PLAN §5).
 */
export function OverviewSection({
  overview,
  canRecord,
  canManage,
  onBringInSales,
  onOpenSettings,
}: {
  overview: BooksOverviewView;
  canRecord: boolean;
  canManage: boolean;
  onBringInSales: () => void;
  onOpenSettings: () => void;
}) {
  const notices = overviewNotices(overview);
  const months = activeMonths(overview.months);
  const current = overview.investors.filter((investor) => investor.formerAt === null || investor.owed !== 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {notices.map((notice) => (
        <div
          key={notice.key}
          role={notice.tone === 'warning' ? 'alert' : 'status'}
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm',
            notice.tone === 'warning'
              ? 'bg-status-warning text-status-warning-foreground'
              : 'bg-status-info text-status-info-foreground',
          )}
        >
          <span>{notice.text}</span>
          {notice.action === 'pos' && canRecord ? (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={onBringInSales}>
              Bring in sales
            </button>
          ) : null}
          {notice.action === 'settings' && canManage ? (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={onOpenSettings}>
              Open settings
            </button>
          ) : null}
        </div>
      ))}

      <div className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-4">
        <section aria-labelledby="books-cash" className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <h2 id="books-cash" className="text-sm font-medium text-muted-foreground">
            Cash on hand
          </h2>
          <p
            className={cn(
              'text-2xl font-semibold tabular-nums tracking-tight',
              overview.money.total < 0 ? 'text-destructive' : null,
            )}
          >
            {formatPeso(overview.money.total)}
          </p>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            {moneyRows(overview.money).map(([place, amount]) => (
              <div key={place} className="flex flex-col">
                <dt className="text-muted-foreground">{PLACE_LABEL[place]}</dt>
                <dd className={cn('tabular-nums', amount < 0 ? 'text-destructive' : null)}>{formatPeso(amount)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="books-unshared" className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <h2 id="books-unshared" className="text-sm font-medium text-muted-foreground">
            Profit not yet shared
          </h2>
          <p
            className={cn(
              'text-2xl font-semibold tabular-nums tracking-tight',
              (overview.unshared?.profit ?? 0) < 0 ? 'text-destructive' : null,
            )}
          >
            {formatPeso(overview.unshared?.profit ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            {overview.unsharedFrom && overview.unsharedFrom <= overview.today
              ? `Since ${formatDay(overview.unsharedFrom)}: sales less cost of goods and expenses.`
              : 'Nothing recorded since the last share.'}
          </p>
        </section>

        <section aria-labelledby="books-owed" className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <h2 id="books-owed" className="text-sm font-medium text-muted-foreground">
            Owed to investors
          </h2>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{formatPeso(overview.owedToInvestors)}</p>
          <p className="text-xs text-muted-foreground">Profit shared with them and not yet paid out.</p>
        </section>

        <section aria-labelledby="books-lent" className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <h2 id="books-lent" className="text-sm font-medium text-muted-foreground">
            Lent out
          </h2>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{formatPeso(overview.lentOutstanding)}</p>
          <p className="text-xs text-muted-foreground">
            {overview.loans.filter((loan) => loan.outstanding > 0).length} borrower(s) still owe the business.
          </p>
        </section>
      </div>

      <section aria-labelledby="books-investors" className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <h2 id="books-investors" className="text-sm font-semibold">
          Investors
        </h2>
        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">No investors yet. Add them under Investors.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Investor</th>
                  <th className="py-1 text-right font-medium">Capital</th>
                  <th className="py-1 text-right font-medium">Share</th>
                  <th className="py-1 text-right font-medium">Profit shared</th>
                  <th className="py-1 text-right font-medium">Paid out</th>
                  <th className="py-1 text-right font-medium">Still owed</th>
                </tr>
              </thead>
              <tbody>
                {current.map((investor) => (
                  <tr key={investor.id} className="border-t border-border">
                    <td className="py-1">
                      {investor.name}
                      {investor.formerAt ? <span className="text-muted-foreground"> (former)</span> : null}
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatPeso(investor.capital)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {investor.share === null ? '—' : formatPercent(investor.share)}
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatPeso(investor.profitShared)}</td>
                    <td className="py-1 text-right tabular-nums">{formatPeso(investor.paidOut)}</td>
                    <td className={cn('py-1 text-right tabular-nums', investor.owed < 0 ? 'text-destructive' : null)}>
                      {formatPeso(investor.owed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="books-months" className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <h2 id="books-months" className="text-sm font-semibold">
          Profit by month
        </h2>
        {months.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded in the last twelve months.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Month</th>
                  <th className="py-1 text-right font-medium">Sales</th>
                  <th className="py-1 text-right font-medium">Cost of goods</th>
                  <th className="py-1 text-right font-medium">Expenses</th>
                  <th className="py-1 text-right font-medium">Profit</th>
                  <th className="py-1 text-right font-medium">Bought to keep</th>
                </tr>
              </thead>
              <tbody>
                {months.map((month) => (
                  <tr key={month.month} className="border-t border-border">
                    <td className="py-1">{formatMonth(month.month)}</td>
                    <td className="py-1 text-right tabular-nums">{formatPeso(month.sales - month.refunds)}</td>
                    <td className="py-1 text-right tabular-nums">{formatPeso(month.costOfGoods)}</td>
                    <td className="py-1 text-right tabular-nums">{formatPeso(month.expenses)}</td>
                    <td
                      className={cn(
                        'py-1 text-right font-medium tabular-nums',
                        month.profit < 0 ? 'text-destructive' : null,
                      )}
                    >
                      {formatPeso(month.profit)}
                    </td>
                    <td className="py-1 text-right tabular-nums text-muted-foreground">
                      {formatPeso(month.purchases)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Sales are after refunds. “Bought to keep” — equipment and stock — is not an expense, so it is not in profit.
        </p>
      </section>
    </div>
  );
}
