import { Inject, Optional } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { CONTACT_REFUSED_MESSAGE } from '../../domain/blocking.js';
import { isChatParticipantRole } from '../../domain/participant-roles.js';
import { withCatchUp } from '../chat.catch-up.js';
import { ChatWriteError } from '../chat.errors.js';
import type { ChatModuleOptions } from '../chat.options.js';
import { ChatPresenceService } from '../chat.presence.service.js';
import {
  CHAT_EVENT,
  type ChatConversationEvent,
  type ChatMessageEvent,
  type ChatPresenceEvent,
  type ChatPubSub,
  type ChatTypingEvent,
  deliverTo,
  NULL_CHAT_PUBSUB,
} from '../chat.pubsub.js';
import type { MessageRow, ParticipantRow } from '../chat.repository.js';
import type { ConversationSummary } from '../chat.service.js';
import { ChatService } from '../chat.service.js';
import { CHAT_OPTIONS, CHAT_PLATFORM_ADMIN, CHAT_PUBSUB, CHAT_USER_DIRECTORY } from '../chat.tokens.js';
import { ChatWriteService } from '../chat-write.service.js';
import type { PlatformAdminCheck } from '../platform-admin.js';
import type { UserDirectory } from '../user-directory.js';
import {
  ChatConversationType,
  ChatDirectoryMatchType,
  ChatEventType,
  ChatMessagePageType,
  ChatMessageType,
  ChatMyAvailabilityType,
  ChatParticipantType,
  ChatPresenceType,
} from './chat.types.js';

/**
 * Chat's GraphQL surface.
 *
 * ## ⚠ WHERE THE GUARD IS, since there is no decorator here
 *
 * Every operation below is guarded by its BINDING in `CHAT_FEATURE_REGISTRY` —
 * `graphql_operation: 'Mutation.sendChatMessage'` and so on — which the host
 * composes into `featureRegistry` and `FeatureGuard` enforces. There is no
 * `@RequireFeature` because that decorator belongs to `module-permissions`, and
 * a module may not import a module (§9).
 *
 * That is not a weaker guarantee, and it is checked twice: the guard builds its
 * index from the COMPOSED registry (fixed 2026-09-11 — it was a static built
 * from permissions' own, so a contributed binding enforced nothing), and
 * `auditRegistry()` reports any `chat:*` key whose binding names a surface that
 * does not exist.
 *
 * ## And the guard is only half
 *
 * PARTICIPATION IS NOT PERMISSION. `chat:send` says you may use chat; it says
 * nothing about conversation 42. Every method below goes through the services,
 * which re-read the participant row — see `ChatWriteService`.
 */
@Resolver()
export class ChatResolver {
  constructor(
    private readonly chat: ChatService,
    private readonly writes: ChatWriteService,
    @Inject(CHAT_OPTIONS) private readonly options: ChatModuleOptions,
    @Optional() @Inject(CHAT_USER_DIRECTORY) private readonly directory?: UserDirectory,
    /**
     * Absent means the one subscription below streams nothing and ends — see
     * `NULL_CHAT_PUBSUB`. A host that mounts chat without realtime gets a
     * working product over HTTP, which is the point of the port being optional.
     */
    @Optional() @Inject(CHAT_PUBSUB) private readonly pubsub?: ChatPubSub,
    /**
     * Absent means nobody may administer a conversation they are not in, which
     * is the right default for a host that has not granted it.
     */
    @Optional() @Inject(CHAT_PLATFORM_ADMIN) private readonly platform?: PlatformAdminCheck,
    /**
     * Absent means the ephemeral tier is not mounted: presence answers empty
     * and typing goes nowhere, while every conversation still works. That is
     * the right shape for a host with no socket.
     */
    @Optional() private readonly presence?: ChatPresenceService,
  ) {}

  // ── queries ───────────────────────────────────────────────────────────────

  @Query(() => [ChatConversationType], { name: 'chatConversations' })
  async conversations(@Context() gql: { req?: unknown }): Promise<ChatConversationType[]> {
    const actorId = this.actor(gql.req);
    const summaries = await this.chat.listConversations(actorId);
    return this.renderAll(summaries);
  }

