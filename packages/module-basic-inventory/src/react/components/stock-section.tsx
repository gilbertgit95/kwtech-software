'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { ConfirmDialog, cn, LIST_KEYS, ListDrawer, listNeighbours, searchIntoList } from '@kwtech/web-ui/react';
import {
  Archive,
  Boxes,
  CircleSlash,
  ClipboardCheck,
  Flag,
  History as HistoryIcon,
  Import,
  Info,
  Layers,
  type LucideIcon,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Undo2,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import type { StockItemView, StockMoveView, StockOverviewView, StockSourceItemView } from '../../views.js';
import { type StockContext, useStockAction, useStockData } from '../use-stock.js';
import {
  KIND_LABEL,
  LEVEL_LABEL,
  MOVE_LABEL,
  quantityText,
  reasonLabel,
  type StatusTone,
  signedQuantityText,
  whenText,
  whoText,
} from '../view/labels.js';
import { filterItems, levelFill, plural, type StockFilter, stockSummary } from '../view/lists.js';
import { formatPeso } from '../view/money.js';
import { buttonClass, IconButton, INPUT_CLASS } from './controls.js';
import { AdjustDialog, CreateFromPosDialog, ItemDialog, ReceiveDialog, WasteDialog } from './dialogs.js';
import { Alert, Callout, EmptyState, Meter, RowButton, StatCard, StatusChip, Tabs } from './layout.js';

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

  const summary = stockSummary(overview);
  const counts: Readonly<Record<StockFilter, number>> = {
    all: summary.items,
    low: filterItems(overview.items, 'low', null, '').length,
    out: summary.out,
    materials: filterItems(overview.items, 'materials', null, '').length,
    for_sale: filterItems(overview.items, 'for_sale', null, '').length,
  };

  const list = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        <StatCard
          label="Worth at cost"
          value={formatPeso(summary.value)}
          hint={summary.unvalued > 0 ? `${plural(summary.unvalued, 'item')} with no cost` : 'Every item has a cost'}
          icon={Wallet}
          tone="info"
        />
        <StatCard
          label="Items counted"
          value={String(summary.items)}
          hint="Show all"
          icon={Boxes}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <StatCard
          label="Running low"
          value={String(summary.low)}
          hint="At or under their low level"
          icon={TriangleAlert}
          tone={summary.low > 0 ? 'warning' : 'neutral'}
          active={filter === 'low'}
          onClick={() => setFilter('low')}
        />
        <StatCard
          label="Out or count off"
          value={String(summary.out)}
          hint="Nothing left, or below zero"
          icon={CircleSlash}
          tone={summary.out > 0 ? 'danger' : 'neutral'}
          active={filter === 'out'}
          onClick={() => setFilter('out')}
        />
      </div>

      {canReceive || canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {canReceive ? (
            <>
              <button
                type="button"
                className={buttonClass('primary', 'sm')}
                onClick={() => setDialog({ kind: 'receive', itemId: null })}
              >
                <PackagePlus aria-hidden="true" className="size-3.5" />
                Receive stock
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setDialog({ kind: 'waste', itemId: null })}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                Record waste
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setDialog({ kind: 'adjust', itemId: null })}
              >
                <SlidersHorizontal aria-hidden="true" className="size-3.5" />
                Adjust
              </button>
            </>
          ) : null}
          {canManage ? (
            <span className="flex flex-wrap gap-2 @xl:ml-auto">
              {overview.hasSource ? (
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => setDialog({ kind: 'fromPos' })}
                >
                  <Import aria-hidden="true" className="size-3.5" />
                  From POS products
                </button>
              ) : null}
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setDialog({ kind: 'item', item: null })}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                New item
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
          <span className="sr-only">Search stock</span>
          <input
            type="search"
            placeholder="Search by name or code"
            className={`${INPUT_CLASS} pl-8`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={searchIntoList(listRef)}
          />
        </label>
        {categories.length > 0 ? (
          <select
            aria-label="Category"
            className={`${INPUT_CLASS} @xl:w-48`}
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
      <Tabs
        label="Show"
        tabs={[
          { key: 'all', label: `All ${counts.all}` },
          { key: 'low', label: `Low and out ${counts.low}` },
          { key: 'out', label: `Out ${counts.out}` },
          { key: 'materials', label: `Materials ${counts.materials}` },
          { key: 'for_sale', label: `For sale ${counts.for_sale}` },
        ]}
        current={filter}
        onChange={setFilter}
      />

      <div ref={listRef} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pb-2" {...LIST_KEYS}>
        {live.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Nothing is counted yet"
            action={
              canManage ? (
                <span className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    className={buttonClass('primary', 'sm')}
                    onClick={() => setDialog({ kind: 'item', item: null })}
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    New item
                  </button>
                  {overview.hasSource ? (
                    <button
                      type="button"
                      className={buttonClass('secondary', 'sm')}
                      onClick={() => setDialog({ kind: 'fromPos' })}
                    >
                      <Import aria-hidden="true" className="size-3.5" />
                      From POS products
                    </button>
                  ) : null}
                </span>
              ) : null
            }
          >
            {canManage
              ? 'Add what you stock — paper, boards, mugs — or bring in the point of sale’s products.'
              : 'Somebody who manages stock adds the items.'}
          </EmptyState>
        ) : null}
        {live.length > 0 && shown.length === 0 ? (
          <EmptyState icon={Search} title="Nothing matches">
            Try another word, or show every item.
          </EmptyState>
        ) : null}
        {shown.map((item) => (
          <StockRow key={item.id} item={item} selected={item.id === selectedId} onOpen={() => setSelectedId(item.id)} />
        ))}
      </div>
    </div>
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

/** One row of the stock list: what it is, how much is left, and how it stands. */
function StockRow({ item, selected, onOpen }: { item: StockItemView; selected: boolean; onOpen: () => void }) {
  const level = LEVEL_LABEL[item.level];
  const fill = levelFill(item);
  const KindIcon = item.kind === 'for_sale' ? Package : Layers;
  return (
    <RowButton selected={selected} onClick={onOpen}>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg',
            item.kind === 'for_sale' ? 'bg-status-info text-status-info-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          <KindIcon aria-hidden="true" className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{item.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {KIND_LABEL[item.kind]}
            {item.usedBy > 0 ? ` · on ${plural(item.usedBy, 'list')}` : ''}
            {item.value === null ? '' : ` · ${formatPeso(item.value)}`}
          </span>
        </span>
      </span>
      <span className="flex w-28 shrink-0 flex-col items-end gap-1 @md:w-36">
        <span className="font-medium tabular-nums">{quantityText(item.onHand, item.unit)}</span>
        {fill === null ? null : <Meter fill={fill} tone={level.tone} />}
        {item.level === 'ok' ? null : <StatusChip label={level.label} tone={level.tone} />}
      </span>
    </RowButton>
  );
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
  const fill = levelFill(item);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{item.name}</h2>
          <StatusChip label={level.label} tone={level.tone} />
        </div>
        <p className="text-sm text-muted-foreground">
          {KIND_LABEL[item.kind]}
          {category ? ` · ${category.name}` : ''}
          {item.code ? ` · ${item.code}` : ''}
          {item.archivedAt ? ' · archived' : ''}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <span className="text-xs font-medium text-muted-foreground">On hand</span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {quantityText(item.onHand, item.unit)}
          </span>
          {fill === null ? null : (
            <>
              <Meter fill={fill} tone={level.tone} />
              <span className="text-xs text-muted-foreground">
                Low at {quantityText(item.lowStockAt ?? 0, item.unit)}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3">
          <span className="text-xs font-medium text-muted-foreground">Cost per unit</span>
          <span className="font-semibold tabular-nums">{item.unitCost === null ? '—' : formatPeso(item.unitCost)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3">
          <span className="text-xs font-medium text-muted-foreground">Worth</span>
          <span className="font-semibold tabular-nums">{item.value === null ? '—' : formatPeso(item.value)}</span>
        </div>
      </div>
      {item.level === 'negative' ? (
        <Callout icon={TriangleAlert} tone="danger">
          More was used than was ever recorded, so the count is off. Sales are never stopped for it — count the shelf
          with a stock take, or receive what arrived.
        </Callout>
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
                <PackagePlus aria-hidden="true" className="size-3.5" />
                Receive
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => onDialog({ kind: 'waste', itemId: item.id })}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                Waste
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => onDialog({ kind: 'adjust', itemId: item.id })}
              >
                <SlidersHorizontal aria-hidden="true" className="size-3.5" />
                Adjust
              </button>
            </>
          ) : null}
          {canManage ? (
            <span className="ml-auto flex gap-1">
              <IconButton label="Edit item" onClick={() => onDialog({ kind: 'item', item })}>
                <Pencil aria-hidden="true" className="size-4" />
              </IconButton>
              <IconButton label="Archive item" onClick={() => onDialog({ kind: 'archive', item })}>
                <Archive aria-hidden="true" className="size-4" />
              </IconButton>
            </span>
          ) : null}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Used by</h3>
        {uses.length === 0 ? (
          <Callout icon={Info}>
            No product uses it, so only deliveries, adjustments, waste and stock takes move it.{' '}
            <button type="button" className="font-medium text-foreground underline" onClick={onOpenProducts}>
              Set up materials lists under Products
            </button>
          </Callout>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border text-sm">
            {uses.map((use) => (
              <li key={use.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate">
                  {use.refLabel}
                  {use.refKind === 'item' ? <span className="text-muted-foreground"> · every size</span> : null}
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

/** Each movement's icon and tone in the history. */
const MOVE_ICON: Readonly<Record<StockMoveView['kind'], { icon: LucideIcon; tone: StatusTone }>> = {
  opening: { icon: Flag, tone: 'info' },
  received: { icon: PackagePlus, tone: 'success' },
  used: { icon: ShoppingCart, tone: 'neutral' },
  returned: { icon: Undo2, tone: 'info' },
  adjustment: { icon: SlidersHorizontal, tone: 'neutral' },
  wasted: { icon: Trash2, tone: 'danger' },
  count: { icon: ClipboardCheck, tone: 'info' },
};

const DOT: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  danger: 'bg-status-error text-status-error-foreground',
  info: 'bg-status-info text-status-info-foreground',
};

/** An item's movements, newest first, a page at a time, as a timeline. Re-read on every stock event. */
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
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <HistoryIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        History
      </h3>
      <Alert message={first.error ?? action.error} />
      {first.data && moves.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has moved yet.</p>
      ) : null}
      <ol className="flex flex-col">
        {moves.map((move, index) => {
          const look = MOVE_ICON[move.kind];
          const Icon = look.icon;
          return (
            <li key={move.id} className="relative flex gap-3 pb-3">
              {index < moves.length - 1 ? (
                <span aria-hidden="true" className="absolute top-8 bottom-0 left-[15px] w-px bg-border" />
              ) : null}
              <span className={cn('z-0 grid size-8 shrink-0 place-items-center rounded-full', DOT[look.tone])}>
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col pt-1">
                <span className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{MOVE_LABEL[move.kind]}</span>
                    {move.wasteRefLabel ? <span className="text-muted-foreground"> · {move.wasteRefLabel}</span> : null}
                    {move.reason ? <span className="text-muted-foreground"> · {reasonLabel(move.reason)}</span> : null}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-medium tabular-nums',
                      move.quantity > 0 ? 'text-status-success-foreground' : 'text-destructive',
                    )}
                  >
                    {signedQuantityText(move.quantity, item.unit)}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {whenText(move.createdAt, timeZone)} · {whoText(move)}
                  {move.supplier ? ` · ${move.supplier}` : ''}
                  {move.reference ? ` · ref ${move.reference}` : ''}
                  {move.unitCost === null ? '' : ` · ${formatPeso(move.unitCost)} each`}
                </span>
                {move.note ? <span className="text-xs italic text-muted-foreground">“{move.note}”</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
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
