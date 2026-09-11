import { Inject, Optional } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CONTACT_REFUSED_MESSAGE } from '../../domain/blocking.js';
import { ChatWriteError } from '../chat.errors.js';
import type { ChatModuleOptions } from '../chat.options.js';
import type { MessageRow, ParticipantRow } from '../chat.repository.js';
import type { ConversationSummary } from '../chat.service.js';
import { ChatService } from '../chat.service.js';
import { CHAT_OPTIONS, CHAT_USER_DIRECTORY } from '../chat.tokens.js';
import { ChatWriteService } from '../chat-write.service.js';
import type { UserDirectory } from '../user-directory.js';
import {
  ChatConversationType,
  ChatDirectoryMatchType,
  ChatMessagePageType,
  ChatMessageType,
  ChatParticipantType,
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
    await this.writes.invite(this.actor(gql.req), conversationId, userId);
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
    await this.writes.removeParticipant(this.actor(gql.req), conversationId, userId);
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
    await this.writes.rename(actorId, conversationId, {
      ...(title !== undefined ? { title } : {}),
      ...(icon !== undefined ? { icon } : {}),
    });
    return this.render(await this.chat.conversationFor(actorId, conversationId));
  }

  @Mutation(() => Boolean, { name: 'setChatArchived' })
  async setArchived(
    @Context() gql: { req?: unknown },
    @Args('conversationId') conversationId: string,
    @Args('archived') archived: boolean,
  ): Promise<boolean> {
    await this.writes.setArchived(this.actor(gql.req), conversationId, archived);
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
  @Mutation(() => Boolean, { name: 'setChatBlocked' })
  async setBlocked(
    @Context() gql: { req?: unknown },
    @Args('userId') userId: string,
    @Args('blocked') blocked: boolean,
  ): Promise<boolean> {
    await this.writes.setBlocked(this.actor(gql.req), userId, blocked);
    return true;
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
  const { conversation, me, participants, unread } = summary;
  return {
    id: conversation.id,
    title: conversation.title,
    icon: conversation.icon,
    isDirect: conversation.directKey !== null,
    createdById: conversation.createdById,
    archived: conversation.archivedAt !== null,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    myStatus: me.status,
    unread,
    participants: participants.map((row) => renderParticipant(row, people)),
  };
}

function renderParticipant(row: ParticipantRow, people: ReadonlyMap<string, string>): ChatParticipantType {
  return {
    userId: row.userId,
    // The id is a poor name and a working one. A missing directory entry — a
    // deleted account, an unwired port — must not blank the whole conversation.
    displayName: people.get(row.userId) ?? row.userId,
    status: row.status,
  };
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