  @Query(() => ChatConversationType, { name: 'chatConversation', nullable: true })
  async conversation(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
  ): Promise<ChatConversationType | null> {
    const actorId = this.actor(gql.req);
    try {
      const [rendered] = await this.renderAll([await this.chat.conversationFor(actorId, conversationId)]);
      return rendered ?? null;
    } catch (error) {
      // A conversation you may not see and one that does not exist are the same
      // answer, deliberately — see `conversationFor`.
      if (error instanceof ChatWriteError && error.reason === 'not_found') return null;
      throw error;
    }
  }

  @Query(() => ChatMessagePageType, { name: 'chatMessages' })
  async messages(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('cursor', { type: () => String, nullable: true }) cursor?: string | null,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number | null,
  ): Promise<ChatMessagePageType> {
    const actorId = this.actor(gql.req);
    const items = await this.chat.listMessages(actorId, conversationId, {
      before: decodeCursor(cursor),
      take: limit ?? null,
    });

    const oldest = items.at(-1);
    return {
      items: items.map(renderMessage),
      /*
       * Null when the page came back short of what was asked for, which is the
       * only honest "there is no more" a keyset can give without a second query.
       */
      nextCursor: oldest && items.length > 0 ? encodeCursor(oldest) : null,
    };
  }

  /**
   * ⚠ EXACT EMAIL MATCH, and a miss and a BLOCK are the same answer.
   *
   * A distinct "you have been blocked" is a notification to the blocked person
   * that tells them exactly what they wanted to know. Same value, same shape;
   * the timing difference of one extra query is below anything observable over
   * a network.
   */
  @Query(() => ChatDirectoryMatchType, { name: 'chatDirectoryLookup', nullable: true })
  async directoryLookup(
    @Context() gql: { req?: unknown },
    @Args('email') email: string,
  ): Promise<ChatDirectoryMatchType | null> {
    const actorId = this.actor(gql.req);
    if (!this.directory) return null;

    const found = await this.directory.findByEmail(email.trim().toLowerCase());
    if (!found) return null;
    if (await this.chat.contactBlocked(actorId, found.id)) return null;
    return { userId: found.id, displayName: found.displayName };
  }

  /**
   * Who among these people is here.
   *
   * ⚠ THE SERVICE FILTERS TO THE VIEWER'S OWN PARTNERS — ids that are not
   * silently drop out rather than being refused, which tells a prober nothing.
   * A presence query that answered for any id would be the enumeration oracle
   * the directory is exact-email-only to avoid, plus surveillance of a named
   * person by anybody who can guess an id.
   */
  @Query(() => [ChatPresenceType], { name: 'chatPresence' })
  async presenceOf(
    @Context() gql: { req?: unknown },
    @Args('userIds', { type: () => [String] }) userIds: string[],
  ): Promise<ChatPresenceType[]> {
    const actorId = this.actor(gql.req);
    if (!this.presence) return [];

    const found = await this.presence.presenceFor(actorId, userIds);
    return [...found].map(([userId, view]) => ({ userId, online: view.online, availability: view.availability }));
  }

  /** The viewer's own setting — the only one anybody may read in full. */
  @Query(() => ChatMyAvailabilityType, { name: 'chatMyAvailability' })
  async myAvailability(@Context() gql: { req?: unknown }): Promise<ChatMyAvailabilityType> {
    const row = await this.chat.availabilityOf(this.actor(gql.req));
    return {
      availability: row.availability,
      clearAt: row.clearAt?.toISOString() ?? null,
    };
  }

  // ── mutations ─────────────────────────────────────────────────────────────

  @Mutation(() => ChatConversationType, { name: 'startDirectChat' })
  async startDirect(@Context() gql: { req?: unknown }, @Args('userId') userId: string): Promise<ChatConversationType> {
    const actorId = this.actor(gql.req);
    try {
      const conversation = await this.writes.startDirect(actorId, userId);
      return this.render(await this.chat.conversationFor(actorId, conversation.id));
    } catch (error) {
      // The same sentence an unknown address gets.
      if (error instanceof ChatWriteError && error.reason === 'blocked') {
        throw new ChatWriteError('not_found', CONTACT_REFUSED_MESSAGE, {});
      }
      throw error;
    }
  }

