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
