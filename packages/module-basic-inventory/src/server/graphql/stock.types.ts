import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';

/*
 * The stock GraphQL shapes. Code-first, filled from `stock.views.ts`. Kinds,
 * units, levels and reasons cross as documented STRINGS (no
 * `registerEnumType`), moments as ISO strings.
 *
 * ⚠ QUANTITIES ARE `Int` HOLDING THOUSANDTHS: a movement is capped at 10⁹
 * (`STOCK_QUANTITY_MAX`), inside GraphQL's 32-bit `Int`. ⚠ VALUES ARE `Float`
 * HOLDING WHOLE CENTAVOS: a store's stock value can pass the ₱21M a 32-bit
 * `Int` holds, and a double holds every integer up to 2⁵³ exactly.
 */

@ObjectType('StockCategory')
export class StockCategoryType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  sortOrder!: number;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;
}

@ObjectType('StockItem')
export class StockItemType {
  @Field()
  id!: string;

  /** `for_sale` | `material`. */
  @Field()
  kind!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  code!: string | null;

  /** `piece` | `sheet` | `pack` | `ml` | `l` | `g` | `kg` | `m`. */
  @Field()
  unit!: string;

  /** Centavos per whole unit. */
  @Field(() => Int, { nullable: true })
  unitCost!: number | null;

  /** Thousandths. */
  @Field(() => Int, { nullable: true })
  lowStockAt!: number | null;

  @Field(() => String, { nullable: true })
  categoryId!: string | null;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;

  /** Thousandths, added up from the movements. May be negative: the count is wrong. */
  @Field(() => Float)
  onHand!: number;

  /** `ok` | `low` | `out` | `negative`. */
  @Field()
  level!: string;

  @Field(() => Float, { nullable: true })
  value!: number | null;

  @Field(() => Int)
  usedBy!: number;
}

@ObjectType('StockUse')
export class StockUseType {
  @Field()
  id!: string;

  /** `item` | `variant`. */
  @Field()
  refKind!: string;

  @Field()
  refId!: string;

  @Field()
  refItemId!: string;

  @Field()
  refLabel!: string;

  @Field()
  stockItemId!: string;

  @Field(() => Int)
  quantityPerUnit!: number;
}

@ObjectType('StockOverview')
export class StockOverviewType {
  @Field(() => [StockItemType])
  items!: StockItemType[];

  @Field(() => [StockCategoryType])
  categories!: StockCategoryType[];

  @Field(() => [StockUseType])
  uses!: StockUseType[];

  @Field(() => Float)
  totalValue!: number;

  @Field(() => Int)
  unvalued!: number;

  @Field()
  hasSource!: boolean;
}

@ObjectType('StockMove')
export class StockMoveType {
  @Field()
  id!: string;

  @Field()
  stockItemId!: string;

  /** `opening` | `received` | `used` | `returned` | `adjustment` | `wasted` | `count`. */
  @Field()
  kind!: string;

  @Field(() => Int)
  quantity!: number;

  @Field(() => Int, { nullable: true })
  unitCost!: number | null;

  @Field(() => String, { nullable: true })
  reason!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => String, { nullable: true })
  supplier!: string | null;

  @Field(() => String, { nullable: true })
  reference!: string | null;

  @Field(() => String, { nullable: true })
  sourceKey!: string | null;

  @Field(() => String, { nullable: true })
  wasteRefLabel!: string | null;

  @Field(() => String, { nullable: true })
  takeId!: string | null;

  @Field(() => String, { nullable: true })
  createdById!: string | null;

  @Field(() => String, { nullable: true })
  createdByName!: string | null;

  @Field()
  createdAt!: string;
}

@ObjectType('StockMoves')
export class StockMovesType {
  @Field(() => [StockMoveType])
  moves!: StockMoveType[];

  @Field(() => String, { nullable: true })
  nextCursor!: string | null;
}

@ObjectType('StockTakeLine')
export class StockTakeLineType {
  @Field()
  stockItemId!: string;

