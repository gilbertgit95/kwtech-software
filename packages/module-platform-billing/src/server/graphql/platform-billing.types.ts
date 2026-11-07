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

/** A request's price: its lines, the total, and the credit it uses or adds. */
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

/** A cap the organization is over on a smaller plan, and how many to remove (D6). */
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

/** A plan the organization may choose, with today's price. */
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

/** Where organizations pay: a method, a label and the details. */
@ObjectType('PlatformBillingPaymentAccount')
export class PlatformBillingPaymentAccountType {
  @Field() method!: string;
  @Field() label!: string;
  @Field() details!: string;
}

/** A bill: its number, stamp, total and the lines it was issued with. */
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

/** An acknowledgement receipt, and whether it was voided. */
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

/** One version of the payment details a request was given. */
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

/** One step of a request's timeline, with its reason code. */
@ObjectType('PlatformBillingEvent')
export class PlatformBillingEventType {
  @Field() at!: string;
  @Field() step!: string;
  @Field(() => String, { nullable: true }) reason!: string | null;
  @Field(() => String, { nullable: true }) actorId!: string | null;
  /** The step's inputs (days, amounts, dates) as a JSON object. */
  @Field() data!: string;
}

/** A request with its bills, receipts, payment versions and timeline. */
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

/** The organization's Billing page in one read. */
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

/** A page of the organization's requests, newest first. */
@ObjectType('PlatformBillingHistoryPage')
export class PlatformBillingHistoryPageType {
  @Field(() => [PlatformBillingRequestType]) items!: PlatformBillingRequestType[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
}

/** The checks an approver sees; they flag, never decide (plan §4). */
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

/** A pending request and its checks. */
@ObjectType('PlatformBillingQueueItem')
export class PlatformBillingQueueItemType {
  @Field(() => PlatformBillingRequestType) request!: PlatformBillingRequestType;
  @Field(() => PlatformBillingQueueFlagsType) flags!: PlatformBillingQueueFlagsType;
}

/** A page of pending requests, oldest first. */
@ObjectType('PlatformBillingQueuePage')
export class PlatformBillingQueuePageType {
  @Field(() => [PlatformBillingQueueItemType]) items!: PlatformBillingQueueItemType[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
}

/** The platform's billing settings, and whether the currency and time zone are locked. */
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

/** A plan's monthly price from a day on. */
@ObjectType('PlatformBillingPrice')
export class PlatformBillingPriceType {
  @Field() planKey!: string;
  @Field(() => Int) monthly!: number;
  @Field() effectiveFrom!: string;
}

/** Payment details as an organization enters them. */
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

/** The payment as the approver confirms it, with the details version reviewed. */
@InputType('PlatformBillingApprovalInput')
export class PlatformBillingApprovalInputType {
  /** The details version reviewed. */
  @Field(() => Int) detailsVersion!: number;
  @Field() method!: string;
  @Field(() => Int) amount!: number;
  @Field() paidOn!: string;
  @Field(() => String, { nullable: true }) reference?: string | null;
}

/** A payment account as a super admin sets it. */
@InputType('PlatformBillingPaymentAccountInput')
export class PlatformBillingPaymentAccountInputType {
  @Field() method!: string;
  @Field() label!: string;
  @Field() details!: string;
}

/** A settings change; an absent field is left as it is. */
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

/** A page of results: an opaque cursor and a limit. */
@ArgsType()
export class PlatformBillingPageArgs {
  @Field(() => String, { nullable: true }) cursor?: string | null;
  @Field(() => Int, { nullable: true }) limit?: number | null;
}
