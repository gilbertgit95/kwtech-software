'use client';

import { cn, DatePicker, MultiSelect } from '@kwtech/web-ui/react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  type LucideIcon,
  Plus,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useId, useMemo, useState } from 'react';
import { cashBook } from '../../domain/statements.js';
import type { BooksPlace } from '../../types.js';
import type { BooksEntryView, BooksOverviewView } from '../books-client.js';
import { type BooksContext, useBooksData } from '../use-books.js';
import {
  entryMoneyChange,
  entryTitle,
  formatDay,
  formatDays,
  KIND_LABEL,
  PLACE_LABEL,
  placeLabel,
  whoName,
} from '../view/labels.js';
import { canVoidEntry, entryNames, ledgerLines } from '../view/ledger.js';
import { formatPeso, formatSignedPeso } from '../view/money.js';
import {
  activeFilterCount,
  kindOfLabel,
  kindOptions,
  MONEY_PRESETS,
  type MoneyDirectionFilter,
  type MoneyFilter,
  type MoneyRange,
  matchesMoneyFilter,
  matchPreset,
  moneyTotals,
  NO_MONEY_FILTER,
  presetRange,
  rangeLength,
  stepRange,
  toggled,
} from '../view/money-tab.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { RecordEntryDialog, VoidDialog } from './dialogs.js';
import { Alert, Empty, Tabs } from './layout.js';

const DIRECTION_TABS: readonly { key: MoneyDirectionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'Money in' },
  { key: 'out', label: 'Money out' },
];

const PLACE_OF_LABEL = new Map(Object.entries(PLACE_LABEL).map(([place, label]) => [label, place as BooksPlace]));

/**
 * The cash book for any run of days: a quick period (this month, the last 30
 * days…) or two days picked from the calendar, stepped with ← →. Every entry,
 * voided ones struck through, and cash on hand after each — starting from what
 * was in hand the day before the range, so the last line is what the overview
 * says when the range ends today.
 *
 * Filters (words, kind, place, in or out, voided) narrow what is SHOWN, on the
 * page already read; cash on hand after each line is still the whole book's
 * (`view/money-tab.ts`). The calendar is `web-ui`'s, given the workspace's day
 * (`overview.today`) as today, so "This month" is the workspace's month.
 */
