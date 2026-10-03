'use client';

import { cn } from '@kwtech/web-ui/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cashBook } from '../../domain/statements.js';
import type { BooksEntryView, BooksOverviewView } from '../books-client.js';
import { type BooksContext, useBooksData } from '../use-books.js';
import {
  entryMoneyChange,
  entryTitle,
  formatDay,
  formatMonth,
  placeLabel,
  shiftMonth,
  whoName,
} from '../view/labels.js';
import { canVoidEntry, entryNames, ledgerLines } from '../view/ledger.js';
import { formatPeso, formatSignedPeso } from '../view/money.js';
import { buttonClass } from './controls.js';
import { RecordEntryDialog, VoidDialog } from './dialogs.js';
import { Alert, Empty } from './layout.js';

/**
 * The cash book, a month at a time: every entry, voided ones struck through,
 * and cash on hand after each — starting from the month's opening balance, so
 * the last line is what the overview says.
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
  const thisMonth = overview.today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const load = useCallback(() => books.client.entries(books.scope, { month }), [books.client, books.scope, month]);
  const page = useBooksData(books.scope, load, 'Could not load the entries.');
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<BooksEntryView | null>(null);

  const lines = page.data ? cashBook(ledgerLines(page.data.entries), page.data.opening) : [];
  const names = entryNames(overview);
  const done = () => {
    void page.reload();
    onChanged();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            className={buttonClass('ghost', 'sm')}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <h2 className="min-w-36 text-center text-sm font-semibold">{formatMonth(month)}</h2>
          <button
            type="button"
            aria-label="Next month"
            className={buttonClass('ghost', 'sm')}
            disabled={month >= thisMonth}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
        {canRecord ? (
          <div className="flex flex-wrap gap-2">
            {overview.pos.available && overview.pos.connected ? (
              <button type="button" className={buttonClass('secondary', 'sm')} onClick={onBringInSales}>
                Bring in sales
              </button>
            ) : null}
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setRecording(true)}>
              Record money
            </button>
          </div>
        ) : null}
      </div>

      <Alert message={page.error} />
      {page.data?.truncated ? <Alert message="This month has more entries than one page shows." /> : null}

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
              <td className="px-3 py-1.5 text-right tabular-nums">{formatPeso(page.data?.opening ?? 0)}</td>
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
        {page.data && lines.length === 0 ? <Empty>Nothing was recorded in {formatMonth(month)}.</Empty> : null}
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
