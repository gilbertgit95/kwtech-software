import { withCatchUp } from '@kwtech/module-kit';
import { Inject, Optional } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { NotificationWriteError } from '../notification.errors.js';
import type { NotificationModuleOptions } from '../notification.options.js';
import {
  deliverTo,
  NOTIFICATION_EVENT,
  type NotificationEvent,
  type NotificationPubSub,
  NULL_NOTIFICATION_PUBSUB,
} from '../notification.pubsub.js';
import { NotificationSender } from '../notification.sender.js';
import { NotificationService } from '../notification.service.js';
import { NOTIFICATION_OPTIONS, NOTIFICATION_PUBSUB } from '../notification.tokens.js';
import { NotificationWriteService } from '../notification-write.service.js';
import {
  NotificationBatchArgs,
  NotificationBatchPageType,
  NotificationBatchType,
  NotificationEventType,
  NotificationListArgs,
  NotificationPageType,
  NotificationRecipientType,
  NotificationSendInputType,
  NotificationSourceType,
  NotificationsMissedType,
} from './notification.types.js';

/**
 * The notification module's GraphQL surface.
 *
 * ## ⚠ WHERE THE GUARD IS, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `NOTIFICATION_FEATURE_REGISTRY`,
 * which the app composes and `FeatureGuard` enforces — `@RequireFeature`
 * belongs to module-permissions, and a module may not import a module (§9).
 * `test/surface-coverage.test.ts` fails the build on an operation with no
 * binding.
 *
 * ## ⚠ NO DECLARED SCOPE, on purpose
 *
 * Every key here is APP level: the inbox belongs to the person, across every
 * organization and workspace. A scope would make the guard ask the question
 * inside one tenant, which is exactly what a global inbox is not.
 *
 * ## And the guard is only half
 *
 * The services filter every read and write by the actor, so `notification:read`
 * reaches the caller's own rows and nobody else's.
 */
@Resolver()
export class NotificationResolver {
  constructor(
    private readonly notifications: NotificationService,
    private readonly writes: NotificationWriteService,
    private readonly sender: NotificationSender,
    @Inject(NOTIFICATION_OPTIONS) private readonly options: NotificationModuleOptions,
    /** Absent: the subscription streams `sync` and ends. The inbox still works over HTTP. */
    @Optional() @Inject(NOTIFICATION_PUBSUB) private readonly pubsub?: NotificationPubSub,
  ) {}

  // ── the inbox (notification:read) ─────────────────────────────────────────

  @Query(() => NotificationPageType, { name: 'notifications' })
  async list(@Context() gql: { req?: unknown }, @Args() args: NotificationListArgs): Promise<NotificationPageType> {
    return this.notifications.list(this.actor(gql.req), {
      first: args.first ?? null,
      after: args.after ?? null,
      before: args.before ?? null,
      order: args.order ?? null,
      unreadOnly: args.unreadOnly ?? null,
      archived: args.archived ?? null,
      severity: args.severity ?? null,
      source: args.source ?? null,
      organizationId: args.organizationId ?? null,
      globalOnly: args.globalOnly ?? null,
    });
  }

  @Query(() => Int, { name: 'notificationUnreadCount' })
  async unreadCount(@Context() gql: { req?: unknown }): Promise<number> {
    return this.notifications.unreadCount(this.actor(gql.req));
  }

  @Query(() => NotificationsMissedType, { name: 'notificationsSince' })
  async since(@Context() gql: { req?: unknown }, @Args('since') since: string): Promise<NotificationsMissedType> {
    return this.notifications.since(this.actor(gql.req), since);
  }

  @Query(() => [NotificationSourceType], { name: 'notificationSources' })
  sources(@Context() gql: { req?: unknown }): NotificationSourceType[] {
    // Resolved for the refusal, not the answer: an anonymous caller is refused
    // here as everywhere, rather than learning the app's source list.
    this.actor(gql.req);
    return this.notifications.sources().map((source) => ({ ...source }));
  }

  @Mutation(() => Int, { name: 'markNotificationsRead' })
  async markRead(@Context() gql: { req?: unknown }, @Args('ids', { type: () => [String] }) ids: string[]) {
    return this.writes.markRead(this.actor(gql.req), ids);
  }

  @Mutation(() => Int, { name: 'markNotificationsUnread' })
  async markUnread(@Context() gql: { req?: unknown }, @Args('ids', { type: () => [String] }) ids: string[]) {
    return this.writes.markUnread(this.actor(gql.req), ids);
  }

  @Mutation(() => Int, { name: 'markAllNotificationsRead' })
  async markAllRead(@Context() gql: { req?: unknown }, @Args('before') before: string) {
    return this.writes.markAllRead(this.actor(gql.req), before);
  }

