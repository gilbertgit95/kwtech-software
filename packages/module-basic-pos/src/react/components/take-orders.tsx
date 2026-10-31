'use client';

import { BottomSheet, cn } from '@kwtech/web-ui/react';
import { Ban, ChevronDown, Hand, Hash, Info, Minus, Plus, ToggleRight, Trash2, User } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { isPosItemAvailable, isPosVariantAvailable } from '../../domain/availability.js';
import { searchItems } from '../../domain/search.js';
import type { PosItemView } from '../pos-client.js';
import { useNow } from '../use-now.js';
import type { TillState } from '../use-till.js';
import { formatPeso } from '../view/money.js';
import { leftOf, stockWarning, tileLeft } from '../view/stock.js';
import {
  canLeaveOrder,
  countOnOrder,
  hasMoreToRead,
  heldOrderTitle,
  initiallyOpenGroups,
  itemGroups,
  type PosItemGroup,
  waitMinutes,
} from '../view/take-orders.js';
import { itemCount, lineLabel, pickerVariants, priceRange, searchCatalogue } from '../view/till.js';
import { AvailabilityPanel } from './availability-panel.js';
import {
  buttonClass,
  INPUT_CLASS,
  Modal,
  PhoneDialogs,
  StockBadge,
  UNAVAILABLE_ROW_CLASS,
  UNAVAILABLE_TEXT_CLASS,
  UnavailableBadge,
} from './controls.js';
import { CustomerDialog, ReferenceDialog, VariantPicker } from './dialogs.js';
import { OrderTypePicker } from './order-type-picker.js';
import { WaitBadge } from './wait-badge.js';

