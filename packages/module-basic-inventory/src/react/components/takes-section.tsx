'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { ConfirmDialog, LIST_KEYS, ListDrawer, listNeighbours } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useState } from 'react';
import { formatStockQuantity } from '../../domain/quantities.js';
import type { StockOverviewView, StockTakeView } from '../../views.js';
import { type StockContext, useStockAction, useStockData } from '../use-stock.js';
import { parseCount } from '../view/forms.js';
import { quantityText, signedQuantityText, whenText } from '../view/labels.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { StartTakeDialog } from './dialogs.js';
import { Alert, Empty, RowButton, StatusChip } from './layout.js';

const STATUS: Readonly<Record<StockTakeView['status'], { label: string; tone: 'info' | 'success' | 'neutral' }>> = {
  open: { label: 'Counting', tone: 'info' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  abandoned: { label: 'Abandoned', tone: 'neutral' },
};

/**
 * Stock takes (INVENTORY-PLAN §2): count the shelf, see each difference,
 * confirm. One open at a time. Counts are saved as they are typed, so a long
 * count survives a closed tab; confirming writes one movement per line that
 * differs from on hand AT THAT MOMENT, so a sale while counting is not lost.
 */
export function TakesSection({
  stock,
  overview,
  onChanged,
}: {
  stock: StockContext;
  overview: StockOverviewView;
  onChanged: () => void;
}) {
  const timeZone = useWorkspaceTimeZone();
  const load = useCallback(() => stock.client.takes(stock.scope), [stock.client, stock.scope]);
  const takes = useStockData(stock.scope, load, 'Could not load the stock takes.');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const rows = takes.data ?? [];
  const open = rows.find((take) => take.status === 'open') ?? null;
  const around = listNeighbours(
    rows.map((take) => take.id),
    selectedId,
  );

  const list = (
    <>
      <div className="flex flex-wrap gap-2">
        {open ? (
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setSelectedId(open.id)}>
            Continue counting
          </button>
        ) : (
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setStarting(true)}>
            Start a stock take
          </button>
        )}
      </div>
      <Alert message={takes.error} />
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto" {...LIST_KEYS}>
        {takes.data && rows.length === 0 ? <Empty>No stock take yet.</Empty> : null}
        {rows.map((take) => {
          const status = STATUS[take.status];
          return (
            <RowButton key={take.id} selected={take.id === selectedId} onClick={() => setSelectedId(take.id)}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{whenText(take.createdAt, timeZone)}</span>
                <span className="text-xs text-muted-foreground">
                  {take.createdByName ?? 'A team member'}
                  {take.note ? ` · ${take.note}` : ''}
                </span>
              </span>
              <StatusChip label={status.label} tone={status.tone} />
            </RowButton>
          );
        })}
      </div>
    </>
  );

  return (
    <>
      <ListDrawer
        list={list}
        detail={
          selectedId ? (
            <TakeSheet
              key={selectedId}
              stock={stock}
              overview={overview}
              takeId={selectedId}
              onChanged={() => {
                void takes.reload();
                onChanged();
              }}
            />
          ) : null
        }
        onClose={() => setSelectedId(null)}
        label="stock take"
        step={{
          onPrevious: around.previous ? () => setSelectedId(around.previous) : null,
          onNext: around.next ? () => setSelectedId(around.next) : null,
          position: around.position,
        }}
      />
      <StartTakeDialog
        open={starting}
        stock={stock}
        overview={overview}
        onClose={() => setStarting(false)}
        onDone={(takeId) => {
          setSelectedId(takeId);
          void takes.reload();
        }}
      />
    </>
  );
}

