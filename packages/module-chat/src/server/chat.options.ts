import type { LimitChecker } from '@kwtech/module-kit';

/**
 * What the host supplies, and what it may leave out.
 *
 * ⚠ ZERO APP CODE IS NOT THE GOAL AND IS NOT ACHIEVABLE. The seams exist
 * precisely BECAUSE modules may not import each other, and that prohibition is
 * what makes chat portable at all. The goal is that every seam is a NAMED PORT
 * with a documented default, and that the host's total comes to one file.
 */
export interface ChatModuleOptions {
  /**
   * ⚠ ONE SWITCH, IN ONE PLACE.
   *
   * `forRoot({ enabled: false })` returns a module that registers NOTHING — no
   * resolvers, no routes, no subscriptions. A flag consulted independently by
   * each surface is a flag somebody forgets in one of them, and a "disabled"
   * chat that still answers a GraphQL query is worse than no switch at all.
   *
   * ⚠ DISABLING IS NOT UNINSTALLING. Every row stays and re-enabling restores
   * the product exactly — and a temporary disable must KEEP `CHAT_FEATURE_REGISTRY`
   * composed in the host's seed, because dropping it makes `syncFeatureRegistry`
   * deprecate the `chat:*` rows, and a deprecated feature grants nothing. Every
   * role would silently lose its chat rights and get them back only on
   * re-registration.
   */
  enabled?: boolean;

  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /** A `UserDirectory` provider. Required in practice; see that port. */
  userDirectoryProvider?: unknown;
  /**
   * The module-kit `LimitChecker`. ⚠ Omitting it means NO CAP — the null object
   * — which is what lets chat run in an app with no permission model at all.
   */
  limitCheckerProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only today; REST is not offered. */
  expose?: { graphql?: boolean };

  /**
   * Principal → `userId`. §9 rule 6, and the same seam `module-permissions`
   * already takes: the module never learns what a session is.
   */
  resolveActorId?: (request: unknown) => string | undefined;
}

/** What the module falls back to when the host says nothing. */
export const CHAT_DEFAULT_LIMIT_CHECKER: LimitChecker = {
  async check({ current }) {
    return { allowed: true, limit: null, current, remaining: null };
  },
};
