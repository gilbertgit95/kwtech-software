'use client';

import { cn } from '@kwtech/web-ui/react';
import type { PosOrderView } from '../pos-client.js';
import type { TillState } from '../use-till.js';
import { liveOrderTypes } from '../view/take-orders.js';

/**
 * How the order is served — "Dine-in", "Takeout" — as a row of buttons, one
 * tap each. Shown only when the store has order types (the Items tab); a
 * store with none never sees it.
 *
 * - OPTIONAL: tapping the chosen one again clears it.
 * - On a clear till a tap starts the order: the server starts it on the
 *   store's defaults (type and reference), then sets the one tapped.
 * - `large` is the phone's: buttons a thumb can hit, in a row that scrolls.
 * - INSIDE THE ORDER, never on the items screen (the operator, 2026-10-29):
 *   the Take orders sheet and the till's order panel. Named "Order type" on
 *   screen there, since nothing else beside it says what the buttons are.
 */
export function OrderTypePicker({
  state,
  order,
  large = false,
  labelled = false,
}: {
  state: TillState;
  order: PosOrderView | null;
  large?: boolean;
  /** Says "Order type" before the buttons, where nothing else around says what they are. */
  labelled?: boolean;
}) {
  const types = state.catalogue ? liveOrderTypes(state.catalogue) : [];
  if (types.length === 0) return null;
  const { client, scope } = state;
  const choose = (orderTypeId: string) => {
    const next = order?.orderTypeId === orderTypeId ? null : orderTypeId;
    void state.act((current) => client.setOrderType(scope, current, next), { create: true });
  };
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Order type</legend>
      <div className={cn('flex items-center gap-1.5', large ? '-mx-1 overflow-x-auto px-1 pb-1' : 'flex-wrap')}>
        {labelled ? (
          <span aria-hidden="true" className="shrink-0 pr-1 text-xs font-medium text-muted-foreground">
            Order type
          </span>
        ) : null}
        {types.map((type) => {
          const chosen = order?.orderTypeId === type.id;
          return (
            <button
              key={type.id}
              type="button"
              aria-pressed={chosen}
              disabled={state.busy}
              onClick={() => choose(type.id)}
              className={cn(
                'shrink-0 rounded-full border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70',
                large ? 'min-h-11 px-4 text-sm' : 'px-2.5 py-1 text-xs',
                chosen
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-accent active:bg-accent',
              )}
            >
              {type.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