  @Mutation(() => Int, { name: 'archiveNotifications' })
  async archive(@Context() gql: { req?: unknown }, @Args('ids', { type: () => [String] }) ids: string[]) {
    return this.writes.archive(this.actor(gql.req), ids);
  }

  @Mutation(() => Int, { name: 'unarchiveNotifications' })
  async unarchive(@Context() gql: { req?: unknown }, @Args('ids', { type: () => [String] }) ids: string[]) {
    return this.writes.unarchive(this.actor(gql.req), ids);
  }

  /**
   * The live stream: `sync` first, then this person's events.
   *
   * ⚠ No `since` argument. `graphql-ws` re-sends a subscription's ORIGINAL
   * variables on every reconnect, so a cursor passed here would be stale from
   * the first reconnect on. The client answers `sync` by re-reading, and asks
   * `notificationsSince` with a time it tracks itself — the same arrangement
   * chat uses.
   *
   * Guarded by the `notification:read` BINDING, once, at subscribe. The
   * AUDIENCE is decided on every publish: `deliverTo` sends an event to its one
   * recipient's sockets and nobody else's.
   */
  @Subscription(() => NotificationEventType, {
    name: 'notificationEvents',
    /**
     * ⚠ REQUIRED, and its absence is silent: without it GraphQL looks for a
     * `notificationEvents` property on the payload, finds none, and delivers
     * `data: null` forever.
     */
    resolve: (payload: NotificationEventType) => payload,
  })
  notificationEvents(@Context() gql: { req?: unknown }): AsyncIterableIterator<NotificationEventType> {
    // Resolved HERE, not inside the generator: an unauthenticated subscribe is
    // refused at subscribe, not on the first event that never comes.
    const actorId = this.actor(gql.req);
    const live = (this.pubsub ?? NULL_NOTIFICATION_PUBSUB).asyncIterableIterator<NotificationEvent>(
      NOTIFICATION_EVENT.item,
    );
    return withCatchUp<NotificationEvent, NotificationEventType>({
      live,
      catchUp: async () => [SYNC_EVENT],
      transform: (event) => (deliverTo(event, actorId) ? renderEvent(event) : null),
      // Nothing to de-duplicate: the catch-up is one `sync` with no rows in it.
      keyOf: () => null,
    });
  }

  // ── sending and recalling (notification:send / notification:manage) ──────

  /**
   * The compose screen. ⚠ Always as the PLATFORM: the recipient reads
   * "Platform", and the actor is recorded on the batch for the audit, never
   * shown. People who want to tell someone something personally use chat.
   */
  @Mutation(() => NotificationBatchType, { name: 'sendNotification' })
  async send(
    @Context() gql: { req?: unknown },
    @Args('input') input: NotificationSendInputType,
  ): Promise<NotificationBatchType> {
    const result = await this.sender.sendAsPlatform(this.actor(gql.req), {
      recipientIds: input.recipientIds,
      severity: input.severity ?? null,
      title: input.title,
      body: input.body ?? null,
      linkLabel: input.linkLabel ?? null,
      linkHref: input.linkHref ?? null,
    });
    const batch = await this.notifications.batch(result.batchId);
    if (!batch) throw new NotificationWriteError('not_found', 'The send was written but could not be read back.');
    return batch;
  }

  @Query(() => NotificationBatchPageType, { name: 'notificationBatches' })
  async batches(
    @Context() gql: { req?: unknown },
    @Args() args: NotificationBatchArgs,
  ): Promise<NotificationBatchPageType> {
    return this.notifications.batches(this.actor(gql.req), {
      first: args.first ?? null,
      after: args.after ?? null,
      mineOnly: args.mineOnly ?? null,
    });
  }

  @Query(() => [NotificationRecipientType], { name: 'notificationRecipientSearch' })
  async recipientSearch(
    @Context() gql: { req?: unknown },
    @Args('query') query: string,
  ): Promise<NotificationRecipientType[]> {
    this.actor(gql.req);
    return this.notifications.searchRecipients(query);
  }

  @Mutation(() => NotificationBatchType, { name: 'recallNotificationBatch' })
  async recall(@Context() gql: { req?: unknown }, @Args('batchId') batchId: string): Promise<NotificationBatchType> {
    await this.writes.recall(this.actor(gql.req), batchId);
    const batch = await this.notifications.batch(batchId);
    if (!batch) throw new NotificationWriteError('not_found', 'That send does not exist.');
    return batch;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Principal → id, through the host's hook. Throws rather than returning
   * undefined: a resolver that quietly acted as nobody would read the inbox of
   * the empty string.
   */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new NotificationWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

const SYNC_EVENT: NotificationEventType = { kind: 'sync', ids: [], batchId: null, notification: null };

/** The wire shape of an event. `recipientId` stays on the server: it was the filter, not content. */
function renderEvent(event: NotificationEvent): NotificationEventType {
  return { kind: event.kind, ids: event.ids, batchId: event.batchId, notification: event.notification };
}
