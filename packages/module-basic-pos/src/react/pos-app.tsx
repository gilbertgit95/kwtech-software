'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useHoldsFeature } from '@kwtech/module-kit/react';
import { cn } from '@kwtech/web-ui/react';
import { useCallback, useState } from 'react';
import { POS_FEATURE } from '../feature-keys.js';
import { buttonClass, INPUT_CLASS } from './components/controls.js';
import { CustomersSection } from './components/customers-section.js';
import { ItemsSection } from './components/items-section.js';
import { OrdersSection } from './components/orders-section.js';
import { SettingsSection } from './components/settings-section.js';
import { Till } from './components/till.js';
import type { PosClient } from './pos-client.js';
import { usePosData } from './use-pos-data.js';
import { useTill } from './use-till.js';

type Section = 'sell' | 'orders' | 'items' | 'customers' | 'settings';

/**
 * The point of sale as a SUB-APP on the workspace's Apps page (docs/POS-PLAN.md).
 *
 * - Laid out by the BOX's width, never the viewport's (`@container`), because a
 *   grid cell is narrow on a wide screen: the order sits beside the items when
 *   there is room and under them when there is not.
 * - Which section is open is this component's own state, never a URL (D23): a
 *   link would leave the Apps page and close every other app running on it.
 * - A section shows only to somebody holding its key (D23): a workspace user
 *   sees Sell, Orders and Customers. Hiding is cosmetic — the API refuses too.
 * - Leaving Sell loses nothing: the till's state lives here, above the
 *   sections, and an open order is saved as it is built (D8).
 * - Says WHY when something is missing — no key to sell, no items yet, not live.
 */
export function PosApp({ organizationId, workspaceId, client }: AppProps & { client?: PosClient }) {
  const state = useTill(organizationId, workspaceId, client ? { client } : {});
  const canManageItems = useHoldsFeature(POS_FEATURE.manageItems);
  const canManageSettings = useHoldsFeature(POS_FEATURE.manageSettings);
  const [section, setSection] = useState<Section>('sell');
  /** An order to open in Orders, from a customer's history. */
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  // The Orders badge (D23): pending + unpaid + change owed — what still needs somebody.
  const loadOwed = useCallback(async () => {
    const [unpaid, changeOwed] = await Promise.all([
      state.client.orders(state.scope, 'unpaid'),
      state.client.orders(state.scope, 'change_owed'),
    ]);
    return unpaid.length + changeOwed.length;
  }, [state.client, state.scope]);
  const owed = usePosData(state.scope, loadOwed, ['order'], 'Could not count the unpaid orders.');
  const badge = state.pending.length + (owed.data ?? 0);

  const sections: { key: Section; label: string; badge?: number }[] = [
    { key: 'sell', label: 'Sell' },
    { key: 'orders', label: 'Orders', badge },
    ...(canManageItems ? [{ key: 'items' as const, label: 'Items' }] : []),
    { key: 'customers', label: 'Customers' },
    ...(canManageSettings ? [{ key: 'settings' as const, label: 'Settings' }] : []),
  ];
  const go = (next: Section) => {
    setSection(next);
    if (next !== 'orders') setOpenOrderId(null);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handler only catches Esc bubbling up from a section (D23: Esc at a section's top level returns to Sell); every control inside has its own keys.
    <div
      className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || section === 'sell' || event.defaultPrevented) return;
        // ⚠ Esc inside a dialog closes the dialog, never the section under it.
        if (event.target instanceof Element && event.target.closest('dialog')) return;
        go('sell');
      }}
    >
      <nav aria-label="Point of sale" className="flex items-center gap-1">
        {/* A narrow panel folds the bar into a menu (D23). */}
        <label className="@xl:hidden">
          <span className="sr-only">Section</span>
          <select
            className={cn(INPUT_CLASS, 'h-8 w-auto')}
            value={section}
            // The options are the sections above, so the value is one of them.
            onChange={(event) => go(event.target.value as Section)}
          >
            {sections.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
                {entry.badge ? ` (${entry.badge})` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="hidden flex-wrap items-center gap-1 @xl:flex">
          {sections.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-current={section === entry.key ? 'page' : undefined}
              className={cn(buttonClass(section === entry.key ? 'primary' : 'ghost', 'sm'))}
              onClick={() => go(entry.key)}
            >
              {entry.label}
              {entry.badge ? (
                <span className="rounded-full bg-status-warning px-1.5 text-[10px] text-status-warning-foreground tabular-nums">
                  {entry.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {!state.live ? (
          <span className="ml-auto text-xs text-muted-foreground">
            Not live — other tills’ changes show when you reload.
          </span>
        ) : null}
      </nav>

      {section === 'sell' ? (
        <>
          {state.error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
            >
              {state.error}
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={state.dismissError}>
                Dismiss
              </button>
            </div>
          ) : null}
          <Till state={state} />
        </>
      ) : null}
      {section === 'orders' ? (
        <OrdersSection state={state} openOrderId={openOrderId} onToSell={() => go('sell')} />
      ) : null}
      {section === 'items' && canManageItems ? <ItemsSection state={state} /> : null}
      {section === 'customers' ? (
        <CustomersSection
          state={state}
          onOpenOrder={(orderId) => {
            setOpenOrderId(orderId);
            setSection('orders');
          }}
        />
      ) : null}
      {section === 'settings' && canManageSettings ? <SettingsSection state={state} /> : null}
    </div>
  );
}
