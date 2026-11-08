import { Inject, Logger, Optional } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { platformDay } from '../../domain/days.js';
import { priceOn } from '../../domain/standing.js';
import { billingRefusal } from '../platform-billing.errors.js';
import type { PlatformBillingModuleOptions } from '../platform-billing.options.js';
import { PlatformBillingService, type RequestDetail } from '../platform-billing.service.js';
import { PLATFORM_BILLING_OPTIONS, PLATFORM_BILLING_PEOPLE } from '../platform-billing.tokens.js';
import { PlatformBillingWriteService } from '../platform-billing-write.service.js';
import type { PlatformBillingPeople } from '../ports.js';
import {
  PlatformBillingApprovalInputType,
  PlatformBillingPageArgs,
  PlatformBillingPlanEntryType,
  PlatformBillingPriceType,
  PlatformBillingQueueItemType,
  PlatformBillingQueuePageType,
  PlatformBillingRequestType,
  PlatformBillingSettingsInputType,
  PlatformBillingSettingsType,
} from './platform-billing.types.js';
import { renderRequest } from './render.js';

/**
 * THE PLATFORM'S SIDE: the queue of requests, the decisions, the settings and
 * the prices.
 *
 * ## ⚠ NO DECLARED SCOPE, on purpose
 *
 * Every key here is APP level (plan §8). A scope would make the guard ask the
 * question inside one tenant, where no app-level key is the answer — and app
 * level is what keeps an organization's owner from holding approval over
 * their own request: the registry refuses an app key in an organization role.
 *
 * ## Split by risk, one key each
 *
 * Reading the queue (`queue_read`), deciding (`approve`), voiding (`void`),
 * and the settings and prices (`manage_settings`) are separate keys, so a role can read without
 * approving. Every operation is bound in `PLATFORM_BILLING_FEATURE_REGISTRY`.
 */
@Resolver()
export class PlatformBillingAdminResolver {
  constructor(
    private readonly reads: PlatformBillingService,
    private readonly writes: PlatformBillingWriteService,
    @Inject(PLATFORM_BILLING_OPTIONS) private readonly options: PlatformBillingModuleOptions,
    @Optional() @Inject(PLATFORM_BILLING_PEOPLE) private readonly people?: PlatformBillingPeople,
  ) {}

  private readonly logger = new Logger('PlatformBillingAdminResolver');

  /** Pending requests, oldest first, each with the checks an approver reads. */
  @Query(() => PlatformBillingQueuePageType, { name: 'platformBillingQueue' })
  async queue(
    @Context() gql: { req?: unknown },
    @Args() page: PlatformBillingPageArgs,
  ): Promise<PlatformBillingQueuePageType> {
    const viewerId = this.actor(gql.req);
    const result = await this.reads.pendingRequests(page.cursor ?? null, page.limit ?? null);
    return { items: await this.items(result.items, viewerId), nextCursor: result.nextCursor };
  }

  /** Decided requests, newest first: where an approval to void, or any past bill or receipt, is found. */
  @Query(() => PlatformBillingQueuePageType, { name: 'platformBillingDecided' })
  async decided(
    @Context() gql: { req?: unknown },
    @Args() page: PlatformBillingPageArgs,
  ): Promise<PlatformBillingQueuePageType> {
    const viewerId = this.actor(gql.req);
    const result = await this.reads.decidedRequests(page.cursor ?? null, page.limit ?? null);
    return { items: await this.items(result.items, viewerId), nextCursor: result.nextCursor };
  }

  /** Every plan, archived ones included, with today's price: the price list's rows. */
  @Query(() => [PlatformBillingPlanEntryType], { name: 'platformBillingPlanList' })
  async planList(@Context() gql: { req?: unknown }): Promise<PlatformBillingPlanEntryType[]> {
    this.actor(gql.req);
    const [plans, prices, settings] = await Promise.all([
      this.reads.plans(),
      this.reads.prices(),
      this.reads.settings(),
    ]);
    const today = platformDay(new Date(), settings.timeZone);
    return [...plans.values()].map((plan) => ({
      key: plan.key,
      label: plan.label,
      isPublic: plan.isPublic,
      archived: plan.archived,
      monthly: priceOn(prices, plan.key, today),
    }));
  }

  @Query(() => PlatformBillingQueueItemType, { name: 'platformBillingReview', nullable: true })
  async review(
    @Context() gql: { req?: unknown },
    @Args('requestId') requestId: string,
  ): Promise<PlatformBillingQueueItemType | null> {
    const viewerId = this.actor(gql.req);
    const detail = await this.reads.anyRequest(requestId);
    if (!detail) return null;
    return (await this.items([detail], viewerId))[0] ?? null;
  }

  @Query(() => PlatformBillingSettingsType, { name: 'platformBillingSettings' })
  async settings(@Context() gql: { req?: unknown }): Promise<PlatformBillingSettingsType> {
    this.actor(gql.req);
    const [settings, locked] = await Promise.all([this.reads.settings(), this.reads.billed()]);
    return {
      currency: settings.currency,
      timeZone: settings.timeZone,
      graceDays: settings.graceDays,
      issuerName: settings.issuer.name,
      issuerDetails: settings.issuer.details,
      paymentAccounts: settings.paymentAccounts.map((account) => ({ ...account })),
      locked,
    };
  }

  @Query(() => [PlatformBillingPriceType], { name: 'platformBillingPrices' })
  async prices(@Context() gql: { req?: unknown }): Promise<PlatformBillingPriceType[]> {
    this.actor(gql.req);
    return (await this.reads.priceRows()).map((row) => ({
      planKey: row.planKey,
      monthly: row.monthly,
      effectiveFrom: row.effectiveFrom,
    }));
  }

