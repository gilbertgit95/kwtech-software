'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useMobileSection, useMobileSectionBadge } from '@kwtech/module-kit/react';
import { buttonClass } from '../react/components/controls.js';
import { PhoneCashier } from '../react/components/phone-cashier.js';
import { TakeOrders } from '../react/components/take-orders.js';
import { useTill } from '../react/use-till.js';
import { POS_MOBILE_SECTION } from './sections.js';

/**
 * The point of sale on a phone (issue #22): the same app as the Apps page's,
 * with its sections in the phone frame's strip: Sell and Cashier. Orders,
 * Items, Customers, Reports and Settings stay on the full site until each is
 * brought here as a section of its own (`POS_MOBILE_SECTION` and
 * `posMobileModule`).
 *
 * - **Sell is TAKE ORDERS** (issue #23), not the till: a phone or a handheld
 *   carried between tables, every order it takes held for the cashier. The
 *   keyboard till (`Till`) is not offered here at all (the operator,
 *   2026-10-29).
 * - **Cashier** (issue #69, `PhoneCashier`): the held orders, and paying
 *   them, so a cashier or a manager never needs a desktop to settle one.
 *   This reverses the half of the 2026-10-29 decision that sent every payment
 *   to the full screen (PLAN §13, 2026-11-05).
 *
 * `useTill` lives here, above the sections, as in `PosApp`: switching section
 * never costs the order being built, and the cashier's "Add items" opens Take
 * orders on the very order they had open.
 */
export function PosMobileApp({ organizationId, workspaceId }: AppProps) {
  const state = useTill(organizationId, workspaceId);
  // The frame owns which section is open, among those this person holds; anything else is Sell.
  const { section } = useMobileSection();
  const shown = section === POS_MOBILE_SECTION.cashier ? POS_MOBILE_SECTION.cashier : POS_MOBILE_SECTION.sell;
  // How many wait, on the Cashier chip (issue #69): from the same live list both screens show.
  useMobileSectionBadge(POS_MOBILE_SECTION.cashier, state.canTakePayment ? state.pending.length : null);

  return (
    <div data-section={shown} className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground">
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
      {/*
       * ⚠ Cashier only with the key, here as well as in the strip: an address saved with
       * `?section=cashier` must not open it for somebody who lost the key since. Sell then
       * says for itself what this person may do.
       */}
      {shown === POS_MOBILE_SECTION.cashier && state.canTakePayment ? (
        <PhoneCashier state={state} />
      ) : (
        <TakeOrders state={state} phone />
      )}
    </div>
  );
}