  @Mutation(() => ChatConversationType, { name: 'startGroupChat' })
  async startGroup(
    @Context() gql: { req?: unknown },
    @Args('title') title: string,
    @Args('userIds', { type: () => [String] }) userIds: string[],
    @Args('icon', { type: () => String, nullable: true }) icon?: string | null,
  ): Promise<ChatConversationType> {
    const actorId = this.actor(gql.req);
    const conversation = await this.writes.startGroup(actorId, { title, icon: icon ?? null, userIds });
    return this.render(await this.chat.conversationFor(actorId, conversation.id));
  }

  @Mutation(() => ChatMessageType, { name: 'sendChatMessage' })
  async send(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('body') body: string,
    @Args('clientMessageId', { type: () => String, nullable: true }) clientMessageId?: string | null,
    @Args('replyToMessageId', { type: () => String, nullable: true }) replyToMessageId?: string | null,
  ): Promise<ChatMessageType> {
    const actorId = this.actor(gql.req);
    return renderMessage(
      await this.writes.send(actorId, {
        conversationId,
        body,
        clientMessageId: clientMessageId ?? null,
        replyToMessageId: replyToMessageId ?? null,
      }),
    );
  }

  @Mutation(() => ChatMessageType, { name: 'editChatMessage' })
  async edit(
    @Context() gql: { req?: unknown },
    @Args('messageId') messageId: string,
    @Args('body') body: string,
  ): Promise<ChatMessageType> {
    return renderMessage(await this.writes.edit(this.actor(gql.req), messageId, body));
  }

  /**
   * ⚠ `mayModerate` is decided by the GUARD, not here.
   *
   * The resolver cannot ask whether the caller holds `chat:moderate` — that is
   * the permission module's question and this module may not ask it. So the
   * moderation path is its OWN operation with its own binding: deleting your
   * own message is `deleteChatMessage`, deleting somebody else's is
   * `moderateChatMessage` and is bound to `chat:moderate`. Two operations
   * instead of one flag, and the key guards the one that needs it.
   */
  @Mutation(() => ChatMessageType, { name: 'deleteChatMessage' })
  async deleteOwn(@Context() gql: { req?: unknown }, @Args('messageId') messageId: string): Promise<ChatMessageType> {
    return renderMessage(await this.writes.delete(this.actor(gql.req), messageId, { mayModerate: false }));
  }

  @Mutation(() => ChatMessageType, { name: 'moderateChatMessage' })
  async moderateDelete(
    @Context() gql: { req?: unknown },
    @Args('messageId') messageId: string,
  ): Promise<ChatMessageType> {
    return renderMessage(await this.writes.delete(this.actor(gql.req), messageId, { mayModerate: true }));
  }

  @Mutation(() => Boolean, { name: 'inviteToChat' })
  async invite(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('userId') userId: string,
  ): Promise<boolean> {
    await this.writes.invite(this.actor(gql.req), conversationId, userId, {
      asPlatformAdmin: await this.platformAdmin(gql.req),
    });
    return true;
  }

  @Mutation(() => Boolean, { name: 'respondToChatInvitation' })
  async respond(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('accept') accept: boolean,
  ): Promise<boolean> {
    await this.writes.respondToInvitation(this.actor(gql.req), conversationId, accept);
    return true;
  }

  /** No key guards this one. Withholding it would be a lockout dressed as a permission. */
  @Mutation(() => Boolean, { name: 'leaveChat' })
  async leave(@Context() gql: { req?: unknown }, @Args('conversationId') conversationId: string): Promise<boolean> {
    await this.writes.leave(this.actor(gql.req), conversationId);
    return true;
  }

  @Mutation(() => Boolean, { name: 'removeChatParticipant' })
  async remove(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('userId') userId: string,
  ): Promise<boolean> {
    await this.writes.removeParticipant(this.actor(gql.req), conversationId, userId, {
      asPlatformAdmin: await this.platformAdmin(gql.req),
    });
    return true;
  }

  @Mutation(() => ChatConversationType, { name: 'renameChat' })
  async rename(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('title', { type: () => String, nullable: true }) title?: string | null,
    @Args('icon', { type: () => String, nullable: true }) icon?: string | null,
  ): Promise<ChatConversationType> {
    const actorId = this.actor(gql.req);
    await this.writes.rename(
      actorId,
      conversationId,
      {
        ...(title !== undefined ? { title } : {}),
        ...(icon !== undefined ? { icon } : {}),
      },
      { asPlatformAdmin: await this.platformAdmin(gql.req) },
    );
    return this.render(await this.chat.conversationFor(actorId, conversationId));
  }