/** One count sheet: type what is on the shelf; each difference shows as it is typed. */
function TakeSheet({
  stock,
  overview,
  takeId,
  onChanged,
}: {
  stock: StockContext;
  overview: StockOverviewView;
  takeId: string;
  onChanged: () => void;
}) {
  const load = useCallback(() => stock.client.take(stock.scope, takeId), [stock.client, stock.scope, takeId]);
  const take = useStockData(stock.scope, load, 'Could not load the count sheet.');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<'confirm' | 'abandon' | null>(null);
  const action = useStockAction();
  const view = take.data;

  // The sheet as saved, into the boxes — once, when it first arrives, so a reload never wipes what is being typed.
  const loaded = view !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: filled once per sheet, when it first arrives.
  useEffect(() => {
    if (!view) return;
    setTyped(
      Object.fromEntries(
        view.lines.map((line) => [line.stockItemId, line.counted === null ? '' : formatStockQuantity(line.counted)]),
      ),
    );
  }, [loaded]);

  if (!view) return <Alert message={take.error} />;
  const editable = view.status === 'open';
  const itemOf = (id: string) => overview.items.find((item) => item.id === id) ?? null;
  const counted = view.lines.filter((line) => (typed[line.stockItemId] ?? '').trim() !== '').length;

  /** Saves one line when its box is left: a long count survives a closed tab. */
  const saveLine = async (stockItemId: string) => {
    const item = itemOf(stockItemId);
    if (!item) return;
    const parsed = parseCount(typed[stockItemId] ?? '', item.unit);
    if ('error' in parsed) {
      setProblems({ ...problems, [stockItemId]: parsed.error });
      return;
    }
    const { [stockItemId]: _cleared, ...rest } = problems;
    setProblems(rest);
    const line = view.lines.find((one) => one.stockItemId === stockItemId);
    if (line && line.counted === parsed.counted) return;
    const saved = await action.run(
      () => stock.client.saveTakeCounts(stock.scope, takeId, [{ stockItemId, counted: parsed.counted }]),
      'Could not save that count.',
    );
    if (saved) void take.reload();
  };

  const close = async (how: 'confirm' | 'abandon') => {
    const done =
      how === 'confirm'
        ? await action.run(() => stock.client.confirmTake(stock.scope, takeId), 'Could not confirm the stock take.')
        : await action.run(() => stock.client.abandonTake(stock.scope, takeId), 'Could not abandon it.');
    setConfirming(null);
    if (!done) return;
    void take.reload();
    onChanged();
  };

  return (
    <div className="flex flex-col gap-3">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Stock take</h2>
        <p className="text-sm text-muted-foreground">
          {STATUS[view.status].label}
          {view.note ? ` · ${view.note}` : ''}
          {editable ? ` · ${counted} of ${view.lines.length} counted` : ''}
        </p>
      </header>
      {editable ? (
        <p className="text-sm text-muted-foreground">
          Type what is on the shelf; leave a line empty to leave it alone. Counts are saved as you go. “On hand” moves
          if something sells while you count — confirming compares with it then.
        </p>
      ) : null}
      <Alert message={action.error ?? take.error} onDismiss={action.dismissError} />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 font-medium">Item</th>
            <th className="py-1 text-right font-medium">On hand</th>
            <th className="py-1 text-right font-medium">Counted</th>
            <th className="py-1 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((line) => {
            const item = itemOf(line.stockItemId);
            const unit = item?.unit ?? 'piece';
            const typedCount = parseCount(typed[line.stockItemId] ?? '', unit);
            const count = 'counted' in typedCount ? typedCount.counted : null;
            const typedDifference = count === null ? null : count - line.onHand;
            const difference = editable ? typedDifference : line.difference;
            return (
              <tr key={line.stockItemId} className="border-t border-border align-top">
                <td className="py-1.5 pr-2">
                  {item?.name ?? 'An archived item'}
                  {problems[line.stockItemId] ? (
                    <span role="alert" className="block text-xs text-destructive">
                      {problems[line.stockItemId]}
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 text-right tabular-nums">{quantityText(line.onHand, unit)}</td>
                <td className="py-1.5 text-right">
                  {editable ? (
                    <input
                      aria-label={`Counted, ${item?.name ?? 'item'}`}
                      inputMode="decimal"
                      className={`${INPUT_CLASS} ml-auto h-8 w-24 text-right`}
                      value={typed[line.stockItemId] ?? ''}
                      onChange={(event) => setTyped({ ...typed, [line.stockItemId]: event.target.value })}
                      onBlur={() => void saveLine(line.stockItemId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveLine(line.stockItemId);
                      }}
                    />
                  ) : (
                    <span className="tabular-nums">
                      {line.counted === null ? '—' : quantityText(line.counted, unit)}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {difference === null || difference === 0 ? (
                    <span className="text-muted-foreground">{difference === 0 ? 'Matches' : '—'}</span>
                  ) : (
                    <span className={difference < 0 ? 'text-destructive' : undefined}>
                      {signedQuantityText(difference, unit)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editable ? (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass('ghost')} onClick={() => setConfirming('abandon')}>
            Abandon
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={action.busy || counted === 0}
            onClick={() => setConfirming('confirm')}
          >
            Confirm counts
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming === 'confirm'}
        title="Confirm this stock take?"
        description="Every counted line that differs from on hand right now is corrected to what you counted. It cannot be undone — a wrong count is fixed with another stock take or an adjustment."
        confirmLabel="Confirm counts"
        pending={action.busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void close('confirm')}
      />
      <ConfirmDialog
        open={confirming === 'abandon'}
        title="Abandon this stock take?"
        description="Nothing on the sheet changes the stock. The sheet is kept, marked abandoned."
        confirmLabel="Abandon"
        danger
        pending={action.busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void close('abandon')}
      />
    </div>
  );
}
