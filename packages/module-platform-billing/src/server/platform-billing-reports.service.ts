import { Inject, Injectable, Optional } from '@nestjs/common';
import { addDays, platformDayStart } from '../domain/days.js';
import {
  buildCollectionsReport,
  type CollectionsReport,
  matchesStanding,
  type StandingEntry,
  type StandingFilter,
  type StandingsSummary,
  summariseStandings,
} from '../domain/reports.js';
import { checkStatementRange, STATEMENT_MAX_DAYS } from '../domain/statement.js';
import { billingRefusal } from './platform-billing.errors.js';
import type { PlatformBillingPrismaClient } from './platform-billing.repository.js';
import { type BillingContext, PlatformBillingService, type SharedBillingReads } from './platform-billing.service.js';
import { PLATFORM_BILLING_PEOPLE, PLATFORM_BILLING_PRISMA } from './platform-billing.tokens.js';
import type { BillingOrganizationEntry, PlatformBillingPeople } from './ports.js';

/** The most organizations one page of standings returns. */
export const STANDINGS_PAGE_MAX = 100;

/**
 * The most organizations one page of standings EXAMINES. With a filter most
 * organizations may not match, so a page keeps walking until it is full or
 * this many were read; past it, the page returns what it found and a cursor
 * to go on from. Each organization is a handful of indexed reads.
 */
export const STANDINGS_SCAN_MAX = 500;

/**
 * The most organizations the reports' summary counts. Past it the summary
 * says it is incomplete rather than reading on: a page that counts every
 * organization of a large platform belongs in a nightly table, which is
 * PLAN §12.134's open question, not in a request.
 */
export const STANDINGS_SUMMARY_MAX = 2000;

/** How many organizations' contexts are read at once: enough to be quick, few enough to leave the pool to others. */
const CONTEXT_BATCH = 10;

/** One organization's standing, as the platform lists it. */
export interface OrganizationStanding {
  organizationId: string;
  name: string;
  context: BillingContext;
  entry: StandingEntry;
}

/**
 * THE PLATFORM'S REPORTS (phase 7b): every organization's standing, the
 * standings counted, and what was collected over a range of days.
 *
 * ⚠ Organizations are permissions' rows: they are walked through the
 * people port, and with it unbound the standings say they are unavailable
 * rather than listing nobody as if nobody were there.
 */
@Injectable()
export class PlatformBillingReportsService {
  constructor(
    private readonly reads: PlatformBillingService,
    @Inject(PLATFORM_BILLING_PRISMA) private readonly prisma: PlatformBillingPrismaClient,
    @Optional() @Inject(PLATFORM_BILLING_PEOPLE) private readonly people?: PlatformBillingPeople,
  ) {}

  /** Whether organizations can be listed at all: the people port is bound. */
  get available(): boolean {
    return this.people !== undefined;
  }

  /**
   * A page of organizations' standings by id, those `filter` keeps, from
   * after `cursor`. The cursor is the last organization EXAMINED, so a
   * filtered page that stopped at its scan limit goes on from there.
   */
  async standings(
    now: Date,
    cursor: string | null,
    limit: number | null,
    filter: StandingFilter | null,
  ): Promise<{ items: OrganizationStanding[]; nextCursor: string | null }> {
    const want = Math.min(Math.max(limit ?? 50, 1), STANDINGS_PAGE_MAX);
    const walk = await this.walk(now, cursor, STANDINGS_SCAN_MAX, want, (entry) => matchesStanding(entry, filter));
    return { items: walk.kept, nextCursor: walk.ended ? null : walk.last };
  }

  /** Every organization's standing counted, up to `STANDINGS_SUMMARY_MAX`; `complete` false past it. */
  async summary(now: Date): Promise<{ summary: StandingsSummary; complete: boolean }> {
    const walk = await this.walk(now, null, STANDINGS_SUMMARY_MAX, STANDINGS_SUMMARY_MAX, () => true);
    return { summary: summariseStandings(walk.kept.map((one) => one.entry)), complete: walk.ended };
  }

