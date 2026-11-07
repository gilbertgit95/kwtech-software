import { ArgsType, Field, InputType, Int, ObjectType } from '@nestjs/graphql';

/**
 * Billing's GraphQL shapes. Money crosses as `Int` centavos, days as
 * `YYYY-MM-DD` strings, instants as ISO strings; enums cross as documented
 * `String` fields (backend rules: no `registerEnumType`, no custom scalars).
 */

@ObjectType('PlatformBillingLine')
export class PlatformBillingLineType {
  /** `month`, `new_plan_days`, `old_plan_unused`, `prepaid_month`, `access_used`, `credit_applied`, `owed`. */
  @Field() kind!: string;
  @Field(() => Int) amount!: number;
  @Field(() => Int, { nullable: true }) days!: number | null;
}

@ObjectType('PlatformBillingQuote')
export class PlatformBillingQuoteType {
  @Field(() => [PlatformBillingLineType]) lines!: PlatformBillingLineType[];
  @Field(() => Int) total!: number;
  @Field(() => Int) creditUsed!: number;
  @Field(() => Int) creditAdded!: number;
  /** `upgrade`, `downgrade`, or null when not a plan change. */
  @Field(() => String, { nullable: true }) direction!: string | null;
  /** False for a downgrade: its bill is issued at approval, and this is today's estimate (D12). */
  @Field() billAtSubmission!: boolean;
  @Field(() => String, { nullable: true }) periodStart!: string | null;
  @Field(() => String, { nullable: true }) periodEnd!: string | null;
}

@ObjectType('PlatformBillingCapOverrun')
export class PlatformBillingCapOverrunType {
  @Field() limit!: string;
  @Field(() => Int) have!: number;
  @Field(() => Int) allowed!: number;
  @Field(() => Int) remove!: number;
}

/** A request before it is made: allowed with its price, or refused with why (plan §6). */
@ObjectType('PlatformBillingPreview')
export class PlatformBillingPreviewType {
  @Field() kind!: string;
  @Field(() => String, { nullable: true }) planKey!: string | null;
  @Field() allowed!: boolean;
  /** A `PlatformBillingRefusal`, with its sentence and next step. */
  @Field(() => String, { nullable: true }) refusal!: string | null;
  @Field(() => String, { nullable: true }) message!: string | null;
  @Field(() => String, { nullable: true }) nextStep!: string | null;
  @Field(() => PlatformBillingQuoteType, { nullable: true }) quote!: PlatformBillingQuoteType | null;
  @Field(() => [PlatformBillingCapOverrunType]) overruns!: PlatformBillingCapOverrunType[];
}

/** Where the organization stands, with the parts of its access end (plan §6). */
@ObjectType('PlatformBillingStanding')
export class PlatformBillingStandingType {
  /** `none` (no paid plan), `active`, `renewal_open`, `overdue`, `held`, `expired`. */
  @Field() kind!: string;
  /** Days to the due date, days left, or days since expiry, by `kind`. */
  @Field(() => Int, { nullable: true }) days!: number | null;
  @Field(() => String, { nullable: true }) planKey!: string | null;
  @Field(() => String, { nullable: true }) planLabel!: string | null;
  @Field() planArchived!: boolean;
  @Field(() => String, { nullable: true }) periodStart!: string | null;
  @Field(() => String, { nullable: true }) periodEnd!: string | null;
  /** The first day without access. */
  @Field(() => String, { nullable: true }) accessUntil!: string | null;
  @Field(() => Int) graceDays!: number;
  @Field(() => Int) holdDays!: number;
  /** The row holds a month paid ahead (an early renewal). */
  @Field() prepaid!: boolean;
}

@ObjectType('PlatformBillingPlanOffer')
export class PlatformBillingPlanOfferType {
  @Field() key!: string;
  @Field() label!: string;
  /** Today's monthly price, or null when none is set. */
  @Field(() => Int, { nullable: true }) monthly!: number | null;
  @Field() isPublic!: boolean;
  @Field() archived!: boolean;
  @Field() current!: boolean;
}

@ObjectType('PlatformBillingPaymentAccount')
export class PlatformBillingPaymentAccountType {
  @Field() method!: string;
  @Field() label!: string;
  @Field() details!: string;
}

