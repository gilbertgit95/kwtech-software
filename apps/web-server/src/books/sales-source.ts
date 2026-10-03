import type { BooksSalesFigures, BooksSalesSource } from '@kwtech/module-basic-bookkeeping/server';
import { PosReportService } from '@kwtech/module-basic-pos/server';

/**
 * The books' sales, from the point of sale — the one place the two modules
 * meet, and it is here because neither may import the other (PLAN §9).
 *
 * The POS counts its takings the way its own dashboard does
 * (`PosReportService.takings`: a sale on the day it was PAID, a refund on the
 * day it was made, money KEPT per method). This only renames: card payments
 * land in the bank, so `card` is the books' `bank`.
 *
 * ⚠ THE POS'S OWN SERVICE, from the POS's own module instance (see
 * `POS_SERVER_MODULE` in app.module.ts) — never a second copy reading
 * `pos_order` here, which would be a second set of counting rules that drift
 * from the dashboard's.
 */
export class BooksPosSalesSource implements BooksSalesSource {
  constructor(private readonly reports: PosReportService) {}

  async salesBetween(
    organizationId: string,
    workspaceId: string,
    fromDay: string,
    toDay: string,
  ): Promise<BooksSalesFigures> {
    const { summary, truncated } = await this.reports.takings({ organizationId, workspaceId }, fromDay, toDay);
    return {
      cash: summary.byMethod.cash,
      ewallet: summary.byMethod.ewallet,
      bank: summary.byMethod.card,
      costOfGoods: summary.costOfGoods,
      costCoverage: summary.costCoverage,
      orders: summary.orders,
      truncated,
    };
  }
}