  @Field(() => Int, { nullable: true })
  counted!: number | null;

  @Field(() => Float)
  onHand!: number;

  @Field(() => Float, { nullable: true })
  difference!: number | null;
}

@ObjectType('StockTake')
export class StockTakeType {
  @Field()
  id!: string;

  /** `open` | `confirmed` | `abandoned`. */
  @Field()
  status!: string;

  @Field(() => [String])
  categoryIds!: string[];

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field()
  createdById!: string;

  @Field(() => String, { nullable: true })
  createdByName!: string | null;

  @Field()
  createdAt!: string;

  @Field(() => String, { nullable: true })
  closedAt!: string | null;

  @Field(() => [StockTakeLineType])
  lines!: StockTakeLineType[];
}

@ObjectType('StockSourceItem')
export class StockSourceItemType {
  @Field()
  itemId!: string;

  @Field(() => String, { nullable: true })
  variantId!: string | null;

  @Field()
  itemName!: string;

  @Field(() => String, { nullable: true })
  variantName!: string | null;

  /** `product` | `service`. */
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  code!: string | null;

  @Field()
  archived!: boolean;

  @Field()
  label!: string;
}

@ObjectType('StockEvent')
export class StockEventType {
  /** `sync` | `stock` | `setup` | `take`. */
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  actorId!: string | null;
}

// ── inputs ─────────────────────────────────────────────────────────────────

@InputType('SaveStockItemInput')
export class SaveStockItemInputType {
  @Field(() => String, { nullable: true })
  id?: string | null;

  @Field()
  kind!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  code?: string | null;

  @Field()
  unit!: string;

  @Field(() => Int, { nullable: true })
  unitCost?: number | null;

  @Field(() => Int, { nullable: true })
  lowStockAt?: number | null;

  @Field(() => String, { nullable: true })
  categoryId?: string | null;
}

@InputType('StockUseLineInput')
export class StockUseLineInputType {
  @Field()
  stockItemId!: string;

  @Field(() => Int)
  quantityPerUnit!: number;
}

@InputType('StockSourcePickInput')
export class StockSourcePickInputType {
  @Field()
  itemId!: string;

  @Field(() => String, { nullable: true })
  variantId?: string | null;
}

@InputType('ReceiveStockInput')
export class ReceiveStockInputType {
  @Field()
  stockItemId!: string;

  @Field(() => Int)
  quantity!: number;

  @Field(() => Int, { nullable: true })
  unitCost?: number | null;

  @Field(() => String, { nullable: true })
  supplier?: string | null;

  @Field(() => String, { nullable: true })
  reference?: string | null;

  @Field(() => Boolean, { nullable: true })
  opening?: boolean | null;

  @Field()
  clientId!: string;
}

@InputType('AdjustStockInput')
export class AdjustStockInputType {
  @Field()
  stockItemId!: string;

  /** Signed thousandths: positive in, negative out. */
  @Field(() => Int)
  quantity!: number;

  @Field()
  reason!: string;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field()
  clientId!: string;
}

@InputType('StockWasteLineInput')
export class StockWasteLineInputType {
  @Field()
  stockItemId!: string;

  /** Positive thousandths wasted. */
  @Field(() => Int)
  quantity!: number;
}

@InputType('RecordStockWasteInput')
export class RecordStockWasteInputType {
  @Field(() => [StockWasteLineInputType])
  lines!: StockWasteLineInputType[];

  @Field()
  reason!: string;

  @Field(() => String, { nullable: true })
  note?: string | null;

  /** The POS item or variant spoiled, when a product was. */
  @Field(() => String, { nullable: true })
  ofRefId?: string | null;

  @Field(() => String, { nullable: true })
  ofRefLabel?: string | null;

  @Field()
  clientId!: string;
}

@InputType('StockTakeCountInput')
export class StockTakeCountInputType {
  @Field()
  stockItemId!: string;

  /** Thousandths, or null to clear the line. */
  @Field(() => Int, { nullable: true })
  counted?: number | null;
}