  /**
   * What was collected from `from` to `to`, both included, in the billing
   * time zone: every receipt that stands, by day, month, method and plan.
   * The range is the statement's, at most two years.
   */
  async collections(from: string, to: string): Promise<CollectionsReport> {
    const refused = checkStatementRange(from, to);
    if (refused) throw billingRefusal(refused, { field: 'range', maxDays: STATEMENT_MAX_DAYS });
    const [settings, plans] = await Promise.all([this.reads.settings(), this.reads.plans()]);
    const range = {
      gte: platformDayStart(from, settings.timeZone),
      lt: platformDayStart(addDays(to, 1), settings.timeZone),
    };
    const receipts = await this.prisma.platformBillingReceipt.findMany({
      where: { issuedAt: range, voidedAt: null },
      orderBy: { number: 'asc' },
    });
    const ids = [...new Set(receipts.map((receipt) => receipt.requestId))];
    const requests =
      ids.length > 0
        ? await this.prisma.platformBillingRequest.findMany({
            where: { id: { in: ids } },
            orderBy: [{ id: 'asc' }],
            take: ids.length,
          })
        : [];
    const planOf = new Map(requests.map((request) => [request.id, request.planKey]));
    return buildCollectionsReport({
      from,
      to,
      currency: settings.currency,
      timeZone: settings.timeZone,
      planLabels: new Map([...plans.values()].map((plan) => [plan.key, plan.label])),
      receipts: receipts.map((receipt) => ({
        amount: receipt.amount,
        method: receipt.method,
        kind: receipt.kind,
        issuedAt: receipt.issuedAt,
        voidedAt: receipt.voidedAt,
        planKey: planOf.get(receipt.requestId) ?? null,
      })),
    });
  }

  /**
   * Walks organizations by id from after `after`, reading each one's
   * context, until `want` are kept, `budget` were examined, or the list
   * ends. The settings, prices and plans are read once for the walk.
   */
  private async walk(
    now: Date,
    after: string | null,
    budget: number,
    want: number,
    keep: (entry: StandingEntry) => boolean,
  ): Promise<{ kept: OrganizationStanding[]; last: string | null; ended: boolean }> {
    const people = this.people;
    if (!people) return { kept: [], last: null, ended: true };
    const [settings, prices, plans] = await Promise.all([
      this.reads.settings(),
      this.reads.prices(),
      this.reads.plans(),
    ]);
    const shared: SharedBillingReads = { settings, prices, plans };
    const kept: OrganizationStanding[] = [];
    let last = after;
    let examined = 0;
    while (examined < budget && kept.length < want) {
      const asked = Math.min(STANDINGS_PAGE_MAX, budget - examined);
      const batch = await people.organizations(last, asked);
      for (let start = 0; start < batch.length; start += CONTEXT_BATCH) {
        const chunk = batch.slice(start, start + CONTEXT_BATCH);
        const read = await Promise.all(chunk.map((organization) => this.standingOf(organization, now, shared)));
        // In id order, stopping at the first that fills the page, so the cursor names the last one examined.
        for (const standing of read) {
          examined += 1;
          last = standing.organizationId;
          if (keep(standing.entry)) kept.push(standing);
          if (kept.length >= want) {
            const atEnd = batch.length < asked && standing.organizationId === batch.at(-1)?.id;
            return { kept, last, ended: atEnd };
          }
        }
      }
      if (batch.length < asked) return { kept, last, ended: true };
    }
    return { kept, last, ended: false };
  }

  /** One organization's context, and the entry the summary and the filters read. */
  private async standingOf(
    organization: BillingOrganizationEntry,
    now: Date,
    shared: SharedBillingReads,
  ): Promise<OrganizationStanding> {
    const context = await this.reads.context(organization.id, now, undefined, shared);
    return {
      organizationId: organization.id,
      name: organization.name,
      context,
      entry: {
        kind: context.standing.standing?.kind ?? 'none',
        creditBalance: context.creditBalance,
        pending: context.pending !== null,
      },
    };
  }
}
