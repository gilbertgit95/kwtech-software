import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';

/*
 * The POS GraphQL shapes. Code-first, rendered from rows by the resolvers'
 * `render*` functions. Kinds, statuses and methods cross as documented STRINGS
 * (no `registerEnumType`), moments as ISO strings, a keymap as JSON text.
 *
 * ⚠ MONEY IS `Float` HOLDING WHOLE CENTAVOS. GraphQL's `Int` is 32-bit, which
 * caps at ₱21,474,836.47 — one line of 9999 × ₱1M is past it. A double holds
 * every integer up to 2^53 exactly, and the server refuses anything that is not
 * a safe integer (`checkPosPrice`, `planPayment`), so no fraction ever lands.
 */

@ObjectType('PosCategory')
export class PosCategoryType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  sortOrder!: number;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;
}

@ObjectType('PosVariant')
export class PosVariantType {
  @Field()
  id!: string;

  @Field()
  itemId!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  code!: string | null;

  /** Centavos. */
  @Field(() => Float)
  price!: number;

  /**
   * Centavos, or null — when none was entered, AND when the viewer may not see
   * costs (`costsVisible` on the catalogue says which).
   */
  @Field(() => Float, { nullable: true })
  cost!: number | null;

  @Field(() => Int)
  sortOrder!: number;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;
}

@ObjectType('PosItem')
export class PosItemType {
  @Field()
  id!: string;

  /** `product` or `service`. */
  @Field()
  kind!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  code!: string | null;

  /** Centavos. Unused while the item has live variants: the till asks for one. */
  @Field(() => Float)
  price!: number;

  /** Centavos, or null — see `PosVariant.cost`. */
  @Field(() => Float, { nullable: true })
  cost!: number | null;

  @Field(() => String, { nullable: true })
  categoryId!: string | null;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;

  /** In the picker's order. Archived ones only when the catalogue was asked for them. */
  @Field(() => [PosVariantType])
  variants!: PosVariantType[];
}

@ObjectType('PosCatalogue')
export class PosCatalogueType {
  @Field(() => [PosCategoryType])
  categories!: PosCategoryType[];

  @Field(() => [PosItemType])
  items!: PosItemType[];

  /** Whether costs are in this answer: the viewer holds `pos:manage_items` or `pos:reports`. */
  @Field()
  costsVisible!: boolean;
}

@ObjectType('PosCustomer')
export class PosCustomerType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  contact!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;
}

@ObjectType('PosSettings')
export class PosSettingsType {
  /** IANA name, such as `Asia/Manila`. */
  @Field()
  timeZone!: string;

  /** The effective `PosKeymap` (defaults filled in), as JSON text. */
  @Field()
  keymap!: string;

  /** 0 while the store has saved nothing. */
  @Field(() => Int)
  version!: number;
}

/** A change in the store. `sync` first on every (re)subscribe: read everything again. */
@ObjectType('PosEvent')
export class PosEventType {
  /** `sync`, `catalogue`, `customers`, `settings` or `order`. */
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  orderId!: string | null;

  @Field(() => String, { nullable: true })
  actorId!: string | null;
}

@InputType('SavePosVariantInput')
export class SavePosVariantInputType {
  /** An existing variant of the item; omitted for a new one. */
  @Field(() => String, { nullable: true })
  id?: string | null;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  code?: string | null;

  @Field(() => Float)
  price!: number;

  @Field(() => Float, { nullable: true })
  cost?: number | null;
}

@InputType('SavePosItemInput')
export class SavePosItemInputType {
  /** Omitted: a new item. */
  @Field(() => String, { nullable: true })
  id?: string | null;

  /** `product` or `service`. */
  @Field()
  kind!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  code?: string | null;

  @Field(() => Float)
  price!: number;

  @Field(() => Float, { nullable: true })
  cost?: number | null;

  @Field(() => String, { nullable: true })
  categoryId?: string | null;

