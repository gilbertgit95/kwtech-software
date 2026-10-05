/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the adapters only it can write.
 */
export interface BookingModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /**
   * The module-kit `LimitChecker`, resolving `booking:resources` from the plan.
   * ⚠ Omitting it means the DECLARED DEFAULT, not unlimited.
   */
  limitCheckerProvider?: unknown;
  /** A `BookingWorkspaceTimeZone` provider. Unbound: every workspace runs on Asia/Manila. */
  workspaceTimeZoneProvider?: unknown;
  /** A `BookingMemberDirectory` provider. Unbound: no names, no linked staff, no reminders. */
  memberDirectoryProvider?: unknown;
  /** A `BookingNotifier` provider. Unbound: nobody is told. */
  notifierProvider?: unknown;
  /**
   * A `BookingPubSub` provider. ⚠ Omitting it means NOT LIVE: nobody sees
   * another person's booking until they read again. Bind the app's one engine.
   */
  pubsubProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
