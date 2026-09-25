import type { HrefPolicy } from '../domain/actions.js';
import { NOTIFICATION_RECIPIENTS_FLOOR } from '../domain/compose.js';
import { resolveFloodLimit } from '../domain/flood.js';
import { composeSources } from '../domain/sources.js';
import type { NotificationSource } from '../types.js';

/**
 * What the host supplies, and what it may leave out. Every seam is a NAMED
 * PORT with a documented default.
 */
export interface NotificationModuleOptions {
  /** The read client. Structural, host-injected — this module opens nothing. */
  prismaProvider?: unknown;
  /** The write client, which must expose `$transaction`. */
  prismaWriteProvider?: unknown;
  /**
   * A `NotificationPubSub` provider. ⚠ Omitting it means NOT LIVE — nothing
   * arrives by itself. Bind the app's one engine, never a new one.
   */
  pubsubProvider?: unknown;
  /** A `NotificationUserDirectory` provider. Unbound: the compose screen finds nobody. */
  userDirectoryProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /** Which transports to publish. GraphQL only. */
  expose?: { graphql?: boolean };

  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;

  /**
   * The kinds of notification this app sends: "Queue", "Account". The module
   * adds `platform` itself. ⚠ A send naming a source that is not here is
   * refused, so a raw key never reaches a screen.
   */
  sources?: readonly NotificationSource[];

  /**
   * People one send may reach. Defaults to 500. Sends to everyone are a
   * different mechanism (announcements), not a larger number here.
   *
   * ⚠ Configured here rather than as a role limit: module-kit's limit checker
   * resolves a cap for an ACTING PERSON, and nearly every send here has none —
   * the system is the sender.
   */
  maxRecipientsPerSend?: number;

  /**
   * Items per source per person per minute before the rest fold into one
   * overflow row. Defaults to 20; a bad value falls back to 20, never to
   * "unlimited".
   */
  floodLimitPerMinute?: number;

  /**
   * Whether a button may link to plain `http://`. ⚠ Off unless the app turns it
   * on, and the app should only in development.
   */
  allowHttpLinks?: boolean;
}

/** The options as the services use them, resolved ONCE so a bad source list fails the boot. */
export interface NotificationConfig {
  sources: readonly NotificationSource[];
  sourceByKey: ReadonlyMap<string, NotificationSource>;
  maxRecipients: number;
  floodLimit: number;
  hrefPolicy: HrefPolicy;
}

/**
 * ⚠ THROWS on a duplicate or malformed source key — at boot, where a
 * configuration mistake belongs, rather than on the first send that names it.
 */
export function resolveNotificationConfig(options: NotificationModuleOptions): NotificationConfig {
  const sources = composeSources(options.sources ?? []);
  const configured = options.maxRecipientsPerSend;
  return {
    sources,
    sourceByKey: new Map(sources.map((source) => [source.key, source])),
    maxRecipients:
      configured !== undefined && Number.isInteger(configured) && configured > 0
        ? configured
        : NOTIFICATION_RECIPIENTS_FLOOR,
    floodLimit: resolveFloodLimit(options.floodLimitPerMinute),
    hrefPolicy: { allowHttp: options.allowHttpLinks ?? false },
  };
}
