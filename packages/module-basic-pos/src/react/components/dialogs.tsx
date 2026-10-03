'use client';

import { cn, LIST_ITEM, LIST_KEYS, useDebouncedValue } from '@kwtech/web-ui/react';
import { UserPlus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { posContactAsCustomerFields, posCustomerContactLine } from '../../domain/customers.js';
import type {
  PosCustomerView,
  PosDiscountInput,
  PosDiscountView,
  PosItemView,
  PosOrderSummaryView,
} from '../pos-client.js';
import type { TillState } from '../use-till.js';
import { formatPercent, formatPeso, parsePercent, parsePeso, pesoInputValue } from '../view/money.js';
import { liveVariants, nextOption } from '../view/till.js';
import { buttonClass, Field, INPUT_CLASS, Modal } from './controls.js';

/** The variants of one item, in order (D9). Picking one adds it. */
export function VariantPicker({
  item,
  onPick,
  onClose,
}: {
  item: PosItemView | null;
  onPick: (variantId: string) => void;
  onClose: () => void;
}) {
  const variants = item ? liveVariants(item) : [];
  return (
    <Modal open={item !== null} title={item?.name ?? ''} onClose={onClose}>
      <ul className="flex flex-col gap-1" {...LIST_KEYS}>
        {variants.map((variant, index) => (
          <li key={variant.id}>
            <button
              type="button"
              {...LIST_ITEM}
              // biome-ignore lint/a11y/noAutofocus: The first choice takes focus, so ↓ / Enter work at once (D20).
              autoFocus={index === 0}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onPick(variant.id)}
            >
              <span>{variant.name}</span>
              <span className="tabular-nums text-muted-foreground">{formatPeso(variant.price)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** What the customer search last answered, and for which text — so "no match" is never said of a search still on its way. */
interface CustomerMatches {
  term: string;
  rows: readonly PosCustomerView[];
  failed: boolean;
}

/**
 * Who the order is for (D5): a walk-in (with optional free text), a recorded
 * customer found by name or contact, or a new one saved from what was typed.
 *
 * The name box is a SEARCH-SELECT: what is typed searches the recorded
 * customers, and the matches drop down under it — ↑ ↓ choose, Enter or a
 * click links that customer (the operator, 2026-10-02; before, the matches
 * were a list further down the dialog, easy to miss). What is typed is still
 * the walk-in's name when nothing is picked.
 *
 * ⚠ ENTER LINKS ONLY A CUSTOMER CHOSEN WITH ↑ ↓. Nothing is pre-chosen: a
 * walk-in called "Ana" must not be rung up to the recorded "Ana Cruz" because
 * she was the first match.
 */
export function CustomerDialog({ open, state, onClose }: { open: boolean; state: TillState; onClose: () => void }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [found, setFound] = useState<CustomerMatches | null>(null);
  /** Whether the matches are showing. Typing, ↓ or a click opens them — the dialog opening does not, or they would cover Contact and the buttons before anything was asked. */
  const [listOpen, setListOpen] = useState(false);
  /** The match ↑ ↓ are on, as an index into `matches`; null until one of them is pressed. */
  const [active, setActive] = useState<number | null>(null);
  const settled = useDebouncedValue(name, 250);
  const listId = useId();
  const { client, scope, order } = state;
  const matches = found?.rows ?? [];
  const searching = found?.term !== name;

  useEffect(() => {
    if (!open) return;
    setName(order?.customerId ? '' : (order?.customerName ?? ''));
    setContact(order?.customerId ? '' : (order?.customerContact ?? ''));
    setListOpen(false);
    setActive(null);
  }, [open, order?.customerId, order?.customerName, order?.customerContact]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    client
      .customers(scope, settled)
      .then((rows) => {
        if (cancelled) return;
        setFound({ term: settled, rows, failed: false });
        // The list under the cursor changed: an index kept would point at somebody else.
        setActive(null);
      })
      // The picker is a convenience: without it, typing a walk-in still works.
      .catch(() => {
        if (!cancelled) setFound({ term: settled, rows: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open, client, scope, settled]);

  // ↑ ↓ can move past what the dropdown shows; keep the chosen one in sight.
  useEffect(() => {
    if (active === null) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const set = async (input: { customerId?: string | null; name?: string | null; contact?: string | null }) => {
    const done = await state.act((current) => client.setCustomer(scope, current, input), { create: true });
    if (done) onClose();
  };

  const saveAndLink = async () => {
    try {
      // The till has one contact line; a customer has a box for each way of reaching them.
      const saved = await client.saveCustomer(scope, { name, ...posContactAsCustomerFields(contact) });
      await set({ customerId: saved.id });
    } catch (caught) {
      state.showError(caught, 'Could not save that customer.');
    }
  };

  const onNameKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setListOpen(true);
      setActive(nextOption(matches.length, listOpen ? active : null, event.key === 'ArrowDown' ? 'down' : 'up'));
      return;
    }
    if (event.key === 'Escape' && listOpen) {
      // ⚠ The first Escape closes the dropdown only. Unprevented, the <dialog> takes it and the whole dialog closes.
      event.preventDefault();
      setListOpen(false);
      setActive(null);
      return;
    }
    if (event.key !== 'Enter' || !listOpen || active === null) return;
    const chosen = matches[active];
    if (!chosen) return;
    event.preventDefault();
    void set({ customerId: chosen.id });
  };

  return (
    <Modal open={open} title="Customer" onClose={onClose}>
      <Field label="Name" hint="Type to search recorded customers, or type a walk-in’s name.">
        {(id, describedBy) => (
          <div className="relative">
            <input
              id={id}
              role="combobox"
              aria-expanded={listOpen}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={listOpen && active !== null ? `${listId}-${active}` : undefined}
              aria-describedby={describedBy}
              autoComplete="off"
              className={INPUT_CLASS}
              placeholder="Search by name, phone or e-mail"
              value={name}
              // biome-ignore lint/a11y/noAutofocus: a dialog opens where the person will type or choose next (D20: focus always has a home).
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                setListOpen(true);
                setActive(null);
              }}
              onClick={() => setListOpen(true)}
              onBlur={() => setListOpen(false)}
              onKeyDown={onNameKey}
            />
            {listOpen ? (
              // biome-ignore lint/a11y/noStaticElementInteractions: not a control — the handler only keeps the focus in the box; the options inside carry the roles.
              <div
                className="absolute inset-x-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                // ⚠ A press on the dropdown must not take focus from the box: its blur closes the dropdown before the click lands.
                onMouseDown={(event) => event.preventDefault()}
              >
                <div id={listId} role="listbox" aria-label="Recorded customers" className="flex flex-col gap-0.5">
                  {matches.map((customer, index) => (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the options are chosen from the box, with ↑ ↓ and Enter — the combobox pattern; focus never leaves it.
                    <div
                      key={customer.id}
                      id={`${listId}-${index}`}
                      role="option"
                      // Focusable by script only: Tab goes on to Contact, and the box keeps the focus while choosing.
                      tabIndex={-1}
                      aria-selected={index === active}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
                        index === active && 'bg-accent text-accent-foreground',
                      )}
                      onClick={() => void set({ customerId: customer.id })}
                    >
                      <span className="min-w-0 truncate">
                        {customer.name}
                        {order?.customerId === customer.id ? (
                          <span className="ml-1 text-xs text-muted-foreground">(on this order)</span>
                        ) : null}
                      </span>
                      <span className="max-w-[50%] shrink-0 truncate text-xs text-muted-foreground">
                        {posCustomerContactLine(customer) ?? ''}
                      </span>
                    </div>
                  ))}
                </div>
                {matches.length === 0 ? (
                  <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
                    {customerListNote(name, searching, found?.failed ?? false)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Field>
      <Field label="Contact" hint="Phone or email. Needed to pay later or to owe change.">
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            className={INPUT_CLASS}
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass('ghost')} onClick={() => void set({})}>
          Walk-in, no name
        </button>
        <button
          type="button"
          className={buttonClass('secondary')}
          disabled={name.trim() === ''}
          onClick={() => void set({ name, contact: contact || null })}
        >
          Use as typed
        </button>
        {state.canSell ? (
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={name.trim() === '' || state.busy}
            onClick={() => void saveAndLink()}
          >
            <UserPlus aria-hidden="true" className="size-4" />
            Save as customer
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

/** The dropdown's one line when it has no customer to offer: still looking, could not look, or nobody matches. */
function customerListNote(name: string, searching: boolean, failed: boolean): string {
  if (searching) return 'Searching…';
  if (failed) return 'Could not search the customers. The name can still be used as typed.';
  if (name.trim() === '') return 'No customers are recorded yet.';
  return `No recorded customer matches “${name.trim()}”. Use it as typed, or save it as a customer.`;
}

/**
 * A discount on a line or the whole order (D16): ₱ or %, with a reason. Only
 * offered to `pos:discount` — and the server checks again.
 */
export function DiscountDialog({
  open,
  title,
  current,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  current: PosDiscountView | null;
  onSave: (discount: PosDiscountInput | null) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'amount' | 'percent'>('amount');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const currentKind = current?.kind === 'percent' ? 'percent' : 'amount';
    setKind(currentKind);
    setValue(current ? (currentKind === 'percent' ? String(current.value / 100) : pesoInputValue(current.value)) : '');
    setReason(current?.reason ?? '');
    setProblem(null);
  }, [open, current]);

  const save = async () => {
    const parsed = kind === 'percent' ? parsePercent(value) : parsePeso(value);
    if (parsed === null || parsed <= 0) {
      setProblem(kind === 'percent' ? 'Enter a percentage from 0.01 to 100.' : 'Enter an amount above ₱0.');
      return;
    }
    if (reason.trim() === '') {
      setProblem('Give a reason, such as “suki”.');
      return;
    }
    await onSave({ kind, value: parsed, reason });
  };

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <fieldset className="flex w-fit rounded-md border border-border p-0.5">
        <legend className="sr-only">Discount as</legend>
        {(['amount', 'percent'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            className={buttonClass(kind === option ? 'primary' : 'ghost', 'sm')}
            onClick={() => setKind(option)}
          >
            {option === 'amount' ? '₱ amount' : '% percent'}
          </button>
        ))}
      </fieldset>
      <Field label={kind === 'amount' ? 'Amount off (₱)' : 'Percent off'} error={problem}>
        {(id, describedBy) => (
          <input
            id={id}
            inputMode="decimal"
            aria-invalid={problem !== null}
            aria-describedby={describedBy}
            className={INPUT_CLASS}
            value={value}
            // biome-ignore lint/a11y/noAutofocus: a dialog opens where the person will type or choose next (D20: focus always has a home).
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
        )}
      </Field>
      <Field label="Reason">
        {(id) => (
          <input
            id={id}
            className={INPUT_CLASS}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
        )}
      </Field>
      <div className="flex justify-between gap-2">
        {current ? (
          <button type="button" className={buttonClass('ghost')} onClick={() => void onSave(null)}>
            Remove discount ({current.kind === 'percent' ? formatPercent(current.value) : formatPeso(current.value)})
          </button>
        ) : (
          <span />
        )}
        <button type="button" className={buttonClass('primary')} onClick={() => void save()}>
          Apply
        </button>
      </div>
    </Modal>
  );
}

/** One line of text asked for: a line note, a held order's label, a reason. */
export function TextDialog({
  open,
  title,
  label,
  hint,
  initial,
  required = false,
  confirmLabel,
  danger = false,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  hint?: string;
  initial: string;
  required?: boolean;
  confirmLabel: string;
  danger?: boolean;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText(initial);
      setProblem(null);
    }
  }, [open, initial]);
  const save = async () => {
    if (required && text.trim() === '') {
      setProblem('This is needed.');
      return;
    }
    await onSave(text);
  };
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <Field label={label} {...(hint ? { hint } : {})} error={problem}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-invalid={problem !== null}
            aria-describedby={describedBy}
            className={INPUT_CLASS}
            value={text}
            // biome-ignore lint/a11y/noAutofocus: a dialog opens where the person will type or choose next (D20: focus always has a home).
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass(danger ? 'danger' : 'primary')} onClick={() => void save()}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Held orders (D8), oldest first: who, what, how much, how long. Resuming puts one on the till. */
export function PendingDialog({
  open,
  pending,
  currentId,
  onResume,
  onClose,
}: {
  open: boolean;
  pending: readonly PosOrderSummaryView[];
  currentId: string | null;
  onResume: (orderId: string) => void;
  onClose: () => void;
}) {
  // ⚠ The first one that CAN be resumed: a disabled button takes no focus, and with
  // the order on the till listed first the arrows had nowhere to start from.
  const firstResumable = pending.findIndex((row) => row.id !== currentId);
  return (
    <Modal open={open} title="Pending orders" onClose={onClose} wide>
      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is on hold.</p>
      ) : (
        <ul className="flex flex-col gap-1" {...LIST_KEYS}>
          {pending.map((row, index) => (
            <li key={row.id}>
              <button
                type="button"
                {...LIST_ITEM}
                // biome-ignore lint/a11y/noAutofocus: a dialog opens where the person will type or choose next (D20: focus always has a home).
                autoFocus={index === firstResumable}
                disabled={row.id === currentId}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onResume(row.id)}
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{row.label ?? row.customerName ?? 'Walk-in'}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {row.itemCount} {row.itemCount === 1 ? 'item' : 'items'} · {sinceText(row.createdAt)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {row.id === currentId ? 'On the till' : formatPeso(row.total)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** "5 min ago", "2 h ago", "3 d ago": how long an order has waited. */
export function sinceText(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
