/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the adapters only it can write.
 */
export interface BooksModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /** A `BooksAccessCheck` provider. Unbound: nobody may void an investor's entry. */
  accessCheckProvider?: unknown;
  /** A `BooksWorkspaceTimeZone` provider. Unbound: every workspace runs on Asia/Manila. */
  workspaceTimeZoneProvider?: unknown;
  /** A `BooksMemberDirectory` provider. Unbound: nobody has a name. */
  memberDirectoryProvider?: unknown;
  /**
   * A `BooksSalesSource` provider: the point of sale's takings. ⚠ Omitting it
   * means there is no POS — sales are recorded by hand, and bringing them in is
   * refused.
   */
  salesSourceProvider?: unknown;
  /**
   * A `BooksPubSub` provider. ⚠ Omitting it means NOT LIVE: an open screen sees
   * another person's entry only when it reads again. Bind the app's one engine.
   */
  pubsubProvider?: unknown;

  /** Modules the host wants visible inside this one's injector (the POS, for the sales source). */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