  /** The WHOLE list, in order; an existing one left out is archived. Omitted: unchanged. */
  @Field(() => [SavePosVariantInputType], { nullable: true })
  variants?: SavePosVariantInputType[] | null;
}

@InputType('SavePosCustomerInput')
export class SavePosCustomerInputType {
  /** Omitted: a new customer. */
  @Field(() => String, { nullable: true })
  id?: string | null;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  contact?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

// ── orders ──────────────────────────────────────────────────────────────────

@ObjectType('PosDiscount')
export class PosDiscountType {
  /** `amount` (value in centavos) or `percent` (value in basis points: 1000 = 10%). */
  @Field()
  kind!: string;

  @Field(() => Float)
  value!: number;

  @Field()
  reason!: string;

  @Field(() => String, { nullable: true })
  givenById!: string | null;

  @Field(() => String, { nullable: true })
  givenAt!: string | null;
}

@ObjectType('PosOrderLine')
export class PosOrderLineType {
  @Field()
  id!: string;

  @Field()
  itemId!: string;

  @Field(() => String, { nullable: true })
  variantId!: string | null;

  /** The copies taken when the line was added: a later price change never shows here. */
  @Field()
  name!: string;

  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  variantName!: string | null;

  @Field(() => String, { nullable: true })
  code!: string | null;

  @Field(() => String, { nullable: true })
  categoryName!: string | null;

  @Field(() => Float)
  unitPrice!: number;

  /** Null when none was entered AND when the viewer may not see costs. */
  @Field(() => Float, { nullable: true })
  unitCost!: number | null;

  @Field(() => Int)
  quantity!: number;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => PosDiscountType, { nullable: true })
  discount!: PosDiscountType | null;

  /** What the line's own discount took off. */
  @Field(() => Float)
  discountAmount!: number;

  @Field(() => Float)
  gross!: number;

  /** As printed: gross − its discount. */
  @Field(() => Float)
  total!: number;

  /** What the customer actually paid for it, after its share of the order discount. */
  @Field(() => Float)
  net!: number;

  /** Units already given back. */
  @Field(() => Int)
  refundedQuantity!: number;
}

@ObjectType('PosRefund')
export class PosRefundType {
  @Field()
  id!: string;

  @Field(() => Float)
  amount!: number;

  @Field()
  method!: string;

  @Field()
  reason!: string;

  @Field()
  refundedById!: string;

  @Field()
  refundedAt!: string;
}

/** An order, whole: what the till, the receipt and the order detail show. */
@ObjectType('PosOrder')
export class PosOrderType {
  @Field()
  id!: string;

  /** `open`, `unpaid`, `paid`, `cancelled` or `voided`. */
  @Field()
  status!: string;

  /** Send it back with every change: a change made on an older version is refused. */
  @Field(() => Int)
  version!: number;

  /** Null while open, and for a cancelled order. */
  @Field(() => Int, { nullable: true })
  number!: number | null;

  @Field(() => String, { nullable: true })
  label!: string | null;

  @Field(() => String, { nullable: true })
  customerId!: string | null;

  /** The copy on the receipt — for a walk-in, the free text, or null. */
  @Field(() => String, { nullable: true })
  customerName!: string | null;

  @Field(() => String, { nullable: true })
  customerContact!: string | null;

  @Field(() => [PosOrderLineType])
  lines!: PosOrderLineType[];

  @Field(() => Float)
  gross!: number;

  @Field(() => Float)
  lineDiscounts!: number;

  @Field(() => Float)
  subtotal!: number;

  @Field(() => PosDiscountType, { nullable: true })
  discount!: PosDiscountType | null;

  @Field(() => Float)
  orderDiscount!: number;

  @Field(() => Float)
  total!: number;

  @Field(() => String, { nullable: true })
  paymentMethod!: string | null;

  @Field(() => Float, { nullable: true })
  received!: number | null;

  @Field(() => Float, { nullable: true })
  change!: number | null;

  @Field(() => Float)
  tip!: number;

  @Field(() => String, { nullable: true })
  paymentReference!: string | null;

