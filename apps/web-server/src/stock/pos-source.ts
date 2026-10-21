import type {
  StockSaleFeed,
  StockSourceCatalogue,
  StockSourceEvent,
  StockSourceItem,
} from '@kwtech/module-basic-inventory/server';
import { PosStockService } from '@kwtech/module-basic-pos/server';

/**
 * What stock reads from the point of sale — its items, to hang materials lists
 * on, and its feed of finalised, voided and refunded lines, for the catch-up —
 * the one place the two modules meet in this direction, here because neither
 * may import the other (PLAN §9).
 *
 * ⚠ THE POS'S OWN SERVICE, from the POS's own module instance (see
 * `POS_SERVER_MODULE` in app.module.ts) — never a second copy reading
 * `pos_order` here, which would be a second idea of when a line left the store.
 *
 * The shapes are each module's own and copied from nothing; this only passes
 * them across. They line up field for field today, and the compiler says so the
 * day one of them changes.
 */
export class StockPosSource implements StockSourceCatalogue, StockSaleFeed {
  constructor(private readonly pos: PosStockService) {}

  async itemsOf(organizationId: string, workspaceId: string, limit: number): Promise<readonly StockSourceItem[]> {
    const entries = await this.pos.catalogue({ organizationId, workspaceId }, limit);
    return entries.map((entry) => ({
      itemId: entry.itemId,
      variantId: entry.variantId,
      itemName: entry.itemName,
      variantName: entry.variantName,
      kind: entry.kind,
      code: entry.code,
      archived: entry.archived,
    }));
  }

  async eventsSince(
    organizationId: string,
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<readonly StockSourceEvent[]> {
    return this.pos.eventsSince({ organizationId, workspaceId }, since, limit);
  }
}
