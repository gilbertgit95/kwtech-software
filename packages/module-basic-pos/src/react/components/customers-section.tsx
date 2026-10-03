'use client';

import { cn, LIST_KEYS, ListDrawer, listNeighbours, searchIntoList, useDebouncedValue } from '@kwtech/web-ui/react';
import {
  Archive,
  ArchiveRestore,
  type LucideIcon,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  UsersRound,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useRef, useState } from 'react';
import { POS_CUSTOMER_SEARCH_MAX, posCustomerContactLine, preparePosFacebookUrl } from '../../domain/customers.js';
import type { PosCustomerView } from '../pos-client.js';
import { usePosData } from '../use-pos-data.js';
import type { TillState } from '../use-till.js';
import {
  customerInitials,
  customerSummary,
  emailHref,
  orderStatusChip,
  orderTitle,
  phoneHref,
  whenText,
} from '../view/manage.js';
import { formatPeso } from '../view/money.js';
import { buttonClass, Field, INPUT_CLASS } from './controls.js';
import { Alert, Empty, RowButton, StatusChip } from './layout.js';

/**
 * Customers (D5, D23): the store's recorded customers, and each one's orders.
 * Everybody who sells may add and edit them (`pos:sell`), because the till is
 * where customers are met; a person who only reads sees the list.
 *
 * Their orders are the ones LINKED to them, never a walk-in who typed the same
 * name — somebody else with the same first name is not their history.
 *
 * A customer opens as a PROFILE to read and act from — message, call, e-mail,
 * what they bought, what they owe — and the form is one press away (the
 * operator, 2026-10-02: the screen had been a bare form, every time).
 */
export function CustomersSection({ state, onOpenOrder }: { state: TillState; onOpenOrder: (orderId: string) => void }) {
  const { client, scope } = state;
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const settled = useDebouncedValue(search);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<null | 'new' | string>(null);
  const load = useCallback(
    () => client.customers(scope, settled, showArchived),
    [client, scope, settled, showArchived],
  );
  const list = usePosData(scope, load, ['customers'], 'Could not load the customers.');
  const rows = list.data ?? [];
  const searching = settled.trim() !== '';
  const around = listNeighbours(
    rows.map((row) => row.id),
    selected,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Alert message={list.error} />
      <ListDrawer
        onClose={() => setSelected(null)}
        label="customer"
        step={{
          onPrevious: around.previous ? () => setSelected(around.previous) : null,
          onNext: around.next ? () => setSelected(around.next) : null,
          position: around.position,
        }}
        list={
          <>
            <div className="flex gap-2">
              <label className="relative block flex-1">
                <span className="sr-only">Search customers</span>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                />
                <input
                  type="search"
                  // biome-ignore lint/a11y/noAutofocus: a section opens on its search, as Sell does — the next thing done is finding one (D20: focus always has a home).
                  autoFocus
                  className={`${INPUT_CLASS} pl-8`}
                  placeholder="Name, phone, e-mail or Facebook"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={searchIntoList(listRef)}
                />
              </label>
              {state.canSell ? (
                <button type="button" className={buttonClass('primary')} onClick={() => setSelected('new')}>
                  <Plus aria-hidden="true" className="size-4" />
                  New customer
                </button>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
              <span role="status">{list.data ? countText(rows.length, searching) : ''}</span>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                Show archived
              </label>
            </div>
            {rows.length === 0 ? (
              <EmptyList
                loading={list.loading}
                searching={searching}
                onAdd={state.canSell ? () => setSelected('new') : null}
              />
            ) : (
              <ul ref={listRef} className="flex min-h-0 flex-col gap-1 overflow-y-auto" {...LIST_KEYS}>
                {rows.map((row) => (
                  <li key={row.id}>
                    <RowButton selected={row.id === selected} onClick={() => setSelected(row.id)}>
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar name={row.name} muted={row.archivedAt !== null} />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-medium">{row.name}</span>
                            {row.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {posCustomerContactLine(row) ?? 'No contact recorded'}
                          </span>
                        </span>
                      </span>
                      <ChannelIcons customer={row} />
                    </RowButton>
                  </li>
                ))}
              </ul>
            )}
          </>
        }
        detail={
          selected ? (
            <CustomerDetail
              key={selected}
              state={state}
              customerId={selected === 'new' ? null : selected}
              onSaved={(id) => {
                setSelected(id);
                void list.reload();
              }}
              onClose={() => setSelected(null)}
              onOpenOrder={onOpenOrder}
            />
          ) : null
        }
      />
    </div>
  );
}

/** "12 customers", "3 matches" — and that the list stops at the search's cap, when it does. */
function countText(count: number, searching: boolean): string {
  if (count >= POS_CUSTOMER_SEARCH_MAX) return `The first ${POS_CUSTOMER_SEARCH_MAX} — search to find the rest`;
  if (searching) return `${count} ${count === 1 ? 'match' : 'matches'}`;
  return `${count} ${count === 1 ? 'customer' : 'customers'}`;
}

/** Nobody to list: still loading, nobody matches, or an empty store — which says what to do next. */
function EmptyList({
  loading,
  searching,
  onAdd,
}: {
  loading: boolean;
  searching: boolean;
  onAdd: (() => void) | null;
}) {
  if (loading) return <Empty>Loading…</Empty>;
  if (searching) return <Empty>Nobody matches. Check the spelling, or try their phone number.</Empty>;
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <UsersRound aria-hidden="true" className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">No customers yet</p>
      <p className="text-sm text-muted-foreground">
        Record the people who come back, with how to reach them, and their orders gather under their name.
      </p>
      {onAdd ? (
        <button type="button" className={buttonClass('primary')} onClick={onAdd}>
          <Plus aria-hidden="true" className="size-4" />
          Add the first customer
        </button>
      ) : null}
    </div>
  );
}

/** A customer's initials in a circle: a face for the row, so a list of names is scanned, not read. */
function Avatar({ name, muted = false, large = false }: { name: string; muted?: boolean; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        large ? 'size-14 text-lg' : 'size-9 text-xs',
        muted ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
      )}
    >
      {customerInitials(name)}
    </span>
  );
}