export function MoneySection({
  books,
  overview,
  canRecord,
  canManage,
  onBringInSales,
  onChanged,
}: {
  books: BooksContext;
  overview: BooksOverviewView;
  canRecord: boolean;
  canManage: boolean;
  onBringInSales: () => void;
  onChanged: () => void;
}) {
  const today = overview.today;
  const [range, setRange] = useState<MoneyRange>(() => presetRange('this_month', today));
  const [filter, setFilter] = useState<MoneyFilter>(NO_MONEY_FILTER);
  const load = useCallback(
    () => books.client.entries(books.scope, { fromDay: range.fromDay, toDay: range.toDay }),
    [books.client, books.scope, range.fromDay, range.toDay],
  );
  const page = useBooksData(books.scope, load, 'Could not load the entries.');
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<BooksEntryView | null>(null);
  const searchId = useId();

  const names = useMemo(() => entryNames(overview), [overview]);
  const all = useMemo(
    () => (page.data ? cashBook(ledgerLines(page.data.entries), page.data.opening) : []),
    [page.data],
  );
  const lines = useMemo(
    () => all.filter(({ entry }) => matchesMoneyFilter(entry.view, filter, names.of(entry.view))),
    [all, filter, names],
  );
  const totals = moneyTotals(lines.map(({ entry }) => entry));
  const opening = page.data?.opening ?? 0;
  const closing = all.at(-1)?.balance ?? opening;
  const filters = activeFilterCount(filter);
  const preset = matchPreset(range, today);
  const previous = stepRange(range, -1, today);
  const next = stepRange(range, 1, today);
  const kinds = kindOptions(page.data?.entries ?? [], filter.kinds);
  const done = () => {
    void page.reload();
    onChanged();
  };
  const patch = (change: Partial<MoneyFilter>) => setFilter((current) => ({ ...current, ...change }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* The period, and what can be recorded. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 @xl:w-auto">
          <fieldset className="m-0 flex w-fit min-w-0 max-w-full flex-wrap gap-0.5 rounded-lg border-0 bg-muted p-0.5">
            <legend className="sr-only">Period</legend>
            {MONEY_PRESETS.map((choice) => (
              <button
                key={choice.key}
                type="button"
                aria-pressed={choice.key === preset}
                className={cn(
                  'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  choice.key === preset
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setRange(presetRange(choice.key, today))}
              >
                {choice.label}
              </button>
            ))}
          </fieldset>
          {/* Full width in a narrow panel, the two days sharing it: two fixed-width days pushed the whole tab sideways on a phone. */}
          <div className="flex w-full min-w-0 items-center gap-1 @xl:w-auto">
            <button
              type="button"
              aria-label="Previous period"
              className={cn(buttonClass('ghost', 'sm'), 'size-9 px-0')}
              disabled={previous === null}
              onClick={() => previous && setRange(previous)}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <div className="min-w-0 flex-1 @xl:w-40 @xl:flex-none">
              <DatePicker
                aria-label="First day"
                value={range.fromDay}
                today={today}
                max={range.toDay}
                clearable={false}
                className="w-full"
                onChange={(day) => day && setRange((current) => ({ ...current, fromDay: day }))}
              />
            </div>
            <span aria-hidden="true" className="px-0.5 text-muted-foreground">
              –
            </span>
            <div className="min-w-0 flex-1 @xl:w-40 @xl:flex-none">
              <DatePicker
                aria-label="Last day"
                value={range.toDay}
                today={today}
                min={range.fromDay}
                max={today}
                clearable={false}
                className="w-full"
                onChange={(day) => day && setRange((current) => ({ ...current, toDay: day }))}
              />
            </div>
            <button
              type="button"
              aria-label="Next period"
              className={cn(buttonClass('ghost', 'sm'), 'size-9 px-0')}
              disabled={next === null}
              onClick={() => next && setRange(next)}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
        {canRecord ? (
          <div className="flex flex-wrap gap-2">
            {overview.pos.available && overview.pos.connected ? (
              <button type="button" className={buttonClass('secondary')} onClick={onBringInSales}>
                Bring in sales
              </button>
            ) : null}
            <button type="button" className={buttonClass('primary')} onClick={() => setRecording(true)}>
              <Plus aria-hidden="true" className="size-4" />
              Record money
            </button>
          </div>
        ) : null}
      </div>

      {/* What the period did. Money in and out follow the filters; the two balances are the whole book's. */}
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        <Tile icon={Wallet} label={`Brought forward to ${formatDay(range.fromDay)}`} value={formatPeso(opening)} />
        <Tile
          icon={ArrowDownLeft}
          tone="in"
          label={filters > 0 ? 'Money in (shown)' : 'Money in'}
          value={formatPeso(totals.moneyIn)}
        />
        <Tile
          icon={ArrowUpRight}
          tone="out"
          label={filters > 0 ? 'Money out (shown)' : 'Money out'}
          value={formatPeso(-totals.moneyOut)}
        />
        <Tile
          icon={Wallet}
          tone={closing < 0 ? 'out' : 'neutral'}
          label={`Cash on hand after ${formatDay(range.toDay)}`}
          value={formatPeso(closing)}
        >
          Net {formatSignedPeso(closing - opening)} over {rangeLength(range)}{' '}
          {rangeLength(range) === 1 ? 'day' : 'days'}
        </Tile>
      </div>

      {/* The filters: they hide lines, never change a balance. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        <label htmlFor={searchId} className="relative min-w-0 basis-full @lg:min-w-48 @lg:flex-1 @lg:basis-auto">
          <span className="sr-only">Search entries</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id={searchId}
            type="search"
            value={filter.search}
            placeholder="Search what, note, reference or who…"
            className={cn(INPUT_CLASS, 'pl-8')}
            onChange={(event) => patch({ search: event.target.value })}
          />
        </label>
        <MultiSelect
          label="Kind"
          options={kinds.map((kind) => KIND_LABEL[kind])}
          selected={filter.kinds.map((kind) => KIND_LABEL[kind])}
          onToggle={(label) => {
            const kind = kindOfLabel(label);
            if (kind) patch({ kinds: toggled(filter.kinds, kind) });
          }}
          onClear={() => patch({ kinds: [] })}
          className="h-8"
        />
        <MultiSelect
          label="Place"
          options={Object.values(PLACE_LABEL)}
          selected={filter.places.map((place) => PLACE_LABEL[place])}
          hint="A transfer matches either end."
          onToggle={(label) => {
            const place = PLACE_OF_LABEL.get(label);
            if (place) patch({ places: toggled(filter.places, place) });
          }}
          onClear={() => patch({ places: [] })}
          className="h-8"
        />
        <Tabs
          label="Direction"
          tabs={DIRECTION_TABS}
          current={filter.direction}
          onChange={(direction) => patch({ direction })}
        />
        <button
          type="button"
          aria-pressed={filter.showVoided}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            filter.showVoided
              ? 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              : 'border-primary bg-primary text-primary-foreground',
          )}
          onClick={() => patch({ showVoided: !filter.showVoided })}
        >
          {filter.showVoided ? (
            <Eye aria-hidden="true" className="size-3.5" />
          ) : (
            <EyeOff aria-hidden="true" className="size-3.5" />
          )}
          {filter.showVoided ? 'Voided shown' : 'Voided hidden'}
        </button>
        {filters > 0 ? (
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setFilter(NO_MONEY_FILTER)}>
            <X aria-hidden="true" className="size-3.5" />
            Clear filters ({filters})
          </button>
        ) : null}
      </div>

      <Alert message={page.error} />
      {page.data?.truncated ? (
        <Alert message="This period has more entries than one page shows. Choose fewer days." />
      ) : null}

      <p role="status" className="-mb-1 px-1 text-xs text-muted-foreground">
        {page.data ? `${countLine(lines.length, all.length)} · ${formatDays(range.fromDay, range.toDay)}` : 'Loading…'}
      </p>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">What</th>
              <th className="px-3 py-2 font-medium">Where</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Cash on hand</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border text-muted-foreground">
              <td className="px-3 py-1.5" colSpan={4}>
                Brought forward
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatPeso(opening)}</td>
              <td />
            </tr>
            {lines.map(({ entry, balance }) => {
              const view = entry.view;
              const change = entryMoneyChange(view);
              return (
                <tr
                  key={view.id}
                  className={cn('border-t border-border align-top', view.voidedAt ? 'opacity-60' : null)}
                >
                  <td className="whitespace-nowrap px-3 py-1.5">{formatDay(view.day)}</td>
                  <td className="px-3 py-1.5">
                    <div className={cn(view.voidedAt ? 'line-through' : null)}>{entryTitle(view, names.of(view))}</div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        view.description,
                        view.reference ? `Ref. ${view.reference}` : null,
                        `by ${whoName(view.recordedByName)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {view.voidedAt ? (
                      <div className="text-xs text-destructive">
                        Voided by {whoName(view.voidedByName)}: {view.voidReason}
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">{placeLabel(view.place)}</td>
                  <td
                    className={cn(
                      'whitespace-nowrap px-3 py-1.5 text-right tabular-nums',
                      change < 0 ? 'text-destructive' : null,
                      view.voidedAt ? 'line-through' : null,
                    )}
                  >
                    {change === 0 ? formatPeso(view.amount) : formatSignedPeso(change)}
                  </td>
                  <td
                    className={cn(
                      'whitespace-nowrap px-3 py-1.5 text-right tabular-nums',
                      balance < 0 ? 'text-destructive' : null,
                    )}
                  >
                    {formatPeso(balance)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {canVoidEntry(view, { canRecord, canManage }) ? (
                      <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setVoiding(view)}>
                        Void
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {page.data && all.length === 0 ? (
          <Empty>Nothing was recorded from {formatDays(range.fromDay, range.toDay)}.</Empty>
        ) : null}
        {page.data && all.length > 0 && lines.length === 0 ? (
          <Empty>
            No entry in this period matches the filters.{' '}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => setFilter(NO_MONEY_FILTER)}
            >
              Clear filters
            </button>
          </Empty>
        ) : null}
      </div>

      <RecordEntryDialog
        open={recording}
        kind="expense"
        books={books}
        overview={overview}
        onClose={() => setRecording(false)}
        onDone={done}
      />
      <VoidDialog
        open={voiding !== null}
        title="Void this entry"
        description={
          voiding?.importId
            ? 'This voids the whole batch of point-of-sale sales it came in with, so those days can be brought in again.'
            : 'It stays in the books, struck through, with your reason — and counts for nothing. Record it again if it was wrong.'
        }
        onClose={() => setVoiding(null)}
        onVoid={async (reason) => {
          if (!voiding) return null;
          try {
            await books.client.voidEntry(books.scope, voiding.id, reason);
            done();
            return null;
          } catch (caught) {
            return caught instanceof Error ? caught.message : 'Could not void it.';
          }
        }}
      />
    </div>
  );
}

/** "12 entries", or "3 of 12 entries" while filters hide some. */
function countLine(shown: number, total: number): string {
  if (shown !== total) return `${shown} of ${total} entries`;
  return `${total} ${total === 1 ? 'entry' : 'entries'}`;
}

/** One figure of the period, with an icon chip in the status colours (never a raw green or red). */
function Tile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: 'neutral' | 'in' | 'out';
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-card p-3">
      <span
        aria-hidden="true"
        className={cn(
          // Hidden in a narrow panel: two tiles a row leave no room for the chip AND a peso amount.
          'hidden size-9 shrink-0 @lg:grid place-items-center rounded-full',
          tone === 'in' && 'bg-status-success text-status-success-foreground',
          tone === 'out' && 'bg-status-error text-status-error-foreground',
          tone === 'neutral' && 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold tabular-nums tracking-tight">{value}</span>
        {children ? <span className="text-xs text-muted-foreground">{children}</span> : null}
      </div>
    </div>
  );
}
