/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the adapters only it can write.
 */
export interface QueueModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /**
   * The module-kit `LimitChecker`. ⚠ Omitting it means NO CAP on windows and
   * the ceiling on displays, which is what lets the queue run in an app with no
   * permission model. A host that meant to enforce caps and forgot gets
   * silence, so it is one explicit line.
   */
  limitCheckerProvider?: unknown;
  /** A `QueueStaffCheck` provider. Unbound: assign only yourself. */
  staffCheckProvider?: unknown;
  /** A `QueueStaffDirectory` provider. Unbound: no picker, no names. */
  staffDirectoryProvider?: unknown;
  /** A `QueueWorkspaceLocator` provider. Unbound: no display can open. */
  workspaceLocatorProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