  @Mutation(() => Boolean, { name: 'setChatArchived' })
  async setArchived(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('archived') archived: boolean,
  ): Promise<boolean> {
    await this.writes.setArchived(this.actor(gql.req), conversationId, archived, {
      asPlatformAdmin: await this.platformAdmin(gql.req),
    });
    return true;
  }

  @Mutation(() => Boolean, { name: 'markChatRead' })
  async markRead(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('messageId') messageId: string,
  ): Promise<boolean> {
    await this.writes.markRead(this.actor(gql.req), conversationId, messageId);
    return true;
  }

  /**
   * Blocking needs NO KEY either, for the same reason leaving does not: it is
   * the user's own remedy, and §12.42 leaves the platform without one.
   */
  /**
   * Say what you are doing. ⚠ ABOUT YOURSELF ONLY — there is no `userId`
   * argument and there must never be one.
   */
  @Mutation(() => ChatMyAvailabilityType, { name: 'setChatAvailability' })
  async setAvailability(
    @Context() gql: { req?: unknown },
    @Args('availability') availability: string,
    @Args('forMinutes', { type: () => Int, nullable: true }) forMinutes?: number | null,
  ): Promise<ChatMyAvailabilityType> {
    const row = await this.writes.setAvailability(this.actor(gql.req), availability, forMinutes ?? null);
    return { availability: row.availability, clearAt: row.clearAt?.toISOString() ?? null };
  }

  /**
   * "I am writing."
   *
   * ⚠ OVER HTTP, NOT THE SOCKET. It is the highest-frequency write in the
   * product — one per person per conversation every few seconds — and putting
   * it on the socket would need rate limiting of its own, which §12.29 leaves
   * open. As a mutation it passes `ThrottlerGuard` like everything else.
   *
   * ⚠ PARTICIPATION IS RE-ASKED, because a typing ping is a write into somebody
   * else's conversation: without this, anybody holding `chat:send` could make an
   * indicator appear in a thread they are not in.
   */
  @Mutation(() => Boolean, { name: 'sendChatTyping' })
  async sendTyping(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
  ): Promise<boolean> {
    const actorId = this.actor(gql.req);
    // Throws `not_found` for a conversation they may not be in — the same
    // answer a stranger gets for one that does not exist.
    await this.chat.conversationFor(actorId, conversationId);
    await this.presence?.noteTyping(conversationId, actorId);
    return true;
  }

  /**
   * Hand the conversation on, or change what somebody may do in it.
   *
   * ⚠ THE OWNER'S ALONE, or the platform's — `refuseRoleChange` decides, and
   * setting somebody to `owner` is a TRANSFER rather than a second owner.
   */
  @Mutation(() => Boolean, { name: 'setChatParticipantRole' })
  async setParticipantRole(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('userId') userId: string,
    @Args('role') role: string,
  ): Promise<boolean> {
    if (!isChatParticipantRole(role)) {
      throw new ChatWriteError('invalid', 'That is not a role', { role });
    }
    await this.writes.setParticipantRole(this.actor(gql.req), conversationId, userId, role, {
      asPlatformAdmin: await this.platformAdmin(gql.req),
    });
    return true;
  }

  @Mutation(() => Boolean, { name: 'setChatBlocked' })
  async setBlocked(
    @Context() gql: { req?: unknown },
    @Args('userId') userId: string,
    @Args('blocked') blocked: boolean,
  ): Promise<boolean> {
    await this.writes.setBlocked(this.actor(gql.req), userId, blocked);
    return true;
  }

  // ── the one subscription ──────────────────────────────────────────────────