/** Which ways of reaching them are recorded, at a glance down the list. */
function ChannelIcons({ customer }: { customer: PosCustomerView }) {
  const channels: { key: string; icon: LucideIcon; label: string; has: boolean }[] = [
    { key: 'facebook', icon: MessageCircle, label: 'Facebook', has: customer.facebookUrl !== null },
    { key: 'phone', icon: Phone, label: 'Phone', has: customer.phone !== null },
    { key: 'email', icon: Mail, label: 'E-mail', has: customer.email !== null },
  ];
  const recorded = channels.filter((channel) => channel.has);
  if (recorded.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
      <span className="sr-only">Has: {recorded.map((channel) => channel.label).join(', ')}</span>
      {recorded.map((channel) => (
        <channel.icon key={channel.key} aria-hidden="true" className="size-3.5" />
      ))}
    </span>
  );
}

/**
 * One customer, read by id rather than picked from the list: a customer just
 * added may not match the search the list is showing.
 *
 * A recorded customer opens on their profile; a new one opens on the form,
 * because there is nothing to read yet.
 */
function CustomerDetail({
  state,
  customerId,
  onSaved,
  onClose,
  onOpenOrder,
}: {
  state: TillState;
  customerId: string | null;
  onSaved: (id: string) => void;
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { client, scope } = state;
  const [editing, setEditing] = useState(false);
  const load = useCallback(
    () => (customerId ? client.customer(scope, customerId) : Promise.resolve(null)),
    [client, scope, customerId],
  );
  const found = usePosData(scope, load, ['customers'], 'Could not load this customer.');
  if (customerId && !found.data) {
    return found.error ? (
      <Alert message={found.error} />
    ) : (
      <Empty>{found.loading ? 'Loading…' : 'That customer is no longer there.'}</Empty>
    );
  }
  /** After a save or an archive: read them again — a till that is not live gets no event to do it — and tell the list. */
  const changed = (id: string) => {
    setEditing(false);
    void found.reload();
    onSaved(id);
  };
  if (!found.data || editing) {
    return (
      <CustomerForm
        state={state}
        customer={found.data}
        onSaved={changed}
        onCancel={found.data ? () => setEditing(false) : onClose}
      />
    );
  }
  return (
    <CustomerProfile
      state={state}
      customer={found.data}
      onEdit={() => setEditing(true)}
      onChanged={changed}
      onOpenOrder={onOpenOrder}
    />
  );
}

/**
 * A customer to read and act from: who they are, the ways to reach them as
 * buttons, what they have bought and owe, and their orders.
 */
function CustomerProfile({
  state,
  customer,
  onEdit,
  onChanged,
  onOpenOrder,
}: {
  state: TillState;
  customer: PosCustomerView;
  onEdit: () => void;
  onChanged: (id: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { client, scope, timeZone } = state;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadOrders = useCallback(() => client.orders(scope, 'all', null, customer.id), [client, scope, customer.id]);
  const orders = usePosData(scope, loadOrders, ['order'], 'Could not load their orders.');
  const history = orders.data ?? [];
  const summary = customerSummary(history);
  const archived = customer.archivedAt !== null;

  // ⚠ The SAVED link, checked again here: only an https Facebook address is ever drawn as a link (`preparePosFacebookUrl`).
  const checked = preparePosFacebookUrl(customer.facebookUrl ?? '');
  const facebook = 'refused' in checked ? null : checked.facebookUrl;
  const call = phoneHref(customer.phone);
  const mail = emailHref(customer.email);
  const reachable = facebook !== null || customer.phone !== null || customer.email !== null;

  const setArchived = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await client.setCustomerArchived(scope, customer.id, !archived);
      setProblem(null);
      onChanged(customer.id);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not change the customer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={customer.name} className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <Avatar name={customer.name} muted={archived} large />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">{customer.name}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {archived ? <StatusChip label="Archived" tone="neutral" /> : null}
            {summary.owed > 0 ? (
              <StatusChip label={`Owes the store ${formatPeso(summary.owed)}`} tone="warning" />
            ) : null}
            {!archived && summary.owed === 0 ? (
              <span className="text-xs text-muted-foreground">
                {summary.lastAt ? `Last order ${whenText(summary.lastAt, timeZone)}` : 'No orders yet'}
              </span>
            ) : null}
          </div>
        </div>
        {state.canSell ? (
          <button type="button" className={cn(buttonClass('secondary', 'sm'), 'shrink-0')} onClick={onEdit}>
            <Pencil aria-hidden="true" className="size-3.5" />
            Edit
          </button>
        ) : null}
      </header>
      <Alert message={problem} onDismiss={() => setProblem(null)} />

      {/* The ways to reach them, as the buttons that do it. Facebook first: it is how this store talks to its customers. */}
      {facebook || call || mail ? (
        <div className="flex flex-wrap gap-2">
          {facebook ? (
            <a href={facebook} target="_blank" rel="noopener noreferrer" className={buttonClass('primary')}>
              <MessageCircle aria-hidden="true" className="size-4" />
              Open in Facebook
            </a>
          ) : null}
          {call ? (
            <a href={call} className={buttonClass('secondary')}>
              <Phone aria-hidden="true" className="size-4" />
              Call
            </a>
          ) : null}
          {mail ? (
            <a href={mail} className={buttonClass('secondary')}>
              <Mail aria-hidden="true" className="size-4" />
              E-mail
            </a>
          ) : null}
        </div>
      ) : null}

      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Orders" value={String(summary.orders)} />
        <Stat label="Spent" value={formatPeso(summary.spent)} />
        <Stat label="Owes" value={formatPeso(summary.owed)} warn={summary.owed > 0} />
      </dl>

      <div className="flex flex-col rounded-lg border border-border">
        {reachable ? (
          <>
            {customer.phone ? <DetailRow icon={Phone} label="Phone" value={customer.phone} /> : null}
            {customer.email ? <DetailRow icon={Mail} label="E-mail" value={customer.email} /> : null}
            {customer.facebookUrl ? (
              <DetailRow
                icon={MessageCircle}
                label="Facebook"
                value={customer.facebookUrl.replace(/^https:\/\/(www\.)?/u, '')}
              />
            ) : null}
          </>
        ) : (
          <p className="px-3 py-2.5 text-sm text-muted-foreground">
            No way to reach them is recorded yet.
            {state.canSell ? ' Edit to add a phone number, an e-mail address or their Facebook link.' : ''}
          </p>
        )}
        {customer.note ? (
          <div className="border-t border-border px-3 py-2.5 first:border-t-0">
            <p className="text-xs text-muted-foreground">Note — for the staff, never printed</p>
            <p className="text-sm">{customer.note}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">Their orders</h3>
        <Alert message={orders.error} />
        {history.length === 0 ? (
          <Empty>{orders.loading ? 'Loading…' : 'No orders linked to them yet.'}</Empty>
        ) : (
          <ul className="flex flex-col gap-1" {...LIST_KEYS}>
            {history.map((row) => (
              <li key={row.id}>
                <RowButton selected={false} onClick={() => onOpenOrder(row.id)}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-medium">{orderTitle(row)}</span>
                    <StatusChip {...orderStatusChip(row)} />
                    <span className="truncate text-xs text-muted-foreground">
                      {whenText(row.paidAt ?? row.finalisedAt ?? row.createdAt, timeZone)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatPeso(row.total)}</span>
                </RowButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      {state.canSell ? (
        <div className="flex flex-col items-start gap-1 border-t border-border pt-3">
          <button
            type="button"
            disabled={busy}
            className={buttonClass('ghost', 'sm')}
            onClick={() => void setArchived()}
          >
            {archived ? (
              <ArchiveRestore aria-hidden="true" className="size-3.5" />
            ) : (
              <Archive aria-hidden="true" className="size-3.5" />
            )}
            {archived ? 'Restore customer' : 'Archive customer'}
          </button>
          <p className="text-xs text-muted-foreground">
            {archived
              ? 'Restoring puts them back in the till’s customer search.'
              : 'Archiving takes them out of the till’s customer search. Their orders stay, and they can be restored.'}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** One number of the profile's summary. */
function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn('truncate text-base font-semibold tabular-nums', warn ? 'text-status-warning-foreground' : null)}
      >
        {value}
      </dd>
    </div>
  );
}

/** One way of reaching them, as recorded: what to read out or copy. The buttons above are what act on it. */
function DetailRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-3 py-2.5 first:border-t-0">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="break-words text-sm">{value}</span>
      </div>
    </div>
  );
}

/**
 * The form: a new customer, or an edit of one. Only the name is needed; the
 * server checks the rest (`preparePosPhone` and its siblings) and its refusal
 * is shown as it comes, in its own words.
 *
 * A real `<form>`, so Enter in any box saves.
 */
function CustomerForm({
  state,
  customer,
  onSaved,
  onCancel,
}: {
  state: TillState;
  customer: PosCustomerView | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const { client, scope } = state;
  const [draft, setDraft] = useState({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    facebookUrl: customer?.facebookUrl ?? '',
    note: customer?.note ?? '',
  });
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const orNull = (text: string) => (text.trim() === '' ? null : text);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (draft.name.trim() === '') {
      setNameProblem('A customer needs a name.');
      return;
    }
    setSaving(true);
    try {
      const saved = await client.saveCustomer(scope, {
        ...(customer ? { id: customer.id } : {}),
        name: draft.name,
        phone: orNull(draft.phone),
        email: orNull(draft.email),
        facebookUrl: orNull(draft.facebookUrl),
        note: orNull(draft.note),
      });
      setProblem(null);
      onSaved(saved.id);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not save the customer.');
    } finally {
      setSaving(false);
    }
  };

  const title = customer ? `Edit ${customer.name}` : 'New customer';
  return (
    <form aria-label={title} className="flex flex-col gap-4" onSubmit={(event) => void save(event)} noValidate>
      <header className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">Only the name is needed. Add whichever way you reach them.</p>
      </header>

      <Field label="Name" error={nameProblem}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-invalid={nameProblem !== null}
            aria-describedby={describedBy}
            // biome-ignore lint/a11y/noAutofocus: the form is opened to type in, and the name comes first (D20: focus always has a home).
            autoFocus
            autoComplete="off"
            className={INPUT_CLASS}
            value={draft.name}
            onChange={(event) => {
              set({ name: event.target.value });
              setNameProblem(null);
            }}
          />
        )}
      </Field>

      <fieldset className="m-0 flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">How to reach them</legend>
        <IconField
          icon={MessageCircle}
          label="Facebook"
          hint="Their profile or Messenger link, such as facebook.com/juan.delacruz."
        >
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              inputMode="url"
              autoComplete="off"
              placeholder="facebook.com/…"
              className={INPUT_CLASS}
              value={draft.facebookUrl}
              onChange={(event) => set({ facebookUrl: event.target.value })}
            />
          )}
        </IconField>
        <div className="grid gap-3 @md:grid-cols-2">
          <IconField icon={Phone} label="Phone">
            {(id) => (
              <input
                id={id}
                inputMode="tel"
                autoComplete="off"
                placeholder="0917 123 4567"
                className={INPUT_CLASS}
                value={draft.phone}
                onChange={(event) => set({ phone: event.target.value })}
              />
            )}
          </IconField>
          <IconField icon={Mail} label="E-mail">
            {(id) => (
              <input
                id={id}
                inputMode="email"
                autoComplete="off"
                placeholder="name@example.com"
                className={INPUT_CLASS}
                value={draft.email}
                onChange={(event) => set({ email: event.target.value })}
              />
            )}
          </IconField>
        </div>
      </fieldset>

      <Field label="Note" hint="For the staff, never printed.">
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            autoComplete="off"
            className={INPUT_CLASS}
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
          />
        )}
      </Field>

      <Alert message={problem} onDismiss={() => setProblem(null)} />
      <div className="flex justify-end gap-2">
        <button type="button" disabled={saving} className={buttonClass('ghost')} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={buttonClass('primary')}>
          {saving ? 'Saving…' : customer ? 'Save changes' : 'Add customer'}
        </button>
      </div>
    </form>
  );
}

/** A `Field` whose label carries the channel's icon, so the three ways of reaching them are told apart at a glance. */
function IconField({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon aria-hidden="true" className="mt-7 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <Field label={label} {...(hint ? { hint } : {})}>
          {children}
        </Field>
      </div>
    </div>
  );
}
