'use client';

import { cn } from '@kwtech/web-ui/react';
import {
  Ban,
  Hand,
  Keyboard,
  ListOrdered,
  Minus,
  Percent,
  Plus,
  Printer,
  RefreshCw,
  StickyNote,
  Trash2,
  User,
} from 'lucide-react';
import { type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { type PosSearchResult, parseQuantityPrefix, searchItems } from '../../domain/search.js';
import type { PosItemView, PosOrderLineView, PosOrderView } from '../pos-client.js';
import type { TillState } from '../use-till.js';
import { keyOfPress, meaningOf, nextLine, type TillZone } from '../view/keys.js';
import { formatPercent, formatPeso } from '../view/money.js';
import { receiptHtml } from '../view/receipt.js';
import {
  gridCategories,
  gridItems,
  itemCount,
  lineLabel,
  priceNow,
  priceRange,
  searchCatalogue,
} from '../view/till.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { CustomerDialog, DiscountDialog, PendingDialog, TextDialog, VariantPicker } from './dialogs.js';
import { PaymentDialog } from './payment-dialog.js';
import { ShortcutBar, ShortcutHelp } from './shortcuts.js';

type Dialog =
  | { kind: 'none' }
  | { kind: 'variant'; item: PosItemView; quantity: number }
  | { kind: 'customer' }
  | { kind: 'pay' }
  | { kind: 'pending' }
  | { kind: 'hold' }
  | { kind: 'cancel' }
  | { kind: 'note'; line: PosOrderLineView }
  | { kind: 'lineDiscount'; line: PosOrderLineView }
  | { kind: 'orderDiscount' }
  | { kind: 'help' };

/**
 * Sell (D23): search and the item grid on one side, the order on the other —
 * side by side when the panel is wide, stacked when narrow (a container query,
 * because a grid cell on the Apps page is narrow on a wide screen).
 *
 * Laid out for the counter: the search box has focus, Enter adds the best
 * match (an exact code wins, D19), "100*" sets the quantity first (D20), and
 * every act's answer is the order as the server now holds it.
 */
export function Till({ state }: { state: TillState }) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  /** The line the cart's keys act on (D20); null while the cashier is in search. */
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<HTMLUListElement>(null);
  const searchId = useId();
  const { catalogue, order, client, scope } = state;
  const open = order?.status === 'open' ? order : null;
  const finished = order && order.status !== 'open' ? order : null;

  const searchable = useMemo(() => (catalogue ? searchCatalogue(catalogue) : []), [catalogue]);
  const parsed = parseQuantityPrefix(query);
  const quantity = 'refused' in parsed ? null : parsed.quantity;
  const results: PosSearchResult[] = 'refused' in parsed ? [] : searchItems(searchable, parsed.text);

  const lines = open?.lines ?? [];
  const selectedLine = lines.find((line) => line.id === selectedLineId) ?? null;
  // A removed line, or a new order, leaves the cart: the keys go back to search.
  useEffect(() => {
    if (selectedLineId && !selectedLine) setSelectedLineId(null);
  }, [selectedLineId, selectedLine]);

  const zone = tillZone(dialog, finished !== null, selectedLine !== null);

  const toSearch = () => {
    setSelectedLineId(null);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const close = () => {
    setDialog({ kind: 'none' });
    // D20: focus always has a home — the line being worked on, or search.
    if (selectedLineId) requestAnimationFrame(() => cartRef.current?.focus());
    else requestAnimationFrame(() => searchRef.current?.focus());
  };

  const add = async (itemId: string, variantId: string | null, count: number) => {
    const done = await state.act((current) => client.addLine(scope, current, itemId, variantId, count), {
      create: true,
    });
    if (done) setQuery('');
    close();
  };

  const pick = (itemId: string, variantId: string | null, count: number) => {
    const item = catalogue?.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (!variantId && item.variants.some((variant) => variant.archivedAt === null)) {
      setDialog({ kind: 'variant', item, quantity: count });
      return;
    }
    void add(itemId, variantId, count);
  };

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // ↑ from an empty search enters the cart at the line just added (D20).
    if (event.key === 'ArrowUp' && query === '' && lines.length > 0) {
      event.preventDefault();
      setSelectedLineId(
        nextLine(
          lines.map((line) => line.id),
          null,
          'up',
        ),
      );
      requestAnimationFrame(() => cartRef.current?.focus());
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const best = results[0];
    if (!best || quantity === null) return;
    pick(best.itemId, best.variantId, quantity);
  };

  /** Does what a hot key means here (D18). False when it meant nothing, so the key is left alone. */
  const perform = (meaning: ReturnType<typeof meaningOf>): boolean => {
    if (!meaning) return false;
    if (meaning.kind === 'item') {
      pick(meaning.itemId, meaning.variantId, 1);
      return true;
    }
    const line = selectedLine;
    switch (meaning.action) {
      case 'search':
      case 'backToSearch':
        toSearch();
        return true;
      case 'hold':
        if (lines.length > 0) setDialog({ kind: 'hold' });
        return true;
      case 'customer':
        setDialog({ kind: 'customer' });
        return true;
      case 'pending':
        setDialog({ kind: 'pending' });
        return true;
      case 'pay':
        if (lines.length > 0) setDialog({ kind: 'pay' });
        return true;
      case 'help':
        setDialog({ kind: 'help' });
        return true;
      case 'quantityUp':
        if (line) {
          void state.act((current) => client.updateLine(scope, current, line.id, { quantity: line.quantity + 1 }));
        }
        return true;
      case 'quantityDown':
        if (line && line.quantity > 1) {
          void state.act((current) => client.updateLine(scope, current, line.id, { quantity: line.quantity - 1 }));
        }
        return true;
      case 'removeLine':
        if (line) void state.act((current) => client.removeLine(scope, current, line.id));
        return true;
      case 'lineNote':
        if (line) setDialog({ kind: 'note', line });
        return true;
      case 'lineDiscount':
        if (line && state.canDiscount) setDialog({ kind: 'lineDiscount', line });
        return true;
      case 'orderDiscount':
        if (lines.length > 0 && state.canDiscount) setDialog({ kind: 'orderDiscount' });
        return true;
      case 'print':
        if (finished) printHtml(receiptHtml(finished, { timeZone: state.timeZone }));
        return true;
      case 'payCash':
      case 'payEwallet':
      case 'payCard':
      case 'keepTip':
      case 'changeOwed':
      case 'payLater':
        // The payment dialog handles its own keys.
        return false;
    }
  };

  /**
   * ⚠ ONE HANDLER, ON THE TILL — never the page. The Apps page can show the
   * queue beside the POS, and the queue takes Space page-wide; keys that act
   * only while focus is inside this panel can never fight it (D18).
   */
  const onTillKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (zone === 'cart' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const next = nextLine(
        lines.map((one) => one.id),
        selectedLineId,
        event.key === 'ArrowUp' ? 'up' : 'down',
      );
      if (next) setSelectedLineId(next);
      else toSearch();
      return;
    }
    if (zone === 'cart' && event.key === 'Escape') {
      event.preventDefault();
      toSearch();
      return;
    }
    const target = event.target as HTMLElement;
    const key = keyOfPress(event);
    // In a text field other than search, only function keys act: typing a note types (D20).
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (typing && target !== searchRef.current && !/(^|\+)F\d/u.test(key ?? '')) return;
    if (perform(meaningOf(key, zone, state.keymap))) event.preventDefault();
  };

  if (!state.canSell) {
    return (
      <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        You can see this store’s orders, but your role or your organization’s plan does not include selling.
      </p>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the till's keys (D18); every control inside is a real button or field.
    <div className="flex min-h-0 flex-1 flex-col gap-2" onKeyDown={onTillKey}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 @3xl:flex-row">
        {/* ── search and the grid ─────────────────────────────────────────── */}
        <section aria-label="Items" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <label className="sr-only" htmlFor={searchId}>
            Search items
          </label>
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            autoComplete="off"
            // biome-ignore lint/a11y/noAutofocus: the till's search is where a cashier starts every sale (D20).
            autoFocus
            placeholder="Search or scan · 100* for quantity"
            className={cn(INPUT_CLASS, 'h-11 text-base')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
          {'refused' in parsed ? (
            <p role="alert" className="text-xs text-destructive">
              A quantity is a whole number from 1 to 9999.
            </p>
          ) : null}

          {query.trim() && !('refused' in parsed) && parsed.text.trim() ? (
            <SearchResults results={results} quantity={quantity ?? 1} onPick={pick} />
          ) : (
            <ItemGrid
              state={state}
              categoryId={categoryId}
              onCategory={setCategoryId}
              onPick={(id) => pick(id, null, quantity ?? 1)}
            />
          )}
        </section>

        {/* ── the order ───────────────────────────────────────────────────── */}
        <section
          aria-label="Order"
          className="flex min-h-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 @3xl:w-[22rem] @3xl:shrink-0"
        >
          {finished ? (
            <Receipt
              order={finished}
              timeZone={state.timeZone}
              onNext={() => {
                state.clear();
                close();
              }}
            />
          ) : (
            <Cart
              order={open}
              state={state}
              searchRef={searchRef}
              cartRef={cartRef}
              selectedLineId={selectedLineId}
              onSelect={setSelectedLineId}
              onDialog={setDialog}
            />
          )}
        </section>

        <VariantPicker
          item={dialog.kind === 'variant' ? dialog.item : null}
          onPick={(variantId) => {
            if (dialog.kind === 'variant') void add(dialog.item.id, variantId, dialog.quantity);
          }}
          onClose={close}
        />
        <CustomerDialog open={dialog.kind === 'customer'} state={state} onClose={close} />
        <PaymentDialog
          open={dialog.kind === 'pay'}
          order={open}
          state={state}
          keymap={state.keymap}
          onPaid={() => close()}
          onClose={close}
        />
        <PendingDialog
          open={dialog.kind === 'pending'}
          pending={state.pending}
          currentId={open?.id ?? null}
          onResume={(orderId) => {
            void state.resume(orderId);
            close();
          }}
          onClose={close}
        />
        <TextDialog
          open={dialog.kind === 'hold'}
          title="Hold this order"
          label="Label (optional)"
          hint="Tells held orders apart: “table 3”, “red cap”."
          initial={open?.label ?? ''}
          confirmLabel="Hold"
          onSave={async (label) => {
            const held = await state.act((current) => client.setLabel(scope, current, label || null));
            if (held) state.clear();
            close();
          }}
          onClose={close}
        />
        <TextDialog
          open={dialog.kind === 'cancel'}
          title="Cancel this order"
          label="Reason"
          hint="Kept on the record, with your name: “changed their mind”."
          initial=""
          required={(open?.lines.length ?? 0) > 0}
          confirmLabel="Cancel order"
          danger
          onSave={async (reason) => {
            const cancelled = await state.act((current) => client.cancel(scope, current, reason || null));
            if (cancelled) state.clear();
            close();
          }}
          onClose={close}
        />
        <TextDialog
          open={dialog.kind === 'note'}
          title="Line note"
          label="Note"
          hint="“no ice”, “rush”, “for pickup” — printed on the receipt."
          initial={dialog.kind === 'note' ? (dialog.line.note ?? '') : ''}
          confirmLabel="Save note"
          onSave={async (note) => {
            if (dialog.kind !== 'note') return;
            await state.act((current) => client.updateLine(scope, current, dialog.line.id, { note }));
            close();
          }}
          onClose={close}
        />
        <DiscountDialog
          open={dialog.kind === 'lineDiscount'}
          title={dialog.kind === 'lineDiscount' ? `Discount — ${lineLabel(dialog.line)}` : 'Discount'}
          current={dialog.kind === 'lineDiscount' ? dialog.line.discount : null}
          onSave={async (discount) => {
            if (dialog.kind !== 'lineDiscount') return;
            const done = await state.act((current) => client.setLineDiscount(scope, current, dialog.line.id, discount));
            if (done) close();
          }}
          onClose={close}
        />
        <DiscountDialog
          open={dialog.kind === 'orderDiscount'}
          title="Discount on the whole order"
          current={open?.discount ?? null}
          onSave={async (discount) => {
            const done = await state.act((current) => client.setOrderDiscount(scope, current, discount));
            if (done) close();
          }}
          onClose={close}
        />
        <ShortcutHelp open={dialog.kind === 'help'} state={state} onClose={close} />
      </div>
      <ShortcutBar zone={zone} state={state} onPress={(key) => perform(meaningOf(key, zone, state.keymap))} />
    </div>
  );
}

function SearchResults({
  results,
  quantity,
  onPick,
}: {
  results: readonly PosSearchResult[];
  quantity: number;
  onPick: (itemId: string, variantId: string | null, quantity: number) => void;
}) {
  if (results.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-muted-foreground">No item matches that. Check the spelling or the code.</p>
    );
  }
  return (
    <ul aria-label="Matches" className="flex min-h-0 flex-col gap-1 overflow-y-auto">
      {results.map((result, index) => (
        <li key={`${result.itemId}:${result.variantId ?? ''}`}>
          <button
            type="button"
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              index === 0 && 'border-primary',
            )}
            onClick={() => onPick(result.itemId, result.variantId, quantity)}
          >
            <span className="min-w-0 truncate">
              {result.label}
              {result.opensPicker ? ' ▾' : ''}
              {result.code ? <span className="ml-2 text-xs text-muted-foreground">{result.code}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {result.price.min === result.price.max
                ? formatPeso(result.price.min)
                : `${formatPeso(result.price.min)}–${formatPeso(result.price.max)}`}
            </span>
          </button>
        </li>
      ))}
      {results.length > 0 ? (
        <li className="px-1 text-xs text-muted-foreground">
          Enter adds the first{quantity > 1 ? ` × ${quantity}` : ''}.
        </li>
      ) : null}
    </ul>
  );
}

