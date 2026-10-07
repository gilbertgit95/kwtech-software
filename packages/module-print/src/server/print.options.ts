/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the adapters only it can write.
 */
export interface PrintModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /**
   * The module-kit `LimitChecker`, resolving `print:agents` from the plan.
   * ⚠ Omitting it means the DECLARED DEFAULT for everybody, not unlimited.
   */
  limitCheckerProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /**
   * Which transports to publish. `rest` is the relay's two routes, which carry
   * a print job's file (`http/print-relay.controller.ts`); everything else is
   * GraphQL. Both default to on.
   */
  expose?: { graphql?: boolean; rest?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