type Sheet = 'none' | 'order' | 'hold' | 'reference' | 'customer' | 'availability';

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
  /** The item whose whole text is open (ⓘ), or null. */
  const [detailsItem, setDetailsItem] = useState<PosItemView | null>(null);
  /** Said after an act: "Held Table 5", or a stock warning. One line, dismissed with OK. */
  const [notice, setNotice] = useState<string | null>(null);
  /** A notice that goes by itself — "Ready for a new order" — rather than waiting for OK. */
  const [passingNotice, setPassingNotice] = useState<{ text: string; tap: number } | null>(null);
  useEffect(() => {
    if (!passingNotice) return;
    const timer = setTimeout(() => setPassingNotice(null), PASSING_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [passingNotice]);

  const groups = useMemo(() => (catalogue ? itemGroups(catalogue) : []), [catalogue]);
  /** Which groups are open; null until the seller first taps one, so the default follows the catalogue. */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string> | null>(null);
  const shownGroups = openGroups ?? initiallyOpenGroups(groups);
  const searchable = useMemo(() => (catalogue ? searchCatalogue(catalogue) : []), [catalogue]);
  const results = query.trim() ? searchItems(searchable, query) : [];
  const isHeld = open !== null && state.pending.some((one) => one.id === open.id);

  /** ⓘ for a search result: only for an item with more to read than its row shows. */
  const detailsFor = (itemId: string) => {
    const item = catalogue?.items.find((candidate) => candidate.id === itemId);
    return item && hasMoreToRead(item) ? () => setDetailsItem(item) : undefined;
  };

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
    // The rows are greyed out and cannot be tapped, but a list re-read under the thumb can still land here (issue #37).
    const variant = variantId ? item.variants.find((candidate) => candidate.id === variantId) : null;
    if (!isPosItemAvailable(item) || (variant && !isPosVariantAvailable(item, variant))) {
      setNotice(`${variant ? `${item.name} — ${variant.name}` : item.name} is marked not available.`);
      return;
    }
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
    /*
     * ⚠ EVERY TAP ANSWERS (the operator, 2026-10-29): starting fresh changes
     * nothing on screen when it already is fresh, and a tap that does nothing
     * reads as a disabled button. A word that goes by itself, and a tick of
     * vibration where the phone has one.
     */
    setNotice(null);
    // A new object each tap, so a second tap restarts the notice's timer.
    setPassingNotice((last) => ({
      text: 'Ready for a new order — tap an item to start.',
      tap: (last?.tap ?? 0) + 1,
    }));
    tapFeedback();
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
    // On a phone every dialog here is a bottom sheet (customer, reference, sizes, hold).
    <PhoneDialogs on={phone}>
      <div className="relative flex min-h-0 flex-1 flex-col gap-3">
        {/* ── held orders ─────────────────────────────────────────────────── */}
        {/*
         * How many wait for payment, at a glance (the operator, 2026-10-29): the
         * chips scroll sideways, so the strip alone never said how many there
         * are. Every held order in the store, live — the Cashier's column's count.
         */}
        <h2 className="-mb-1.5 flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          Waiting for payment
          <span
            className={cn(
              'min-w-5 rounded-full px-1.5 py-0.5 text-center font-semibold tabular-nums',
              state.pending.length > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {state.pending.length}
          </span>
        </h2>
        <nav aria-label="Held orders" className="-mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={newOrder}
            className={cn(
              // ⚠ Looks pressable, and reacts to the press: grey and dashed, it read as disabled (the operator, 2026-10-29).
              'flex min-h-14 shrink-0 flex-col justify-center rounded-xl border-2 px-3 text-left text-sm font-semibold text-primary transition-transform duration-100 active:scale-95 active:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              open && !isHeld ? 'border-primary bg-primary/10' : 'border-primary/40 bg-primary/5',
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

        {passingNotice && !notice ? (
          <p
            role="status"
            className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-foreground motion-safe:animate-in motion-safe:fade-in"
          >
            {passingNotice.text}
          </p>
        ) : null}
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
        <div className="flex shrink-0 gap-2">
          <input
            id={searchId}
            type="search"
            autoComplete="off"
            placeholder="Search items"
            className={cn(INPUT_CLASS, 'h-12 min-w-0 flex-1 rounded-xl text-base')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {state.canSetAvailability ? (
            <button
              type="button"
              className={cn(buttonClass('secondary'), 'h-12 shrink-0 rounded-xl')}
              onClick={() => setSheet('availability')}
            >
              <ToggleRight aria-hidden="true" className="size-5" />
              Availability
            </button>
          ) : null}
        </div>

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
                    unavailable={result.unavailable}
                    disabled={state.busy}
                    onPick={() => {
                      pick(result.itemId, result.variantId);
                      setQuery('');
                    }}
                    onDetails={detailsFor(result.itemId)}
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
                  onDetails={setDetailsItem}
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

        {/*
         * ── the order, as a BOTTOM SHEET ──────────────────────────────────────
         * It rises from the bottom, has a handle, swipes down or taps outside to
         * close — the phone's way (the operator, 2026-10-29); it was a panel laid
         * over the items, which felt like the desktop. Its customer, reference and
         * hold dialogs open as sheets over it (`PhoneDialogs`), and it stays open
         * under them.
         */}
        <BottomSheet
          open={sheet !== 'none' && open !== null}
          onClose={() => setSheet('none')}
          title={open ? (open.label ?? (isHeld ? 'Held order' : 'New order')) : 'Order'}
          footer={
            open ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-baseline justify-between">
                  <span className="text-base font-semibold">Total</span>
                  <span className="text-xl font-semibold tabular-nums">{formatPeso(open.total)}</span>
                </p>
                <button
                  type="button"
                  disabled={lines.length === 0 || state.busy}
                  onClick={() => setSheet('hold')}
                  className={cn(buttonClass('primary'), 'h-14 w-full rounded-2xl text-base')}
                >
                  <Hand aria-hidden="true" className="size-5" />
                  {isHeld ? 'Save and hold' : 'Hold for the cashier'}
                </button>
                <p className="text-center text-xs text-muted-foreground">
                  The cashier sees it at once, and takes the payment.
                </p>
              </div>
            ) : null
          }
        >
          {open ? (
            <div className="flex flex-col gap-3 px-2 pb-2">
              {/* Inside the order only, never on the items screen (the operator, 2026-10-29). */}
              <OrderTypePicker state={state} order={open} large labelled />

              {/*
               * The customer and the reference, both optional, as on the classic till (the operator,
               * 2026-10-29): the same dashed boxes and the same dialogs, sized for a thumb.
               */}
              <button type="button" className={detailBoxClass} onClick={() => setSheet('customer')}>
                <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {open.customerName ? (
                  <span className="min-w-0 truncate">
                    {open.customerName}
                    {open.customerContact ? (
                      <span className="text-muted-foreground"> · {open.customerContact}</span>
                    ) : null}
                    {open.customerId ? null : <span className="ml-1 text-xs text-muted-foreground">(walk-in)</span>}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Walk-in — add a customer</span>
                )}
              </button>
              <button type="button" className={detailBoxClass} onClick={() => setSheet('reference')}>
                <Hash aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {open.label ? (
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground">Reference:</span> {open.label}
                  </span>
                ) : (
                  <span className="text-muted-foreground">No reference — add one (table no., tag…)</span>
                )}
              </button>

              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing on this order yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
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
            </div>
          ) : null}
        </BottomSheet>

        <ItemDetailsSheet
          item={detailsItem}
          state={state}
          onOrder={detailsItem ? countOnOrder(lines, detailsItem.id) : 0}
          onAdd={(variantId) => {
            const item = detailsItem;
            setDetailsItem(null);
            if (item) void add(item.id, variantId);
          }}
          onClose={() => setDetailsItem(null)}
        />
        <Modal open={sheet === 'availability'} title="Availability" wide onClose={() => setSheet('none')}>
          {catalogue ? <AvailabilityPanel state={state} catalogue={catalogue} /> : null}
        </Modal>
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
        <CustomerDialog open={sheet === 'customer'} state={state} onClose={() => setSheet('order')} />
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
    </PhoneDialogs>
  );
}

/** How long a passing notice ("Ready for a new order") stays. */
const PASSING_NOTICE_MS = 2500;

/**
 * A tick of vibration for a tap that changes little on screen, where the
 * phone has one (Android; iOS Safari has no `vibrate`, and gets the notice
 * alone). Never a reason to fail the tap.
 */
function tapFeedback(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    // No vibration here: the notice says it.
  }
}

/** The customer's and the reference's boxes in the order: the classic till's dashed box, a thumb tall. */
const detailBoxClass =
  'flex min-h-12 w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 text-left text-sm active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
  onDetails,
}: {
  group: PosItemGroup;
  expanded: boolean;
  onToggle: () => void;
  state: TillState;
  onPick: (itemId: string) => void;
  onDetails: (item: PosItemView) => void;
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
      {/*
       * ⚠ `grid-cols-1`, never a bare `grid`: an implicit column is as wide as
       * its longest item, and one long name or description pushed the whole
       * list past a phone's edge (the operator, 2026-10-29). The `grid-cols-*`
       * columns are `minmax(0, 1fr)`, so the text gives way instead.
       */}
      {expanded ? (
        <ul id={listId} className="grid grid-cols-1 gap-2 px-2 pb-2 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {group.items.map((item) => (
            <li key={item.id}>
              <ItemRow
                name={item.name}
                description={item.description}
                price={priceRange(item)}
                sizes={item.variants.some((variant) => variant.archivedAt === null)}
                onOrder={countOnOrder(lines, item.id)}
                left={tileLeft(state.stock, item)}
                unavailable={!isPosItemAvailable(item)}
                disabled={state.busy}
                onPick={() => onPick(item.id)}
                onDetails={hasMoreToRead(item) ? () => onDetails(item) : undefined}
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
  unavailable,
  disabled,
  onPick,
  onDetails,
}: {
  name: string;
  description?: string | null;
  price: { min: number; max: number };
  /** True when tapping opens the sizes (variants) to pick from. */
  sizes: boolean;
  onOrder: number;
  left: number | null;
  /** Marked not available (issue #37): the row stays, greyed out, and cannot be tapped. */
  unavailable: boolean;
  disabled: boolean;
  onPick: () => void;
  /** Opens the item's whole text (ⓘ); omitted when the row already shows it all (`hasMoreToRead`). */
  onDetails?: (() => void) | undefined;
}) {
  // ⓘ is a button BESIDE the row's, never inside it: a button may not hold another.
  return (
    <div className="flex min-w-0 items-stretch gap-1.5">
      <button
        type="button"
        disabled={disabled || unavailable}
        onClick={onPick}
        className={cn(
          'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border bg-background px-3 py-2 text-left active:bg-accent disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          onOrder > 0 ? 'border-primary' : 'border-border',
          // After `disabled:opacity-70` so its own fade wins while the order is saving too.
          unavailable && cn(UNAVAILABLE_ROW_CLASS, 'disabled:opacity-75'),
        )}
      >
        <span className="min-w-0 flex-1">
          {/*
           * Long text is cut with "…", never widens the row: the name on two
           * lines at most (a word with no spaces breaks too), the description on
           * one. `min-w-0` on each level, or a flex item will not shrink below
           * its text.
           */}
          <span className="flex min-w-0 items-start gap-2">
            <span
              className={cn(
                'line-clamp-2 min-w-0 text-base font-medium [overflow-wrap:anywhere]',
                unavailable && UNAVAILABLE_TEXT_CLASS,
              )}
            >
              {name}
            </span>
            {unavailable ? null : <StockBadge left={left} />}
          </span>
          {description ? (
            <span className="block min-w-0 truncate text-xs text-muted-foreground">{description}</span>
          ) : null}
          {/* The tag on the price's line, not after the name: a name's length would move it on every row. */}
          <span className="flex flex-wrap items-center gap-2 text-sm tabular-nums text-muted-foreground">
            <span className={unavailable ? UNAVAILABLE_TEXT_CLASS : undefined}>
              {price.min === price.max ? formatPeso(price.min) : `${formatPeso(price.min)}–${formatPeso(price.max)}`}
              {sizes && !unavailable ? ' · choose size ›' : ''}
            </span>
            {unavailable ? <UnavailableBadge /> : null}
          </span>
        </span>
        {onOrder > 0 ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums">
            {onOrder}
            <span className="sr-only"> on the order</span>
          </span>
        ) : unavailable ? (
          // No "+": nothing here can be added.
          <Ban aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        ) : (
          <Plus aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        )}
      </button>
      {onDetails ? (
        <button
          type="button"
          aria-label={`About ${name}`}
          onClick={onDetails}
          className="flex w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info aria-hidden="true" className="size-5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * An item's WHOLE text, from ⓘ (the operator, 2026-10-29): the row cuts a
 * long name and the description with "…", and this is where they are read
 * in full — with the price, what is left, and the way to add it: each size,
 * or "Add to order". A bottom sheet on a phone (`PhoneDialogs`).
 */
function ItemDetailsSheet({
  item,
  state,
  onOrder,
  onAdd,
  onClose,
}: {
  item: PosItemView | null;
  state: TillState;
  onOrder: number;
  onAdd: (variantId: string | null) => void;
  onClose: () => void;
}) {
  const variants = item ? pickerVariants(item) : [];
  const onSale = item ? isPosItemAvailable(item) : false;
  const price = item ? priceRange(item) : { min: 0, max: 0 };
  return (
    <Modal open={item !== null} title={item?.name ?? ''} onClose={onClose}>
      {item ? (
        <div className="flex flex-col gap-3 [overflow-wrap:anywhere]">
          {item.description ? <p className="whitespace-pre-line text-sm">{item.description}</p> : null}
          <p className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
            {price.min === price.max ? formatPeso(price.min) : `${formatPeso(price.min)}–${formatPeso(price.max)}`}
            {onSale ? null : <UnavailableBadge />}
            {variants.length === 0 && onSale ? <StockBadge left={leftOf(state.stock, item.id, null)} /> : null}
            {onOrder > 0 ? <span>· {onOrder} on the order</span> : null}
          </p>
          {variants.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {variants.map((variant) => (
                <li key={variant.id}>
                  <button
                    type="button"
                    disabled={state.busy || !isPosVariantAvailable(item, variant)}
                    onClick={() => onAdd(variant.id)}
                    className={cn(
                      'flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 text-left active:bg-accent disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isPosVariantAvailable(item, variant) ? null : cn(UNAVAILABLE_ROW_CLASS, 'disabled:opacity-75'),
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          'min-w-0 font-medium',
                          isPosVariantAvailable(item, variant) ? null : UNAVAILABLE_TEXT_CLASS,
                        )}
                      >
                        {variant.name}
                      </span>
                      {isPosVariantAvailable(item, variant) ? (
                        <StockBadge left={leftOf(state.stock, item.id, variant.id)} />
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {isPosVariantAvailable(item, variant) ? null : <UnavailableBadge />}
                      <span
                        className={cn(
                          'tabular-nums',
                          isPosVariantAvailable(item, variant) ? null : UNAVAILABLE_TEXT_CLASS,
                        )}
                      >
                        {formatPeso(variant.price)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button
              type="button"
              disabled={state.busy || !onSale}
              onClick={() => onAdd(null)}
              className={cn(buttonClass('primary'), 'h-12 w-full rounded-xl text-base')}
            >
              <Plus aria-hidden="true" className="size-5" />
              Add to order
            </button>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