function ItemGrid({
  state,
  categoryId,
  onCategory,
  onPick,
}: {
  state: TillState;
  categoryId: string | null;
  onCategory: (id: string | null) => void;
  onPick: (itemId: string) => void;
}) {
  const { catalogue } = state;
  if (!catalogue) return <p className="text-sm text-muted-foreground">Loading items…</p>;
  const items = gridItems(catalogue, categoryId);
  const categories = gridCategories(catalogue);
  if (catalogue.items.length === 0) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        This store has no items yet. Somebody who manages items adds them under Items.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {categories.length > 0 ? (
        <div role="tablist" aria-label="Categories" className="flex flex-wrap gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={categoryId === null}
            className={buttonClass(categoryId === null ? 'primary' : 'ghost', 'sm')}
            onClick={() => onCategory(null)}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={categoryId === category.id}
              className={buttonClass(categoryId === category.id ? 'primary' : 'ghost', 'sm')}
              onClick={() => onCategory(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto @md:grid-cols-3 @5xl:grid-cols-4">
        {items.map((item) => {
          const range = priceRange(item);
          const hasVariants = item.variants.some((variant) => variant.archivedAt === null);
          return (
            <li key={item.id}>
              <button
                type="button"
                className="flex h-full w-full flex-col items-start gap-1 rounded-md border border-border bg-background p-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onPick(item.id)}
                title={item.description ?? undefined}
              >
                <span className="line-clamp-2 text-sm font-medium">{item.name}</span>
                {item.description ? (
                  <span className="line-clamp-2 text-xs text-muted-foreground">{item.description}</span>
                ) : null}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {range.min === range.max
                    ? formatPeso(range.min)
                    : `${formatPeso(range.min)}–${formatPeso(range.max)}`}
                  {hasVariants ? ' ▾' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Cart({
  order,
  state,
  searchRef,
  cartRef,
  selectedLineId,
  onSelect,
  onDialog,
}: {
  order: PosOrderView | null;
  state: TillState;
  searchRef: RefObject<HTMLInputElement | null>;
  cartRef: RefObject<HTMLUListElement | null>;
  selectedLineId: string | null;
  onSelect: (lineId: string | null) => void;
  onDialog: (dialog: Dialog) => void;
}) {
  const { client, scope } = state;
  const lines = order?.lines ?? [];

  return (
    <>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {order ? (order.label ?? 'Order') : 'New order'}
          {lines.length > 0 ? (
            <span className="ml-1 font-normal text-muted-foreground">· {itemCount(lines)} items</span>
          ) : null}
        </h2>
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          className={cn(buttonClass('ghost', 'sm'), 'ml-auto')}
          onClick={() => onDialog({ kind: 'help' })}
        >
          <Keyboard aria-hidden="true" className="size-3.5" />
        </button>
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => onDialog({ kind: 'pending' })}>
          <ListOrdered aria-hidden="true" className="size-3.5" />
          Pending{state.pending.length > 0 ? ` (${state.pending.length})` : ''}
        </button>
      </header>

      <button
        type="button"
        className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onDialog({ kind: 'customer' })}
      >
        <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {order?.customerName ? (
          <span className="min-w-0 truncate">
            {order.customerName}
            {order.customerContact ? <span className="text-muted-foreground"> · {order.customerContact}</span> : null}
            {order.customerId ? null : <span className="ml-1 text-xs text-muted-foreground">(walk-in)</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">Walk-in — add a customer</span>
        )}
      </button>

      {lines.length === 0 ? (
        <p className="flex-1 py-6 text-center text-sm text-muted-foreground">Search or tap an item to start.</p>
      ) : (
        <ul
          ref={cartRef}
          aria-label="Lines"
          // Focusable, so the cart's keys (+ − Delete D N) reach the till's handler, not the search box.
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {lines.map((line) => {
            const now = priceNow(line, state.catalogue);
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: a click selects the line; the keyboard selects with ↑ ↓.
              <li
                key={line.id}
                aria-current={line.id === selectedLineId ? 'true' : undefined}
                className={cn(
                  'flex flex-col gap-1 px-1 py-2',
                  line.id === selectedLineId && 'rounded-md bg-accent text-accent-foreground',
                )}
                onClick={() => onSelect(line.id)}
              >
                <div className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0">{lineLabel(line)}</span>
                  <span className="shrink-0 tabular-nums">{formatPeso(line.total)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <button
                    type="button"
                    aria-label={`One fewer ${lineLabel(line)}`}
                    className={buttonClass('ghost', 'sm')}
                    disabled={state.busy}
                    onClick={() =>
                      void state.act((current) =>
                        line.quantity > 1
                          ? client.updateLine(scope, current, line.id, { quantity: line.quantity - 1 })
                          : client.removeLine(scope, current, line.id),
                      )
                    }
                  >
                    <Minus aria-hidden="true" className="size-3" />
                  </button>
                  <span className="tabular-nums">
                    {line.quantity} × {formatPeso(line.unitPrice)}
                  </span>
                  <button
                    type="button"
                    aria-label={`One more ${lineLabel(line)}`}
                    className={buttonClass('ghost', 'sm')}
                    disabled={state.busy}
                    onClick={() =>
                      void state.act((current) =>
                        client.updateLine(scope, current, line.id, { quantity: line.quantity + 1 }),
                      )
                    }
                  >
                    <Plus aria-hidden="true" className="size-3" />
                  </button>
                  <span className="ml-auto flex gap-0.5">
                    <button
                      type="button"
                      aria-label="Line note"
                      className={buttonClass('ghost', 'sm')}
                      onClick={() => onDialog({ kind: 'note', line })}
                    >
                      <StickyNote aria-hidden="true" className="size-3" />
                    </button>
                    {state.canDiscount ? (
                      <button
                        type="button"
                        aria-label="Line discount"
                        className={buttonClass('ghost', 'sm')}
                        onClick={() => onDialog({ kind: 'lineDiscount', line })}
                      >
                        <Percent aria-hidden="true" className="size-3" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove ${lineLabel(line)}`}
                      className={buttonClass('ghost', 'sm')}
                      disabled={state.busy}
                      onClick={() => void state.act((current) => client.removeLine(scope, current, line.id))}
                    >
                      <Trash2 aria-hidden="true" className="size-3" />
                    </button>
                  </span>
                </div>
                {line.discount ? (
                  <p className="text-xs text-muted-foreground">
                    {line.discount.kind === 'percent' ? formatPercent(line.discount.value) : 'Discount'} (
                    {line.discount.reason}) −{formatPeso(line.discountAmount)}
                  </p>
                ) : null}
                {line.note ? <p className="text-xs italic text-muted-foreground">Note: {line.note}</p> : null}
                {now !== null ? (
                  <p className="flex w-fit items-center gap-1 rounded-md bg-status-warning px-1.5 text-xs text-status-warning-foreground">
                    Price is now {formatPeso(now)}
                    <button
                      type="button"
                      className={buttonClass('ghost', 'sm')}
                      onClick={() => void state.act((current) => client.refreshLine(scope, current, line.id))}
                    >
                      <RefreshCw aria-hidden="true" className="size-3" />
                      Update
                    </button>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <dl className="grid grid-cols-2 gap-y-0.5 border-t border-border pt-2 text-sm tabular-nums">
        {order && order.lineDiscounts + order.orderDiscount > 0 ? (
          <>
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right text-muted-foreground">{formatPeso(order.gross)}</dd>
            <dt className="text-muted-foreground">Discounts</dt>
            <dd className="text-right text-muted-foreground">
              −{formatPeso(order.lineDiscounts + order.orderDiscount)}
            </dd>
          </>
        ) : null}
        <dt className="text-base font-semibold">Total</dt>
        <dd className="text-right text-xl font-semibold">{formatPeso(order?.total ?? 0)}</dd>
      </dl>

      <div className="flex flex-wrap gap-1.5">
        {state.canDiscount ? (
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            disabled={lines.length === 0}
            onClick={() => onDialog({ kind: 'orderDiscount' })}
          >
            <Percent aria-hidden="true" className="size-3.5" />
            {order?.discount ? 'Order discount ✓' : 'Order discount'}
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          disabled={!order}
          onClick={() => onDialog({ kind: 'cancel' })}
        >
          <Ban aria-hidden="true" className="size-3.5" />
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button
          type="button"
          className={buttonClass('secondary')}
          disabled={lines.length === 0 || state.busy}
          onClick={() => onDialog({ kind: 'hold' })}
        >
          <Hand aria-hidden="true" className="size-4" />
          Hold
        </button>
        <button
          type="button"
          className={cn(buttonClass('primary'), 'h-11 text-base')}
          disabled={lines.length === 0 || state.busy}
          onClick={() => onDialog({ kind: 'pay' })}
        >
          Pay {formatPeso(order?.total ?? 0)}
        </button>
      </div>
      {/* Keeps the search box reachable for a mouse user who clicked into the cart. */}
      <button type="button" className="sr-only" onClick={() => searchRef.current?.focus()}>
        Back to search
      </button>
    </>
  );
}

/** The finished order: paid, or released unpaid. Print, then the next customer. */
function Receipt({ order, timeZone, onNext }: { order: PosOrderView; timeZone: string; onNext: () => void }) {
  const unpaid = order.status === 'unpaid';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p
        role="status"
        className={cn(
          'w-fit rounded-md px-2 py-0.5 text-sm font-semibold',
          unpaid
            ? 'bg-status-warning text-status-warning-foreground'
            : 'bg-status-success text-status-success-foreground',
        )}
      >
        {unpaid ? `Order #${order.number} — unpaid` : `Order #${order.number} — paid`}
      </p>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto text-sm">
        {order.lines.map((line) => (
          <li key={line.id} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {line.quantity} × {lineLabel(line)}
            </span>
            <span className="tabular-nums">{formatPeso(line.total)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-y-0.5 border-t border-border pt-2 text-sm tabular-nums">
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">{formatPeso(order.total)}</dd>
        {order.received !== null ? (
          <>
            <dt>Received</dt>
            <dd className="text-right">{formatPeso(order.received)}</dd>
          </>
        ) : null}
        {(order.change ?? 0) > 0 ? (
          <>
            <dt className="text-base font-semibold">Change</dt>
            <dd className="text-right text-xl font-semibold">{formatPeso(order.change ?? 0)}</dd>
          </>
        ) : null}
        {order.tip > 0 ? (
          <>
            <dt>Tip</dt>
            <dd className="text-right">{formatPeso(order.tip)}</dd>
          </>
        ) : null}
        {order.changeOwed > 0 ? (
          <>
            <dt className="font-medium">Change owed</dt>
            <dd className="text-right font-medium">{formatPeso(order.changeOwed)}</dd>
          </>
        ) : null}
      </dl>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button
          type="button"
          className={buttonClass('secondary')}
          onClick={() => printHtml(receiptHtml(order, { timeZone }))}
        >
          <Printer aria-hidden="true" className="size-4" />
          Print
        </button>
        <button
          type="button"
          // biome-ignore lint/a11y/noAutofocus: after a sale, Enter starts the next one (D18).
          autoFocus
          className={cn(buttonClass('primary'), 'h-11 text-base')}
          onClick={onNext}
        >
          Next order
        </button>
      </div>
    </div>
  );
}

/**
 * Prints HTML through a hidden frame: only the receipt prints, never the Apps
 * page and the other apps open on it. Removed once the print dialog closes.
 */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

/** Where the cashier is, for the keys and the bar (`TillZone`). */
function tillZone(dialog: Dialog, finished: boolean, lineSelected: boolean): TillZone {
  if (dialog.kind === 'pay') return 'payment';
  if (dialog.kind !== 'none') return 'dialog';
  if (finished) return 'receipt';
  return lineSelected ? 'cart' : 'search';
}
