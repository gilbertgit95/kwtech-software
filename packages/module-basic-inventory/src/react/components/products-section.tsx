'use client';

import { cn, LIST_KEYS, ListDrawer, listNeighbours, searchIntoList } from '@kwtech/web-ui/react';
import { Import, Info, Layers, Lightbulb, Plus, Search, Shapes, Trash2, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatStockQuantity } from '../../domain/quantities.js';
import type { StockUnit } from '../../types.js';
import type { StockOverviewView, StockSourceItemView } from '../../views.js';
import { type StockContext, useStockAction, useStockData } from '../use-stock.js';
import { type UseLineDraft, validateUseList } from '../view/forms.js';
import { quantityText, UNIT_SUFFIX } from '../view/labels.js';
import {
  canMake,
  limitedBy,
  listOf,
  materialsCost,
  overlapNames,
  type ProductRow,
  plural,
  productRows,
  wasteLinesFor,
} from '../view/lists.js';
import { formatPeso } from '../view/money.js';
import { buttonClass, IconButton, INPUT_CLASS, QuantityInput } from './controls.js';
import { CreateFromPosDialog, ItemSelect, WasteDialog, type WasteOf } from './dialogs.js';
import { Alert, Callout, Empty, EmptyState, RowButton, StatusChip } from './layout.js';

/**
 * What each thing the point of sale sells uses up (INVENTORY-PLAN §2, I13,
 * I14): the item's own list — what every size uses — and each variant's —
 * what changes with it. A sale takes both. Spoiled work is recorded from here
 * too, its materials filled in from the lists (I15).
 *
 * The products are the POS's, read through a port; this app never changes
 * them, only what they take off stock.
 */