  /**
   * Everything happening to this person, on one stream.
   *
   * ⚠ ONE SUBSCRIPTION PER SOCKET, not one per conversation. A topic per thread
   * would have a socket holding as many subscriptions as somebody has
   * conversations, growing as they talk to more people — which is §12.29's open
   * question answered by not creating it. The cost is that every subscriber's
   * filter runs over every published event; the saving is that the number of
   * subscriptions is one, forever.
   *
   * ⚠ `since` IS WHAT STOPS THIS LOSING MAIL. The socket closes when its
   * authorization expires, by design, so every client reconnects on a clock it
   * does not control — and the pub/sub has no replay, so an event published in
   * that gap is gone rather than late. The client sends the cursor of the last
   * message it holds and gets the gap back before anything live. See
   * `withCatchUp` for the ordering that makes it race-free.
   *
   * Guarded by the `chat:read` BINDING — `Subscription.chatEvents` — like every
   * other operation here. The subscription is authorised ONCE, at this call;
   * participation is re-asked on every publish instead, which is what the
   * audience on each event is.
   */
  @Subscription(() => ChatEventType, {
    name: 'chatEvents',
    /**
     * ⚠ REQUIRED, and its absence is silent — the same trap `planChanged`
     * documents. `graphql-subscriptions` assumes a payload is already keyed by
     * the field name, and without this GraphQL finds no `chatEvents` property
     * and delivers `data: null` forever.
     */
    resolve: (payload: ChatEventType) => payload,
  })
  chatEvents(
    @Context() gql: { req?: unknown },
    @Args('since', { type: () => String, nullable: true }) since?: string | null,
  ): AsyncIterableIterator<ChatEventType> {
    // Resolved HERE rather than inside the generator: an unauthenticated
    // subscribe must be refused at subscribe, not on the first event that never
    // comes.
    const actorId = this.actor(gql.req);
    const cursor = decodeCursor(since);

    const live = (this.pubsub ?? NULL_CHAT_PUBSUB).asyncIterableIterator<ChatEvent>([
      CHAT_EVENT.message,
      CHAT_EVENT.conversation,
      CHAT_EVENT.presence,
      CHAT_EVENT.typing,
    ]);

    return withCatchUp<ChatEvent, ChatEventType>({
      live,
      catchUp: () => this.catchUp(actorId, cursor),
      // ⚠ THE PER-PUBLISH FILTER. One published event, every subscriber's own
      // copy of this question.
      transform: (event) => (deliverTo(event, actorId) ? renderEvent(event) : null),
      /*
       * ⚠ THE CHANGE IS PART OF THE KEY, and dropping it would be a bug that
       * only shows up on reconnection: a catch-up row carries the message as it
       * stands NOW, and a live `changed` for that same id published a moment
       * later would be suppressed as a duplicate — leaving the edit invisible
       * until the next reload.
       */
      keyOf: (item) => (item.message ? `${item.change}:${item.message.id}` : null),
    });
  }

  /**
   * What the viewer missed, with `sync` always at the head of it.
   *
   * ⚠ `sync` IS EMITTED EVEN WITH NO CURSOR AND EVEN WITH NOTHING MISSED,
   * because it is what covers everything a message replay cannot: an
   * invitation, a removal, a rename and an archive have no rows to page
   * through. One event that means "re-read your list" is the complete answer to
   * all four, and it costs one query on a client that was only away for a
   * second.
   */
  private async catchUp(
    actorId: string,
    cursor: { createdAt: Date; id: string } | undefined,
  ): Promise<readonly ChatEventType[]> {
    const sync: ChatEventType = { ...EMPTY_EVENT, kind: 'sync' };
    if (!cursor) return [sync];

    const { messages } = await this.chat.missedSince(actorId, cursor);
    return [
      sync,
      ...messages.map(
        (message): ChatEventType => ({
          ...EMPTY_EVENT,
          kind: 'message',
          conversationId: message.conversationId,
          /*
           * Replayed as `sent` whatever has happened to it since: to a client
           * that never saw the message, an edit is not a change, it is the
           * message. `changed` would name a row it does not hold.
           */
          change: 'sent',
          message: renderMessage(message),
        }),
      ),
    ];
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  /**
   * Principal → id, through the host's hook.
   *
   * Throws rather than returning undefined: every operation here needs somebody,
   * and a resolver that quietly acted as nobody would read every conversation
   * belonging to the empty string.
   */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new ChatWriteError('not_permitted', 'Not signed in', {});
    return actorId;
  }

  /**
   * Whether this caller may administer a conversation they are not in.
   *
   * ⚠ FALSE WHEN THE HOST WIRED NOTHING, which is the correct default: a host
   * that has not answered the question has not granted the right, and every
   * conversation is then governed by its own participants alone.
   */
  private async platformAdmin(request: unknown): Promise<boolean> {
    return (await this.platform?.isPlatformAdmin(request)) ?? false;
  }

