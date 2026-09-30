'use client';

import { zonedDayKey } from '@kwtech/module-kit';
import { cn } from '@kwtech/web-ui/react';
import { Download, Printer } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import type { PosBreakdownRowView, PosOwedView, PosReportView } from '../pos-client.js';
import { usePosData } from '../use-pos-data.js';
import type { TillState } from '../use-till.js';
import { formatPercent, formatPeso } from '../view/money.js';
import { METHOD_LABELS } from '../view/receipt.js';
import {
  ageText,
  bucketDays,
  chartPoints,
  comparisonText,
  csvFileName,
  deltaText,
  hourText,
  kpis,
  margin,
  periodText,
  prepareCustomDays,
  presetDays,
  REPORT_PRESETS,
  type ReportDays,
  type ReportPreset,
  type ReportTable,
  reportCsvRows,
  staffLabel,
  summaryHtml,
  summaryLines,
  toCsv,
} from '../view/reports.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { Alert, Empty, Tabs } from './layout.js';
import { printHtml } from './till.js';

const REPORT_TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'summary', label: 'Daily summary' },
  { key: 'item', label: 'By item' },
  { key: 'category', label: 'By category' },
  { key: 'staff', label: 'By staff' },
  { key: 'hour', label: 'By hour' },
  { key: 'outstanding', label: 'Outstanding' },
] as const;

type ReportTab = (typeof REPORT_TABS)[number]['key'];

/**
 * Reports (D22), behind `pos:reports`: one period picker drives a dashboard
 * and six tables, each with CSV export. Every figure is the server's
 * (`src/domain/reports.ts`); this only picks the days and draws them.
 *
 * - The days are the WORKSPACE's (`state.timeZone`), so "Today" is the
 *   store's today wherever the admin is reading from.
 * - A period that includes today re-reads on every order event, so the
 *   dashboard moves as the tills sell. A past period cannot change that way,
 *   and a report reads up to 20,000 orders — so it does not listen.
 */
