'use client';

import { cn } from '@kwtech/web-ui/react';
import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import { isPosVariantAvailable } from '../../domain/availability.js';
import type { PosCatalogueView, PosItemView, PosVariantView } from '../pos-client.js';
import type { TillState } from '../use-till.js';
import {
  availabilityDone,
  availabilityGroups,
  itemKey,
  POS_AVAILABILITY_OTHER,
  type PosAvailabilityFilter,
  type PosAvailabilityStatus,
  selectAllState,
  selectionKeys,
  selectionTarget,
  toggleAll,
  toggleOne,
  variantKey,
} from '../view/availability.js';
import { buttonClass, INPUT_CLASS, UnavailableBadge } from './controls.js';
import { Alert, Empty } from './layout.js';

/**
 * Marking items and sizes "Not available" and back (issue #37) — one panel for
 * the Items tab and for the "Availability" sheet on the sell views.
 *
 * Each row has its own switch, for "we just ran out of bulalo". For a long
 * list there are checkboxes, "Select all" per category and overall, and a
 * filter; the bar at the bottom switches the whole selection in ONE request,
 * which the server applies in one transaction and announces as one event.
 *
 * ⚠ NO OPTIMISTIC STATE (frontend rules): every switch waits for the server,
 * and what the panel shows next is the catalogue as re-read — the same `catalogue`
 * event that moves every till moves this list.
 */