  /** One directory call for a whole page, never one per participant. */
  private async renderAll(summaries: readonly ConversationSummary[]): Promise<ChatConversationType[]> {
    const ids = summaries.flatMap((summary) => summary.participants.map((row) => row.userId));
    const people = new Map((await this.chat.describe(ids)).map((person) => [person.id, person.displayName]));
    return summaries.map((summary) => renderConversation(summary, people));
  }

  private async render(summary: ConversationSummary): Promise<ChatConversationType> {
    const [rendered] = await this.renderAll([summary]);
    // `renderAll` returns one per input, so this cannot be undefined — narrowed
    // rather than asserted, because a non-null assertion here would be the one
    // place a future change to renderAll failed silently.
    if (!rendered) throw new ChatWriteError('not_found', 'No such conversation', {});
    return rendered;
  }
}

function renderConversation(summary: ConversationSummary, people: ReadonlyMap<string, string>): ChatConversationType {
  const { conversation, me, participants, unread, preview } = summary;
  return {
    id: conversation.id,
    title: conversation.title,
    icon: conversation.icon,
    isDirect: conversation.directKey !== null,
    createdById: conversation.createdById,
    archived: conversation.archivedAt !== null,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    myStatus: me.status,
    // From the viewer's OWN participant row, which `conversationFor` already
    // narrowed — never from an argument, which would let a caller ask "as"
    // somebody else.
    myUserId: me.userId,
    unread,
    // ⚠ Rendered through the SAME function the thread uses, so a tombstone or an
    // edit reads identically in a preview and in a conversation — see §12.51.
    preview: preview ? renderMessage(preview) : null,
    participants: participants.map((row) => renderParticipant(row, people)),
  };
}

function renderParticipant(row: ParticipantRow, people: ReadonlyMap<string, string>): ChatParticipantType {
  return {
    userId: row.userId,
    role: row.role,
    // The id is a poor name and a working one. A missing directory entry — a
    // deleted account, an unwired port — must not blank the whole conversation.
    displayName: people.get(row.userId) ?? row.userId,
    status: row.status,
  };
}

/**
 * A published event as one viewer sees it — the audience dropped, which is the
 * only reason it is safe to carry one.
 */
/** Every shape the one topic set carries. */
type ChatEvent = ChatMessageEvent | ChatConversationEvent | ChatPresenceEvent | ChatTypingEvent;

const EMPTY_EVENT = {
  conversationId: null,
  change: null,
  message: null,
  userId: null,
  online: null,
  availability: null,
} as const;

function renderEvent(event: ChatEvent): ChatEventType {
  if ('message' in event) {
    return {
      ...EMPTY_EVENT,
      kind: 'message',
      conversationId: event.message.conversationId,
      change: event.change,
      message: renderMessage(event.message),
    };
  }
  if ('online' in event) {
    /*
     * ⚠ Carried AS PUBLISHED. The invisible rule was applied when the payload
     * was built, so there is nothing to hide here and nothing that could be
     * forgotten — see `publishedPresence`.
     */
    return {
      ...EMPTY_EVENT,
      kind: 'presence',
      userId: event.userId,
      online: event.online,
      availability: event.availability,
    };
  }
  if ('userId' in event) {
    return { ...EMPTY_EVENT, kind: 'typing', conversationId: event.conversationId, userId: event.userId };
  }
  return { ...EMPTY_EVENT, kind: 'conversation', conversationId: event.conversationId, change: event.change };
}

function renderMessage(row: MessageRow): ChatMessageType {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: row.kind,
    authorId: row.authorId,
    // ⚠ Never the body of a deleted message. One place, so no query forgets.
    body: deleted ? null : row.body,
    clientMessageId: row.clientMessageId,
    replyToMessageId: row.replyToMessageId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deleted,
  };
}

/**
 * The cursor is `<epoch ms>:<id>`, base64'd.
 *
 * Opaque so a client cannot build one — a hand-made cursor is a client that has
 * learned the keyset, and the next change to the ordering breaks it silently.
 * Base64 rather than a signature: it encodes nothing secret, and the worst a
 * forged one can do is page somebody's own conversation oddly.
 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.getTime()}:${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.indexOf(':');
  if (separator < 1) return undefined;
  const at = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  // A malformed cursor pages from the START rather than throwing: it is almost
  // always a stale link, and a 500 on a link somebody shared is a worse answer
  // than the first page.
  if (!Number.isFinite(at) || !id) return undefined;
  return { createdAt: new Date(at), id };
}
