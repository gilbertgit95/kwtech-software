import { declareScope, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { Inject, Logger, Optional, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { billingRefusal } from '../platform-billing.errors.js';
import type { PlatformBillingModuleOptions } from '../platform-billing.options.js';
import { PlatformBillingService } from '../platform-billing.service.js';
import { PLATFORM_BILLING_OPTIONS, PLATFORM_BILLING_PEOPLE } from '../platform-billing.tokens.js';
import { PlatformBillingWriteService } from '../platform-billing-write.service.js';
import type { PlatformBillingPeople } from '../ports.js';
import {
  PlatformBillingHistoryPageType,
  PlatformBillingOverviewType,
  PlatformBillingPageArgs,
  PlatformBillingPaymentInputType,
  PlatformBillingPreviewType,
  PlatformBillingRequestType,
  PlatformBillingStatementType,
} from './platform-billing.types.js';
import { renderOverview, renderPreview, renderRequest } from './render.js';

/** The kinds the owner chooses: one mutation, bound to `change_plan` (D8). */
const CHOSEN_KINDS = ['subscribe', 'change_plan', 'replace'] as const;
type ChosenKind = (typeof CHOSEN_KINDS)[number];

/** The kinds a preview may ask about. */
const PREVIEW_KINDS = ['subscribe', 'change_plan', 'replace', 'renew'] as const;

/**
 * THE ORGANIZATION'S BILLING: its standing, what a request would cost, its
 * history, and the requests it makes.
 *
 * ## ⚠ ORGANIZATION SCOPE, DECLARED ON THE CLASS
 *
 * Every key here is organization level. Without the declaration the guard
 * resolves app level, where no organization key participates, and every key
 * grants nothing (§12.13). `surface-coverage.test.ts` fails if it goes.
 *
 * ## ⚠ THESE KEYS WORK WITHOUT A PLAN (D13)
 *
 * The app passes `PLATFORM_BILLING_ORGANIZATION_KEYS` to permissions'
 * `planExemptFeatures`, so an expired or new organization can always reach the
 * page that renews it. Roles still decide who: an organization user holds none.
 *
 * ## Who may do what is the binding (D8)
 *
 * Choosing a plan is `change_plan` (the owner's); renewing is `renew`; payment
 * details and withdrawing are `enter_payment` (owner and admin). Every lookup
 * of a request is by id AND organization: the guard proves membership in the
 * organization named, not that the request is in it.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('organization'))
@Resolver()
export class PlatformBillingResolver {
  constructor(
    private readonly reads: PlatformBillingService,
    private readonly writes: PlatformBillingWriteService,
    @Inject(PLATFORM_BILLING_OPTIONS) private readonly options: PlatformBillingModuleOptions,
    /** Unbound: the organization's name is unknown, and printed documents say so. */
    @Optional() @Inject(PLATFORM_BILLING_PEOPLE) private readonly people?: PlatformBillingPeople,
  ) {}

  private readonly logger = new Logger('PlatformBillingResolver');

  // ── reads (platform-billing:read) ─────────────────────────────────────────

  @Query(() => PlatformBillingOverviewType, { name: 'platformBillingOverview' })
  async overview(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
  ): Promise<PlatformBillingOverviewType> {
    this.actor(gql.req);
    const context = await this.reads.context(organizationId, new Date());
    const pending = context.pending ? await this.reads.organizationRequest(organizationId, context.pending.id) : null;
    return renderOverview(context, pending, await this.organizationName(organizationId));
  }

  /** What a request would cost today, or why it cannot be made: the check `submit` runs. */
  @Query(() => PlatformBillingPreviewType, { name: 'platformBillingPreview' })
  async preview(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('kind') kind: string,
    @Args('planKey', { type: () => String, nullable: true }) planKey?: string | null,
  ): Promise<PlatformBillingPreviewType> {
    this.actor(gql.req);
    if (!(PREVIEW_KINDS as readonly string[]).includes(kind)) throw billingRefusal('invalid', { field: 'kind' });
    const context = await this.reads.context(organizationId, new Date());
    const wanted = kind as (typeof PREVIEW_KINDS)[number];
    return renderPreview(kind, planKey ?? null, await this.reads.preview(context, wanted, planKey ?? null));
  }

  @Query(() => PlatformBillingHistoryPageType, { name: 'platformBillingHistory' })
  async history(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args() page: PlatformBillingPageArgs,
    @Args('year', { type: () => Int, nullable: true }) year?: number | null,
    @Args('state', { type: () => String, nullable: true }) state?: string | null,
    @Args('hideClosed', { type: () => Boolean, nullable: true }) hideClosed?: boolean | null,
  ): Promise<PlatformBillingHistoryPageType> {
    this.actor(gql.req);
    const result = await this.reads.history(organizationId, page.cursor ?? null, page.limit ?? null, {
      year,
      state,
      hideClosed,
    });
    return { items: result.items.map(renderRequest), nextCursor: result.nextCursor, totals: result.totals };
  }

  /** The statement of account for the days `from` to `to`, both included, in the billing time zone. */
  @Query(() => PlatformBillingStatementType, { name: 'platformBillingStatement' })
  async statement(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('from') from: string,
    @Args('to') to: string,
  ): Promise<PlatformBillingStatementType> {
    this.actor(gql.req);
    return this.reads.statement(organizationId, from, to);
  }

  /** Null for a request that does not exist AND for one in another organization: the same answer. */
  @Query(() => PlatformBillingRequestType, { name: 'platformBillingRequest', nullable: true })
  async request(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('requestId') requestId: string,
  ): Promise<PlatformBillingRequestType | null> {
    this.actor(gql.req);
    const detail = await this.reads.organizationRequest(organizationId, requestId);
    return detail ? renderRequest(detail) : null;
  }

  // ── requests ──────────────────────────────────────────────────────────────

  /** Subscribe, change plan, or replace an archived plan (platform-billing:change_plan, the owner's). */
  @Mutation(() => PlatformBillingRequestType, { name: 'requestPlatformBillingPlan' })
  async requestPlan(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('kind') kind: string,
    @Args('planKey') planKey: string,
  ): Promise<PlatformBillingRequestType> {
    if (!(CHOSEN_KINDS as readonly string[]).includes(kind)) throw billingRefusal('invalid', { field: 'kind' });
    const row = await this.writes.submit(organizationId, this.actor(gql.req), kind as ChosenKind, planKey, new Date());
    return this.render(organizationId, row.id);
  }

  /** Another month of the current plan (platform-billing:renew, owner and admin). */
  @Mutation(() => PlatformBillingRequestType, { name: 'renewPlatformBilling' })
  async renew(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
  ): Promise<PlatformBillingRequestType> {
    const row = await this.writes.submit(organizationId, this.actor(gql.req), 'renew', null, new Date());
    return this.render(organizationId, row.id);
  }

  /**
   * End the plan at the close of its period (platform-billing:change_plan, the
   * owner's, D8). Applies at once: nothing is paid, so nobody approves it.
   */
  @Mutation(() => PlatformBillingRequestType, { name: 'cancelPlatformBilling' })
  async cancel(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
  ): Promise<PlatformBillingRequestType> {
    const row = await this.writes.cancel(organizationId, this.actor(gql.req), new Date());
    return this.render(organizationId, row.id);
  }

  @Mutation(() => PlatformBillingRequestType, { name: 'enterPlatformBillingPayment' })
  async enterPayment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('requestId') requestId: string,
    @Args('payment') payment: PlatformBillingPaymentInputType,
  ): Promise<PlatformBillingRequestType> {
    await this.writes.enterPayment(organizationId, requestId, this.actor(gql.req), payment, new Date());
    return this.render(organizationId, requestId);
  }

  /**
   * Bound to `enter_payment`, not `change_plan`: withdrawing changes nothing
   * and cancels a bill nobody paid, so whoever handles the request's payment
   * may take it back.
   */
  @Mutation(() => PlatformBillingRequestType, { name: 'withdrawPlatformBillingRequest' })
  async withdraw(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('requestId') requestId: string,
    @Args('reason', { type: () => String, nullable: true }) reason?: string | null,
  ): Promise<PlatformBillingRequestType> {
    await this.writes.withdraw(organizationId, requestId, this.actor(gql.req), reason ?? null, new Date());
    return this.render(organizationId, requestId);
  }

  /** The request re-read as the client renders it: what the database now holds. */
  private async render(organizationId: string, requestId: string): Promise<PlatformBillingRequestType> {
    const detail = await this.reads.organizationRequest(organizationId, requestId);
    if (!detail) throw billingRefusal('not_found');
    return renderRequest(detail);
  }

  /**
   * The organization's name for what billing prints, or null: unbound, or a
   * read that failed. ⚠ A failure is logged and never blocks the page, the
   * documents or the statement, which were all read successfully without it.
   */
  private async organizationName(organizationId: string): Promise<string | null> {
    if (!this.people) return null;
    try {
      return await this.people.organizationName(organizationId);
    } catch (error) {
      this.logger.warn(
        `The organization's name could not be read for billing: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** The caller, proven by the app's guard; refused when the request carries none. */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw billingRefusal('not_permitted');
    return actorId;
  }
}