@ObjectType('PlatformBillingBill')
export class PlatformBillingBillType {
  @Field() id!: string;
  @Field() number!: string;
  /** `unpaid`, `submitted`, `paid`, `cancelled`. */
  @Field() status!: string;
  @Field(() => Int) total!: number;
  @Field() currency!: string;
  @Field() issuedAt!: string;
  @Field() planLabel!: string;
  @Field(() => String, { nullable: true }) fromPlanLabel!: string | null;
  @Field(() => [PlatformBillingLineType]) lines!: PlatformBillingLineType[];
  @Field(() => String, { nullable: true }) cancelledAt!: string | null;
  @Field(() => String, { nullable: true }) cancelledReason!: string | null;
}

@ObjectType('PlatformBillingReceipt')
export class PlatformBillingReceiptType {
  @Field() id!: string;
  @Field() number!: string;
  @Field(() => Int) amount!: number;
  @Field() currency!: string;
  @Field() method!: string;
  /** `payment` or `closed_as_credit`. */
  @Field() kind!: string;
  @Field(() => String, { nullable: true }) reference!: string | null;
  @Field() issuedAt!: string;
  @Field(() => String, { nullable: true }) voidedAt!: string | null;
  @Field(() => String, { nullable: true }) voidReason!: string | null;
}

@ObjectType('PlatformBillingPayment')
export class PlatformBillingPaymentType {
  @Field(() => Int) version!: number;
  @Field() method!: string;
  @Field(() => Int) amount!: number;
  @Field() paidOn!: string;
  @Field(() => String, { nullable: true }) reference!: string | null;
  @Field(() => String, { nullable: true }) sender!: string | null;
  @Field(() => String, { nullable: true }) note!: string | null;
  @Field() enteredById!: string;
  @Field() enteredAt!: string;
}

@ObjectType('PlatformBillingEvent')
export class PlatformBillingEventType {
  @Field() at!: string;
  @Field() step!: string;
  @Field(() => String, { nullable: true }) reason!: string | null;
  @Field(() => String, { nullable: true }) actorId!: string | null;
  /** The step's inputs (days, amounts, dates) as a JSON object. */
  @Field() data!: string;
}

@ObjectType('PlatformBillingRequest')
export class PlatformBillingRequestType {
  @Field() id!: string;
  @Field() organizationId!: string;
  @Field() kind!: string;
  @Field() state!: string;
  @Field() planKey!: string;
  @Field(() => String, { nullable: true }) fromPlanKey!: string | null;
  @Field() requestedById!: string;
  @Field() requestedAt!: string;
  /** The version approval must name: details changed after it refuse (`details_changed`). */
  @Field(() => Int) detailsVersion!: number;
  @Field(() => String, { nullable: true }) coveredOn!: string | null;
  @Field(() => Int) holdDays!: number;
  @Field(() => String, { nullable: true }) holdReason!: string | null;
  @Field(() => String, { nullable: true }) decidedById!: string | null;
  @Field(() => String, { nullable: true }) decidedAt!: string | null;
  @Field(() => String, { nullable: true }) decisionReason!: string | null;
  @Field() selfApproved!: boolean;
  @Field() approverIsMember!: boolean;
  @Field(() => String, { nullable: true }) periodStart!: string | null;
  @Field(() => String, { nullable: true }) periodEnd!: string | null;
  @Field(() => String, { nullable: true }) accessUntil!: string | null;
  /** The bill in force: the newest not cancelled. Null for a downgrade until approval. */
  @Field(() => PlatformBillingBillType, { nullable: true }) bill!: PlatformBillingBillType | null;
  @Field(() => [PlatformBillingBillType]) bills!: PlatformBillingBillType[];
  @Field(() => [PlatformBillingReceiptType]) receipts!: PlatformBillingReceiptType[];
  @Field(() => [PlatformBillingPaymentType]) payments!: PlatformBillingPaymentType[];
  @Field(() => [PlatformBillingEventType]) events!: PlatformBillingEventType[];
}

