/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default (`stock.tokens.ts`), and
 * the host's total comes to one descriptor plus the adapters only it can write.
 */
export interface StockModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /** A `LimitChecker` for `stock:items`. Unbound: the declared default cap. */
  limitCheckerProvider?: unknown;
  /** A `StockMemberDirectory` provider. Unbound: nobody has a name. */
  memberDirectoryProvider?: unknown;
  /** A `StockSourceCatalogue` provider. ⚠ Unbound: there is no point of sale to hang a list on. */
  sourceCatalogueProvider?: unknown;
  /** A `StockSaleFeed` provider. ⚠ Unbound: a lost push is never caught up. */
  saleFeedProvider?: unknown;
  /** A `StockChangeListener` provider. Unbound: the till re-reads its counts only on its own. */
  changeListenerProvider?: unknown;
  /**
   * A `StockPubSub` provider. ⚠ Omitting it means NOT LIVE: an open screen sees
   * another person's delivery only when it reads again. Bind the app's one engine.
   */
  pubsubProvider?: unknown;

  /** Modules the host wants visible inside this one's injector (the POS, for the catalogue and feed). */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
