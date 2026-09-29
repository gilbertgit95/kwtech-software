/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the adapters only it can write.
 */
export interface PosModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /**
   * The module-kit `LimitChecker`, resolving `pos:items` from the plan.
   * ⚠ Omitting it means the DECLARED DEFAULT, not unlimited.
   */
  limitCheckerProvider?: unknown;
  /** A `PosAccessCheck` provider. Unbound: costs are never shown, and fixed discounts drop on every edit. */
  accessCheckProvider?: unknown;
  /** A `PosMemberDirectory` provider. Unbound: nobody has a name. */
  memberDirectoryProvider?: unknown;
  /**
   * A `PosPubSub` provider. ⚠ Omitting it means NOT LIVE: a till sees another
   * till's change only when it reads again. Bind the app's one engine.
   */
  pubsubProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
