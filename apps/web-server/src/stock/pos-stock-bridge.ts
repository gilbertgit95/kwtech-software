import { StockIntakeService } from '@kwtech/module-basic-inventory/server';
import type { PosStockEvent, PosStockEvents, PosStockLevel, PosStockLevels } from '@kwtech/module-basic-pos/server';
import type { ModuleRef } from '@nestjs/core';

/**
 * What the point of sale tells stock — each line that left the store or came
 * back, after its commit — and what it asks — how many are left, for the till.
 *
 * ## ⚠ WHY IT FINDS THE INTAKE LATE, through `ModuleRef`
 *
 * Stock already imports the POS's module (it reads the POS's items and feed,
 * `pos-source.ts`). For the POS to inject stock's `StockIntakeService` it would
 * have to import stock's module too: a cycle Nest refuses at boot. So the POS's
 * ports are bound to this bridge, which looks the intake up from the container
 * the first time it is needed — as `module-jobs` finds each process's handler.
 * By then every module is built.
 *
 * Not finding it means stock is not mounted: nothing is recorded and the till
 * shows no counts, exactly as with the ports unbound.
 */
export class PosStockBridge implements PosStockEvents, PosStockLevels {
  private intake: StockIntakeService | null | undefined;

  constructor(private readonly moduleRef: ModuleRef) {}

  async record(organizationId: string, workspaceId: string, events: readonly PosStockEvent[]): Promise<void> {
    // The two event shapes are each module's own; they line up field for field, and the compiler checks it here.
    await this.find()?.apply({ organizationId, workspaceId }, events);
  }

  async levelsFor(
    organizationId: string,
    workspaceId: string,
    refs: readonly { itemId: string; variantId: string | null }[],
  ): Promise<readonly PosStockLevel[]> {
    return (await this.find()?.levelsFor({ organizationId, workspaceId }, refs)) ?? [];
  }

  private find(): StockIntakeService | null {
    if (this.intake !== undefined) return this.intake;
    let found: StockIntakeService | null = null;
    try {
      found = this.moduleRef.get(StockIntakeService, { strict: false });
    } catch {
      // Stock is not mounted in this app: remember it, and answer as an unbound port does.
    }
    this.intake = found;
    return found;
  }
}
