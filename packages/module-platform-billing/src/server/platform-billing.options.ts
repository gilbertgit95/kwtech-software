/**
 * What the host supplies, and what it may leave out. Every seam is a NAMED
 * PORT with a documented meaning when absent.
 */
export interface PlatformBillingModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /** ⚠ REQUIRED: a `PlatformBillingSubscriptions` provider. The module refuses to boot without it. */
  subscriptionsProvider?: unknown;
  /** ⚠ REQUIRED: a `PlatformBillingPlans` provider. */
  plansProvider?: unknown;
  /** A `PlatformBillingPeople` provider. Unbound: every approver is flagged as a member (D15). */
  peopleProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
