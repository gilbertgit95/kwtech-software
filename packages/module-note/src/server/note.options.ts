/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the adapters only it can write.
 */
export interface NoteModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /**
   * The module-kit `LimitChecker`, resolving `note:notes` from the plan.
   * ⚠ Omitting it means the DECLARED DEFAULT for everybody, not unlimited.
   */
  limitCheckerProvider?: unknown;
  /** A `NoteAccessCheck` provider. Unbound: you act on your own notes only. */
  accessCheckProvider?: unknown;
  /** A `NoteAuthorDirectory` provider. Unbound: no names, "a member". */
  authorDirectoryProvider?: unknown;
  /**
   * A `NotePubSub` provider. ⚠ Omitting it means NOT LIVE: nobody sees another
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
