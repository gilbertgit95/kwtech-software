'use client';

import { LIST_KEYS, ListDrawer, listNeighbours, searchIntoList } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatStockQuantity } from '../../domain/quantities.js';
import type { StockUnit } from '../../types.js';
import type { StockOverviewView, StockSourceItemView } from '../../views.js';
import { type StockContext, useStockAction, useStockData } from '../use-stock.js';
import { type UseLineDraft, validateUseList } from '../view/forms.js';
import { quantityText, UNIT_LABEL } from '../view/labels.js';
import {
  canMake,
  listOf,
  materialsCost,
  overlapNames,
  type ProductRow,
  productRows,
  wasteLinesFor,
} from '../view/lists.js';
import { formatPeso } from '../view/money.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { CreateFromPosDialog, ItemSelect, WasteDialog, type WasteOf } from './dialogs.js';
import { Alert, Empty, RowButton, StatusChip } from './layout.js';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [wasting, setWasting] = useState<WasteOf | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  if (!overview.hasSource) {
    return (
      <Empty>
        This workspace has no point of sale connected, so there are no products to give materials lists. Stock items can
        still be received, adjusted, wasted and counted under Stock.
      </Empty>
    );
  }

  const rows = productRows(source.data ?? [], overview.uses);
  const words = search.toLocaleLowerCase('en').split(/\s+/u).filter(Boolean);
  const shown = rows.filter((row) => words.every((word) => row.name.toLocaleLowerCase('en').includes(word)));
  const selected = rows.find((row) => row.itemId === selectedId) ?? null;
  const around = listNeighbours(
    shown.map((row) => row.itemId),
    selected?.itemId ?? null,
  );

  const list = (
    <>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setCreating(true)}>
            Create from POS products
          </button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        A product with no list takes nothing off stock when it is sold. A product sold as it is (a mug, a bottle of ink)
        uses one of itself; a service uses its materials.
      </p>
      <input
        type="search"
        aria-label="Search products"
        placeholder="Search products"
        className={INPUT_CLASS}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={searchIntoList(listRef)}
      />
      <Alert message={source.error} />
      <div ref={listRef} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto" {...LIST_KEYS}>
        {source.data === null ? <Empty>Loading the products…</Empty> : null}
        {source.data && rows.length === 0 ? <Empty>The point of sale has no items yet.</Empty> : null}
        {shown.map((row) => (
          <RowButton key={row.itemId} selected={row.itemId === selectedId} onClick={() => setSelectedId(row.itemId)}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{row.name}</span>
              <span className="text-xs text-muted-foreground">
                {row.kind === 'service' ? 'Service' : 'Product'}
                {row.variants.length > 0 ? ` · ${row.variants.length} variant(s)` : ''}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {row.archived ? <StatusChip label="Archived" tone="neutral" /> : null}
              {row.lines === 0 ? (
                <span className="text-xs text-muted-foreground">No materials list</span>
              ) : (
                <span className="text-xs tabular-nums">{row.lines} line(s)</span>
              )}
            </span>
          </RowButton>
        ))}
      </div>
    </>
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