export function AvailabilityPanel({
  state,
  catalogue,
  onChanged,
}: {
  state: TillState;
  catalogue: PosCatalogueView;
  /** Re-reads the catalogue at once, before the live event arrives. */
  onChanged?: () => void;
}) {
  const { client, scope } = state;
  const searchId = useId();
  const categoryFieldId = useId();
  const statusFieldId = useId();
  const [filter, setFilter] = useState<PosAvailabilityFilter>({ search: '', categoryId: null, status: 'all' });
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const groups = availabilityGroups(catalogue, filter);
  const shown = groups.flatMap((group) => selectionKeys(group.rows));
  const target = selectionTarget(selection, shown);
  const picked = target.itemIds.length + target.variantIds.length;
  const categories = catalogue.categories
    .filter((category) => category.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const send = async (next: { itemIds: string[]; variantIds: string[] }, available: boolean, fromBar: boolean) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const change = await client.setAvailability(scope, next, available);
      setDone(availabilityDone(change, available));
      if (fromBar) setSelection(new Set());
      onChanged?.();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Could not change what is available.');
    } finally {
      setBusy(false);
    }
  };

  const switchItem = (item: PosItemView) =>
    void send({ itemIds: [item.id], variantIds: [] }, item.unavailableAt !== null, false);
  const switchVariant = (variant: PosVariantView) =>
    void send({ itemIds: [], variantIds: [variant.id] }, variant.unavailableAt !== null, false);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <label htmlFor={searchId} className="relative block min-w-40 flex-1">
          <span className="sr-only">Search items</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
          />
          <input
            id={searchId}
            type="search"
            autoComplete="off"
            className={`${INPUT_CLASS} pl-8`}
            placeholder="Name, code or size"
            value={filter.search}
            onChange={(event) => setFilter({ ...filter, search: event.target.value })}
          />
        </label>
        <label htmlFor={categoryFieldId} className="sr-only">
          Category
        </label>
        <select
          id={categoryFieldId}
          className={cn(INPUT_CLASS, 'w-auto')}
          value={filter.categoryId ?? ''}
          onChange={(event) =>
            setFilter({ ...filter, categoryId: event.target.value === '' ? null : event.target.value })
          }
        >
          <option value="">Every category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
          <option value={POS_AVAILABILITY_OTHER}>{categories.length === 0 ? 'Items' : 'Other'}</option>
        </select>
        <label htmlFor={statusFieldId} className="sr-only">
          Show
        </label>
        <select
          id={statusFieldId}
          className={cn(INPUT_CLASS, 'w-auto')}
          value={filter.status}
          // ⚠ Narrowed from the select's own three options, never free text.
          onChange={(event) => setFilter({ ...filter, status: event.target.value as PosAvailabilityStatus })}
        >
          <option value="all">Available and not</option>
          <option value="available">Available</option>
          <option value="unavailable">Not available</option>
        </select>
      </div>

      <div className="flex items-center gap-2 px-1 text-sm">
        <Checkbox
          label="Select everything shown"
          checked={selectAllState(selection, shown)}
          disabled={shown.length === 0}
          onChange={() => setSelection(toggleAll(selection, shown))}
        />
        <span className="text-muted-foreground">Select all shown</span>
      </div>

      <Alert message={problem} onDismiss={() => setProblem(null)} />
      {done ? (
        <p role="status" className="rounded-md bg-muted px-3 py-1.5 text-sm">
          {done}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {groups.length === 0 ? (
          <Empty>{catalogue.items.length === 0 ? 'This store has no items yet.' : 'Nothing matches.'}</Empty>
        ) : null}
        {groups.map((group) => {
          const keys = selectionKeys(group.rows);
          return (
            <section key={group.id} aria-label={group.name} className="rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
                <Checkbox
                  label={`Select all in ${group.name}`}
                  checked={selectAllState(selection, keys)}
                  onChange={() => setSelection(toggleAll(selection, keys))}
                />
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.rows.filter((row) => !row.available).length} not available
                </span>
              </div>
              <ul className="flex flex-col">
                {group.rows.map((row) => (
                  <li key={row.item.id} className="border-b border-border last:border-b-0">
                    <div className="flex items-center gap-2 px-3 py-1.5">
                      <Checkbox
                        label={`Select ${row.item.name}`}
                        checked={selection.has(itemKey(row.item.id))}
                        onChange={() => setSelection(toggleOne(selection, itemKey(row.item.id)))}
                      />
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span
                          className={cn('truncate text-sm font-medium', row.available ? null : 'text-muted-foreground')}
                        >
                          {row.item.name}
                        </span>
                        {row.available ? null : <UnavailableBadge />}
                        {row.variantsOff > 0 && row.item.unavailableAt === null ? (
                          <span className="text-xs text-muted-foreground">
                            {row.variantsOff} of {row.variants.length} sizes off
                          </span>
                        ) : null}
                      </span>
                      <AvailabilitySwitch
                        name={row.item.name}
                        on={row.item.unavailableAt === null}
                        disabled={busy}
                        onToggle={() => switchItem(row.item)}
                      />
                    </div>
                    {row.variants.length > 0 ? (
                      <ul className="flex flex-col pb-1 pl-8">
                        {row.variants.map((variant) => {
                          const onSale = isPosVariantAvailable(row.item, variant);
                          return (
                            <li key={variant.id} className="flex items-center gap-2 px-3 py-1">
                              <Checkbox
                                label={`Select ${row.item.name} — ${variant.name}`}
                                checked={selection.has(variantKey(variant.id))}
                                onChange={() => setSelection(toggleOne(selection, variantKey(variant.id)))}
                              />
                              <span className="flex min-w-0 flex-1 items-center gap-2">
                                <span className={cn('truncate text-sm', onSale ? null : 'text-muted-foreground')}>
                                  {variant.name}
                                </span>
                                {variant.unavailableAt !== null ? <UnavailableBadge /> : null}
                                {/* The item's switch wins: say so, or a size switched on looks for sale when it is not. */}
                                {variant.unavailableAt === null && row.item.unavailableAt !== null ? (
                                  <span className="text-xs text-muted-foreground">off with the item</span>
                                ) : null}
                              </span>
                              <AvailabilitySwitch
                                name={`${row.item.name} — ${variant.name}`}
                                on={variant.unavailableAt === null}
                                disabled={busy}
                                onToggle={() => switchVariant(variant)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/*
       * ⚠ STICKY, not absolute: on the Items tab the list scrolls inside the
       * panel, in the sell views' sheet the dialog scrolls; sticky stays in
       * sight at the bottom in both.
       */}
      {picked > 0 ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-md">
          <span className="mr-auto text-sm font-medium tabular-nums">{picked} selected</span>
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setSelection(new Set())}>
            Clear
          </button>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            disabled={busy}
            onClick={() => void send(target, true, true)}
          >
            Mark available
          </button>
          <button
            type="button"
            className={buttonClass('primary', 'sm')}
            disabled={busy}
            onClick={() => void send(target, false, true)}
          >
            {busy ? 'Saving…' : 'Mark not available'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A checkbox whose third state ("some of these") is real: `indeterminate` is a property, never an attribute. */
function Checkbox({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean | 'mixed';
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 shrink-0"
      checked={checked === true}
      disabled={disabled}
      ref={(element) => {
        if (element) element.indeterminate = checked === 'mixed';
      }}
      onChange={onChange}
    />
  );
}

/** One row's switch: on is for sale. A `switch` role, so a screen reader says "on" or "off", not "pressed". */
function AvailabilitySwitch({
  name,
  on,
  disabled,
  onToggle,
}: {
  name: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${name} available`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground',
      )}
    >
      {on ? 'Available' : 'Not available'}
    </button>
  );
}
