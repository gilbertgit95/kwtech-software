'use client';

import type { AppProps } from '@kwtech/module-kit';
import { buttonClass } from '../react/components/controls.js';
import { Till } from '../react/components/till.js';
import { useTill } from '../react/use-till.js';

/**
 * The point of sale on a phone (issue #22): the TILL, and nothing else — the
 * operator's choice for the phone ("strictly Sell"). Orders, Items,
 * Customers, Reports and Settings stay on the full site.
 *
 * The same `useTill` and `Till` as the Apps page's Sell section: the same
 * order kept as it is built, the same payment, the same live updates. The
 * till runs in its `phone` mode — the items fill the screen and the order
 * waits in a summary bar at the foot — with the frame's padding and the
 * till's error line, as `PosApp` shows them above Sell.
 */
export function PosSellScreen({ organizationId, workspaceId }: AppProps) {
  const state = useTill(organizationId, workspaceId);

  return (
    <div className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground">
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
      <Till state={state} phone />
    </div>
  );
}
