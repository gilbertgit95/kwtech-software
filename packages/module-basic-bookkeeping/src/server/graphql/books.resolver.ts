import { declareScope, REQUIRED_SCOPE_METADATA, withCatchUp } from '@kwtech/module-kit';
import { Inject, Optional, SetMetadata } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { BooksWriteError } from '../books.errors.js';
import type { BooksModuleOptions } from '../books.options.js';
import { BOOKS_EVENT, type BooksEvent, type BooksPubSub, isBooksEventFor, NULL_BOOKS_PUBSUB } from '../books.pubsub.js';
import { BOOKS_OPTIONS, BOOKS_PUBSUB } from '../books.tokens.js';
import { BooksEntryService } from '../books-entry.service.js';
import { BooksLedgerService } from '../books-ledger.service.js';
import { BooksPosService } from '../books-pos.service.js';
import {
  BooksEntriesType,
  BooksEntryType,
  BooksEventType,
  BooksLoanType,
  BooksOverviewType,
  BooksPosSalesType,
  BooksSalesImportType,
  LendBooksMoneyInputType,
  RecordBooksEntryInputType,
} from './books.types.js';

/**
 * Reading the books, recording the day's money, lending, voiding, the point of
 * sale's sales, and live events.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `books:*` key is WORKSPACE level. A resolver has no path, so without a
 * declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key grants nothing to everybody, silently (§12.13).
 * `surface-coverage.test.ts` fails if it goes. Every operation therefore takes
 * `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `BOOKS_FEATURE_REGISTRY`. The
 * services then find every row BY ID AND SCOPE.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class BooksResolver {
  constructor(
    private readonly ledger: BooksLedgerService,
    private readonly entries: BooksEntryService,
    private readonly pos: BooksPosService,
    @Inject(BOOKS_OPTIONS) private readonly options: BooksModuleOptions,
    /** Absent means not live: `booksEvents` sends `sync` and ends. */
    @Optional() @Inject(BOOKS_PUBSUB) private readonly pubsub?: BooksPubSub,
  ) {}

  // ── reading ───────────────────────────────────────────────────────────────

  /** Cash on hand, investors, loans, profit: every balance added up from every live entry. */
  @Query(() => BooksOverviewType, { name: 'booksOverview' })
  async booksOverview(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<BooksOverviewType> {
    return this.ledger.overview({ organizationId, workspaceId }, new Date());
  }

  /** One month (`YYYY-MM`), one investor's or one loan's entries — exactly one. None: this month. */
  @Query(() => BooksEntriesType, { name: 'booksEntries' })
  async booksEntries(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('month', { type: () => String, nullable: true }) month?: string | null,
    @Args('investorId', { type: () => String, nullable: true }) investorId?: string | null,
    @Args('loanId', { type: () => String, nullable: true }) loanId?: string | null,
  ): Promise<BooksEntriesType> {
    return this.ledger.entries(
      { organizationId, workspaceId },
      { month: month ?? null, investorId: investorId ?? null, loanId: loanId ?? null },
      new Date(),
    );
  }

  // ── the day's money ───────────────────────────────────────────────────────

  @Mutation(() => BooksEntryType, { name: 'recordBooksEntry' })
  async recordBooksEntry(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => RecordBooksEntryInputType }) input: RecordBooksEntryInputType,
  ): Promise<BooksEntryType> {
    return this.entries.record({ organizationId, workspaceId }, this.actor(gql.req), { ...input }, new Date());
  }

  @Mutation(() => BooksLoanType, { name: 'lendBooksMoney' })
  async lendBooksMoney(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => LendBooksMoneyInputType }) input: LendBooksMoneyInputType,
  ): Promise<BooksLoanType> {
    return this.entries.lend({ organizationId, workspaceId }, this.actor(gql.req), { ...input }, new Date());
  }

  /** A borrower's name, contact and note. The money is in the entries and is never edited. */
  @Mutation(() => BooksLoanType, { name: 'saveBooksLoan' })
  async saveBooksLoan(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('loanId') loanId: string,
    @Args('borrowerName') borrowerName: string,
    @Args('contact', { type: () => String, nullable: true }) contact?: string | null,
    @Args('note', { type: () => String, nullable: true }) note?: string | null,
  ): Promise<BooksLoanType> {
    return this.entries.saveLoan({ organizationId, workspaceId }, this.actor(gql.req), loanId, {
      borrowerName,
      contact: contact ?? null,
      note: note ?? null,
    });
  }

  /** ⚠ An investor's entry also needs `books:manage_investors` — asked in the service. */
  @Mutation(() => BooksEntryType, { name: 'voidBooksEntry' })
  async voidBooksEntry(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('entryId') entryId: string,
    @Args('reason') reason: string,
  ): Promise<BooksEntryType> {
    return this.entries.void({ organizationId, workspaceId }, this.actor(gql.req), entryId, reason);
  }

  // ── the point of sale's sales ─────────────────────────────────────────────

  @Query(() => BooksPosSalesType, { name: 'booksPosSalesPreview' })
  async booksPosSalesPreview(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('toDay') toDay: string,
  ): Promise<BooksPosSalesType> {
    return this.pos.preview({ organizationId, workspaceId }, toDay, new Date());
  }

  @Mutation(() => BooksSalesImportType, { name: 'recordBooksPosSales' })
  async recordBooksPosSales(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('toDay') toDay: string,
    @Args('clientId') clientId: string,
  ): Promise<BooksSalesImportType> {
    return this.pos.record({ organizationId, workspaceId }, this.actor(gql.req), { toDay, clientId }, new Date());
  }

  // ── live ──────────────────────────────────────────────────────────────────

  /**
   * Changes in these books. ⚠ NO CONTENT — the screen reads again through the
   * guarded queries. `sync` first, on every (re)subscribe: the engine has no
   * replay.
   */
  @Subscription(() => BooksEventType, {
    name: 'booksEvents',
    // ⚠ REQUIRED: without it GraphQL looks for a `booksEvents` key on the
    // payload, finds none, and delivers `data: null` forever.
    resolve: (payload: BooksEventType) => payload,
  })
  booksEvents(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): AsyncIterableIterator<BooksEventType> {
    this.actor(gql.req);
    const viewer = { organizationId, workspaceId };
    return withCatchUp<BooksEvent, BooksEventType>({
      live: (this.pubsub ?? NULL_BOOKS_PUBSUB).asyncIterableIterator<BooksEvent>(BOOKS_EVENT.changed),
      catchUp: async () => [{ kind: 'sync', actorId: null }],
      transform: (event) => {
        if (!isBooksEventFor(event, viewer)) return null;
        return { kind: event.change, actorId: event.actorId };
      },
      keyOf: () => null,
    });
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new BooksWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}