/** One product: the item's list, each variant's, how many can still be made, and what the materials cost. */
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
  const sellables: { variant: StockSourceItemView | null; label: string }[] =
    liveVariants.length > 0
      ? liveVariants.map((variant) => ({ variant, label: variant.label }))
      : [{ variant: null, label: row.name }];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{row.name}</h2>
        <p className="text-sm text-muted-foreground">
          {row.kind === 'service' ? 'A service at the point of sale' : 'A product at the point of sale'}
          {row.archived ? ' · archived there' : ''}
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">What each sale can still make</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {sellables.map(({ variant, label }) => {
            const left = canMake(overview, row.itemId, variant?.variantId ?? null);
            const cost = materialsCost(overview, row.itemId, variant?.variantId ?? null);
            return (
              <li key={variant?.variantId ?? row.itemId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate">{label}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-muted-foreground">
                    {left === null ? 'Not counted' : `${left} left`}
                    {cost === null ? '' : ` · materials ${formatPeso(cost)}`}
                  </span>
                  {canReceive && left !== null ? (
                    <button
                      type="button"
                      className={buttonClass('ghost', 'sm')}
                      onClick={() =>
                        onWaste({
                          refId: variant?.variantId ?? row.itemId,
                          refLabel: label,
                          lines: wasteLinesFor(overview.uses, row.itemId, variant?.variantId ?? null, 1),
                        })
                      }
                    >
                      Record waste
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {overlaps.length > 0 ? (
        <p className="rounded-md bg-status-warning px-3 py-2 text-sm text-status-warning-foreground">
          {overlaps.join(', ')} {overlaps.length === 1 ? 'is' : 'are'} on the item’s list and a variant’s, so a sale
          takes both amounts. Keep it on one list unless that is meant.
        </p>
      ) : null}

      <UseListEditor
        stock={stock}
        overview={overview}
        target={{ refKind: 'item', refId: row.itemId, refItemId: row.itemId }}
        title={liveVariants.length > 0 ? 'Every variant uses' : 'Each sale uses'}
        hint={liveVariants.length > 0 ? 'What every size or type takes: the hook, the border.' : undefined}
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

let lineKey = 0;
/** A fresh key for a draft line on screen. */
function nextKey(): string {
  lineKey += 1;
  return `use-${lineKey}`;
}

/**
 * One list — the item's or a variant's — as rows of a stock item and an amount
 * per sale. Saving REPLACES the list; only sales after it read it, so what a
 * sale already took never changes (INVENTORY-PLAN §3).
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
    onSaved();
  };

  if (!canManage) {
    return (
      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {saved.map((use) => {
              const item = overview.items.find((one) => one.id === use.stockItemId);
              return (
                <li key={use.id} className="flex justify-between gap-2">
                  <span className="truncate">{item?.name ?? 'An archived item'}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {item ? quantityText(use.quantityPerUnit, item.unit) : formatStockQuantity(use.quantityPerUnit)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <header>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </header>
      <Alert message={action.error} />
      {lines.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : null}
      {lines.map((line, index) => {
        const unit = unitOf(line.stockItemId);
        return (
          <div key={line.key} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <ItemSelect
                id={`${target.refId}-item-${line.key}`}
                items={items}
                value={line.stockItemId}
                onChange={(stockItemId) => edit(lines.map((one, at) => (at === index ? { ...one, stockItemId } : one)))}
              />
            </div>
            <label className="flex w-32 flex-col gap-1 text-xs text-muted-foreground">
              {unit ? `${UNIT_LABEL[unit]} per sale` : 'Per sale'}
              <input
                inputMode="decimal"
                className={INPUT_CLASS}
                value={line.quantity}
                onChange={(event) =>
                  edit(lines.map((one, at) => (at === index ? { ...one, quantity: event.target.value } : one)))
                }
              />
            </label>
            <button
              type="button"
              aria-label="Remove this line"
              className={buttonClass('ghost', 'sm')}
              onClick={() => edit(lines.filter((_, at) => at !== index))}
            >
              Remove
            </button>
          </div>
        );
      })}
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          onClick={() => edit([...lines, { key: nextKey(), stockItemId: '', quantity: '1' }])}
        >
          Add a material
        </button>
        <span className="flex gap-2">
          {dirty ? (
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => {
                setLines(fromSaved());
                setDirty(false);
                setProblem(null);
              }}
            >
              Undo changes
            </button>
          ) : null}
          <button
            type="button"
            className={buttonClass('primary', 'sm')}
            disabled={!dirty || action.busy}
            onClick={() => void save()}
          >
            {action.busy ? 'Saving…' : 'Save list'}
          </button>
        </span>
      </div>
    </section>
  );
}
