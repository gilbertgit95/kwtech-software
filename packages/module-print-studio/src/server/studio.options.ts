/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the adapters only it can write.
 */
export interface StudioModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /**
   * The module-kit `LimitChecker`, resolving `studio:layouts` from the plan.
   * ⚠ Omitting it means the DECLARED DEFAULT for everybody, not unlimited.
   */
  limitCheckerProvider?: unknown;
  /**
   * A `StudioAccessCheck` provider. Unbound: you change your own layouts and
   * read your own print history, and nobody else's.
   */
  accessCheckProvider?: unknown;
  /** A `StudioMemberDirectory` provider. Unbound: no names, "a member". */
  memberDirectoryProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;

  /**
   * How many days a print history entry is kept before `studio.prune_logs`
   * deletes it. Default `STUDIO_LOG_RETENTION_DAYS` (90). The entries name the
   * files printed, which are often customers' names — so this is a retention
   * decision, and the host's to make.
   */
  logRetentionDays?: number;
}
