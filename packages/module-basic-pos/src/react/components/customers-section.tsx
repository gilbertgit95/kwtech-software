'use client';

import { useDebouncedValue } from '@kwtech/web-ui/react';
import { Plus, Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { PosCustomerView } from '../pos-client.js';
import { usePosData } from '../use-pos-data.js';
import type { TillState } from '../use-till.js';
import { orderStatusChip, orderTitle, whenText } from '../view/manage.js';
import { formatPeso } from '../view/money.js';
import { buttonClass, Field, INPUT_CLASS } from './controls.js';
import { Alert, Empty, ListDetail, RowButton, StatusChip } from './layout.js';

/**
 * Customers (D5, D23): the store's recorded customers, and each one's orders.
 * Everybody who sells may add and edit them (`pos:sell`), because the till is
 * where customers are met; a person who only reads sees the list.
 *
 * Their orders are the ones LINKED to them, never a walk-in who typed the same
 * name — somebody else with the same first name is not their history.
 */
export function CustomersSection({ state, onOpenOrder }: { state: TillState; onOpenOrder: (orderId: string) => void }) {
  const { client, scope } = state;
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<null | 'new' | string>(null);
  const load = useCallback(
    () => client.customers(scope, settled, showArchived),
    [client, scope, settled, showArchived],
  );
  const list = usePosData(scope, load, ['customers'], 'Could not load the customers.');
  const rows = list.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Alert message={list.error} />
      <ListDetail
        onBack={() => setSelected(null)}
        backLabel="Back to customers"
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
                  className={`${INPUT_CLASS} pl-8`}
                  placeholder="Name or contact"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {state.canSell ? (
                <button type="button" className={buttonClass('primary')} onClick={() => setSelected('new')}>
                  <Plus aria-hidden="true" className="size-4" />
                  New customer
                </button>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Show archived
            </label>
            <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
              {rows.length === 0 ? (
                <li>
                  <Empty>{list.loading ? 'Loading…' : settled ? 'Nobody matches.' : 'No customers yet.'}</Empty>
                </li>
              ) : null}
              {rows.map((row) => (
                <li key={row.id}>
                  <RowButton selected={row.id === selected} onClick={() => setSelected(row.id)}>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{row.name}</span>
                        {row.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
                      </span>
                      {row.contact ? (
                        <span className="truncate text-xs text-muted-foreground">{row.contact}</span>
                      ) : null}
                    </span>
                  </RowButton>
                </li>
              ))}
            </ul>
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
              onOpenOrder={onOpenOrder}
            />
          ) : null
        }
      />
    </div>
  );
}

/**
 * One customer, read by id rather than picked from the list: a customer just
 * added may not match the search the list is showing.
 */
function CustomerDetail({
  state,
  customerId,
  onSaved,
  onOpenOrder,
}: {
  state: TillState;
  customerId: string | null;
  onSaved: (id: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { client, scope } = state;
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
  return (
    <CustomerEditor
      // By id only: remounting on every saved change would wipe the "Saved." this save just showed.
      key={found.data?.id ?? 'new'}
      state={state}
      customer={found.data}
      onSaved={onSaved}
      onOpenOrder={onOpenOrder}
    />
  );
}

function CustomerEditor({
  state,
  customer,
  onSaved,
  onOpenOrder,
}: {
  state: TillState;
  customer: PosCustomerView | null;
  onSaved: (id: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { client, scope, timeZone } = state;
  const [name, setName] = useState(customer?.name ?? '');
  const [contact, setContact] = useState(customer?.contact ?? '');
  const [note, setNote] = useState(customer?.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const editable = state.canSell;

  const customerId = customer?.id ?? null;
  const loadOrders = useCallback(
    () => (customerId ? client.orders(scope, 'all', null, customerId) : Promise.resolve([])),
    [client, scope, customerId],
  );
  const orders = usePosData(scope, loadOrders, ['order'], 'Could not load their orders.');

  const run = async (fn: () => Promise<PosCustomerView>, fallback: string) => {
    setSaving(true);
    try {
      const done = await fn();
      setProblem(null);
      setSaved(true);
      onSaved(done.id);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : fallback);
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (name.trim() === '') {
      setProblem('A customer needs a name.');
      return;
    }
    void run(
      () =>
        client.saveCustomer(scope, {
          ...(customer ? { id: customer.id } : {}),
          name,
          contact: contact.trim() === '' ? null : contact,
          note: note.trim() === '' ? null : note,
        }),
      'Could not save the customer.',
    );
  };

  const history = orders.data ?? [];
  const owed = history.filter((row) => row.status === 'unpaid').reduce((sum, row) => sum + row.total, 0);

  return (
    <section aria-label={customer ? customer.name : 'New customer'} className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{customer ? customer.name : 'New customer'}</h2>
        {customer?.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
      </header>
      {owed > 0 ? (
        <p className="w-fit rounded-md bg-status-warning px-2 py-0.5 text-sm text-status-warning-foreground">
          Owes the store {formatPeso(owed)}
        </p>
      ) : null}

      <Field label="Name">
        {(id) => (
          <input
            id={id}
            readOnly={!editable}
            className={INPUT_CLASS}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
        )}
      </Field>
      <Field label="Contact" hint="Optional. A phone number or an e-mail address.">
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            readOnly={!editable}
            className={INPUT_CLASS}
            value={contact}
            onChange={(event) => {
              setContact(event.target.value);
              setSaved(false);
            }}
          />
        )}
      </Field>
      <Field label="Note" hint="Optional. For the staff, never printed.">
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            readOnly={!editable}
            className={INPUT_CLASS}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setSaved(false);
            }}
          />
        )}
      </Field>
      <Alert message={problem} onDismiss={() => setProblem(null)} />
      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      ) : null}
      {editable ? (
        <div className="flex flex-wrap justify-between gap-2">
          {customer ? (
            <button
              type="button"
              disabled={saving}
              className={buttonClass('ghost')}
              onClick={() =>
                void run(
                  () => client.setCustomerArchived(scope, customer.id, customer.archivedAt === null),
                  'Could not change the customer.',
                )
              }
            >
              {customer.archivedAt ? 'Restore' : 'Archive'}
            </button>
          ) : (
            <span />
          )}
          <button type="button" disabled={saving} className={buttonClass('primary')} onClick={save}>
            {saving ? 'Saving…' : customer ? 'Save changes' : 'Add customer'}
          </button>
        </div>
      ) : null}

      {customer ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Their orders</h3>
          <Alert message={orders.error} />
          {history.length === 0 ? (
            <Empty>{orders.loading ? 'Loading…' : 'No orders linked to them yet.'}</Empty>
          ) : (
            <ul className="flex flex-col gap-1">
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
      ) : null}
    </section>
  );
}
