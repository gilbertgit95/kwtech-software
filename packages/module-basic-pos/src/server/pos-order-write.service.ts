import { Inject, Injectable } from '@nestjs/common';
import { posCustomerContactLine } from '../domain/customers.js';
import { checkPosDiscount, checkPosQuantity, discountSurvivesEdit } from '../domain/money.js';
import {
  cancelNeedsReason,
  checkOrderVersion,
  checkPayLater,
  nextOrderStatus,
  type PosChangeSettlement,
  type PosPaymentInput,
  planPayment,
} from '../domain/orders.js';
import {
  POS_NAME_MAX,
  preparePosContact,
  preparePosLabel,
  preparePosLine,
  preparePosNote,
  preparePosReason,
} from '../domain/text.js';
import { POS_FEATURE } from '../feature-keys.js';
import type { PosDiscount, PosOrderStatus, PosPaymentMethod, PosRefusal } from '../types.js';
import { refusalError, unwrap } from './pos.errors.js';
import { PosEventPublisher } from './pos.events.js';
import { linesOf, loadOrder, recomputeTotals, saveOrder, storedDiscount } from './pos.lookup.js';
import type {
  InScope,
  PosOrderLineRow,
  PosOrderRow,
  PosOrderUpdate,
  PosTransaction,
  PosWriteClient,
} from './pos.repository.js';
import { POS_PRISMA_WRITE } from './pos.tokens.js';
import { PosAccessService } from './pos-access.service.js';
import { isUniqueViolation } from './pos-catalogue.service.js';

/** How many lines one order may have. Past this it is a delivery note, not a sale at a counter. */
export const POS_ORDER_LINES_MAX = 200;

export const POS_PAYMENT_METHODS = ['cash', 'ewallet', 'card'] as const satisfies readonly PosPaymentMethod[];

/** A method as it arrives over the wire — a string — narrowed. */
export function isPosPaymentMethod(value: unknown): value is PosPaymentMethod {
  return (POS_PAYMENT_METHODS as readonly unknown[]).includes(value);
}

/** Which order, at which version: every change names both (guard rules, "two people on one order"). */
export interface PosOrderRef {
  orderId: string;
  version: number;
}

export interface PosDiscountInput {
  /** `amount` (centavos) or `percent` (basis points). */
  kind: string;
  value: number;
  reason: string;
}

export interface PosPayInput {
  /** `cash`, `ewallet` or `card`. */
  method: string;
  received: number;
  tip?: number | null | undefined;
  changeOwed?: number | null | undefined;
  reference?: string | null | undefined;
  /** The till's id for this payment: a double click or a retry is answered with the same order, not paid twice. */
  clientId: string;
}

type Change = {
  data: Omit<PosOrderUpdate, 'version'>;
  /** Lines were added, removed or re-priced: add the order up again. */
  linesChanged?: boolean;
};

type Step = (tx: PosTransaction, order: PosOrderRow, lines: PosOrderLineRow[]) => Promise<Change>;

/**
 * Every change to an order: its lines, customer, label, discounts, payment,
 * and how it ends.
 *
 * Each goes through `change`: find the order BY ID AND SCOPE, check its status
 * and the version the till saw, make the change, add it up again with
 * `computeOrderTotals`, and save it as a compare-and-set on the version — all
 * in one transaction — then publish `order` after the commit.
 */
