'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { ConfirmDialog, LIST_KEYS, ListDrawer, listNeighbours, searchIntoList } from '@kwtech/web-ui/react';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import type { StockItemView, StockMoveView, StockOverviewView, StockSourceItemView } from '../../views.js';
import { type StockContext, useStockAction, useStockData } from '../use-stock.js';
import {
  KIND_LABEL,
  LEVEL_LABEL,
  MOVE_LABEL,
  quantityText,
  reasonLabel,
  signedQuantityText,
  whenText,
  whoText,
} from '../view/labels.js';
import { filterItems, type StockFilter } from '../view/lists.js';
import { formatPeso } from '../view/money.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { AdjustDialog, CreateFromPosDialog, ItemDialog, ReceiveDialog, WasteDialog } from './dialogs.js';
import { Alert, Empty, RowButton, StatusChip, Tabs } from './layout.js';

type Dialog =
  | { kind: 'none' }
  | { kind: 'item'; item: StockItemView | null }
  | { kind: 'receive'; itemId: string | null }
  | { kind: 'adjust'; itemId: string | null }
  | { kind: 'waste'; itemId: string | null }
  | { kind: 'fromPos' }
  | { kind: 'archive'; item: StockItemView };

/**
 * Everything the store counts, with what is on hand and what it is worth
 * (INVENTORY-PLAN §2): filtered by low and out, by kind and by category,
 * searched by name or code. An item opens its history and what uses it.
 * Receiving, adjusting and waste are the counter's (`stock:receive`); new
 * items and "Create from POS products" are `stock:manage`'s.
 */
