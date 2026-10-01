'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useHoldsFeature } from '@kwtech/module-kit/react';
import { BarChart3, type LucideIcon, Package, ReceiptText, Settings, ShoppingCart, Users } from 'lucide-react';
import { useCallback, useState } from 'react';
import { POS_FEATURE } from '../feature-keys.js';
import { buttonClass } from './components/controls.js';
import { CustomersSection } from './components/customers-section.js';
import { ItemsSection } from './components/items-section.js';
import { SectionBar } from './components/layout.js';
import { OrdersSection } from './components/orders-section.js';
import { ReportsSection } from './components/reports-section.js';
import { SettingsSection } from './components/settings-section.js';
import { Till } from './components/till.js';
import type { PosClient } from './pos-client.js';
import { usePosData } from './use-pos-data.js';
import { useTill } from './use-till.js';

type Section = 'sell' | 'orders' | 'items' | 'customers' | 'reports' | 'settings';

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
  const canSeeReports = useHoldsFeature(POS_FEATURE.reports);
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

  const sections: { key: Section; label: string; icon: LucideIcon; badge?: number }[] = [
    { key: 'sell', label: 'Sell', icon: ShoppingCart },
    { key: 'orders', label: 'Orders', icon: ReceiptText, badge },
    ...(canManageItems ? [{ key: 'items' as const, label: 'Items', icon: Package }] : []),
    { key: 'customers', label: 'Customers', icon: Users },
    ...(canSeeReports ? [{ key: 'reports' as const, label: 'Reports', icon: BarChart3 }] : []),
    ...(canManageSettings ? [{ key: 'settings' as const, label: 'Settings', icon: Settings }] : []),
  ];
  /** An order opened from somewhere else (a customer's history, the Outstanding report) shows in Orders. */
  const openOrder = (orderId: string) => {
    setOpenOrderId(orderId);
    setSection('orders');
  };
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
      <SectionBar label="Point of sale" sections={sections} current={section} onChange={go}>
        {!state.live ? 'Not live — other tills’ changes show when you reload.' : null}
      </SectionBar>

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
      {section === 'customers' ? <CustomersSection state={state} onOpenOrder={openOrder} /> : null}
      {section === 'reports' && canSeeReports ? <ReportsSection state={state} onOpenOrder={openOrder} /> : null}
      {section === 'settings' && canManageSettings ? <SettingsSection state={state} /> : null}
    </div>
  );
}
