/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the adapters only it can write.
 */
export interface TaskModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /**
   * The module-kit `LimitChecker`, resolving `task:boards` and `task:tasks`
   * from the plan. ⚠ Omitting it means the DECLARED DEFAULTS, not unlimited.
   */
  limitCheckerProvider?: unknown;
  /** A `TaskAccessCheck` provider. Unbound: nobody holds `task:assign` or `task:manage_all`. */
  accessCheckProvider?: unknown;
  /** A `TaskMemberDirectory` provider. Unbound: assign only yourself, and no names. */
  memberDirectoryProvider?: unknown;
  /** A `TaskNotifier` provider. Unbound: nobody is told. */
  notifierProvider?: unknown;
  /**
   * A `TaskPubSub` provider. ⚠ Omitting it means NOT LIVE: nobody sees another
   * person's change until they read again. Bind the app's one engine.
   */
  pubsubProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