export function ProductsSection({
  stock,
  overview,
  canReceive,
  canManage,
  onChanged,
}: {
  stock: StockContext;
  overview: StockOverviewView;
  canReceive: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const load = useCallback(() => stock.client.sourceItems(stock.scope), [stock.client, stock.scope]);
  const source = useStockData(stock.scope, load, 'Could not read the point of sale’s products.');
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [wasting, setWasting] = useState<WasteOf | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  if (!overview.hasSource) {
    return (
      <EmptyState icon={Shapes} title="No point of sale connected">
        There are no products to give materials lists. Stock items can still be received, adjusted, wasted and counted
        under Stock.
      </EmptyState>
    );
  }

  const rows = productRows(source.data ?? [], overview.uses);
  const words = search.toLocaleLowerCase('en').split(/\s+/u).filter(Boolean);
  const shown = rows.filter(
    (row) =>
      (!onlyMissing || row.lines === 0) && words.every((word) => row.name.toLocaleLowerCase('en').includes(word)),
  );
  const missing = rows.filter((row) => row.lines === 0 && !row.archived).length;
  const selected = rows.find((row) => row.itemId === selectedId) ?? null;
  const around = listNeighbours(
    shown.map((row) => row.itemId),
    selected?.itemId ?? null,
  );

  const list = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Callout icon={Lightbulb}>
        A product with no materials list takes nothing off stock when it is sold. A product sold as it is (a mug, an ink
        bottle) uses one of itself; a service uses its materials.
      </Callout>
      <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
          <span className="sr-only">Search products</span>
          <input
            type="search"
            placeholder="Search products"
            className={`${INPUT_CLASS} pl-8`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={searchIntoList(listRef)}
          />
        </label>
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={onlyMissing}
            className={buttonClass(onlyMissing ? 'primary' : 'secondary', 'sm')}
            onClick={() => setOnlyMissing(!onlyMissing)}
          >
            No list yet · {missing}
          </button>
          {canManage ? (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setCreating(true)}>
              <Import aria-hidden="true" className="size-3.5" />
              From POS products
            </button>
          ) : null}
        </span>
      </div>
      <Alert message={source.error} />
      <div ref={listRef} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pb-2" {...LIST_KEYS}>
        {source.data === null ? <Empty>Loading the products…</Empty> : null}
        {source.data && rows.length === 0 ? (
          <EmptyState icon={Shapes} title="The point of sale has no items yet" />
        ) : null}
        {source.data && rows.length > 0 && shown.length === 0 ? (
          <EmptyState icon={Search} title="Nothing matches" />
        ) : null}
        {shown.map((row) => (
          <RowButton key={row.itemId} selected={row.itemId === selectedId} onClick={() => setSelectedId(row.itemId)}>
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Shapes aria-hidden="true" className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{row.name}</span>
                <span className="text-xs text-muted-foreground">
                  {row.kind === 'service' ? 'Service' : 'Product'}
                  {row.variants.length > 0 ? ` · ${plural(row.variants.length, 'variant')}` : ''}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {row.archived ? <StatusChip label="Archived" tone="neutral" /> : null}
              {row.lines === 0 ? (
                <StatusChip label="Not tracked" tone="neutral" />
              ) : (
                <StatusChip label={plural(row.lines, 'material')} tone="success" />
              )}
            </span>
          </RowButton>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <ListDrawer
        list={list}
        detail={
          selected ? (
            <ProductDetail
              key={selected.itemId}
              stock={stock}
              overview={overview}
              row={selected}
              canReceive={canReceive}
              canManage={canManage}
              onWaste={setWasting}
              onChanged={onChanged}
            />
          ) : null
        }
        onClose={() => setSelectedId(null)}
        label="product"
        step={{
          onPrevious: around.previous ? () => setSelectedId(around.previous) : null,
          onNext: around.next ? () => setSelectedId(around.next) : null,
          position: around.position,
        }}
      />
      <CreateFromPosDialog
        open={creating}
        source={source.data ?? []}
        stock={stock}
        overview={overview}
        onClose={() => setCreating(false)}
        onDone={onChanged}
      />
      <WasteDialog
        open={wasting !== null}
        of={wasting}
        itemId={null}
        stock={stock}
        overview={overview}
        onClose={() => setWasting(null)}
        onDone={onChanged}
      />
    </>
  );
}

/** One product: what each size can still make, and its lists — the item's and each variant's. */
function ProductDetail({
  stock,
  overview,
  row,
  canReceive,
  canManage,
  onWaste,
  onChanged,
}: {
  stock: StockContext;
  overview: StockOverviewView;
  row: ProductRow;
  canReceive: boolean;
  canManage: boolean;
  onWaste: (of: WasteOf) => void;
  onChanged: () => void;
}) {
  const overlaps = overlapNames(overview.uses, row.itemId, overview.items);
  const liveVariants = row.variants.filter((variant) => !variant.archived);
  /** What can be sold: each live variant, or the item itself when it has none. */
  const sellables: { variant: StockSourceItemView | null; label: string; short: string }[] =
    liveVariants.length > 0
      ? liveVariants.map((variant) => ({ variant, label: variant.label, short: variant.variantName ?? variant.label }))
      : [{ variant: null, label: row.name, short: row.name }];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{row.name}</h2>
          {row.archived ? <StatusChip label="Archived" tone="neutral" /> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {row.kind === 'service' ? 'A service at the point of sale' : 'A product at the point of sale'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
        {sellables.map(({ variant, label, short }) => {
          const left = canMake(overview, row.itemId, variant?.variantId ?? null);
          const cost = materialsCost(overview, row.itemId, variant?.variantId ?? null);
          const limit = left === null ? null : limitedBy(overview, row.itemId, variant?.variantId ?? null);
          return (
            <div
              key={variant?.variantId ?? row.itemId}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3"
            >
              <span className="truncate text-xs font-medium text-muted-foreground">{short}</span>
              <span
                className={cn(
                  'text-xl font-semibold tracking-tight tabular-nums',
                  left === 0 ? 'text-destructive' : null,
                )}
              >
                {left === null ? 'Not tracked' : `${left} left`}
              </span>
              {limit ? <span className="truncate text-xs text-muted-foreground">Limited by {limit}</span> : null}
              <span className="text-xs text-muted-foreground">
                {cost === null ? 'No material costs entered' : `Materials ${formatPeso(cost)} a sale`}
              </span>
              {canReceive && left !== null ? (
                <button
                  type="button"
                  className={`${buttonClass('ghost', 'sm')} -ml-2 self-start`}
                  onClick={() =>
                    onWaste({
                      refId: variant?.variantId ?? row.itemId,
                      refLabel: label,
                      lines: wasteLinesFor(overview.uses, row.itemId, variant?.variantId ?? null, 1),
                    })
                  }
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Record waste
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {overlaps.length > 0 ? (
        <Callout icon={TriangleAlert} tone="warning">
          {overlaps.join(', ')} {overlaps.length === 1 ? 'is' : 'are'} on the shared list and a variant’s, so a sale
          takes both amounts. Keep it on one list unless that is meant.
        </Callout>
      ) : null}

      <UseListEditor
        stock={stock}
        overview={overview}
        target={{ refKind: 'item', refId: row.itemId, refItemId: row.itemId }}
        title={liveVariants.length > 0 ? 'Every variant uses' : 'Each sale uses'}
        hint={liveVariants.length > 0 ? 'What every size or type takes — the hook, the border.' : undefined}
        canManage={canManage}
        onSaved={onChanged}
      />
      {liveVariants.map((variant) => (
        <UseListEditor
          key={variant.variantId}
          stock={stock}
          overview={overview}
          target={{ refKind: 'variant', refId: variant.variantId ?? '', refItemId: row.itemId }}
          title={`${variant.variantName ?? variant.label} also uses`}
          hint={undefined}
          canManage={canManage}
          onSaved={onChanged}
        />
      ))}
    </div>
  );
}

/*
 * A key for each draft line on screen. Module-level on purpose: keys only have
 * to differ within one list, and a counter outlives the editor that is re-mounted
 * when the drawer steps to the next product.
 */
let lineKey = 0;
function nextKey(): string {
  lineKey += 1;
  return `use-${lineKey}`;
}

/**
 * One list — the item's or a variant's — as a small table: a material and how
 * much one sale takes, in its unit. Saving REPLACES the list; only sales after
 * it read it, so what a sale already took never changes (INVENTORY-PLAN §3).
 */
function UseListEditor({
  stock,
  overview,
  target,
  title,
  hint,
  canManage,
  onSaved,
}: {
  stock: StockContext;
  overview: StockOverviewView;
  target: { refKind: 'item' | 'variant'; refId: string; refItemId: string };
  title: string;
  hint: string | undefined;
  canManage: boolean;
  onSaved: () => void;
}) {
  const saved = listOf(overview.uses, target.refId);
  const fromSaved = (): (UseLineDraft & { key: string })[] =>
    saved.map((use) => ({
      key: use.id,
      stockItemId: use.stockItemId,
      quantity: formatStockQuantity(use.quantityPerUnit),
    }));
  const [lines, setLines] = useState(fromSaved);
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const action = useStockAction();
  const savedKey = saved.map((use) => `${use.id}:${use.quantityPerUnit}`).join(',');
  // A list changed elsewhere (another manager, a sale's reload) shows here — unless this one is being edited.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `savedKey` stands for the saved list; re-reading on every render would wipe what is being typed.
  useEffect(() => {
    if (!dirty) setLines(fromSaved());
  }, [savedKey]);

  const items = overview.items.filter((item) => !item.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
  const unitOf = (id: string): StockUnit | null => overview.items.find((item) => item.id === id)?.unit ?? null;
  const edit = (next: (UseLineDraft & { key: string })[]) => {
    setLines(next);
    setDirty(true);
    setProblem(null);
    setSavedNote(false);
  };

  const save = async () => {
    const result = validateUseList(lines, unitOf);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    const done = await action.run(
      () => stock.client.setUses(stock.scope, target, result.lines),
      'Could not save the list.',
    );
    if (!done) return;
    setDirty(false);
    setSavedNote(true);
    onSaved();
  };

  /** What a person who may not edit the list sees. */
  const readOnly =
    saved.length === 0 ? (
      <p className="text-sm text-muted-foreground">Nothing.</p>
    ) : (
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border text-sm">
        {saved.map((use) => {
          const item = overview.items.find((one) => one.id === use.stockItemId);
          return (
            <li key={use.id} className="flex justify-between gap-2 px-3 py-2">
              <span className="truncate">{item?.name ?? 'An archived item'}</span>
              <span className="tabular-nums text-muted-foreground">
                {item ? quantityText(use.quantityPerUnit, item.unit) : formatStockQuantity(use.quantityPerUnit)}
              </span>
            </li>
          );
        })}
      </ul>
    );

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-end justify-between gap-2">
        <span>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Layers aria-hidden="true" className="size-4 text-muted-foreground" />
            {title}
          </h3>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </span>
        {savedNote ? (
          <span role="status" className="text-xs text-status-success-foreground">
            Saved
          </span>
        ) : null}
      </header>
      <Alert message={action.error} />

      {canManage ? (
        <div className="flex flex-col rounded-xl border border-border">
          {lines.length > 0 ? (
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_2rem] @md:grid-cols-[minmax(0,1fr)_8rem_2rem] gap-2 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span>Material</span>
              <span>Per sale</span>
              <span className="sr-only">Remove</span>
            </div>
          ) : (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Info aria-hidden="true" className="size-4" />
              Nothing yet — add the first material.
            </p>
          )}
          {lines.map((line, index) => {
            const unit = unitOf(line.stockItemId);
            return (
              <div
                key={line.key}
                className="grid grid-cols-[minmax(0,1fr)_5.5rem_2rem] @md:grid-cols-[minmax(0,1fr)_8rem_2rem] items-center gap-2 px-3 py-1.5"
              >
                <ItemSelect
                  id={`${target.refId}-item-${line.key}`}
                  label="Material"
                  showOnHand={false}
                  items={items}
                  value={line.stockItemId}
                  onChange={(stockItemId) =>
                    edit(lines.map((one, at) => (at === index ? { ...one, stockItemId } : one)))
                  }
                />
                <QuantityInput
                  aria-label="Per sale"
                  suffix={unit ? UNIT_SUFFIX[unit] : null}
                  value={line.quantity}
                  onChange={(event) =>
                    edit(lines.map((one, at) => (at === index ? { ...one, quantity: event.target.value } : one)))
                  }
                />
                <IconButton label="Remove this material" onClick={() => edit(lines.filter((_, at) => at !== index))}>
                  <X aria-hidden="true" className="size-4" />
                </IconButton>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <button
              type="button"
              className={`${buttonClass('ghost', 'sm')} -ml-2`}
              onClick={() => edit([...lines, { key: nextKey(), stockItemId: '', quantity: '1' }])}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Add material
            </button>
            {dirty ? (
              <span className="flex gap-2">
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => {
                    setLines(fromSaved());
                    setDirty(false);
                    setProblem(null);
                  }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className={buttonClass('primary', 'sm')}
                  disabled={action.busy}
                  onClick={() => void save()}
                >
                  {action.busy ? 'Saving…' : 'Save list'}
                </button>
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        readOnly
      )}
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
