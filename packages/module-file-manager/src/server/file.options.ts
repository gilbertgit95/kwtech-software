/**
 * What the host supplies, and what it may leave out. Every seam is a named
 * port with a documented meaning when absent (`file.tokens.ts`).
 */
export interface FileModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /** A `FileStore` provider. ⚠ Unbound: no upload and no download — "not set up". */
  storeProvider?: unknown;
  /** The module-kit `LimitChecker`. ⚠ Unbound: the DECLARED DEFAULT caps, not unlimited. */
  limitCheckerProvider?: unknown;
  /** A `FileMemberDirectory` provider. Unbound: nobody can be chosen by name, and no names. */
  memberDirectoryProvider?: unknown;
  /** A `FileNotifier` provider. Unbound: nobody is told. */
  notifierProvider?: unknown;
  /** A `FilePubSub` provider. ⚠ Unbound: NOT LIVE. Bind the app's one engine. */
  pubsubProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Seconds a person has to START an upload after asking. Default 300. */
  uploadTicketSeconds?: number;
  /** Seconds a person has to start a download after asking. Default 60: long enough to start one, no longer. */
  downloadTicketSeconds?: number;

  /** Which transports to publish: GraphQL, and the two routes that carry the bytes. */
  expose?: { graphql?: boolean; rest?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
