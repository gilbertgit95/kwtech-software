import { Inject, Injectable } from '@nestjs/common';
import { type PosRefundRequest, planRefund } from '../domain/refunds.js';
import { preparePosReason } from '../domain/text.js';
import { refusalError, unwrap } from './pos.errors.js';
import { PosEventPublisher } from './pos.events.js';
import { linesOf, loadOrder } from './pos.lookup.js';
import type { InScope, PosRefundRow, PosWriteClient } from './pos.repository.js';
import { POS_PRISMA_WRITE } from './pos.tokens.js';
import { isUniqueViolation } from './pos-catalogue.service.js';
import { isPosPaymentMethod } from './pos-order-write.service.js';

export interface PosRefundInput {
  /** By line: which lines and how many. Omitted or empty with `amount`: a refund by amount. */
  lines?: readonly { lineId: string; quantity: number }[] | null | undefined;
  /** By amount: centavos back, nothing returned. */
  amount?: number | null | undefined;
  /** How the money went back: `cash`, `ewallet` or `card`. */
  method: string;
  reason: string;
  /** The till's id for this refund: a double click does not refund twice. */
  clientId: string;
}

/**
 * Refunds (D17), bound to `pos:refund`: a record of its own against a PAID
 * order, which never changes. The caps — never more units than sold, never more
 * money than paid — are `planRefund`'s, checked against every earlier refund
 * in the same transaction that writes this one.
 */
@Injectable()
export class PosRefundService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly events: PosEventPublisher,
  ) {}

  async refund(scope: InScope, actorId: string, orderId: string, input: PosRefundInput): Promise<PosRefundRow> {
    if (!isPosPaymentMethod(input.method)) throw refusalError('invalid_method');
    const method = input.method;
    const { reason } = unwrap(preparePosReason(input.reason));
    const clientId = input.clientId.trim();
    if (!clientId || clientId.length > 100) {
      throw new Error('A refund needs the till’s clientId (crypto.randomUUID), so a retry is not a second refund.');
    }
    const request: PosRefundRequest =
      input.lines && input.lines.length > 0
        ? { kind: 'lines', lines: input.lines }
        : { kind: 'amount', amount: input.amount ?? 0 };

    const already = await this.prisma.posRefund.findFirst({ where: { ...scope, clientId } });
    if (already) return this.sameRefund(already, orderId);

    try {
      const refund = await this.prisma.$transaction(async (tx) => {
        const order = await loadOrder(tx, scope, orderId);
        const lines = await linesOf(tx, order.id);
        const earlier = await tx.posRefund.findMany({
          where: { ...scope, orderId: order.id },
          orderBy: [{ refundedAt: 'asc' }, { id: 'asc' }],
          take: 1000,
        });
        const earlierLines = earlier.length
          ? await tx.posRefundLine.findMany({ where: { refundId: { in: earlier.map((row) => row.id) } } })
          : [];
        const quantities: Record<string, number> = {};
        for (const line of earlierLines)
          quantities[line.orderLineId] = (quantities[line.orderLineId] ?? 0) + line.quantity;
        const plan = unwrap(
          planRefund(
            {
              status: order.status,
              total: order.total,
              lines: lines.map((l) => ({ id: l.id, quantity: l.quantity, net: l.net })),
            },
            { quantities, amount: earlier.reduce((sum, row) => sum + row.amount, 0) },
            request,
          ),
        );
        const created = await tx.posRefund.create({
          data: { ...scope, orderId: order.id, amount: plan.amount, method, reason, refundedById: actorId, clientId },
        });
        // In order: each line of the refund, one at a time, inside its transaction.
        for (const line of plan.lines) {
          await tx.posRefundLine.create({
            data: {
              ...scope,
              refundId: created.id,
              orderLineId: line.lineId,
              quantity: line.quantity,
              amount: line.amount,
            },
          });
        }
        return created;
      });
      await this.events.changed(scope, 'order', actorId, orderId);
      return refund;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.posRefund.findFirst({ where: { ...scope, clientId } });
      if (raced) return this.sameRefund(raced, orderId);
      throw refusalError('conflict');
    }
  }

  private sameRefund(refund: PosRefundRow, orderId: string): PosRefundRow {
    if (refund.orderId !== orderId) throw refusalError('conflict');
    return refund;
  }
}