@Injectable()
export class PosOrderWriteService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly events: PosEventPublisher,
    private readonly access: PosAccessService,
  ) {}

  /** A new, empty, open order. The cart is saved as it is built (§3), so holding it loses nothing. */
  async create(scope: InScope, actorId: string, rawLabel: string | null): Promise<PosOrderRow> {
    const { label } = unwrap(preparePosLabel(rawLabel ?? ''));
    const order = await this.prisma.posOrder.create({ data: { ...scope, createdById: actorId, label } });
    await this.events.changed(scope, 'order', actorId, order.id);
    return order;
  }

  // ── lines ─────────────────────────────────────────────────────────────────

  /**
   * Adds an item (or one of its variants), COPYING what it is now — name,
   * kind, variant, code, category, price and cost (§3) — so nothing done to
   * the item later changes this order.
   *
   * The same item and variant again, on a plain line (no note, no discount),
   * adds to that line's quantity: tapping "Ref magnet" twice is one line of 2.
   */
  async addLine(
    scope: InScope,
    actorId: string,
    ref: PosOrderRef,
    input: { itemId: string; variantId?: string | null | undefined; quantity: number },
  ): Promise<PosOrderRow> {
    refuse(checkPosQuantity(input.quantity));
    const mayDiscount = await this.access.holds(scope, actorId, POS_FEATURE.discount);
    return this.change(scope, actorId, ref, ['open'], async (tx, order, lines) => {
      const item = await tx.posItem.findFirst({ where: { ...scope, id: input.itemId } });
      if (!item) throw refusalError('not_found');
      if (item.archivedAt) throw refusalError('item_archived');
      const variants = await tx.posItemVariant.findMany({
        where: { ...scope, itemId: item.id, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1000,
      });
      const variant = input.variantId ? variants.find((candidate) => candidate.id === input.variantId) : null;
      if (input.variantId && !variant) throw refusalError('item_archived');
      if (!variant && variants.length > 0) throw refusalError('variant_required');

      const same = lines.find(
        (line) =>
          line.itemId === item.id &&
          line.variantId === (variant?.id ?? null) &&
          line.note === null &&
          line.discountKind === null,
      );
      if (same) {
        const quantity = same.quantity + input.quantity;
        refuse(checkPosQuantity(quantity));
        await tx.posOrderLine.updateMany({ where: { id: same.id, orderId: order.id }, data: { quantity } });
        return { data: this.orderDiscountAfterEdit(order, mayDiscount), linesChanged: true };
      }

      if (lines.length >= POS_ORDER_LINES_MAX) throw refusalError('limit_reached');
      const category = item.categoryId
        ? await tx.posCategory.findFirst({ where: { ...scope, id: item.categoryId } })
        : null;
      const unitPrice = variant ? variant.price : item.price;
      await tx.posOrderLine.create({
        data: {
          ...scope,
          orderId: order.id,
          position: (lines.at(-1)?.position ?? 0) + 1,
          itemId: item.id,
          variantId: variant?.id ?? null,
          name: item.name,
          kind: item.kind,
          variantName: variant?.name ?? null,
          code: variant ? variant.code : item.code,
          categoryName: category?.name ?? null,
          unitPrice,
          unitCost: variant ? variant.cost : item.cost,
          quantity: input.quantity,
          note: null,
          discountKind: null,
          discountValue: null,
          discountAmount: 0,
          discountReason: null,
          discountById: null,
          discountAt: null,
          gross: unitPrice * input.quantity,
          total: unitPrice * input.quantity,
          net: unitPrice * input.quantity,
        },
      });
      return { data: this.orderDiscountAfterEdit(order, mayDiscount), linesChanged: true };
    });
  }

  /**
   * A line's quantity or note. ⚠ A NEW QUANTITY FROM SOMEBODY WHO MAY NOT
   * DISCOUNT DROPS FIXED DISCOUNTS — the line's own, and the order's (guard
   * rules): ₱100 off 100 magnets must not end up covering 7.
   */
  async updateLine(
    scope: InScope,
    actorId: string,
    ref: PosOrderRef,
    lineId: string,
    input: { quantity?: number | null | undefined; note?: string | null | undefined },
  ): Promise<PosOrderRow> {
    if (input.quantity != null) refuse(checkPosQuantity(input.quantity));
    const note = input.note == null ? undefined : unwrap(preparePosNote(input.note)).note;
    const mayDiscount = await this.access.holds(scope, actorId, POS_FEATURE.discount);
    return this.change(scope, actorId, ref, ['open'], async (tx, order, lines) => {
      const line = findLine(lines, lineId);
      const quantityChanges = input.quantity != null && input.quantity !== line.quantity;
      const data: Partial<PosOrderLineRow> = {};
      if (note !== undefined) data.note = note;
      if (quantityChanges && input.quantity != null) {
        data.quantity = input.quantity;
        if (!discountSurvivesEdit(storedDiscount(line), mayDiscount)) Object.assign(data, NO_LINE_DISCOUNT);
      }
      await tx.posOrderLine.updateMany({ where: { id: line.id, orderId: order.id }, data });
      return {
        data: quantityChanges ? this.orderDiscountAfterEdit(order, mayDiscount) : {},
        linesChanged: quantityChanges,
      };
    });
  }

  async removeLine(scope: InScope, actorId: string, ref: PosOrderRef, lineId: string): Promise<PosOrderRow> {
    const mayDiscount = await this.access.holds(scope, actorId, POS_FEATURE.discount);
    return this.change(scope, actorId, ref, ['open'], async (tx, order, lines) => {
      const line = findLine(lines, lineId);
      await tx.posOrderLine.deleteMany({ where: { id: line.id, orderId: order.id } });
      return { data: this.orderDiscountAfterEdit(order, mayDiscount), linesChanged: true };
    });
  }

  /**
   * Re-copies a line from the item as it is NOW — the "Price is now ₱50 ·
   * Update" of a held order (§3). The cashier's choice: a held order keeps the
   * price the customer was told until then.
   */
  async refreshLine(scope: InScope, actorId: string, ref: PosOrderRef, lineId: string): Promise<PosOrderRow> {
    const mayDiscount = await this.access.holds(scope, actorId, POS_FEATURE.discount);
    return this.change(scope, actorId, ref, ['open'], async (tx, order, lines) => {
      const line = findLine(lines, lineId);
      const item = await tx.posItem.findFirst({ where: { ...scope, id: line.itemId } });
      if (!item || item.archivedAt) throw refusalError('item_archived');
      const variant = line.variantId
        ? await tx.posItemVariant.findFirst({ where: { ...scope, id: line.variantId, itemId: item.id } })
        : null;
      if (line.variantId && (!variant || variant.archivedAt)) throw refusalError('item_archived');
      const data: Partial<PosOrderLineRow> = {
        name: item.name,
        kind: item.kind,
        variantName: variant?.name ?? null,
        code: variant ? variant.code : item.code,
        unitPrice: variant ? variant.price : item.price,
        unitCost: variant ? variant.cost : item.cost,
      };
      if (!discountSurvivesEdit(storedDiscount(line), mayDiscount)) Object.assign(data, NO_LINE_DISCOUNT);
      await tx.posOrderLine.updateMany({ where: { id: line.id, orderId: order.id }, data });
      return { data: this.orderDiscountAfterEdit(order, mayDiscount), linesChanged: true };
    });
  }

  // ── who and what ──────────────────────────────────────────────────────────

  /**
   * Who the order is for (D5): a recorded customer (copied), or free text, or
   * nobody (a walk-in). While `open` — and while `unpaid`, so "it's Juan, he'll
   * pay Friday" can be put right after the fact. A paid order keeps what it had.
   */
  async setCustomer(
    scope: InScope,
    actorId: string,
    ref: PosOrderRef,
    input: {
      customerId?: string | null | undefined;
      name?: string | null | undefined;
      contact?: string | null | undefined;
    },
  ): Promise<PosOrderRow> {
    return this.change(scope, actorId, ref, ['open', 'unpaid'], async (tx, order) => {
      if (input.customerId) {
        const customer = await tx.posCustomer.findFirst({ where: { ...scope, id: input.customerId } });
        if (!customer) throw refusalError('not_found');
        // One line on the order, from whichever way of reaching them is recorded (`posCustomerContactLine`).
        const customerContact = posCustomerContactLine(customer);
        return { data: { customerId: customer.id, customerName: customer.name, customerContact } };
      }
      const name = preparePosLine(input.name ?? '', POS_NAME_MAX, { allowEmpty: true });
      if (name === null) throw refusalError('invalid_name');
      const { contact } = unwrap(preparePosContact(input.contact ?? ''));
      // ⚠ An unpaid order may not lose the details that made it unpaid (D13).
      if (order.status === 'unpaid' && (!name || !contact)) throw refusalError('customer_required');
      return { data: { customerId: null, customerName: name || null, customerContact: contact } };
    });
  }

  async setLabel(scope: InScope, actorId: string, ref: PosOrderRef, rawLabel: string | null): Promise<PosOrderRow> {
    const { label } = unwrap(preparePosLabel(rawLabel ?? ''));
    return this.change(scope, actorId, ref, ['open'], async () => ({ data: { label } }));
  }

  // ── discounts (bound to pos:discount) ─────────────────────────────────────

  /** A line's discount, or none (`discount` null). Records who gave it and when (guard rules). */
  async setLineDiscount(
    scope: InScope,
    actorId: string,
    ref: PosOrderRef,
    lineId: string,
    input: PosDiscountInput | null,
  ): Promise<PosOrderRow> {
    const discount = input ? prepareDiscount(input, actorId) : NO_LINE_DISCOUNT;
    return this.change(scope, actorId, ref, ['open'], async (tx, order, lines) => {
      const line = findLine(lines, lineId);
      await tx.posOrderLine.updateMany({ where: { id: line.id, orderId: order.id }, data: discount });
      return { data: {}, linesChanged: true };
    });
  }

  /** The whole order's discount, applied after line discounts (D16), or none. */
  async setOrderDiscount(
    scope: InScope,
    actorId: string,
    ref: PosOrderRef,
    input: PosDiscountInput | null,
  ): Promise<PosOrderRow> {
    const discount = input ? prepareDiscount(input, actorId) : NO_LINE_DISCOUNT;
    return this.change(scope, actorId, ref, ['open'], async () => ({
      data: {
        discountKind: discount.discountKind,
        discountValue: discount.discountValue,
        discountReason: discount.discountReason,
        discountById: discount.discountById,
        discountAt: discount.discountAt,
      },
      linesChanged: true,
    }));
  }

  // ── how it ends ───────────────────────────────────────────────────────────

  /**
   * Takes payment for an open or unpaid order (D12–D14): the amounts checked
   * by `planPayment`, a number taken if it has none, and who took it recorded
   * — the person the sale is credited to.
   *
   * ⚠ IDEMPOTENT ON `clientId`. A double click or a retry after a timeout finds
   * the order this payment already paid and answers with it, rather than paying
   * a second time; the schema's `@@unique([workspaceId, paymentClientId])` is
   * the backstop when two arrive at once.
   */
  async pay(scope: InScope, actorId: string, ref: PosOrderRef, input: PosPayInput): Promise<PosOrderRow> {
    if (!isPosPaymentMethod(input.method)) throw refusalError('invalid_method');
    const clientId = input.clientId.trim();
    if (!clientId || clientId.length > 100) {
      throw new Error('A payment needs the till’s clientId (crypto.randomUUID), so a retry is not a second payment.');
    }
    const reference = preparePosLine(input.reference ?? '', 100, { allowEmpty: true });
    if (reference === null) throw refusalError('invalid_note');
    const payment: PosPaymentInput = {
      method: input.method,
      received: input.received,
      tip: input.tip ?? 0,
      changeOwed: input.changeOwed ?? 0,
    };

    const already = await this.prisma.posOrder.findFirst({ where: { ...scope, paymentClientId: clientId } });
    if (already) return this.samePayment(already, ref.orderId);

    try {
      return await this.change(scope, actorId, ref, ['open', 'unpaid'], async (tx, order, lines) => {
        if (lines.length === 0) throw refusalError('invalid_transition');
        const { change } = unwrap(
          planPayment(order.total, payment, { name: order.customerName, contact: order.customerContact }),
        );
        const now = new Date();
        const status = unwrap(nextOrderStatus(order.status, 'pay')).status;
        const number = order.number ?? (await takeNumber(tx, scope));
        return {
          data: {
            status,
            number,
            finalisedAt: order.finalisedAt ?? now,
            finalisedById: order.finalisedById ?? actorId,
            paidAt: now,
            paidById: actorId,
            paymentMethod: payment.method,
            received: payment.received,
            change,
            tip: payment.tip,
            changeOwed: payment.changeOwed,
            paymentReference: reference || null,
            paymentClientId: clientId,
          },
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.posOrder.findFirst({ where: { ...scope, paymentClientId: clientId } });
      if (raced) return this.samePayment(raced, ref.orderId);
      throw refusalError('conflict');
    }
  }

  /**
   * Pay later (D13): numbered and locked now, paid another day. Needs the
   * customer's name and contact, and records who released it (guard rules).
   */
  async payLater(scope: InScope, actorId: string, ref: PosOrderRef): Promise<PosOrderRow> {
    return this.change(scope, actorId, ref, ['open'], async (tx, order, lines) => {
      refuse(checkPayLater({ name: order.customerName, contact: order.customerContact }, lines.length));
      const status = unwrap(nextOrderStatus(order.status, 'pay_later')).status;
      return {
        data: {
          status,
          number: await takeNumber(tx, scope),
          finalisedAt: new Date(),
          finalisedById: actorId,
          releasedUnpaid: true,
        },
      };
    });
  }

  /**
   * Drops an open order. ⚠ ONCE IT HAS LINES, A REASON IS REQUIRED, and it
   * stays on the record with who and when (guard rules) — cancelling instead of
   * paying is where a ₱500 sale goes missing.
   */
  async cancel(scope: InScope, actorId: string, ref: PosOrderRef, rawReason: string | null): Promise<PosOrderRow> {
    return this.change(scope, actorId, ref, ['open'], async (_tx, order, lines) => {
      const reason = cancelNeedsReason(lines.length) ? unwrap(preparePosReason(rawReason ?? '')).reason : null;
      const status = unwrap(nextOrderStatus(order.status, 'cancel')).status;
      return { data: { status, cancelledAt: new Date(), cancelledById: actorId, cancelReason: reason } };
    });
  }

  /** Voids an unpaid order whose items came back (D17). Bound to `pos:refund`. Keeps its number. */
  async void(scope: InScope, actorId: string, ref: PosOrderRef, rawReason: string): Promise<PosOrderRow> {
    const { reason } = unwrap(preparePosReason(rawReason));
    return this.change(scope, actorId, ref, ['unpaid'], async (_tx, order) => {
      const status = unwrap(nextOrderStatus(order.status, 'void')).status;
      return { data: { status, voidedAt: new Date(), voidedById: actorId, voidReason: reason } };
    });
  }

  /**
   * Settles change the store owed (D14): handed over, or — the customer said
   * keep it — a tip. In full, once; who and when are kept.
   */
  async settleChangeOwed(scope: InScope, actorId: string, ref: PosOrderRef, settlement: string): Promise<PosOrderRow> {
    if (settlement !== 'given' && settlement !== 'tip') throw refusalError('invalid_transition');
    const how: PosChangeSettlement = settlement;
    return this.change(scope, actorId, ref, ['paid'], async (_tx, order) => {
      if (order.changeOwed <= 0 || order.changeSettledAt) throw refusalError('invalid_transition');
      return { data: { changeSettlement: how, changeSettledAt: new Date(), changeSettledById: actorId } };
    });
  }

  // ── the one way an order changes ──────────────────────────────────────────

  private async change(
    scope: InScope,
    actorId: string,
    ref: PosOrderRef,
    allowed: readonly PosOrderStatus[],
    step: Step,
  ): Promise<PosOrderRow> {
    const saved = await this.prisma.$transaction(async (tx) => {
      const order = await loadOrder(tx, scope, ref.orderId);
      // ⚠ Status BEFORE version: an order already paid by the other till says
      // so, rather than "somebody changed it".
      if (!allowed.includes(order.status)) throw refusalError(statusRefusal(allowed));
      refuse(checkOrderVersion(ref.version, order.version));
      const lines = await linesOf(tx, order.id);
      const { data, linesChanged } = await step(tx, order, lines);
      let totals = {};
      if (linesChanged) {
        const merged = { ...order, ...data } as PosOrderRow;
        totals = await recomputeTotals(tx, merged, await linesOf(tx, order.id));
      }
      await saveOrder(tx, scope, order, { ...data, ...totals });
      return loadOrder(tx, scope, order.id);
    });
    await this.events.changed(scope, 'order', actorId, saved.id);
    return saved;
  }

  /**
   * ⚠ The order discount after a change to the lines by somebody who may not
   * discount: a fixed one is dropped (guard rules), a percentage kept.
   */
  private orderDiscountAfterEdit(order: PosOrderRow, mayDiscount: boolean): Omit<PosOrderUpdate, 'version'> {
    if (discountSurvivesEdit(storedDiscount(order), mayDiscount)) return {};
    return {
      discountKind: null,
      discountValue: null,
      discountReason: null,
      discountById: null,
      discountAt: null,
    };
  }

  private samePayment(order: PosOrderRow, orderId: string): PosOrderRow {
    // The same client id on ANOTHER order is not a retry of this payment.
    if (order.id !== orderId) throw refusalError('conflict');
    return order;
  }
}

const NO_LINE_DISCOUNT = {
  discountKind: null,
  discountValue: null,
  discountReason: null,
  discountById: null,
  discountAt: null,
} as const;

function prepareDiscount(input: PosDiscountInput, actorId: string) {
  if (input.kind !== 'amount' && input.kind !== 'percent') throw refusalError('invalid_discount');
  const discount: PosDiscount = { kind: input.kind, value: input.value };
  refuse(checkPosDiscount(discount));
  const { reason } = unwrap(preparePosReason(input.reason));
  return {
    discountKind: discount.kind,
    discountValue: discount.value,
    discountReason: reason,
    discountById: actorId,
    discountAt: new Date(),
  };
}

/**
 * The next order number of the store, taken ATOMICALLY in the finalising
 * transaction: an upsert that increments, so two tills get two numbers and a
 * rolled-back finalise gives its number back.
 */
async function takeNumber(tx: PosTransaction, scope: InScope): Promise<number> {
  const counter = await tx.posCounter.upsert({
    where: { workspaceId: scope.workspaceId },
    create: { ...scope, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });
  return counter.nextNumber - 1;
}

function findLine(lines: readonly PosOrderLineRow[], lineId: string): PosOrderLineRow {
  const line = lines.find((candidate) => candidate.id === lineId);
  if (!line) throw refusalError('unknown_line');
  return line;
}

function statusRefusal(allowed: readonly PosOrderStatus[]): PosRefusal {
  if (allowed.includes('open')) return 'not_open';
  if (allowed.includes('unpaid')) return 'not_unpaid';
  return 'not_paid';
}

function refuse(refusal: PosRefusal | null): void {
  if (refusal) throw refusalError(refusal);
}