export function StockSection({
  stock,
  overview,
  canReceive,
  canManage,
  onChanged,
  onOpenProducts,
}: {
  stock: StockContext;
  overview: StockOverviewView;
  canReceive: boolean;
  canManage: boolean;
  onChanged: () => void;
  onOpenProducts: () => void;
}) {
  const [filter, setFilter] = useState<StockFilter>('all');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const listRef = useRef<HTMLDivElement>(null);
  const action = useStockAction();
  const close = () => setDialog({ kind: 'none' });

  const shown = filterItems(overview.items, filter, categoryId, search);
  const selected = overview.items.find((item) => item.id === selectedId) ?? null;
  const around = listNeighbours(
    shown.map((item) => item.id),
    selected?.id ?? null,
  );
  const live = overview.items.filter((item) => !item.archivedAt);
  const categories = overview.categories.filter((category) => !category.archivedAt);
  const loadSource = useCallback(() => stock.client.sourceItems(stock.scope), [stock.client, stock.scope]);

  const archive = async (item: StockItemView) => {
    const done = await action.run(
      () => stock.client.setItemArchived(stock.scope, item.id, true),
      'Could not archive it.',
    );
    close();
    if (!done) return;
    setSelectedId(null);
    onChanged();
  };

  const list = (
    <>
      {canReceive || canManage ? (
        <div className="flex flex-wrap gap-2">
          {canReceive ? (
            <>
              <button
                type="button"
                className={buttonClass('primary', 'sm')}
                onClick={() => setDialog({ kind: 'receive', itemId: null })}
              >
                Receive stock
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setDialog({ kind: 'waste', itemId: null })}
              >
                Record waste
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setDialog({ kind: 'adjust', itemId: null })}
              >
                Adjust
              </button>
            </>
          ) : null}
          {canManage ? (
            <>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setDialog({ kind: 'item', item: null })}
              >
                New item
              </button>
              {overview.hasSource ? (
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => setDialog({ kind: 'fromPos' })}
                >
                  Create from POS products
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          label="Show"
          tabs={[
            { key: 'all', label: 'All' },
            { key: 'low', label: 'Low and out' },
            { key: 'out', label: 'Out' },
            { key: 'materials', label: 'Materials' },
            { key: 'for_sale', label: 'For sale' },
          ]}
          current={filter}
          onChange={setFilter}
        />
        {categories.length > 0 ? (
          <select
            aria-label="Category"
            className={`${INPUT_CLASS} h-7 w-auto text-xs`}
            value={categoryId ?? ''}
            onChange={(event) => setCategoryId(event.target.value || null)}
          >
            <option value="">Every category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <input
        type="search"
        aria-label="Search stock"
        placeholder="Search by name or code"
        className={INPUT_CLASS}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={searchIntoList(listRef)}
      />
      <p className="text-xs text-muted-foreground">
        Worth {formatPeso(overview.totalValue)} at cost
        {overview.unvalued > 0 ? `, not counting ${overview.unvalued} item(s) with no cost entered` : ''}.
      </p>

      <div ref={listRef} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto" {...LIST_KEYS}>
        {live.length === 0 ? (
          <Empty>
            Nothing is counted yet.{' '}
            {canManage
              ? overview.hasSource
                ? 'Add an item, or create them from the point of sale’s products.'
                : 'Add an item to start.'
              : 'Somebody who manages stock adds the items.'}
          </Empty>
        ) : null}
        {live.length > 0 && shown.length === 0 ? <Empty>Nothing matches.</Empty> : null}
        {shown.map((item) => {
          const level = LEVEL_LABEL[item.level];
          return (
            <RowButton key={item.id} selected={item.id === selectedId} onClick={() => setSelectedId(item.id)}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {KIND_LABEL[item.kind]}
                  {item.usedBy > 0 ? ` · on ${item.usedBy} list(s)` : ''}
                  {item.value === null ? '' : ` · ${formatPeso(item.value)}`}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-sm tabular-nums">{quantityText(item.onHand, item.unit)}</span>
                {item.level === 'ok' ? null : <StatusChip label={level.label} tone={level.tone} />}
              </span>
            </RowButton>
          );
        })}
      </div>
    </>
  );

  return (
    <>
      <Alert message={action.error} onDismiss={action.dismissError} />
      <ListDrawer
        list={list}
        detail={
          selected ? (
            <ItemDetail
              key={selected.id}
              stock={stock}
              item={selected}
              overview={overview}
              canReceive={canReceive}
              canManage={canManage}
              onDialog={setDialog}
              onOpenProducts={onOpenProducts}
            />
          ) : null
        }
        onClose={() => setSelectedId(null)}
        label="stock item"
        step={{
          onPrevious: around.previous ? () => setSelectedId(around.previous) : null,
          onNext: around.next ? () => setSelectedId(around.next) : null,
          position: around.position,
        }}
      />
      <ItemDialog
        open={dialog.kind === 'item'}
        item={dialog.kind === 'item' ? dialog.item : null}
        stock={stock}
        overview={overview}
        onClose={close}
        onDone={(itemId) => {
          setSelectedId(itemId);
          onChanged();
        }}
      />
      <ReceiveDialog
        open={dialog.kind === 'receive'}
        itemId={dialog.kind === 'receive' ? dialog.itemId : null}
        stock={stock}
        overview={overview}
        onClose={close}
        onDone={onChanged}
      />
      <AdjustDialog
        open={dialog.kind === 'adjust'}
        itemId={dialog.kind === 'adjust' ? dialog.itemId : null}
        stock={stock}
        overview={overview}
        onClose={close}
        onDone={onChanged}
      />
      <WasteDialog
        open={dialog.kind === 'waste'}
        of={null}
        itemId={dialog.kind === 'waste' ? dialog.itemId : null}
        stock={stock}
        overview={overview}
        onClose={close}
        onDone={onChanged}
      />
      {dialog.kind === 'fromPos' ? (
        <SourceLoader stock={stock} load={loadSource}>
          {(source) => (
            <CreateFromPosDialog
              open
              source={source}
              stock={stock}
              overview={overview}
              onClose={close}
              onDone={onChanged}
            />
          )}
        </SourceLoader>
      ) : null}
      <ConfirmDialog
        open={dialog.kind === 'archive'}
        title={dialog.kind === 'archive' ? `Archive ${dialog.item.name}?` : 'Archive'}
        description="It leaves the list and every picker. Its history is kept, and a sale whose materials list still names it still takes it — take it off those lists first. You can restore it later."
        confirmLabel="Archive"
        danger
        pending={action.busy}
        onCancel={close}
        onConfirm={() => {
          if (dialog.kind === 'archive') void archive(dialog.item);
        }}
      />
    </>
  );
}

/** Reads the POS's catalogue once, for a dialog that needs it, and says so while it loads or when it fails. */
export function SourceLoader({
  stock,
  load,
  children,
}: {
  stock: StockContext;
  load: () => Promise<StockSourceItemView[]>;
  children: (source: StockSourceItemView[]) => ReactNode;
}) {
  const source = useStockData(stock.scope, load, 'Could not read the point of sale’s products.');
  if (source.error) return <Alert message={source.error} />;
  if (!source.data) return null;
  return <>{children(source.data)}</>;
}

/** One item: what is on hand, what it costs, what uses it, and its history. */
function ItemDetail({
  stock,
  item,
  overview,
  canReceive,
  canManage,
  onDialog,
  onOpenProducts,
}: {
  stock: StockContext;
  item: StockItemView;
  overview: StockOverviewView;
  canReceive: boolean;
  canManage: boolean;
  onDialog: (dialog: Dialog) => void;
  onOpenProducts: () => void;
}) {
  const timeZone = useWorkspaceTimeZone();
  const uses = overview.uses.filter((use) => use.stockItemId === item.id);
  const category = overview.categories.find((one) => one.id === item.categoryId) ?? null;
  const level = LEVEL_LABEL[item.level];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{item.name}</h2>
        <p className="text-sm text-muted-foreground">
          {KIND_LABEL[item.kind]}
          {category ? ` · ${category.name}` : ''}
          {item.code ? ` · ${item.code}` : ''}
          {item.archivedAt ? ' · archived' : ''}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm @md:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">On hand</dt>
          <dd className="text-lg font-semibold tabular-nums">{quantityText(item.onHand, item.unit)}</dd>
          <dd>
            <StatusChip label={level.label} tone={level.tone} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Cost per unit</dt>
          <dd className="tabular-nums">{item.unitCost === null ? 'Not entered' : formatPeso(item.unitCost)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Worth</dt>
          <dd className="tabular-nums">{item.value === null ? '—' : formatPeso(item.value)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Low at</dt>
          <dd className="tabular-nums">
            {item.lowStockAt === null ? 'No alert' : quantityText(item.lowStockAt, item.unit)}
          </dd>
        </div>
      </dl>
      {item.level === 'negative' ? (
        <p className="rounded-md bg-status-error px-3 py-2 text-sm text-status-error-foreground">
          More was used than was ever recorded, so the count is off. Sales are never stopped for it — count the shelf
          with a stock take, or receive what arrived.
        </p>
      ) : null}

      {item.archivedAt ? null : (
        <div className="flex flex-wrap gap-2">
          {canReceive ? (
            <>
              <button
                type="button"
                className={buttonClass('primary', 'sm')}
                onClick={() => onDialog({ kind: 'receive', itemId: item.id })}
              >
                Receive
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => onDialog({ kind: 'waste', itemId: item.id })}
              >
                Record waste
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => onDialog({ kind: 'adjust', itemId: item.id })}
              >
                Adjust
              </button>
            </>
          ) : null}
          {canManage ? (
            <>
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                onClick={() => onDialog({ kind: 'item', item })}
              >
                Edit
              </button>
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                onClick={() => onDialog({ kind: 'archive', item })}
              >
                Archive
              </button>
            </>
          ) : null}
        </div>
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium">Used by</h3>
        {uses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No product uses it, so only deliveries, adjustments, waste and stock takes move it.{' '}
            <button type="button" className="underline" onClick={onOpenProducts}>
              Materials lists are under Products.
            </button>
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {uses.map((use) => (
              <li key={use.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {use.refLabel}
                  {use.refKind === 'item' ? <span className="text-muted-foreground"> (every size)</span> : null}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {quantityText(use.quantityPerUnit, item.unit)} each
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <History stock={stock} item={item} timeZone={timeZone} />
    </div>
  );
}

/** An item's movements, newest first, a page at a time. Re-read on every stock event, as everything is. */
function History({ stock, item, timeZone }: { stock: StockContext; item: StockItemView; timeZone: string }) {
  const [older, setOlder] = useState<StockMoveView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const action = useStockAction();
  const load = useCallback(async () => {
    const page = await stock.client.moves(stock.scope, item.id, null);
    setOlder([]);
    setCursor(page.nextCursor);
    return page.moves;
  }, [stock.client, stock.scope, item.id]);
  const first = useStockData(stock.scope, load, 'Could not load the history.');
  const moves = [...(first.data ?? []), ...older];

  const loadOlder = async () => {
    const last = moves.at(-1);
    if (!last) return;
    const page = await action.run(() => stock.client.moves(stock.scope, item.id, last.id), 'Could not load more.');
    if (!page) return;
    setOlder([...older, ...page.moves]);
    setCursor(page.nextCursor);
  };

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium">History</h3>
      <Alert message={first.error ?? action.error} />
      {first.data && moves.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has moved yet.</p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border text-sm">
        {moves.map((move) => (
          <li key={move.id} className="flex items-start justify-between gap-3 py-1.5">
            <span className="flex min-w-0 flex-col">
              <span>
                {MOVE_LABEL[move.kind]}
                {move.wasteRefLabel ? ` — ${move.wasteRefLabel}` : ''}
                {move.reason ? <span className="text-muted-foreground"> · {reasonLabel(move.reason)}</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {whenText(move.createdAt, timeZone)} · {whoText(move)}
                {move.supplier ? ` · ${move.supplier}` : ''}
                {move.reference ? ` · ref ${move.reference}` : ''}
                {move.unitCost === null ? '' : ` · ${formatPeso(move.unitCost)} each`}
                {move.note ? ` · “${move.note}”` : ''}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{signedQuantityText(move.quantity, item.unit)}</span>
          </li>
        ))}
      </ul>
      {cursor ? (
        <button
          type="button"
          className={`${buttonClass('ghost', 'sm')} self-start`}
          disabled={action.busy}
          onClick={() => void loadOlder()}
        >
          {action.busy ? 'Loading…' : 'Show older'}
        </button>
      ) : null}
    </section>
  );
}