  @Field(() => Float)
  changeOwed!: number;

  /** `given` or `tip`, once owed change is settled. */
  @Field(() => String, { nullable: true })
  changeSettlement!: string | null;

  @Field(() => String, { nullable: true })
  changeSettledAt!: string | null;

  @Field(() => [PosRefundType])
  refunds!: PosRefundType[];

  @Field(() => Float)
  refunded!: number;

  /** `none`, `partly` or `full` — derived from the refunds, never stored. */
  @Field()
  refundState!: string;

  @Field()
  createdById!: string;

  @Field()
  createdAt!: string;

  @Field(() => String, { nullable: true })
  finalisedAt!: string | null;

  @Field(() => String, { nullable: true })
  finalisedById!: string | null;

  @Field()
  releasedUnpaid!: boolean;

  @Field(() => String, { nullable: true })
  paidAt!: string | null;

  @Field(() => String, { nullable: true })
  paidById!: string | null;

  @Field(() => String, { nullable: true })
  cancelledAt!: string | null;

  @Field(() => String, { nullable: true })
  cancelReason!: string | null;

  @Field(() => String, { nullable: true })
  voidedAt!: string | null;

  @Field(() => String, { nullable: true })
  voidReason!: string | null;
}

/** An order as a list shows it. */
@ObjectType('PosOrderSummary')
export class PosOrderSummaryType {
  @Field()
  id!: string;

  @Field()
  status!: string;

  @Field(() => Int)
  version!: number;

  @Field(() => Int, { nullable: true })
  number!: number | null;

  @Field(() => String, { nullable: true })
  label!: string | null;

  @Field(() => String, { nullable: true })
  customerName!: string | null;

  @Field(() => Int)
  itemCount!: number;

  @Field(() => Float)
  total!: number;

  @Field(() => Float)
  changeOwed!: number;

  @Field(() => Float)
  refunded!: number;

  @Field()
  createdAt!: string;

  @Field(() => String, { nullable: true })
  finalisedAt!: string | null;

  /** Who released it unpaid, or took payment — the Unpaid tab shows who (guard rules). */
  @Field(() => String, { nullable: true })
  finalisedById!: string | null;

  @Field(() => String, { nullable: true })
  paidAt!: string | null;

  @Field(() => String, { nullable: true })
  cancelReason!: string | null;
}

@InputType('PosDiscountInput')
export class PosDiscountInputType {
  /** `amount` (centavos) or `percent` (basis points). */
  @Field()
  kind!: string;

  @Field(() => Float)
  value!: number;

  @Field()
  reason!: string;
}

@InputType('PayPosOrderInput')
export class PayPosOrderInputType {
  /** `cash`, `ewallet` or `card`. */
  @Field()
  method!: string;

  @Field(() => Float)
  received!: number;

  @Field(() => Float, { nullable: true })
  tip?: number | null;

  /** Cash only, and needs the customer's name and contact. */
  @Field(() => Float, { nullable: true })
  changeOwed?: number | null;

  @Field(() => String, { nullable: true })
  reference?: string | null;

  /** `crypto.randomUUID()`, once per payment attempt: a retry sends the same one. */
  @Field()
  clientId!: string;
}

@InputType('PosRefundLineInput')
export class PosRefundLineInputType {
  @Field()
  lineId!: string;

  @Field(() => Int)
  quantity!: number;
}

@InputType('RefundPosOrderInput')
export class RefundPosOrderInputType {
  /** By line. Omitted or empty: by `amount`. */
  @Field(() => [PosRefundLineInputType], { nullable: true })
  lines?: PosRefundLineInputType[] | null;

  @Field(() => Float, { nullable: true })
  amount?: number | null;

  /** How the money went back: `cash`, `ewallet` or `card`. */
  @Field()
  method!: string;

  @Field()
  reason!: string;

  @Field()
  clientId!: string;
}

// ── reports ─────────────────────────────────────────────────────────────────