export function ReportsSection({ state, onOpenOrder }: { state: TillState; onOpenOrder: (orderId: string) => void }) {
  const { client, scope, timeZone } = state;
  const today = zonedDayKey(new Date(), timeZone);
  const [preset, setPreset] = useState<ReportPreset>('today');
  const [custom, setCustom] = useState<ReportDays>({ fromDay: today, toDay: today });
  const [tab, setTab] = useState<ReportTab>('dashboard');

  const prepared = preset === 'custom' ? prepareCustomDays(custom.fromDay, custom.toDay) : presetDays(preset, today);
  const days = 'problem' in prepared ? null : prepared;
  const fromDay = days?.fromDay ?? null;
  const toDay = days?.toDay ?? null;

  const load = useCallback(async (): Promise<PosReportView | null> => {
    if (!fromDay || !toDay) return null;
    return client.report(scope, fromDay, toDay);
  }, [client, scope, fromDay, toDay]);
  const live = toDay !== null && toDay >= today;
  const report = usePosData(scope, load, live ? ['order'] : [], 'Could not load the report.');
  // A report for another period may still be on screen while the new one loads: never show it as this one.
  const shown = report.data && report.data.fromDay === fromDay && report.data.toDay === toDay ? report.data : null;

  /** A chart column, a day, opens that day's summary (D23: "a report's day → that day's summary"). */
  const openDays = (next: ReportDays, nextTab: ReportTab) => {
    setPreset('custom');
    setCustom(next);
    setTab(nextTab);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Period
          <select
            className={cn(INPUT_CLASS, 'h-8 w-auto')}
            value={preset}
            // The options are REPORT_PRESETS, so the value is one of them.
            onChange={(event) => {
              const next = event.target.value as ReportPreset;
              // Custom starts from what was showing, so switching to it changes nothing yet.
              if (next === 'custom' && days) setCustom(days);
              setPreset(next);
            }}
          >
            {REPORT_PRESETS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        {preset === 'custom' ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input
                type="date"
                className={cn(INPUT_CLASS, 'h-8 w-auto')}
                value={custom.fromDay}
                max={today}
                onChange={(event) => setCustom({ ...custom, fromDay: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input
                type="date"
                className={cn(INPUT_CLASS, 'h-8 w-auto')}
                value={custom.toDay}
                max={today}
                onChange={(event) => setCustom({ ...custom, toDay: event.target.value })}
              />
            </label>
          </>
        ) : null}
        <p className="pb-1.5 text-sm text-muted-foreground">
          {days ? periodText(days.fromDay, days.toDay) : null}
          {shown ? ` · ${comparisonText(shown)}` : null}
        </p>
      </div>

      <Tabs tabs={REPORT_TABS} current={tab} onChange={setTab} label="Report" />
      {'problem' in prepared ? <Alert message={prepared.problem} /> : null}
      <Alert message={report.error} />
      {shown?.truncated ? (
        <Alert message="This period has more orders than one report reads, so these figures are too low. Choose a shorter period." />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown ? (
          <ReportBody
            tab={tab}
            report={shown}
            timeZone={timeZone}
            onOpenDays={openDays}
            onOpenOrder={onOpenOrder}
            onTab={setTab}
          />
        ) : (
          <Empty>{report.loading ? 'Loading…' : 'Choose a period.'}</Empty>
        )}
      </div>
    </div>
  );
}

/** The open tab's content, for a report that is this period's. */
function ReportBody({
  tab,
  report,
  timeZone,
  onOpenDays,
  onOpenOrder,
  onTab,
}: {
  tab: ReportTab;
  report: PosReportView;
  timeZone: string;
  onOpenDays: (days: ReportDays, tab: ReportTab) => void;
  onOpenOrder: (orderId: string) => void;
  onTab: (tab: ReportTab) => void;
}) {
  switch (tab) {
    case 'dashboard':
      return (
        <Dashboard
          report={report}
          // One day opens its summary; a month opens the dashboard for that month.
          onOpenDays={(days) => onOpenDays(days, days.fromDay === days.toDay ? 'summary' : 'dashboard')}
          onOutstanding={() => onTab('outstanding')}
        />
      );
    case 'summary':
      return <SummaryReport report={report} timeZone={timeZone} />;
    case 'outstanding':
      return <OutstandingReport report={report} onOpenOrder={onOpenOrder} />;
    case 'hour':
      return <HourReport report={report} />;
    case 'item':
    case 'category':
    case 'staff':
      return <BreakdownReport report={report} table={tab} />;
  }
}

// ── the dashboard ───────────────────────────────────────────────────────────

function Dashboard({
  report,
  onOpenDays,
  onOutstanding,
}: {
  report: PosReportView;
  onOpenDays: (days: ReportDays) => void;
  onOutstanding: () => void;
}) {
  const [measure, setMeasure] = useState<'sales' | 'orders'>('sales');
  const [topBy, setTopBy] = useState<'net' | 'quantity'>('net');
  const points = chartPoints(report);
  const unpaid = report.unpaid.reduce((sum, row) => sum + row.amount, 0);
  const owed = report.changeOwed.reduce((sum, row) => sum + row.amount, 0);
  const top = [...report.byItem]
    .sort((a, b) => (topBy === 'net' ? b.net - a.net : b.quantity - a.quantity))
    .slice(0, 10);
  const methods = (['cash', 'ewallet', 'card'] as const).map((method) => ({
    key: method,
    label: METHOD_LABELS[method] ?? method,
    value: report.summary[method],
    text: formatPeso(report.summary[method]),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        {kpis(report).map((card) => (
          <div key={card.key} className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
            <span className="text-xs text-muted-foreground">{card.label}</span>
            <span className="text-xl font-semibold">{card.value}</span>
            <span className="text-xs text-muted-foreground">
              {/* Text in text tokens, never green/red alone: the arrow says which way. */}
              {deltaText(card.delta)} {comparisonText(report)}
            </span>
          </div>
        ))}
      </div>

      {report.unpaid.length > 0 || report.changeOwed.length > 0 ? (
        <button
          type="button"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-status-warning px-3 py-2 text-left text-sm text-status-warning-foreground"
          onClick={onOutstanding}
        >
          {report.unpaid.length > 0 ? (
            <span>
              {report.unpaid.length} unpaid · {formatPeso(unpaid)} owed to the store
            </span>
          ) : null}
          {report.changeOwed.length > 0 ? (
            <span>
              {report.changeOwed.length} with change owed · {formatPeso(owed)} to give back
            </span>
          ) : null}
          <span className="underline">See outstanding</span>
        </button>
      ) : null}

      <Panel
        title={measure === 'sales' ? 'Sales over time' : 'Orders over time'}
        controls={
          <Toggle
            options={[
              { key: 'sales', label: '₱' },
              { key: 'orders', label: 'Orders' },
            ]}
            current={measure}
            onChange={setMeasure}
            label="Measure"
          />
        }
      >
        <Columns
          label={measure === 'sales' ? 'Sales per period' : 'Orders per period'}
          points={points.map((point) => {
            const value = measure === 'sales' ? point.sales : point.orders;
            const previous = measure === 'sales' ? point.previousSales : point.previousOrders;
            const text = (amount: number) => (measure === 'sales' ? formatPeso(amount) : `${amount} orders`);
            return {
              key: point.key,
              label: point.label,
              value,
              previous,
              text: previous === null ? text(value) : `${text(value)} · before ${text(previous)}`,
            };
          })}
          format={(amount) => (measure === 'sales' ? formatPeso(amount) : String(amount))}
          onPick={(key) => onOpenDays(bucketDays(key, report))}
          legend
        />
      </Panel>

      <div className="grid gap-4 @3xl:grid-cols-2">
        <Panel title="Sales by hour">
          <Columns
            label="Sales by hour of the day"
            points={report.byHour.map((row) => ({
              key: String(row.hour),
              label: hourText(row.hour),
              value: row.sales,
              previous: null,
              text: `${formatPeso(row.sales)} · ${row.orders} orders`,
            }))}
            format={formatPeso}
          />
        </Panel>
        <Panel title="Payment methods">
          <Bars rows={methods} empty="No payments in this period." />
        </Panel>
      </div>

      <Panel
        title="Top 10 items"
        controls={
          <Toggle
            options={[
              { key: 'net', label: '₱' },
              { key: 'quantity', label: 'Quantity' },
            ]}
            current={topBy}
            onChange={setTopBy}
            label="Rank by"
          />
        }
      >
        <Bars
          rows={top.map((row) => ({
            key: row.key,
            label: row.label,
            value: topBy === 'net' ? row.net : row.quantity,
            text: topBy === 'net' ? formatPeso(row.net) : String(row.quantity),
          }))}
          empty="Nothing sold in this period."
        />
      </Panel>
    </div>
  );
}

function Panel({ title, controls, children }: { title: string; controls?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {controls}
      </div>
      {children}
    </section>
  );
}

function Toggle<K extends string>({
  options,
  current,
  onChange,
  label,
}: {
  options: readonly { key: K; label: string }[];
  current: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <fieldset className="m-0 flex gap-1 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.key === current}
          className={buttonClass(option.key === current ? 'secondary' : 'ghost', 'sm')}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

interface ColumnPoint {
  key: string;
  label: string;
  value: number;
  /** The comparison period's value at this position, drawn as the faint line; null past its end. */
  previous: number | null;
  /** Everything the tooltip says — also the column's accessible name, so hover never gates a value. */
  text: string;
}

/**
 * A column chart in plain HTML and one SVG line (the dataviz marks): columns
 * at most 24px wide with a rounded top and a square base, a 2px gap between
 * them, one hue (the theme's primary — a single series needs no legend), and
 * the previous period as a 2px muted line with its own legend entry.
 *
 * Each column is a button when it opens something, with the value in its
 * name; the tables carry the same numbers for anyone who cannot see bars.
 */
function Columns({
  points,
  label,
  format,
  onPick,
  legend = false,
}: {
  points: readonly ColumnPoint[];
  label: string;
  format: (value: number) => string;
  onPick?: (key: string) => void;
  legend?: boolean;
}) {
  const max = Math.max(1, ...points.map((point) => Math.max(point.value, point.previous ?? 0)));
  const hasPrevious = points.some((point) => point.previous !== null && point.previous > 0);
  const first = points[0];
  const last = points[points.length - 1];
  const line = points
    .map((point, index) => (point.previous === null ? null : `${index + 0.5},${100 - (point.previous / max) * 100}`))
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return (
    <figure className="m-0 flex flex-col gap-1" aria-label={label}>
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{format(max === 1 && points.every((point) => point.value === 0) ? 0 : max)}</span>
        {legend && hasPrevious ? (
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="inline-block size-2 rounded-sm bg-primary" />
              This period
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="inline-block h-0.5 w-3 bg-muted-foreground" />
              Previous period
            </span>
          </span>
        ) : null}
      </div>
      <div className="relative h-36 border-b border-border">
        <div className="absolute inset-0 flex items-end gap-0.5">
          {points.map((point) => {
            return onPick ? (
              <button
                key={point.key}
                type="button"
                aria-label={`${point.label}: ${point.text}. Open`}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onPick(point.key)}
              >
                <ColumnMark point={point} max={max} />
              </button>
            ) : (
              <span
                key={point.key}
                role="img"
                aria-label={`${point.label}: ${point.text}`}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <ColumnMark point={point} max={max} />
              </span>
            );
          })}
        </div>
        {hasPrevious ? (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full text-muted-foreground"
            viewBox={`0 0 ${points.length} 100`}
            preserveAspectRatio="none"
          >
            <polyline
              points={line}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.6}
            />
          </svg>
        ) : null}
      </div>
      {first && last ? (
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{first.label}</span>
          {last !== first ? <span>{last.label}</span> : null}
        </div>
      ) : null}
    </figure>
  );
}

/** One column's bar, and its tooltip shown on hover and on keyboard focus of the column around it. */
function ColumnMark({ point, max }: { point: ColumnPoint; max: number }) {
  return (
    <>
      <span
        className="block w-full max-w-6 rounded-t bg-primary transition-opacity group-hover:opacity-80"
        style={{ height: `${(Math.max(0, point.value) / max) * 100}%` }}
      />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow group-hover:block group-focus-visible:block">
        {point.label} · {point.text}
      </span>
    </>
  );
}

/** Horizontal bars (never a pie, D22): label, a bar from one baseline, and the value at its tip in text ink. */
function Bars({
  rows,
  empty,
}: {
  rows: readonly { key: string; label: string; value: number; text: string }[];
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.every((row) => row.value === 0)) return <Empty>{empty}</Empty>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2 text-sm">
          <span className="truncate" title={row.label}>
            {row.label}
          </span>
          <span className="h-3 rounded-r bg-muted">
            <span
              className="block h-full rounded-r bg-primary"
              style={{ width: `${(Math.max(0, row.value) / max) * 100}%` }}
            />
          </span>
          <span className="text-right text-xs tabular-nums">{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ── the tables ──────────────────────────────────────────────────────────────

/** The page's copy of a table as a file, built by the same pure rows the tests pin. */
function CsvButton({ table, report }: { table: ReportTable; report: PosReportView }) {
  return (
    <button
      type="button"
      className={buttonClass('secondary', 'sm')}
      onClick={() => download(csvFileName(table, report), toCsv(reportCsvRows(table, report, new Date())))}
    >
      <Download aria-hidden="true" className="size-4" />
      CSV
    </button>
  );
}

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // After the click has started the download: revoking first would cancel it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const TH = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground';
const TD = 'px-2 py-1.5';
const NUM = 'text-right tabular-nums';

function SummaryReport({ report, timeZone }: { report: PosReportView; timeZone: string }) {
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
          onClick={() => printHtml(summaryHtml(report, new Date(), timeZone))}
        >
          <Printer aria-hidden="true" className="size-4" />
          Print
        </button>
        <CsvButton table="summary" report={report} />
      </div>
      <table className="w-full text-sm">
        <tbody>
          {summaryLines(report.summary).map((line) => (
            <tr key={line.label} className={cn('border-b border-border', line.strong && 'font-semibold')}>
              <td className={cn(TD, line.indent && 'pl-6 text-muted-foreground')}>{line.label}</td>
              <td className={cn(TD, NUM)}>{line.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownReport({ report, table }: { report: PosReportView; table: 'item' | 'category' | 'staff' }) {
  const { rows, title } = breakdownOf(report, table);
  const totals = rows.reduce((sum, row) => ({ quantity: sum.quantity + row.quantity, net: sum.net + row.net }), {
    quantity: 0,
    net: 0,
  });
  return (
    <div className="flex flex-col gap-2">
      <div>
        <CsvButton table={table} report={report} />
      </div>
      {rows.length === 0 ? (
        <Empty>Nothing sold in this period.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>{title}</th>
                <th className={cn(TH, 'text-right')}>Qty</th>
                <th className={cn(TH, 'text-right')}>Net sales</th>
                <th className={cn(TH, 'text-right')}>Cost</th>
                <th className={cn(TH, 'text-right')}>Profit</th>
                <th className={cn(TH, 'text-right')}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowMargin = margin(row);
                return (
                  <tr key={row.key} className="border-b border-border">
                    <td className={TD}>{row.label}</td>
                    <td className={cn(TD, NUM)}>{row.quantity}</td>
                    <td className={cn(TD, NUM)}>{formatPeso(row.net)}</td>
                    {/* A dash, not ₱0: a line without a cost is unknown, not free. */}
                    <td className={cn(TD, NUM)}>{row.cost === null ? '—' : formatPeso(row.cost)}</td>
                    <td className={cn(TD, NUM)}>{row.profit === null ? '—' : formatPeso(row.profit)}</td>
                    <td className={cn(TD, NUM)}>{rowMargin === null ? '—' : formatPercent(rowMargin)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className={TD}>Total</td>
                <td className={cn(TD, NUM)}>{totals.quantity}</td>
                <td className={cn(TD, NUM)}>{formatPeso(totals.net)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Net sales are what customers paid for the lines, after discounts and before refunds. A dash means a cost was not
        entered for some of it.
      </p>
    </div>
  );
}

/** A breakdown table's rows, each labelled as a person reads it (no blank category or staff name). */
function breakdownOf(
  report: PosReportView,
  table: 'item' | 'category' | 'staff',
): { rows: PosBreakdownRowView[]; title: string } {
  switch (table) {
    case 'item':
      return { rows: report.byItem, title: 'Item' };
    case 'category':
      // Already labelled: the server names a line with no category POS_UNCATEGORISED.
      return { rows: report.byCategory, title: 'Category' };
    case 'staff':
      return {
        rows: report.byStaff.map((row) => ({ ...row, label: staffLabel(row) })),
        title: 'Staff (who took payment)',
      };
  }
}

function HourReport({ report }: { report: PosReportView }) {
  const rows = report.byHour.filter((row) => row.orders > 0);
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <div>
        <CsvButton table="hour" report={report} />
      </div>
      {rows.length === 0 ? (
        <Empty>Nothing sold in this period.</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Hour</th>
              <th className={cn(TH, 'text-right')}>Orders</th>
              <th className={cn(TH, 'text-right')}>Sales</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.hour} className="border-b border-border">
                <td className={TD}>{hourText(row.hour)}</td>
                <td className={cn(TD, NUM)}>{row.orders}</td>
                <td className={cn(TD, NUM)}>{formatPeso(row.sales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OutstandingReport({ report, onOpenOrder }: { report: PosReportView; onOpenOrder: (orderId: string) => void }) {
  const now = new Date();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <CsvButton table="outstanding" report={report} />
      </div>
      <OwedTable
        title="Unpaid — the customer owes the store"
        rows={report.unpaid}
        now={now}
        onOpenOrder={onOpenOrder}
      />
      <OwedTable
        title="Change owed — the store owes the customer"
        rows={report.changeOwed}
        now={now}
        onOpenOrder={onOpenOrder}
      />
    </div>
  );
}

function OwedTable({
  title,
  rows,
  now,
  onOpenOrder,
}: {
  title: string;
  rows: readonly PosOwedView[];
  now: Date;
  onOpenOrder: (orderId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <Empty>Nothing outstanding.</Empty>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.orderId}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpenOrder(row.orderId)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {row.number === null ? 'Order' : `#${row.number}`}
                    {row.customerName ? ` · ${row.customerName}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">for {ageText(row.since, now)}</span>
                </span>
                <span className="tabular-nums">{formatPeso(row.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