@ObjectType('PlatformBillingOverview')
export class PlatformBillingOverviewType {
  @Field() organizationId!: string;
  @Field() currency!: string;
  @Field(() => PlatformBillingStandingType) standing!: PlatformBillingStandingType;
  /** Negative is owed after a void (plan §4). */
  @Field(() => Int) creditBalance!: number;
  @Field(() => PlatformBillingRequestType, { nullable: true }) pending!: PlatformBillingRequestType | null;
  @Field(() => [PlatformBillingPlanOfferType]) plans!: PlatformBillingPlanOfferType[];
  @Field(() => [PlatformBillingPaymentAccountType]) paymentAccounts!: PlatformBillingPaymentAccountType[];
}

@ObjectType('PlatformBillingHistoryPage')
export class PlatformBillingHistoryPageType {
  @Field(() => [PlatformBillingRequestType]) items!: PlatformBillingRequestType[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
}

@ObjectType('PlatformBillingQueueFlags')
export class PlatformBillingQueueFlagsType {
  @Field(() => [String]) referenceUsedOn!: string[];
  /** `exact`, `short`, `over`, `none`. */
  @Field() amount!: string;
  @Field(() => Int) amountDifference!: number;
  @Field() missingDetails!: boolean;
  @Field() holdInForce!: boolean;
  @Field() selfRequest!: boolean;
  @Field() viewerIsMember!: boolean;
}

@ObjectType('PlatformBillingQueueItem')
export class PlatformBillingQueueItemType {
  @Field(() => PlatformBillingRequestType) request!: PlatformBillingRequestType;
  @Field(() => PlatformBillingQueueFlagsType) flags!: PlatformBillingQueueFlagsType;
}

@ObjectType('PlatformBillingQueuePage')
export class PlatformBillingQueuePageType {
  @Field(() => [PlatformBillingQueueItemType]) items!: PlatformBillingQueueItemType[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
}

@ObjectType('PlatformBillingSettings')
export class PlatformBillingSettingsType {
  @Field() currency!: string;
  @Field() timeZone!: string;
  @Field(() => Int) graceDays!: number;
  @Field() issuerName!: string;
  @Field() issuerDetails!: string;
  @Field(() => [PlatformBillingPaymentAccountType]) paymentAccounts!: PlatformBillingPaymentAccountType[];
  /** A bill exists: the currency and the time zone can no longer change (D16). */
  @Field() locked!: boolean;
}

@ObjectType('PlatformBillingPrice')
export class PlatformBillingPriceType {
  @Field() planKey!: string;
  @Field(() => Int) monthly!: number;
  @Field() effectiveFrom!: string;
}

@InputType('PlatformBillingPaymentInput')
export class PlatformBillingPaymentInputType {
  /** `cash`, `e_wallet`, `bank_transfer`. */
  @Field() method!: string;
  @Field(() => Int) amount!: number;
  @Field() paidOn!: string;
  @Field(() => String, { nullable: true }) reference?: string | null;
  @Field(() => String, { nullable: true }) sender?: string | null;
  @Field(() => String, { nullable: true }) note?: string | null;
}

@InputType('PlatformBillingApprovalInput')
export class PlatformBillingApprovalInputType {
  /** The details version reviewed. */
  @Field(() => Int) detailsVersion!: number;
  @Field() method!: string;
  @Field(() => Int) amount!: number;
  @Field() paidOn!: string;
  @Field(() => String, { nullable: true }) reference?: string | null;
}

@InputType('PlatformBillingPaymentAccountInput')
export class PlatformBillingPaymentAccountInputType {
  @Field() method!: string;
  @Field() label!: string;
  @Field() details!: string;
}

@InputType('PlatformBillingSettingsInput')
export class PlatformBillingSettingsInputType {
  @Field(() => String, { nullable: true }) currency?: string | null;
  @Field(() => String, { nullable: true }) timeZone?: string | null;
  @Field(() => Int, { nullable: true }) graceDays?: number | null;
  @Field(() => String, { nullable: true }) issuerName?: string | null;
  @Field(() => String, { nullable: true }) issuerDetails?: string | null;
  @Field(() => [PlatformBillingPaymentAccountInputType], { nullable: true })
  paymentAccounts?: PlatformBillingPaymentAccountInputType[] | null;
}

@ArgsType()
export class PlatformBillingPageArgs {
  @Field(() => String, { nullable: true }) cursor?: string | null;
  @Field(() => Int, { nullable: true }) limit?: number | null;
}
