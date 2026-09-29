'use client';

import type { AppProps } from '@kwtech/module-kit';
import { cn } from '@kwtech/web-ui/react';
import { buttonClass } from './components/controls.js';
import { Till } from './components/till.js';
import type { PosClient } from './pos-client.js';
import { useTill } from './use-till.js';

/**
 * The point of sale as a SUB-APP on the workspace's Apps page (docs/POS-PLAN.md).
 *
 * - Laid out by the BOX's width, never the viewport's (`@container`), because a
 *   grid cell is narrow on a wide screen: the order sits beside the items when
 *   there is room and under them when there is not.
 * - Which section is open is this component's own state, never a URL (D23): a
 *   link would leave the Apps page and close every other app running on it.
 * - Says WHY when something is missing — no key to sell, no items yet, not live.
 */
export function PosApp({ organizationId, workspaceId, client }: AppProps & { client?: PosClient }) {
  const state = useTill(organizationId, workspaceId, client ? { client } : {});

  return (
    <div className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground">
      <nav aria-label="Point of sale" className="flex flex-wrap items-center gap-1">
        <button type="button" aria-current="page" className={cn(buttonClass('primary', 'sm'))}>
          Sell
        </button>
        {!state.live ? (
          <span className="ml-auto text-xs text-muted-foreground">
            Not live — other tills’ changes show when you reload.
          </span>
        ) : null}
      </nav>

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
    </div>
  );
}
