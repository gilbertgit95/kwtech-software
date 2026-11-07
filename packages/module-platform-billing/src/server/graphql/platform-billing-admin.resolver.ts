import { Inject, Optional } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { billingRefusal } from '../platform-billing.errors.js';
import type { PlatformBillingModuleOptions } from '../platform-billing.options.js';
import { PlatformBillingService } from '../platform-billing.service.js';
import { PLATFORM_BILLING_OPTIONS, PLATFORM_BILLING_PEOPLE } from '../platform-billing.tokens.js';
import { PlatformBillingWriteService } from '../platform-billing-write.service.js';
import type { PlatformBillingPeople } from '../ports.js';
import {
  PlatformBillingApprovalInputType,
  PlatformBillingPageArgs,
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
 * Reading the queue (`queue_read`), deciding (`approve`), and the settings and
 * prices (`manage_settings`) are separate keys, so a role can read without
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

  /** Pending requests, oldest first, each with the checks an approver reads. */
  @Query(() => PlatformBillingQueuePageType, { name: 'platformBillingQueue' })
  async queue(
    @Context() gql: { req?: unknown },
    @Args() page: PlatformBillingPageArgs,
  ): Promise<PlatformBillingQueuePageType> {
    const viewerId = this.actor(gql.req);
    const result = await this.reads.pendingRequests(page.cursor ?? null, page.limit ?? null);
    const items: PlatformBillingQueueItemType[] = [];
    for (const detail of result.items) {
      // Sequential: a page is at most PLATFORM_BILLING_PAGE_MAX, and each check is one indexed read.
      const member = await this.isMember(viewerId, detail.request.organizationId);
      const flags = await this.reads.flags(detail, viewerId, member);
      items.push({ request: renderRequest(detail), flags: { ...flags, referenceUsedOn: [...flags.referenceUsedOn] } });
    }
    return { items, nextCursor: result.nextCursor };
  }

  @Query(() => PlatformBillingQueueItemType, { name: 'platformBillingReview', nullable: true })
  async review(
    @Context() gql: { req?: unknown },
    @Args('requestId') requestId: string,
  ): Promise<PlatformBillingQueueItemType | null> {
    const viewerId = this.actor(gql.req);
    const detail = await this.reads.anyRequest(requestId);
    if (!detail) return null;
    const flags = await this.reads.flags(
      detail,
      viewerId,
      await this.isMember(viewerId, detail.request.organizationId),
    );
    return { request: renderRequest(detail), flags: { ...flags, referenceUsedOn: [...flags.referenceUsedOn] } };
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

  private async render(requestId: string): Promise<PlatformBillingRequestType> {
    const detail = await this.reads.anyRequest(requestId);
    if (!detail) throw billingRefusal('not_found');
    return renderRequest(detail);
  }

  /** Unbound: flagged as a member, the side that asks for a second look (D15). */
  private async isMember(userId: string, organizationId: string): Promise<boolean> {
    return this.people ? this.people.isMember(userId, organizationId) : true;
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw billingRefusal('not_permitted');
    return actorId;
  }
}
