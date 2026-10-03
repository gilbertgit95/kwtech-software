import { declareScope, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { Inject, SetMetadata } from '@nestjs/common';
import { Args, Context, Float, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BooksWriteError } from '../books.errors.js';
import type { BooksModuleOptions } from '../books.options.js';
import { BOOKS_OPTIONS } from '../books.tokens.js';
import { BooksEntryService } from '../books-entry.service.js';
import { BooksInvestorService } from '../books-investor.service.js';
import {
  BooksEntryType,
  BooksInvestorType,
  BooksProfitSharePlanType,
  BooksProfitShareType,
  BooksSettingsType,
  RecordBooksInvestorEntryInputType,
  SaveBooksInvestorInputType,
} from './books.types.js';

/**
 * The owners' side of the books: investors, their money, how profit is shared,
 * and sharing it — every operation bound to `books:manage_investors`.
 *
 * ⚠ THE SCOPE IS DECLARED ON THE CLASS, for the reason `BooksResolver` gives.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class BooksInvestorResolver {
  constructor(
    private readonly investors: BooksInvestorService,
    private readonly entries: BooksEntryService,
    @Inject(BOOKS_OPTIONS) private readonly options: BooksModuleOptions,
  ) {}

  @Mutation(() => BooksInvestorType, { name: 'saveBooksInvestor' })
  async saveBooksInvestor(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => SaveBooksInvestorInputType }) input: SaveBooksInvestorInputType,
  ): Promise<BooksInvestorType> {
    return this.investors.save({ organizationId, workspaceId }, this.actor(gql.req), { ...input });
  }

  /** Former: capital all returned, takes no new share. `former: false` restores them. */
  @Mutation(() => BooksInvestorType, { name: 'setBooksInvestorFormer' })
  async setBooksInvestorFormer(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('investorId') investorId: string,
    @Args('former') former: boolean,
  ): Promise<BooksInvestorType> {
    return this.investors.setFormer({ organizationId, workspaceId }, this.actor(gql.req), investorId, former);
  }

  /** Capital in, a payout, a capital return or a reinvestment. */
  @Mutation(() => BooksEntryType, { name: 'recordBooksInvestorEntry' })
  async recordBooksInvestorEntry(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => RecordBooksInvestorEntryInputType }) input: RecordBooksInvestorEntryInputType,
  ): Promise<BooksEntryType> {
    return this.entries.recordInvestor(
      { organizationId, workspaceId },
      this.actor(gql.req),
      { ...input, place: input.place ?? null },
      new Date(),
    );
  }

  /** `shareMode`: `capital` or `agreed`. `posImportFrom`: the first day of POS sales to bring in; omit for none. */
  @Mutation(() => BooksSettingsType, { name: 'saveBooksSettings' })
  async saveBooksSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('shareMode') shareMode: string,
    @Args('posImportFrom', { type: () => String, nullable: true }) posImportFrom?: string | null,
  ): Promise<BooksSettingsType> {
    return this.investors.saveSettings({ organizationId, workspaceId }, this.actor(gql.req), {
      shareMode,
      posImportFrom: posImportFrom ?? null,
    });
  }

  /** What sharing through `toDay` would give each investor — or why it cannot, as data. */
  @Query(() => BooksProfitSharePlanType, { name: 'booksProfitSharePreview' })
  async booksProfitSharePreview(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('toDay') toDay: string,
    @Args('kept', { type: () => Float }) kept: number,
  ): Promise<BooksProfitSharePlanType> {
    return this.investors.preview({ organizationId, workspaceId }, toDay, kept, new Date());
  }

  @Mutation(() => BooksProfitShareType, { name: 'shareBooksProfit' })
  async shareBooksProfit(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('toDay') toDay: string,
    @Args('kept', { type: () => Float }) kept: number,
    @Args('clientId') clientId: string,
  ): Promise<BooksProfitShareType> {
    return this.investors.share(
      { organizationId, workspaceId },
      this.actor(gql.req),
      { toDay, kept, clientId },
      new Date(),
    );
  }

  /** Only the latest share; its period reopens. */
  @Mutation(() => BooksProfitShareType, { name: 'voidBooksProfitShare' })
  async voidBooksProfitShare(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('shareId') shareId: string,
    @Args('reason') reason: string,
  ): Promise<BooksProfitShareType> {
    return this.investors.voidShare({ organizationId, workspaceId }, this.actor(gql.req), shareId, reason);
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new BooksWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}
