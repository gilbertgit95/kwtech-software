'use client';

import { cn } from '@kwtech/web-ui/react';
import { ChevronDown, ChevronLeft, Hand, Minus, Plus, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { searchItems } from '../../domain/search.js';
import type { PosItemView } from '../pos-client.js';
import { useNow } from '../use-now.js';
import type { TillState } from '../use-till.js';
import { formatPeso } from '../view/money.js';
import { leftOf, stockWarning, tileLeft } from '../view/stock.js';
import {
  canLeaveOrder,
  countOnOrder,
  heldOrderTitle,
  initiallyOpenGroups,
  itemGroups,
  type PosItemGroup,
  waitMinutes,
} from '../view/take-orders.js';
import { itemCount, lineLabel, priceRange, searchCatalogue } from '../view/till.js';
import { buttonClass, INPUT_CLASS, StockBadge } from './controls.js';
import { ReferenceDialog, VariantPicker } from './dialogs.js';
import { OrderTypePicker } from './order-type-picker.js';
import { WaitBadge } from './wait-badge.js';

type Sheet = 'none' | 'order' | 'hold' | 'reference';

/**
 * TAKE ORDERS (issue #23): the seller's screen, made for a phone or a handheld
 * carried between tables. One hand, one thumb, no keyboard needed.
 *
 * - **Held orders across the top**, one tap to reopen and add to one. They are
 *   `state.pending`, which every order write re-reads live, so an order held
 *   on another device shows here too, and leaves once a cashier settles it.
 * - **Items grouped by category** ("Beef ▸ Bulalo, Balbacua"), each group a
 *   heading that opens and closes; an item with sizes opens the variant
 *   picker, as on the till.
 * - **Every order ends at Hold** — the cashier takes the payment, on the
 *   Cashier board. There is no Pay here even for somebody who may take
 *   payment: on this view the whole sale goes through the held orders.
 * - The same `useTill` state as the till: one order, saved as it is built.
 */
export function TakeOrders({ state, phone = false }: { state: TillState; phone?: boolean }) {
  const { catalogue, order, client, scope } = state;
  const open = order?.status === 'open' ? order : null;
  const lines = open?.lines ?? [];
  const searchId = useId();
  /** Ticks every half minute, so each chip's waiting time moves on its own. */
  const now = useNow();
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<Sheet>('none');
  const [variantItem, setVariantItem] = useState<PosItemView | null>(null);
  /** Said after an act: "Held Table 5", or a stock warning. One line, dismissed with OK. */
  const [notice, setNotice] = useState<string | null>(null);

  const groups = useMemo(() => (catalogue ? itemGroups(catalogue) : []), [catalogue]);
  /** Which groups are open; null until the seller first taps one, so the default follows the catalogue. */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string> | null>(null);
  const shownGroups = openGroups ?? initiallyOpenGroups(groups);
  const searchable = useMemo(() => (catalogue ? searchCatalogue(catalogue) : []), [catalogue]);
  const results = query.trim() ? searchItems(searchable, query) : [];
  const isHeld = open !== null && state.pending.some((one) => one.id === open.id);

  const toggleGroup = (id: string) => {
    const next = new Set(shownGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenGroups(next);
  };

  const add = async (itemId: string, variantId: string | null) => {
    setVariantItem(null);
    const done = await state.act((current) => client.addLine(scope, current, itemId, variantId, 1), {
      create: true,
    });
    if (!done) return;
    const same = done.lines.filter((line) => line.itemId === itemId && line.variantId === variantId);
    const inOrder = same.reduce((sum, line) => sum + line.quantity, 0);
    setNotice(
      stockWarning(same[0] ? lineLabel(same[0]) : 'This item', leftOf(state.stock, itemId, variantId), inOrder),
    );
  };

  const pick = (itemId: string, variantId: string | null) => {
    const item = catalogue?.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (!variantId && item.variants.some((variant) => variant.archivedAt === null)) {
      setVariantItem(item);
      return;
    }
    void add(itemId, variantId);
  };

  /** Starts a fresh order — or, for an order never held, asks to hold it first, since it is listed nowhere else. */
  const newOrder = () => {
    if (!canLeaveOrder(open, state.pending)) {
      setSheet('hold');
      return;
    }
    state.clear();
    setSheet('none');
  };

  const resume = async (orderId: string) => {
    if (open?.id === orderId) {
      setSheet('order');
      return;
    }
    if (!canLeaveOrder(open, state.pending)) {
      setNotice('Hold the order you are taking first, so it is not lost.');
      setSheet('hold');
      return;
    }
    await state.resume(orderId);
    setSheet('order');
  };

  if (!state.canSell) {
    return (
      <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        You can see this store’s orders, but your role or your organization’s plan does not include taking orders.
      </p>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3">
      {/* ── held orders ─────────────────────────────────────────────────── */}
      <nav aria-label="Held orders" className="-mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={newOrder}
          className={cn(
            'flex min-h-14 shrink-0 flex-col justify-center rounded-xl border-2 border-dashed px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open && !isHeld ? 'border-primary text-primary' : 'border-border text-muted-foreground',
          )}
        >
          <span className="flex items-center gap-1">
            <Plus aria-hidden="true" className="size-4" />
            {open && !isHeld ? 'Taking' : 'New order'}
          </span>
          {open && !isHeld ? <span className="text-xs tabular-nums">{formatPeso(open.total)}</span> : null}
        </button>
        {state.pending.map((held) => {
          const current = held.id === open?.id;
          return (
            <button
              key={held.id}
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => void resume(held.id)}
              className={cn(
                'flex min-h-14 max-w-44 shrink-0 flex-col justify-center rounded-xl border px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                current
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card active:bg-accent',
              )}
            >
              <span className="truncate text-sm font-semibold">{heldOrderTitle(held)}</span>
              {held.orderTypeName ? (
                <span className={cn('truncate text-xs', current ? 'opacity-80' : 'text-muted-foreground')}>
                  {held.orderTypeName}
                </span>
              ) : null}
              <span className="flex items-center gap-1.5 text-xs">
                <span className={cn('tabular-nums', current ? 'opacity-80' : 'text-muted-foreground')}>
                  {formatPeso(held.total)}
                </span>
                {now ? <WaitBadge minutes={waitMinutes(held.createdAt, now)} inverted={current} /> : null}
              </span>
            </button>
          );
        })}
      </nav>

      {notice ? (
        <p
          role="status"
          className="flex items-start justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-foreground"
        >
          <span>{notice}</span>
          <button type="button" className="shrink-0 font-medium underline" onClick={() => setNotice(null)}>
            OK
          </button>
        </p>
      ) : null}

      {/* ── items ───────────────────────────────────────────────────────── */}
      <label className="sr-only" htmlFor={searchId}>
        Search items
      </label>
      {/* No autofocus: on a phone it raises the keyboard over the items before anybody asked to type. */}
      <input
        id={searchId}
        type="search"
        autoComplete="off"
        placeholder="Search items"
        className={cn(INPUT_CLASS, 'h-12 shrink-0 rounded-xl text-base')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {!catalogue ? <p className="text-sm text-muted-foreground">Loading items…</p> : null}
        {catalogue && groups.length === 0 ? (
          <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            This store has no items yet. Somebody who manages items adds them under Items.
          </p>
        ) : null}
        {query.trim() ? (
          <ul className="flex flex-col gap-2">
            {results.length === 0 ? <li className="text-sm text-muted-foreground">Nothing matches.</li> : null}
            {results.map((result) => (
              <li key={`${result.itemId}:${result.variantId ?? ''}`}>
                <ItemRow
                  name={result.label}
                  price={result.price}
                  sizes={result.opensPicker}
                  onOrder={countOnOrder(lines, result.itemId)}
                  left={leftOf(state.stock, result.itemId, result.variantId)}
                  disabled={state.busy}
                  onPick={() => {
                    pick(result.itemId, result.variantId);
                    setQuery('');
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((group) => (
              <ItemGroupSection
                key={group.id}
                group={group}
                expanded={shownGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
                state={state}
                onPick={(itemId) => pick(itemId, null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── the order, at the thumb ─────────────────────────────────────── */}
      <button
        type="button"
        disabled={!open}
        onClick={() => setSheet('order')}
        className="flex min-h-14 shrink-0 items-center justify-between gap-3 rounded-2xl bg-primary px-4 text-left text-primary-foreground shadow-md transition-transform active:scale-[0.99] disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="min-w-0">
          <span className="block truncate text-xs opacity-80">
            {open
              ? [
                  open.orderTypeName,
                  open.label ?? (isHeld ? 'Held order' : 'New order'),
                  `${itemCount(lines)} ${itemCount(lines) === 1 ? 'item' : 'items'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Tap an item to start an order'}
          </span>
          <span className="block text-lg font-semibold tabular-nums">{formatPeso(open?.total ?? 0)}</span>
        </span>
        <span className="shrink-0 text-sm font-medium">{open ? 'View order ›' : null}</span>
      </button>

      {/* ── the order sheet, over the items ─────────────────────────────── */}
      {sheet !== 'none' && open ? (
        <section
          aria-label="Order"
          className={cn(
            'absolute inset-0 z-10 flex min-h-0 flex-col gap-3 bg-card p-3 shadow-lg',
            phone ? 'rounded-2xl' : 'rounded-lg border border-border',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSheet('none')}
              className="-ml-1 flex min-h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-medium text-primary active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
              Items
            </button>
            <button
              type="button"
              onClick={() => setSheet('reference')}
              className="min-h-11 max-w-[60%] truncate rounded-xl border border-dashed border-border px-3 text-sm font-medium active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {open.label ?? 'Add reference'}
            </button>
          </div>

          <OrderTypePicker state={state} order={open} large />

          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing on this order yet.</p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto overscroll-contain">
              {lines.map((line) => (
                <li key={line.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{lineLabel(line)}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {formatPeso(line.unitPrice)} · {formatPeso(line.total)}
                    </span>
                    {line.note ? (
                      <span className="block truncate text-xs text-muted-foreground">{line.note}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    aria-label={line.quantity > 1 ? `One fewer ${lineLabel(line)}` : `Remove ${lineLabel(line)}`}
                    disabled={state.busy}
                    className={stepperClass}
                    onClick={() =>
                      void state.act((current) =>
                        line.quantity > 1
                          ? client.updateLine(scope, current, line.id, { quantity: line.quantity - 1 })
                          : client.removeLine(scope, current, line.id),
                      )
                    }
                  >
                    {line.quantity > 1 ? (
                      <Minus aria-hidden="true" className="size-4" />
                    ) : (
                      <Trash2 aria-hidden="true" className="size-4" />
                    )}
                  </button>
                  <span className="w-7 text-center text-base font-semibold tabular-nums">{line.quantity}</span>
                  <button
                    type="button"
                    aria-label={`One more ${lineLabel(line)}`}
                    disabled={state.busy}
                    className={stepperClass}
                    onClick={() =>
                      void state.act((current) =>
                        client.updateLine(scope, current, line.id, { quantity: line.quantity + 1 }),
                      )
                    }
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
            <p className="flex items-baseline justify-between">
              <span className="text-base font-semibold">Total</span>
              <span className="text-xl font-semibold tabular-nums">{formatPeso(open.total)}</span>
            </p>
            <button
              type="button"
              disabled={lines.length === 0 || state.busy}
              onClick={() => setSheet('hold')}
              className={cn(buttonClass('primary'), 'h-14 rounded-2xl text-base')}
            >
              <Hand aria-hidden="true" className="size-5" />
              {isHeld ? 'Save and hold' : 'Hold for the cashier'}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              The cashier sees it at once, and takes the payment.
            </p>
          </div>
        </section>
      ) : null}

      <VariantPicker
        item={variantItem}
        stock={state.stock}
        onPick={(variantId) => {
          if (variantItem) void add(variantItem.id, variantId);
        }}
        onClose={() => setVariantItem(null)}
      />
      <ReferenceDialog
        open={sheet === 'hold'}
        title="Hold for the cashier"
        label="Order reference (optional)"
        hint="Tells held orders apart: “table 3”, “red cap”. The cashier finds the order by it."
        initial={open?.label ?? ''}
        options={state.referenceOptions}
        held={state.pending}
        currentId={open?.id ?? null}
        phone={phone}
        confirmLabel="Hold"
        onSave={async (label) => {
          const held = await state.act((current) => client.hold(scope, current, label || null));
          if (!held) return;
          state.clear();
          setSheet('none');
          setNotice(`Held ${held.label ? `“${held.label}”` : 'the order'} — the cashier sees it now.`);
        }}
        onClose={() => setSheet(open ? 'order' : 'none')}
      />
      <ReferenceDialog
        open={sheet === 'reference'}
        title="Order reference"
        label="Reference (optional)"
        hint="Letters or numbers: “table 5”, “T12”, “pickup 3”. Empty removes it."
        initial={open?.label ?? ''}
        options={state.referenceOptions}
        held={state.pending}
        currentId={open?.id ?? null}
        phone={phone}
        confirmLabel="Save reference"
        onSave={async (reference) => {
          const done = await state.act((current) => client.setLabel(scope, current, reference.trim() || null));
          if (done) setSheet('order');
        }}
        onClose={() => setSheet('order')}
      />
    </div>
  );
}

/** A thumb-sized + / − beside a line. */
const stepperClass =
  'flex size-11 shrink-0 items-center justify-center rounded-full border border-border active:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** One category: a heading that opens and closes, and its items under it. */
function ItemGroupSection({
  group,
  expanded,
  onToggle,
  state,
  onPick,
}: {
  group: PosItemGroup;
  expanded: boolean;
  onToggle: () => void;
  state: TillState;
  onPick: (itemId: string) => void;
}) {
  const listId = useId();
  const lines = state.order?.status === 'open' ? state.order.lines : [];
  const onOrder = group.items.reduce((sum, item) => sum + countOnOrder(lines, item.id), 0);
  return (
    <section aria-label={group.name} className="rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-2 rounded-xl px-3 text-left active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn('size-5 shrink-0 text-muted-foreground transition-transform', expanded ? null : '-rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{group.name}</span>
        {onOrder > 0 ? (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
            {onOrder} on order
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground tabular-nums">{group.items.length}</span>
      </button>
      {expanded ? (
        <ul id={listId} className="grid gap-2 px-2 pb-2 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {group.items.map((item) => (
            <li key={item.id}>
              <ItemRow
                name={item.name}
                description={item.description}
                price={priceRange(item)}
                sizes={item.variants.some((variant) => variant.archivedAt === null)}
                onOrder={countOnOrder(lines, item.id)}
                left={tileLeft(state.stock, item)}
                disabled={state.busy}
                onPick={() => onPick(item.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** An item to tap: its name, price and sizes, and how many are on the order already. */
function ItemRow({
  name,
  description = null,
  price,
  sizes,
  onOrder,
  left,
  disabled,
  onPick,
}: {
  name: string;
  description?: string | null;
  price: { min: number; max: number };
  /** True when tapping opens the sizes (variants) to pick from. */
  sizes: boolean;
  onOrder: number;
  left: number | null;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 rounded-xl border bg-background px-3 py-2 text-left active:bg-accent disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        onOrder > 0 ? 'border-primary' : 'border-border',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-medium">{name}</span>
          <StockBadge left={left} />
        </span>
        {description ? <span className="block truncate text-xs text-muted-foreground">{description}</span> : null}
        <span className="block text-sm tabular-nums text-muted-foreground">
          {price.min === price.max ? formatPeso(price.min) : `${formatPeso(price.min)}–${formatPeso(price.max)}`}
          {sizes ? ' · choose size ›' : ''}
        </span>
      </span>
      {onOrder > 0 ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums">
          {onOrder}
          <span className="sr-only"> on the order</span>
        </span>
      ) : (
        <Plus aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
