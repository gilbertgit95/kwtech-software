'use client';

import { cn, LIST_KEYS, searchIntoList } from '@kwtech/web-ui/react';
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosCatalogueView, PosCategoryView } from '../pos-client.js';
import { usePosData } from '../use-pos-data.js';
import type { TillState } from '../use-till.js';
import {
  categoryReorder,
  filterItems,
  type ItemForm,
  itemForm,
  itemInput,
  listNeighbours,
  moveEntry,
  newVariantKey,
  type VariantForm,
} from '../view/manage.js';
import { formatPeso } from '../view/money.js';
import { priceRange } from '../view/till.js';
import { buttonClass, Field, INPUT_CLASS } from './controls.js';
import { TextDialog } from './dialogs.js';
import { Alert, Empty, ListDetail, RowButton, StatusChip, Tabs } from './layout.js';

type ItemsTab = 'items' | 'categories';

/**
 * Items (D23): the store's catalogue — items with their variants, and the
 * categories the till's tabs come from. Behind `pos:manage_items`, which also
 * sees costs (D15). Archived rows show on request and can be restored; nothing
 * is ever deleted, because old orders point at it.
 */
export function ItemsSection({ state }: { state: TillState }) {
  const { client, scope } = state;
  const [tab, setTab] = useState<ItemsTab>('items');
  const load = useCallback(() => client.catalogue(scope, true), [client, scope]);
  const catalogue = usePosData(scope, load, ['catalogue'], 'Could not load the items.');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Tabs
        label="Items or categories"
        tabs={[
          { key: 'items', label: 'Items' },
          { key: 'categories', label: 'Categories' },
        ]}
        current={tab}
        onChange={setTab}
      />
      <Alert message={catalogue.error} />
      {catalogue.data ? (
        tab === 'items' ? (
          <ItemsPanel state={state} catalogue={catalogue.data} onSaved={() => void catalogue.reload()} />
        ) : (
          <CategoriesPanel state={state} catalogue={catalogue.data} onSaved={() => void catalogue.reload()} />
        )
      ) : (
        <Empty>{catalogue.loading ? 'Loading…' : 'The items could not be loaded.'}</Empty>
      )}
    </div>
  );
}

/** `null` nothing open; `new` a blank form; otherwise an item's id. */
type Selection = null | 'new' | string;

function ItemsPanel({
  state,
  catalogue,
  onSaved,
}: {
  state: TillState;
  catalogue: PosCatalogueView;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  /** The item just saved, so its editor says so even after it remounts with the saved values. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const open = (next: Selection) => {
    setSelected(next);
    setSavedId(null);
  };
  const items = filterItems(catalogue.items, catalogue.categories, search, showArchived);
  const categoryName = new Map(catalogue.categories.map((category) => [category.id, category.name]));
  const item = selected && selected !== 'new' ? (catalogue.items.find((row) => row.id === selected) ?? null) : null;
  const around = listNeighbours(
    items.map((row) => row.id),
    selected,
  );

  return (
    <ListDetail
      onClose={() => open(null)}
      label="item"
      step={{
        onPrevious: around.previous ? () => open(around.previous) : null,
        onNext: around.next ? () => open(around.next) : null,
        position: around.position,
      }}
      list={
        <>
          <div className="flex gap-2">
            <label className="relative block flex-1">
              <span className="sr-only">Search items</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              />
              <input
                type="search"
                // biome-ignore lint/a11y/noAutofocus: a section opens on its search, as Sell does — the next thing done is finding one (D20: focus always has a home).
                autoFocus
                className={`${INPUT_CLASS} pl-8`}
                placeholder="Name, code or category"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={searchIntoList(listRef)}
              />
            </label>
            <button type="button" className={buttonClass('primary')} onClick={() => open('new')}>
              <Plus aria-hidden="true" className="size-4" />
              New item
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            Show archived
          </label>
          <ul ref={listRef} className="flex min-h-0 flex-col gap-1 overflow-y-auto" {...LIST_KEYS}>
            {items.length === 0 ? (
              <li>
                <Empty>{catalogue.items.length === 0 ? 'No items yet. Add the first one.' : 'Nothing matches.'}</Empty>
              </li>
            ) : null}
            {items.map((row) => {
              const range = priceRange(row);
              const variants = row.variants.filter((variant) => variant.archivedAt === null).length;
              return (
                <li key={row.id}>
                  <RowButton selected={row.id === selected} onClick={() => open(row.id)}>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{row.name}</span>
                        {row.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[
                          row.kind === 'service' ? 'Service' : 'Product',
                          categoryName.get(row.categoryId ?? '') ?? 'No category',
                          row.code,
                          variants > 0 ? `${variants} variants` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {range.min === range.max
                        ? formatPeso(range.min)
                        : `${formatPeso(range.min)}–${formatPeso(range.max)}`}
                    </span>
                  </RowButton>
                </li>
              );
            })}
          </ul>
        </>
      }
      detail={
        selected ? (
          <ItemEditor
            /*
             * ⚠ Keyed on whether the item is LOADED too: a new item's id is
             * selected before the catalogue has re-read it, and without the
             * second part its editor would stay the blank form it mounted as.
             */
            key={`${selected}:${item ? 'loaded' : 'blank'}`}
            state={state}
            catalogue={catalogue}
            form={itemForm(item)}
            archived={item !== null && item.archivedAt !== null}
            justSaved={savedId !== null && savedId === item?.id}
            onSaved={(id) => {
              setSelected(id);
              setSavedId(id);
              onSaved();
            }}
          />
        ) : null
      }
    />
  );
}

