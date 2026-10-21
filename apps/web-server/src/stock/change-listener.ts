import type { StockChangeListener } from '@kwtech/module-basic-inventory/server';
import { PosEventPublisher } from '@kwtech/module-basic-pos/server';

/**
 * Stock moved in a workspace — a sale taken, a delivery, a count — so every open
 * till re-reads its "3 left". Relayed as the POS's own `stock` event, because a
 * till listens to `posEvents` and nothing else.
 *
 * ⚠ NO CONTENT: the event carries the workspace only, and the till reads the
 * counts again through `posStockLevels`, guarded by `pos:read`.
 */
export class StockToPosChangeListener implements StockChangeListener {
  constructor(private readonly events: PosEventPublisher) {}

  async stockChanged(organizationId: string, workspaceId: string): Promise<void> {
    // The POS's event names who did it; a stock change from a sale was nobody at this till.
    await this.events.changed({ organizationId, workspaceId }, 'stock', 'stock');
  }
}