  // ── decisions (platform-billing:approve) ──────────────────────────────────

  @Mutation(() => PlatformBillingRequestType, { name: 'approvePlatformBillingRequest' })
  async approve(
    @Context() gql: { req?: unknown },
    @Args('requestId') requestId: string,
    @Args('approval') approval: PlatformBillingApprovalInputType,
  ): Promise<PlatformBillingRequestType> {
    await this.writes.approve(requestId, this.actor(gql.req), approval, new Date());
    return this.render(requestId);
  }

  @Mutation(() => PlatformBillingRequestType, { name: 'rejectPlatformBillingRequest' })
  async reject(
    @Context() gql: { req?: unknown },
    @Args('requestId') requestId: string,
    @Args('reason') reason: string,
  ): Promise<PlatformBillingRequestType> {
    await this.writes.reject(requestId, this.actor(gql.req), reason, new Date());
    return this.render(requestId);
  }

  /**
   * Keep a pending request's payment as credit, the plan unchanged (D12a):
   * an expired plan-change quote, or a payment that cannot be applied.
   * Bound to `approve`: it is the same judgement, "we were paid".
   */
  @Mutation(() => PlatformBillingRequestType, { name: 'closePlatformBillingRequestAsCredit' })
  async closeAsCredit(
    @Context() gql: { req?: unknown },
    @Args('requestId') requestId: string,
    @Args('payment') payment: PlatformBillingApprovalInputType,
    @Args('reason', { type: () => String, nullable: true }) reason?: string | null,
  ): Promise<PlatformBillingRequestType> {
    await this.writes.closeAsCredit(requestId, this.actor(gql.req), payment, reason ?? null, new Date());
    return this.render(requestId);
  }

  // ── voids (platform-billing:void) ─────────────────────────────────────────

  /** Reverse a mistaken approval, newest first, with the reason (D9a). */
  @Mutation(() => PlatformBillingRequestType, { name: 'voidPlatformBillingRequest' })
  async void(
    @Context() gql: { req?: unknown },
    @Args('requestId') requestId: string,
    @Args('reason') reason: string,
  ): Promise<PlatformBillingRequestType> {
    await this.writes.void(requestId, this.actor(gql.req), reason, new Date());
    return this.render(requestId);
  }

  // ── settings (platform-billing:manage_settings) ───────────────────────────

  @Mutation(() => PlatformBillingSettingsType, { name: 'setPlatformBillingSettings' })
  async setSettings(
    @Context() gql: { req?: unknown },
    @Args('settings') settings: PlatformBillingSettingsInputType,
  ): Promise<PlatformBillingSettingsType> {
    await this.writes.setSettings(this.actor(gql.req), settings);
    return this.settings(gql);
  }

  @Mutation(() => [PlatformBillingPriceType], { name: 'setPlatformBillingPrice' })
  async setPrice(
    @Context() gql: { req?: unknown },
    @Args('planKey') planKey: string,
    @Args('monthly', { type: () => Int }) monthly: number,
    @Args('effectiveFrom') effectiveFrom: string,
  ): Promise<PlatformBillingPriceType[]> {
    await this.writes.setPrice(this.actor(gql.req), planKey, monthly, effectiveFrom);
    return this.prices(gql);
  }

  /** The request re-read as the client renders it: what the database now holds. */
  private async render(requestId: string): Promise<PlatformBillingRequestType> {
    const detail = await this.reads.anyRequest(requestId);
    if (!detail) throw billingRefusal('not_found');
    return renderRequest(detail);
  }

  /**
   * Each request as an approver reads it: rendered, its checks, and its
   * organization's name. Sequential: a page is at most
   * PLATFORM_BILLING_PAGE_MAX, and each check is one indexed read.
   */
  private async items(details: readonly RequestDetail[], viewerId: string): Promise<PlatformBillingQueueItemType[]> {
    // Each item is independent, so they are read in parallel. One organization often has several requests on a
    // page: its name is read once, the promise shared.
    const names = new Map<string, Promise<string | null>>();
    const nameOf = (organizationId: string) => {
      const known = names.get(organizationId);
      if (known) return known;
      const read = this.organizationName(organizationId);
      names.set(organizationId, read);
      return read;
    };
    return Promise.all(
      details.map(async (detail) => {
        const organizationId = detail.request.organizationId;
        const [flags, organizationName] = await Promise.all([
          this.isMember(viewerId, organizationId).then((member) => this.reads.flags(detail, viewerId, member)),
          nameOf(organizationId),
        ]);
        return {
          request: renderRequest(detail),
          organizationName,
          flags: { ...flags, referenceUsedOn: [...flags.referenceUsedOn] },
        };
      }),
    );
  }

  /** The organization's name, or null: unbound, or a read that failed (logged, never blocking the queue). */
  private async organizationName(organizationId: string): Promise<string | null> {
    if (!this.people) return null;
    try {
      return await this.people.organizationName(organizationId);
    } catch (error) {
      this.logger.warn(
        `An organization's name could not be read for the queue: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** Unbound: flagged as a member, the side that asks for a second look (D15). */
  private async isMember(userId: string, organizationId: string): Promise<boolean> {
    return this.people ? this.people.isMember(userId, organizationId) : true;
  }

  /** The caller, proven by the app's guard; refused when the request carries none. */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw billingRefusal('not_permitted');
    return actorId;
  }
}
