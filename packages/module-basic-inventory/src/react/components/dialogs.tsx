'use client';

import { useEffect, useRef, useState } from 'react';
import { STOCK_ADJUST_REASONS, STOCK_WASTE_REASONS } from '../../domain/moves.js';
import { STOCK_UNITS } from '../../domain/quantities.js';
import type { StockUnit } from '../../types.js';
import type { StockCategoryView, StockItemView, StockOverviewView, StockSourceItemView } from '../../views.js';
import { type StockContext, useStockAction } from '../use-stock.js';
import {
  type AdjustDraft,
  type ItemDraft,
  itemDraft,
  type ReceiveDraft,
  validateAdjustDraft,
  validateItemDraft,
  validateReceiveDraft,
  validateWasteDraft,
  type WasteDraft,
  type WasteLineDraft,
} from '../view/forms.js';
import { ADJUST_REASON_LABEL, KIND_LABEL, quantityText, UNIT_LABEL, WASTE_REASON_LABEL } from '../view/labels.js';
import { buttonClass, Field, INPUT_CLASS, Modal } from './controls.js';
import { Alert } from './layout.js';

/*
 * The stock app's forms, each in a `Modal`. Every one checks its draft with the
 * same rules the server runs (`view/forms.ts`) and says why before Save; the
 * API's own sentence shows when it refuses anyway.
 *
 * ⚠ ONE CLIENT ID PER OPEN DIALOG for a movement: a double press, or a retry
 * after a dropped connection, records once.
 */

/** A fresh client id each time a dialog opens. */
function useClientId(open: boolean): React.RefObject<string> {
  const id = useRef('');
  useEffect(() => {
    if (open) id.current = globalThis.crypto.randomUUID();
  }, [open]);
  return id;
}

/** The live items, by name, as a picker lists them. */
function liveItems(overview: StockOverviewView): StockItemView[] {
  return overview.items.filter((item) => !item.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
}

/** A stock item picker: a native select, so ↑ ↓ and typing to jump work everywhere. */
export function ItemSelect({
  id,
  describedBy,
  items,
  value,
  onChange,
  autoFocus = false,
}: {
  id: string;
  describedBy?: string | undefined;
  items: readonly StockItemView[];
  value: string;
  onChange: (id: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <select
      id={id}
      aria-describedby={describedBy}
      // biome-ignore lint/a11y/noAutofocus: a dialog opens on the choice made first (POS-PLAN D20).
      autoFocus={autoFocus}
      className={INPUT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose…</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name} — {quantityText(item.onHand, item.unit)}
        </option>
      ))}
    </select>
  );
}

// ── a stock item ──────────────────────────────────────────────────────────

