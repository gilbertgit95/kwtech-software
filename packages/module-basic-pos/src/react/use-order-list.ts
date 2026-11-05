'use client';

import { zonedDayKey } from '@kwtech/module-kit';
import { useDebouncedValue } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useState } from 'react';
import type { PosOrderSummaryView } from './pos-client.js';
import { type PosData, usePosData } from './use-pos-data.js';
import type { TillState } from './use-till.js';
import { isOutstandingFilter, type OrderFilter, otherDaysLine } from './view/manage.js';
import { prepareCustomDays, presetDays, type ReportDays, type ReportPreset } from './view/reports.js';

/** Which orders are listed, read and counted: what both Orders screens draw. */
export interface OrderListState {
  /** The store's today (`YYYY-MM-DD`, the workspace's zone). */
  today: string;
  filter: OrderFilter;
  setFilter: (filter: OrderFilter) => void;
  preset: ReportPreset;
  custom: ReportDays;
  /** Whether the custom range's date fields are open. */
  editing: boolean;
  /** No period at all: every date. */
  everyDate: boolean;
  /** The days listed, or null for every date or a custom range not finished. */
  days: ReportDays | null;
  /** Why nothing is listed: a custom range still being typed. */
  problem: string | null;
  search: string;
  setSearch: (search: string) => void;
  /** The search as sent, once typing pauses. */
  settled: string;
  list: PosData<PosOrderSummaryView[]>;
  rows: readonly PosOrderSummaryView[];
  /** The count of an outstanding status's orders on other days (`otherDaysNote`), or null. */
  otherDays: string | null;
  /** An error from the count of other days, apart from the list's own. */
  countError: string | null;
  /** True when anything differs from what the screen opens on (today, every status). */
  filtered: boolean;
  /** The order open over the list, if any. */
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  showEveryDate: () => void;
  reset: () => void;
  onPreset: (preset: Exclude<ReportPreset, 'custom'>) => void;
  onDays: (days: ReportDays) => void;
  onCustom: (custom: ReportDays) => void;
  onEditing: (open: boolean) => void;
}

/**
 * The Orders list's filters and reads (D23), once for the full screen's
 * Orders tab and the phone's Orders section (issue #72), so the two never
 * disagree about which orders "today, Unpaid" means.
 *
 * WHICH orders is two filters, each its own question (the operator,
 * 2026-10-05): the DAYS — the reports' own picker, plus "All dates" — and the
 * STATUS. It opens on today, every status: what the counter did so far.
 *
 * - The days are the WORKSPACE's (`state.timeZone`), so "Today" is the
 *   store's today wherever the person is reading from.
 * - ⚠ An outstanding order outlives its day. Narrowed to some days, the
 *   Pending, Unpaid and Change owed lists say how many more there are on
 *   other days (`otherDays`) — a filter must never read as "nobody owes".
 * - Another period or status is another list, so each change closes the
 *   order that was open: it may not be in the new one.
 *
 * `openOrderId` opens one from elsewhere (a customer's history), on every
 * status and every date, so it is in the list whenever it was sold.
 */
export function useOrderList(state: TillState, openOrderId: string | null = null): OrderListState {
  const { client, scope, timeZone } = state;
  const today = zonedDayKey(new Date(), timeZone);
  const [filter, setFilterState] = useState<OrderFilter>('all');
  const [preset, setPreset] = useState<ReportPreset>('today');
  const [custom, setCustom] = useState<ReportDays>({ fromDay: today, toDay: today });
  const [editing, setEditing] = useState(false);
  const [everyDate, setEveryDate] = useState(openOrderId !== null);
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search);
  const [selectedId, setSelectedId] = useState<string | null>(openOrderId);

  useEffect(() => {
    if (!openOrderId) return;
    setFilterState('all');
    setEveryDate(true);
    setEditing(false);
    setSelectedId(openOrderId);
  }, [openOrderId]);

  const prepared = preset === 'custom' ? prepareCustomDays(custom.fromDay, custom.toDay) : presetDays(preset, today);
  const problem = !everyDate && 'problem' in prepared ? prepared.problem : null;
  const days = everyDate || 'problem' in prepared ? null : prepared;
  const fromDay = days?.fromDay ?? null;
  const toDay = days?.toDay ?? null;

  const load = useCallback(async (): Promise<PosOrderSummaryView[]> => {
    // A custom range still being typed is no period yet: list nothing rather than every date.
    if (problem) return [];
    return client.orders(scope, filter, settled || null, null, fromDay && toDay ? { fromDay, toDay } : null);
  }, [client, scope, filter, settled, fromDay, toDay, problem]);
  const list = usePosData(scope, load, ['order'], 'Could not load the orders.');
  const rows = list.data ?? [];

  // How many of an outstanding status there are on ANY date, to say what the days showing leave out.
  // Not while searching: the search narrows the list, and the two counts would no longer be of the same thing.
  const counting = isOutstandingFilter(filter) && fromDay !== null && !settled;
  const loadEveryDate = useCallback(async (): Promise<{ filter: OrderFilter; count: number } | null> => {
    if (!counting) return null;
    return { filter, count: (await client.orders(scope, filter)).length };
  }, [client, scope, filter, counting]);
  const elsewhere = usePosData(scope, loadEveryDate, ['order'], 'Could not count the orders on other days.');
  // ⚠ Only once both reads are current and the count's succeeded (`otherDaysLine` says why).
  const otherDays = otherDaysLine({
    counting,
    filter,
    listed: rows.length,
    listLoading: list.loading,
    count: elsewhere,
  });

  const showEveryDate = () => {
    setEveryDate(true);
    setEditing(false);
    setSelectedId(null);
  };
  const reset = () => {
    setFilterState('all');
    setPreset('today');
    setEveryDate(false);
    setEditing(false);
    setSelectedId(null);
  };

  return {
    today,
    filter,
    setFilter: (next) => {
      setFilterState(next);
      setSelectedId(null);
    },
    preset,
    custom,
    editing,
    everyDate,
    days,
    problem,
    search,
    setSearch,
    settled,
    list,
    rows,
    otherDays,
    countError: elsewhere.error,
    filtered: filter !== 'all' || everyDate || preset !== 'today',
    selectedId,
    setSelectedId,
    showEveryDate,
    reset,
    onPreset: (next) => {
      setPreset(next);
      setEveryDate(false);
      setEditing(false);
      setSelectedId(null);
    },
    onDays: (next) => {
      setPreset('custom');
      setCustom(next);
      setEveryDate(false);
      setSelectedId(null);
    },
    onCustom: (next) => {
      setPreset('custom');
      setCustom(next);
      setEveryDate(false);
      setSelectedId(null);
    },
    onEditing: (open) => {
      setEditing(open);
      if (!open || !everyDate) return;
      // From "All dates" there are no days to start the range from: start it at today.
      setPreset('custom');
      setCustom({ fromDay: today, toDay: today });
      setEveryDate(false);
    },
  };
}
