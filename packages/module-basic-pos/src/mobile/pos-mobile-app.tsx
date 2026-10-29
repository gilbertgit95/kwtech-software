'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useMobileSection } from '@kwtech/module-kit/react';
import { buttonClass } from '../react/components/controls.js';
import { TakeOrders } from '../react/components/take-orders.js';
import { useTill } from '../react/use-till.js';
import { POS_MOBILE_SECTION } from './sections.js';

/**
 * The point of sale on a phone (issue #22): the same app as the Apps page's,
 * with its sections in the phone frame's strip. Today it has ONE, Sell — the
 * operator's choice for the phone — and Orders, Items, Customers, Reports and
 * Settings stay on the full site until each is brought here as a section of
 * its own (`POS_MOBILE_SECTION` and `posMobileModule`).
 *
 * Sell on a phone is TAKE ORDERS (issue #23), not the till: a phone or a
 * handheld is the seller's, carried between tables, and every order it takes
 * is held for the cashier, who pays it on the full screen's Cashier board.
 * The keyboard till (`Till`) is not offered here at all (the operator,
 * 2026-10-29). `useTill` lives here, above the sections, as in `PosApp`, so a
 * later section never costs the order being built.
 */
export function PosMobileApp({ organizationId, workspaceId }: AppProps) {
  const state = useTill(organizationId, workspaceId);
  // The frame owns which section is open; this app has only Sell for now, so every answer is Sell.
  const { section } = useMobileSection();

  return (
    <div
      data-section={section ?? POS_MOBILE_SECTION.sell}
      className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground"
    >
      {!state.live ? (
        <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          Not live — other tills’ changes show when you reload.
        </p>
      ) : null}
      {state.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={state.dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}
      <TakeOrders state={state} phone />
    </div>
  );
}
