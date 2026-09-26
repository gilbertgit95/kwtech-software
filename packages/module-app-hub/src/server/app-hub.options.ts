/**
 * What the host supplies. No ports: the Apps page asks nothing of another
 * module that the guard has not already answered (who is signed in, and whether
 * they are a member of this workspace).
 */
export interface AppHubModuleOptions {
  /** The client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
}