@ObjectType('PosCountAmount')
export class PosCountAmountType {
  @Field(() => Int)
  count!: number;

  @Field(() => Float)
  amount!: number;
}

@ObjectType('PosSummary')
export class PosSummaryType {
  @Field(() => Int)
  orders!: number;

  @Field(() => Float)
  gross!: number;

  @Field(() => Float)
  discounts!: number;

  @Field(() => Float)
  refunds!: number;

  @Field(() => Float)
  netSales!: number;

  @Field(() => Float)
  averageOrder!: number;

  @Field(() => Float)
  tips!: number;

  @Field(() => Float)
  cash!: number;

  @Field(() => Float)
  ewallet!: number;

  @Field(() => Float)
  card!: number;

  @Field(() => Float)
  cashExpected!: number;

  /** Null when nothing sold had a cost: "no profit figure", not "₱0 profit". */
  @Field(() => Float, { nullable: true })
  profit!: number | null;

  /** Basis points of sales that had a cost entered. */
  @Field(() => Int)
  costCoverage!: number;

  @Field(() => PosCountAmountType)
  unpaidReleased!: PosCountAmountType;

  @Field(() => PosCountAmountType)
  unpaidCollected!: PosCountAmountType;

  @Field(() => PosCountAmountType)
  changeOwedOutstanding!: PosCountAmountType;

  @Field(() => PosCountAmountType)
  cancelled!: PosCountAmountType;
}

@ObjectType('PosBreakdownRow')
export class PosBreakdownRowType {
  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field(() => Int)
  quantity!: number;

  @Field(() => Float)
  net!: number;

  @Field(() => Float, { nullable: true })
  cost!: number | null;

  @Field(() => Float, { nullable: true })
  profit!: number | null;
}

@ObjectType('PosSeriesPoint')
export class PosSeriesPointType {
  /** `YYYY-MM-DD` or `YYYY-MM`. */
  @Field()
  key!: string;

  @Field(() => Int)
  orders!: number;

  @Field(() => Float)
  sales!: number;

  @Field(() => Float)
  refunds!: number;
}

@ObjectType('PosHourPoint')
export class PosHourPointType {
  @Field(() => Int)
  hour!: number;

  @Field(() => Int)
  orders!: number;

  @Field(() => Float)
  sales!: number;
}

@ObjectType('PosOwed')
export class PosOwedType {
  @Field()
  orderId!: string;

  @Field(() => Int, { nullable: true })
  number!: number | null;

  @Field(() => String, { nullable: true })
  customerName!: string | null;

  @Field(() => Float)
  amount!: number;

  @Field()
  since!: string;
}

@ObjectType('PosReport')
export class PosReportType {
  @Field()
  fromDay!: string;

  @Field()
  toDay!: string;

  @Field()
  timeZone!: string;

  @Field(() => PosSummaryType)
  summary!: PosSummaryType;

  /** One day: the same weekday last week. Longer: the same number of days before. */
  @Field(() => PosSummaryType)
  previous!: PosSummaryType;

  @Field()
  previousFromDay!: string;

  @Field()
  previousToDay!: string;

  /** `day` or `month`. */
  @Field()
  granularity!: string;

  @Field(() => [PosSeriesPointType])
  series!: PosSeriesPointType[];

  @Field(() => [PosBreakdownRowType])
  byItem!: PosBreakdownRowType[];

  @Field(() => [PosBreakdownRowType])
  byCategory!: PosBreakdownRowType[];

  /** `key` is the user id; `label` their name, or empty when the app cannot name them. */
  @Field(() => [PosBreakdownRowType])
  byStaff!: PosBreakdownRowType[];

  @Field(() => [PosHourPointType])
  byHour!: PosHourPointType[];

  @Field(() => [PosOwedType])
  unpaid!: PosOwedType[];

  @Field(() => [PosOwedType])
  changeOwed!: PosOwedType[];

  /** The figures are a lower bound: the period held more orders than one report reads. */
  @Field()
  truncated!: boolean;
}