export function ItemDialog({
  open,
  item,
  stock,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  item: StockItemView | null;
  stock: StockContext;
  overview: StockOverviewView;
  onClose: () => void;
  onDone: (itemId: string) => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(itemDraft(item));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const action = useStockAction();
  const { dismissError } = action;
  useEffect(() => {
    if (!open) return;
    setDraft(itemDraft(item));
    setErrors({});
    dismissError();
  }, [open, item, dismissError]);
  const set = (patch: Partial<ItemDraft>) => setDraft({ ...draft, ...patch });
  const categories = overview.categories.filter((category) => !category.archivedAt || category.id === draft.categoryId);
  const unitLocked = item !== null && item.onHand !== 0;

  const save = async () => {
    const result = validateItemDraft(draft, item?.id ?? null);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const saved = await action.run(() => stock.client.saveItem(stock.scope, result.input), 'Could not save the item.');
    if (!saved) return;
    onDone(saved.id);
    onClose();
  };

  return (
    <Modal open={open} title={item ? `Edit ${item.name}` : 'New stock item'} onClose={onClose}>
      <Alert message={action.error} />
      <Field label="Name" error={errors.name}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={errors.name !== undefined}
            // biome-ignore lint/a11y/noAutofocus: a blank form opens on its first box (POS-PLAN D20).
            autoFocus
            className={INPUT_CLASS}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="What it is" error={errors.kind}>
          {(id, describedBy) => (
            <select
              id={id}
              aria-describedby={describedBy}
              className={INPUT_CLASS}
              value={draft.kind}
              onChange={(event) => set({ kind: event.target.value })}
            >
              <option value="material">{KIND_LABEL.material} — used up making what is sold</option>
              <option value="for_sale">{KIND_LABEL.for_sale} — sold as it is</option>
            </select>
          )}
        </Field>
        <Field
          label="Counted in"
          hint={unitLocked ? 'Fixed once stock has moved: every movement is counted in it.' : undefined}
        >
          {(id, describedBy) => (
            <select
              id={id}
              aria-describedby={describedBy}
              disabled={unitLocked}
              className={INPUT_CLASS}
              value={draft.unit}
              onChange={(event) => set({ unit: event.target.value })}
            >
              {STOCK_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_LABEL[unit]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cost per unit (₱)" hint="Optional. A delivery at a new cost updates it." error={errors.unitCost}>
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={errors.unitCost !== undefined}
              inputMode="decimal"
              className={INPUT_CLASS}
              value={draft.unitCost}
              onChange={(event) => set({ unitCost: event.target.value })}
            />
          )}
        </Field>
        <Field label="Low at" hint="Optional. Shown as low at or under this." error={errors.lowStockAt}>
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={errors.lowStockAt !== undefined}
              inputMode="decimal"
              className={INPUT_CLASS}
              value={draft.lowStockAt}
              onChange={(event) => set({ lowStockAt: event.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" hint="Optional, your own short code.">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={INPUT_CLASS}
              value={draft.code}
              onChange={(event) => set({ code: event.target.value })}
            />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <select
              id={id}
              className={INPUT_CLASS}
              value={draft.categoryId}
              onChange={(event) => set({ categoryId: event.target.value })}
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="flex justify-end">
        <button type="button" className={buttonClass('primary')} disabled={action.busy} onClick={() => void save()}>
          {action.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

// ── receive ───────────────────────────────────────────────────────────────

export function ReceiveDialog({
  open,
  itemId,
  stock,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  /** The item to receive, when opened from it; null to choose. */
  itemId: string | null;
  stock: StockContext;
  overview: StockOverviewView;
  onClose: () => void;
  onDone: () => void;
}) {
  const blank: ReceiveDraft = {
    stockItemId: itemId ?? '',
    quantity: '',
    unitCost: '',
    supplier: '',
    reference: '',
    opening: false,
  };
  const [draft, setDraft] = useState<ReceiveDraft>(blank);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const action = useStockAction();
  const { dismissError } = action;
  const clientId = useClientId(open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens, or opens on another item.
  useEffect(() => {
    if (!open) return;
    setDraft(blank);
    setErrors({});
    dismissError();
  }, [open, itemId, dismissError]);
  const set = (patch: Partial<ReceiveDraft>) => setDraft({ ...draft, ...patch });
  const items = liveItems(overview);
  const item = items.find((one) => one.id === draft.stockItemId) ?? null;

  const save = async () => {
    const result = validateReceiveDraft(draft, item, clientId.current);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const done = await action.run(() => stock.client.receive(stock.scope, result.input), 'Could not record it.');
    if (!done) return;
    onDone();
    onClose();
  };

  return (
    <Modal open={open} title="Receive stock" onClose={onClose}>
      <Alert message={action.error} />
      <Field label="What arrived" error={errors.stockItemId}>
        {(id, describedBy) => (
          <ItemSelect
            id={id}
            describedBy={describedBy}
            items={items}
            value={draft.stockItemId}
            onChange={(stockItemId) => set({ stockItemId })}
            autoFocus={itemId === null}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={item ? `How many (${UNIT_LABEL[item.unit].toLowerCase()})` : 'How many'} error={errors.quantity}>
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={errors.quantity !== undefined}
              inputMode="decimal"
              // biome-ignore lint/a11y/noAutofocus: opened from an item, the quantity is what is typed first.
              autoFocus={itemId !== null}
              className={INPUT_CLASS}
              value={draft.quantity}
              onChange={(event) => set({ quantity: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Cost per unit (₱)"
          hint={item?.unitCost ? `Was ₱${(item.unitCost / 100).toFixed(2)}. Becomes the item’s cost.` : 'Optional.'}
          error={errors.unitCost}
        >
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={errors.unitCost !== undefined}
              inputMode="decimal"
              className={INPUT_CLASS}
              value={draft.unitCost}
              onChange={(event) => set({ unitCost: event.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier" hint="Optional.">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={INPUT_CLASS}
              value={draft.supplier}
              onChange={(event) => set({ supplier: event.target.value })}
            />
          )}
        </Field>
        <Field label="Reference" hint="Optional: a receipt or delivery number.">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={INPUT_CLASS}
              value={draft.reference}
              onChange={(event) => set({ reference: event.target.value })}
            />
          )}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.opening} onChange={(event) => set({ opening: event.target.checked })} />
        This is the stock already on the shelf when we started counting
      </label>
      <div className="flex justify-end">
        <button type="button" className={buttonClass('primary')} disabled={action.busy} onClick={() => void save()}>
          {action.busy ? 'Recording…' : 'Record delivery'}
        </button>
      </div>
    </Modal>
  );
}

// ── adjust ────────────────────────────────────────────────────────────────

export function AdjustDialog({
  open,
  itemId,
  stock,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  itemId: string | null;
  stock: StockContext;
  overview: StockOverviewView;
  onClose: () => void;
  onDone: () => void;
}) {
  const blank: AdjustDraft = { stockItemId: itemId ?? '', direction: 'out', quantity: '', reason: '', note: '' };
  const [draft, setDraft] = useState<AdjustDraft>(blank);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const action = useStockAction();
  const { dismissError } = action;
  const clientId = useClientId(open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens, or opens on another item.
  useEffect(() => {
    if (!open) return;
    setDraft(blank);
    setErrors({});
    dismissError();
  }, [open, itemId, dismissError]);
  const set = (patch: Partial<AdjustDraft>) => setDraft({ ...draft, ...patch });
  const items = liveItems(overview);
  const item = items.find((one) => one.id === draft.stockItemId) ?? null;

  const save = async () => {
    const result = validateAdjustDraft(draft, item, clientId.current);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const done = await action.run(() => stock.client.adjust(stock.scope, result.input), 'Could not record it.');
    if (!done) return;
    onDone();
    onClose();
  };

  return (
    <Modal open={open} title="Adjust stock" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        For a correction by hand. A misprint or something spoiled while making it is <strong>Record waste</strong>; a
        whole shelf counted is a stock take.
      </p>
      <Alert message={action.error} />
      <Field label="Which item" error={errors.stockItemId}>
        {(id, describedBy) => (
          <ItemSelect
            id={id}
            describedBy={describedBy}
            items={items}
            value={draft.stockItemId}
            onChange={(stockItemId) => set({ stockItemId })}
            autoFocus={itemId === null}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="In or out">
          {(id) => (
            <select
              id={id}
              className={INPUT_CLASS}
              value={draft.direction}
              onChange={(event) => set({ direction: event.target.value === 'in' ? 'in' : 'out' })}
            >
              <option value="out">Out — less on the shelf</option>
              <option value="in">In — more on the shelf</option>
            </select>
          )}
        </Field>
        <Field label="How many" error={errors.quantity}>
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={errors.quantity !== undefined}
              inputMode="decimal"
              // biome-ignore lint/a11y/noAutofocus: opened from an item, the quantity is what is typed first.
              autoFocus={itemId !== null}
              className={INPUT_CLASS}
              value={draft.quantity}
              onChange={(event) => set({ quantity: event.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Reason" error={errors.reason}>
        {(id, describedBy) => (
          <select
            id={id}
            aria-describedby={describedBy}
            className={INPUT_CLASS}
            value={draft.reason}
            onChange={(event) => set({ reason: event.target.value })}
          >
            <option value="">Choose…</option>
            {STOCK_ADJUST_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {ADJUST_REASON_LABEL[reason]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Note" hint={draft.reason === 'other' ? 'Required for “Other”.' : 'Optional.'} error={errors.note}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={errors.note !== undefined}
            className={INPUT_CLASS}
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <button type="button" className={buttonClass('primary')} disabled={action.busy} onClick={() => void save()}>
          {action.busy ? 'Recording…' : 'Record adjustment'}
        </button>
      </div>
    </Modal>
  );
}

// ── waste ─────────────────────────────────────────────────────────────────

/** What a waste is OF: a POS product (its materials proposed), or nothing (one stock item). */
export interface WasteOf {
  refId: string;
  refLabel: string;
  lines: WasteLineDraft[];
}

/**
 * Record waste (I15). Opened from a product, its materials from both lists are
 * filled in, each changeable — the hook was not used yet — and lines cleared
 * are left out. Opened from an item, or alone, it is one line.
 */
export function WasteDialog({
  open,
  of,
  itemId,
  stock,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  of: WasteOf | null;
  itemId: string | null;
  stock: StockContext;
  overview: StockOverviewView;
  onClose: () => void;
  onDone: () => void;
}) {
  const blank: WasteDraft = {
    lines: of ? of.lines : [{ key: 'line-0', stockItemId: itemId ?? '', quantity: '' }],
    reason: '',
    note: '',
  };
  const [draft, setDraft] = useState<WasteDraft>(blank);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const action = useStockAction();
  const { dismissError } = action;
  const clientId = useClientId(open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens, or opens on another product or item.
  useEffect(() => {
    if (!open) return;
    setDraft(blank);
    setErrors({});
    dismissError();
  }, [open, of, itemId, dismissError]);
  const items = liveItems(overview);
  const unitOf = (id: string): StockUnit | null => items.find((item) => item.id === id)?.unit ?? null;
  const setLine = (index: number, patch: Partial<WasteDraft['lines'][number]>) =>
    setDraft({ ...draft, lines: draft.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) });

  const save = async () => {
    const result = validateWasteDraft(
      draft,
      unitOf,
      of ? { refId: of.refId, refLabel: of.refLabel } : null,
      clientId.current,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const done = await action.run(() => stock.client.waste(stock.scope, result.input), 'Could not record it.');
    if (!done) return;
    onDone();
    onClose();
  };

  return (
    <Modal open={open} title={of ? `Record waste — ${of.refLabel}` : 'Record waste'} onClose={onClose} wide>
      {of ? (
        <p className="text-sm text-muted-foreground">
          What one spoiled piece uses, from its materials list. Change any amount, or clear a line that was not used.
        </p>
      ) : null}
      <Alert message={action.error} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Wasted</legend>
        {draft.lines.map((line, index) => {
          const item = items.find((one) => one.id === line.stockItemId) ?? null;
          return (
            <div key={line.key} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                {of ? (
                  <p className="truncate pb-2 text-sm">{item?.name ?? 'An archived item'}</p>
                ) : (
                  <ItemSelect
                    id={`waste-item-${index}`}
                    items={items}
                    value={line.stockItemId}
                    onChange={(stockItemId) => setLine(index, { stockItemId })}
                    autoFocus={index === 0 && itemId === null}
                  />
                )}
              </div>
              <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
                {item ? UNIT_LABEL[item.unit] : 'Amount'}
                <input
                  inputMode="decimal"
                  // biome-ignore lint/a11y/noAutofocus: opened on a product or an item, the first amount is what is checked first.
                  autoFocus={index === 0 && (of !== null || itemId !== null)}
                  className={INPUT_CLASS}
                  value={line.quantity}
                  onChange={(event) => setLine(index, { quantity: event.target.value })}
                />
              </label>
            </div>
          );
        })}
        {errors.lines ? (
          <p role="alert" className="text-xs text-destructive">
            {errors.lines}
          </p>
        ) : null}
        {of ? null : (
          <button
            type="button"
            className={`${buttonClass('ghost', 'sm')} self-start`}
            onClick={() =>
              setDraft({
                ...draft,
                lines: [...draft.lines, { key: `line-${draft.lines.length}`, stockItemId: '', quantity: '' }],
              })
            }
          >
            Add another item
          </button>
        )}
      </fieldset>
      <Field label="Reason" error={errors.reason}>
        {(id, describedBy) => (
          <select
            id={id}
            aria-describedby={describedBy}
            className={INPUT_CLASS}
            value={draft.reason}
            onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
          >
            <option value="">Choose…</option>
            {STOCK_WASTE_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {WASTE_REASON_LABEL[reason]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Note" hint={draft.reason === 'other' ? 'Required for “Other”.' : 'Optional.'} error={errors.note}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={errors.note !== undefined}
            className={INPUT_CLASS}
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <button type="button" className={buttonClass('danger')} disabled={action.busy} onClick={() => void save()}>
          {action.busy ? 'Recording…' : 'Record waste'}
        </button>
      </div>
    </Modal>
  );
}

// ── create from POS products ──────────────────────────────────────────────

/**
 * "Create from POS products" (I17): the POS's products and variants that no
 * list uses yet, to tick. Each ticked one becomes a for-sale stock item at 0,
 * linked one to one, ready for a first count. Services are never offered.
 */
export function CreateFromPosDialog({
  open,
  source,
  stock,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  source: readonly StockSourceItemView[];
  stock: StockContext;
  overview: StockOverviewView;
  onClose: () => void;
  onDone: () => void;
}) {
  const used = new Set(overview.uses.map((use) => use.refId));
  const offered = source.filter((entry) => {
    if (entry.kind !== 'product' || entry.archived) return false;
    if (used.has(entry.variantId ?? entry.itemId)) return false;
    // An item with variants is offered per variant: the item itself is never sold.
    if (entry.variantId === null) return !source.some((one) => one.itemId === entry.itemId && one.variantId !== null);
    return true;
  });
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const action = useStockAction();
  const { dismissError } = action;
  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    dismissError();
  }, [open, dismissError]);
  const keyOf = (entry: StockSourceItemView) => `${entry.itemId}:${entry.variantId ?? ''}`;

  const save = async () => {
    const picks = offered
      .filter((entry) => picked.has(keyOf(entry)))
      .map((entry) => ({ itemId: entry.itemId, variantId: entry.variantId }));
    if (picks.length === 0) {
      action.setError('Tick at least one product.');
      return;
    }
    const done = await action.run(
      () => stock.client.createFromSource(stock.scope, picks),
      'Could not create the stock items.',
    );
    if (!done) return;
    onDone();
    onClose();
  };

  return (
    <Modal open={open} title="Create from POS products" onClose={onClose} wide>
      <p className="text-sm text-muted-foreground">
        Each product you tick becomes a stock item at 0, counted in pieces, and every sale of it takes one off. Count
        the shelf afterwards with a stock take. Services are left out: give them a materials list instead.
      </p>
      <Alert message={action.error} />
      {offered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every product the point of sale has is already counted.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {offered.map((entry) => (
            <li key={keyOf(entry)}>
              <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <input
                  type="checkbox"
                  checked={picked.has(keyOf(entry))}
                  onChange={(event) => {
                    const next = new Set(picked);
                    if (event.target.checked) next.add(keyOf(entry));
                    else next.delete(keyOf(entry));
                    setPicked(next);
                  }}
                />
                {entry.label}
                {entry.code ? <span className="text-xs text-muted-foreground">{entry.code}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        {offered.length > 0 ? (
          <button type="button" className={buttonClass('ghost')} onClick={() => setPicked(new Set(offered.map(keyOf)))}>
            Tick all
          </button>
        ) : null}
        <button type="button" className={buttonClass('primary')} disabled={action.busy} onClick={() => void save()}>
          {action.busy ? 'Creating…' : 'Create stock items'}
        </button>
      </div>
    </Modal>
  );
}

// ── categories and takes ──────────────────────────────────────────────────

export function CategoryDialog({
  open,
  category,
  stock,
  onClose,
  onDone,
}: {
  open: boolean;
  category: StockCategoryView | null;
  stock: StockContext;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const action = useStockAction();
  const { dismissError } = action;
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setProblem(null);
    dismissError();
  }, [open, category, dismissError]);

  const save = async () => {
    if (name.trim() === '') {
      setProblem('Give it a name.');
      return;
    }
    const done = await action.run(
      () =>
        stock.client.saveCategory(stock.scope, {
          categoryId: category?.id ?? null,
          name,
          sortOrder: category?.sortOrder ?? null,
        }),
      'Could not save the category.',
    );
    if (!done) return;
    onDone();
    onClose();
  };

  return (
    <Modal open={open} title={category ? `Rename ${category.name}` : 'New category'} onClose={onClose}>
      <Alert message={action.error} />
      <Field label="Name" hint="“Paper”, “Lamination”, “Mugs and blanks”." error={problem}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={problem !== null}
            // biome-ignore lint/a11y/noAutofocus: the dialog's one box.
            autoFocus
            className={INPUT_CLASS}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <button type="button" className={buttonClass('primary')} disabled={action.busy} onClick={() => void save()}>
          {action.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

export function StartTakeDialog({
  open,
  stock,
  overview,
  onClose,
  onDone,
}: {
  open: boolean;
  stock: StockContext;
  overview: StockOverviewView;
  onClose: () => void;
  onDone: (takeId: string) => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState('');
  const action = useStockAction();
  const { dismissError } = action;
  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setNote('');
    dismissError();
  }, [open, dismissError]);
  const categories = overview.categories.filter((category) => !category.archivedAt);

  const save = async () => {
    const take = await action.run(
      () => stock.client.startTake(stock.scope, [...picked], note.trim() || null),
      'Could not start the stock take.',
    );
    if (!take) return;
    onDone(take.id);
    onClose();
  };

  return (
    <Modal open={open} title="Start a stock take" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        A count sheet of what is on the shelf. Sales go on while you count: each difference is taken against the shelf
        when you confirm, not now.
      </p>
      <Alert message={action.error} />
      {categories.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Which categories (none ticked: everything)</legend>
          {categories.map((category) => (
            <label key={category.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.has(category.id)}
                onChange={(event) => {
                  const next = new Set(picked);
                  if (event.target.checked) next.add(category.id);
                  else next.delete(category.id);
                  setPicked(next);
                }}
              />
              {category.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Field label="Note" hint="Optional: “month end”, “after the flood”.">
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            className={INPUT_CLASS}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <button type="button" className={buttonClass('primary')} disabled={action.busy} onClick={() => void save()}>
          {action.busy ? 'Starting…' : 'Start counting'}
        </button>
      </div>
    </Modal>
  );
}