/**
 * One item and its variants, edited as a draft and saved in one request —
 * the server writes the item and every variant in one transaction, so a till
 * never loads half of it.
 */
function ItemEditor({
  state,
  catalogue,
  form: initial,
  archived,
  justSaved,
  onSaved,
}: {
  state: TillState;
  catalogue: PosCatalogueView;
  form: ItemForm;
  archived: boolean;
  justSaved: boolean;
  onSaved: (id: string) => void;
}) {
  const { client, scope } = state;
  const [form, setForm] = useState<ItemForm>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(justSaved);
  const set = (patch: Partial<ItemForm>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };
  const setVariant = (key: string, patch: Partial<VariantForm>) =>
    set({ variants: form.variants.map((variant) => (variant.key === key ? { ...variant, ...patch } : variant)) });
  const hasVariants = form.variants.length > 0;
  const liveCategories = catalogue.categories.filter(
    (category) => category.archivedAt === null || category.id === form.categoryId,
  );

  const save = async () => {
    const prepared = itemInput(form);
    if ('problem' in prepared) {
      setProblem(prepared.problem);
      return;
    }
    setSaving(true);
    try {
      const item = await client.saveItem(scope, prepared.input);
      setProblem(null);
      setSaved(true);
      onSaved(item.id);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not save the item.');
    } finally {
      setSaving(false);
    }
  };

  const setArchived = async (next: boolean) => {
    if (!form.id) return;
    setSaving(true);
    try {
      await client.setItemArchived(scope, form.id, next);
      setProblem(null);
      onSaved(form.id);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not change the item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={form.id ? `Edit ${initial.name}` : 'New item'} className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{form.id ? initial.name : 'New item'}</h2>
        {archived ? <StatusChip label="Archived" tone="neutral" /> : null}
      </header>

      <div className="grid gap-3 @md:grid-cols-2">
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              // biome-ignore lint/a11y/noAutofocus: "New item" is asking to type a name. An existing item opens unfocused: the list is still being browsed.
              autoFocus={form.id === null}
              className={INPUT_CLASS}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Kind" hint="A service is never counted as stock.">
          {(id, describedBy) => (
            <select
              id={id}
              aria-describedby={describedBy}
              className={INPUT_CLASS}
              value={form.kind}
              onChange={(e) => set({ kind: e.target.value === 'service' ? 'service' : 'product' })}
            >
              <option value="product">Product</option>
              <option value="service">Service</option>
            </select>
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <select
              id={id}
              className={INPUT_CLASS}
              value={form.categoryId}
              onChange={(e) => set({ categoryId: e.target.value })}
            >
              <option value="">No category</option>
              {liveCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Code" hint="Optional. For search and a scanner; unique in this store.">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={INPUT_CLASS}
              value={form.code}
              onChange={(e) => set({ code: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Description" hint="Optional. One line shown on the till under the name; never printed.">
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            className={INPUT_CLASS}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        )}
      </Field>
      {hasVariants ? null : (
        <div className="grid gap-3 @md:grid-cols-2">
          <Field label="Price (₱)">
            {(id) => (
              <input
                id={id}
                inputMode="decimal"
                className={INPUT_CLASS}
                value={form.price}
                onChange={(e) => set({ price: e.target.value })}
              />
            )}
          </Field>
          <Field label="Cost (₱)" hint="Optional. What one costs the store; cashiers never see it.">
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                inputMode="decimal"
                className={INPUT_CLASS}
                value={form.cost}
                onChange={(e) => set({ cost: e.target.value })}
              />
            )}
          </Field>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Variants</h3>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            onClick={() =>
              set({
                variants: [
                  ...form.variants,
                  { id: null, key: newVariantKey(), name: '', code: '', price: '', cost: '' },
                ],
              })
            }
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Add variant
          </button>
        </div>
        {hasVariants ? (
          <p className="text-xs text-muted-foreground">
            Each variant has its own price, and the till asks which one. A removed variant is archived: old orders keep
            it.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            None: the item goes straight into the cart. Add variants for sizes or types, such as “250 mic · A4”.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {form.variants.map((variant, index) => (
            <li
              key={variant.key}
              className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 @lg:grid-cols-[2fr_1fr_1fr_1fr_auto]"
            >
              <input
                aria-label={`Variant ${index + 1} name`}
                // biome-ignore lint/a11y/noAutofocus: a row just added is the one being typed next. Saved variants have an id and mount unfocused.
                autoFocus={variant.id === null}
                placeholder="Name"
                className={cn(INPUT_CLASS, 'col-span-2 @lg:col-span-1')}
                value={variant.name}
                onChange={(e) => setVariant(variant.key, { name: e.target.value })}
              />
              <input
                aria-label={`Variant ${index + 1} code`}
                placeholder="Code"
                className={INPUT_CLASS}
                value={variant.code}
                onChange={(e) => setVariant(variant.key, { code: e.target.value })}
              />
              <input
                aria-label={`Variant ${index + 1} price in pesos`}
                placeholder="Price"
                inputMode="decimal"
                className={INPUT_CLASS}
                value={variant.price}
                onChange={(e) => setVariant(variant.key, { price: e.target.value })}
              />
              <input
                aria-label={`Variant ${index + 1} cost in pesos`}
                placeholder="Cost"
                inputMode="decimal"
                className={INPUT_CLASS}
                value={variant.cost}
                onChange={(e) => setVariant(variant.key, { cost: e.target.value })}
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label={`Move variant ${index + 1} up`}
                  disabled={index === 0}
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => set({ variants: moveEntry(form.variants, index, 'up') })}
                >
                  <ArrowUp aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move variant ${index + 1} down`}
                  disabled={index === form.variants.length - 1}
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => set({ variants: moveEntry(form.variants, index, 'down') })}
                >
                  <ArrowDown aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove variant ${index + 1}`}
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => set({ variants: form.variants.filter((row) => row.key !== variant.key) })}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Alert message={problem} onDismiss={() => setProblem(null)} />
      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2">
        {form.id ? (
          <button
            type="button"
            disabled={saving}
            className={buttonClass('ghost')}
            onClick={() => void setArchived(!archived)}
          >
            {archived ? 'Restore' : 'Archive'}
          </button>
        ) : (
          <span />
        )}
        <button type="button" disabled={saving} className={buttonClass('primary')} onClick={() => void save()}>
          {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add item'}
        </button>
      </div>
    </section>
  );
}

type CategoryDialog = { kind: 'none' } | { kind: 'new' } | { kind: 'rename'; category: PosCategoryView };

/** Categories: the till's tabs, in the order shown here. Renamed, reordered, archived — never deleted. */
function CategoriesPanel({
  state,
  catalogue,
  onSaved,
}: {
  state: TillState;
  catalogue: PosCatalogueView;
  onSaved: () => void;
}) {
  const { client, scope } = state;
  const [dialog, setDialog] = useState<CategoryDialog>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(catalogue.categories);
  useEffect(() => setOrder(catalogue.categories), [catalogue.categories]);
  const count = (id: string) => catalogue.items.filter((item) => item.categoryId === id && !item.archivedAt).length;

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setError(null);
      setDialog({ kind: 'none' });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, direction: 'up' | 'down') => {
    const next = moveEntry(order, index, direction);
    setOrder(next);
    // One at a time: the store's categories are few, and a failure stops the rest.
    void run(async () => {
      for (const change of categoryReorder(next)) {
        await client.saveCategory(scope, change.name, change.id, change.sortOrder);
      }
    }, 'Could not reorder the categories.');
  };

  return (
    <section aria-label="Categories" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">The till shows these as tabs, in this order.</p>
        <button type="button" className={buttonClass('primary')} onClick={() => setDialog({ kind: 'new' })}>
          <Plus aria-hidden="true" className="size-4" />
          New category
        </button>
      </div>
      <Alert message={error} onDismiss={() => setError(null)} />
      <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {order.length === 0 ? (
          <li>
            <Empty>No categories yet.</Empty>
          </li>
        ) : null}
        {order.map((category, index) => (
          <li
            key={category.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{category.name}</span>
              <span className="text-xs text-muted-foreground">{count(category.id)} items</span>
              {category.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
            </span>
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label={`Move ${category.name} up`}
                disabled={busy || index === 0}
                className={buttonClass('ghost', 'sm')}
                onClick={() => move(index, 'up')}
              >
                <ArrowUp aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${category.name} down`}
                disabled={busy || index === order.length - 1}
                className={buttonClass('ghost', 'sm')}
                onClick={() => move(index, 'down')}
              >
                <ArrowDown aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                onClick={() => setDialog({ kind: 'rename', category })}
              >
                Rename
              </button>
              <button
                type="button"
                disabled={busy}
                className={buttonClass('ghost', 'sm')}
                onClick={() =>
                  void run(
                    () => client.setCategoryArchived(scope, category.id, category.archivedAt === null),
                    'Could not change the category.',
                  )
                }
              >
                {category.archivedAt ? 'Restore' : 'Archive'}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <TextDialog
        open={dialog.kind !== 'none'}
        title={dialog.kind === 'rename' ? `Rename ${dialog.category.name}` : 'New category'}
        label="Name"
        initial={dialog.kind === 'rename' ? dialog.category.name : ''}
        required
        confirmLabel={dialog.kind === 'rename' ? 'Rename' : 'Add category'}
        onSave={(name) =>
          run(
            () =>
              dialog.kind === 'rename'
                ? client.saveCategory(scope, name, dialog.category.id, dialog.category.sortOrder)
                : client.saveCategory(scope, name, null, order.length),
            'Could not save the category.',
          )
        }
        onClose={() => setDialog({ kind: 'none' })}
      />
    </section>
  );
}
