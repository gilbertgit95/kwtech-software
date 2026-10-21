'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { ConfirmDialog, LIST_KEYS, ListDrawer, listNeighbours } from '@kwtech/web-ui/react';
import { Check, ClipboardCheck, ClipboardList, Info, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatStockQuantity } from '../../domain/quantities.js';
import type { StockUnit } from '../../types.js';
import type { StockOverviewView, StockTakeView } from '../../views.js';
import { type StockContext, useStockAction, useStockData } from '../use-stock.js';
import { parseCount } from '../view/forms.js';
import { quantityText, signedQuantityText, UNIT_SUFFIX, whenText } from '../view/labels.js';
import { buttonClass, QuantityInput } from './controls.js';
import { StartTakeDialog } from './dialogs.js';
import { Alert, Callout, Meter, RowButton, StatusChip } from './layout.js';

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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {open ? (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-card p-3 shadow-xs">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <ClipboardList aria-hidden="true" className="size-4 text-primary" />A count is open
            </span>
            <StatusChip label="Counting" tone="info" />
          </span>
          <span className="text-xs text-muted-foreground">
            Started {whenText(open.createdAt, timeZone)} by {open.createdByName ?? 'a team member'}
            {open.note ? ` · ${open.note}` : ''}
          </span>
          <button
            type="button"
            className={`${buttonClass('primary', 'sm')} self-start`}
            onClick={() => setSelectedId(open.id)}
          >
            Continue counting
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border p-3">
          <span className="text-sm text-muted-foreground">
            Count the shelf to correct what the history says. Sales can go on while you count.
          </span>
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setStarting(true)}>
            <Plus aria-hidden="true" className="size-3.5" />
            Start a stock take
          </button>
        </div>
      )}
      <Alert message={takes.error} />
      <h3 className="text-sm font-semibold">Past counts</h3>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pb-2" {...LIST_KEYS}>
        {takes.data && rows.filter((take) => take.status !== 'open').length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : null}
        {rows
          .filter((take) => take.status !== 'open')
          .map((take) => {
            const status = STATUS[take.status];
            return (
              <RowButton key={take.id} selected={take.id === selectedId} onClick={() => setSelectedId(take.id)}>
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <ClipboardCheck aria-hidden="true" className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{whenText(take.createdAt, timeZone)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {take.createdByName ?? 'A team member'}
                      {take.note ? ` · ${take.note}` : ''}
                    </span>
                  </span>
                </span>
                <StatusChip label={status.label} tone={status.tone} />
              </RowButton>
            );
          })}
      </div>
    </div>
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

  const total = view.lines.length;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Stock take</h2>
          <StatusChip label={STATUS[view.status].label} tone={STATUS[view.status].tone} />
        </div>
        <p className="text-sm text-muted-foreground">
          {view.createdByName ?? 'A team member'}
          {view.note ? ` · ${view.note}` : ''}
        </p>
      </header>
      {editable ? (
        <div className="flex flex-col gap-1.5">
          <span className="flex justify-between text-xs text-muted-foreground">
            <span>
              {counted} of {total} counted
            </span>
            <span>{total === 0 ? 0 : Math.round((counted / total) * 100)}%</span>
          </span>
          <Meter fill={total === 0 ? 0 : counted / total} tone="info" />
        </div>
      ) : null}
      {editable ? (
        <Callout icon={Info}>
          Type what is on the shelf; leave a line empty to leave it alone. Counts save as you go. If something sells
          while you count, “On hand” moves — confirming compares with it then.
        </Callout>
      ) : null}
      <Alert message={action.error ?? take.error} onDismiss={action.dismissError} />
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {view.lines.map((line) => {
          const item = itemOf(line.stockItemId);
          const unit = item?.unit ?? 'piece';
          const typedCount = parseCount(typed[line.stockItemId] ?? '', unit);
          const count = 'counted' in typedCount ? typedCount.counted : null;
          const typedDifference = count === null ? null : count - line.onHand;
          const difference = editable ? typedDifference : line.difference;
          return (
            <li key={line.stockItemId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{item?.name ?? 'An archived item'}</span>
                <span className="text-xs text-muted-foreground">On hand {quantityText(line.onHand, unit)}</span>
                {problems[line.stockItemId] ? (
                  <span role="alert" className="text-xs text-destructive">
                    {problems[line.stockItemId]}
                  </span>
                ) : null}
              </span>
              {editable ? (
                <QuantityInput
                  className="w-32"
                  aria-label={`Counted, ${item?.name ?? 'item'}`}
                  placeholder="Count"
                  suffix={UNIT_SUFFIX[unit]}
                  value={typed[line.stockItemId] ?? ''}
                  onChange={(event) => setTyped({ ...typed, [line.stockItemId]: event.target.value })}
                  onBlur={() => void saveLine(line.stockItemId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveLine(line.stockItemId);
                  }}
                />
              ) : (
                <span className="w-32 text-right text-sm tabular-nums">
                  {line.counted === null ? 'Not counted' : quantityText(line.counted, unit)}
                </span>
              )}
              <span className="flex w-28 justify-end">
                <DifferenceChip difference={difference} unit={unit} />
              </span>
            </li>
          );
        })}
      </ul>
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
            <Check aria-hidden="true" className="size-4" />
            Confirm {counted} {counted === 1 ? 'count' : 'counts'}
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

/** A line's difference as a chip: matches, more on the shelf, or less. Nothing until it is counted. */
function DifferenceChip({ difference, unit }: { difference: number | null; unit: StockUnit }) {
  if (difference === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (difference === 0) return <StatusChip label="Matches" tone="success" />;
  return <StatusChip label={signedQuantityText(difference, unit)} tone={difference < 0 ? 'danger' : 'warning'} />;
}
