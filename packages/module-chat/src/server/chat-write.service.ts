import type { LimitChecker } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { isContactBlocked } from '../domain/blocking.js';
import { directKeyFor } from '../domain/conversations.js';
import { canEditMessage, editPatch, prepareBody, refuseDelete } from '../domain/messages.js';
import {
  canAccessConversation,
  isLiveParticipant,
  nextParticipantStatus,
  refuseRemoval,
} from '../domain/participation.js';
import { CHAT_LIMIT } from '../feature-keys.js';
import { ChatWriteError } from './chat.errors.js';
import { ChatEventPublisher } from './chat.events.js';
import { CHAT_DEFAULT_LIMIT_CHECKER } from './chat.options.js';
import type { ChatTransaction, ChatWriteClient, ConversationRow, MessageRow } from './chat.repository.js';
import { CHAT_LIMIT_CHECKER, CHAT_PRISMA_WRITE } from './chat.tokens.js';

/**
 * Every write chat makes, and the one rule they all share.
 *
 * ⚠ PARTICIPATION IS RE-ASKED HERE, on every path, against the row in the
 * database — not against anything the caller sent and not against a decision
 * made by a guard. The guard answered "may this user use chat". This answers "is
 * this conversation somewhere they may be", which is the question C1 was about.
 *
 * ## And every write ANNOUNCES itself, after it has committed
 *
 * ⚠ THE PUBLISH IS ALWAYS OUTSIDE THE TRANSACTION, which is why several methods
 * below assign the result and return it on a second line rather than returning
 * the `$transaction` call directly. Announcing from inside means announcing a
 * message that a rollback then un-sends, to clients that have already drawn it.
 *
 * Two writes deliberately announce NOTHING. `markRead` moves the viewer's own
 * mark — their other tabs are stale for a moment and nobody else's view changes
 * — and `setBlocked` is private by its nature: telling the blocked person is
 * exactly what §12's blocking design refuses to do. Both are listed here so the
 * silence reads as a decision rather than an omission.
 */
@Injectable()
export class ChatWriteService {
  constructor(
    @Inject(CHAT_PRISMA_WRITE) private readonly prisma: ChatWriteClient,
    /**
     * ⚠ Absent means NO CAP. A host with no permission model gets an unguarded
     * but working chat, which is the design goal; a host that meant to enforce
     * one and forgot the binding gets silence, which is the price and is written
     * down rather than discovered.
     */
    @Optional() @Inject(CHAT_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    /**
     * Absent means nothing is announced, and the writes still happen — the
     * shape a worker importing this service gets. Optional rather than a null
     * object because the publisher needs a client of its own, and a service
     * that constructs one would be choosing an engine.
     */
    @Optional() private readonly events?: ChatEventPublisher,
  ) {}

  private get checker(): LimitChecker {
    return this.limits ?? CHAT_DEFAULT_LIMIT_CHECKER;
  }

  /**
   * Open a direct chat with somebody, or return the one that already exists.
   *
   * ⚠ The key is COMPUTED HERE. A client-supplied `directKey` forges a DM
   * between two other people, and the only defence against that is never
   * accepting one.
   */
  async startDirect(actorId: string, otherUserId: string): Promise<ConversationRow> {
    const directKey = directKeyFor(actorId, otherUserId);

    const conversation = await this.prisma.$transaction(async (tx) => {
      /*
       * ⚠ Blocking is checked on the way IN, in either direction, and the
       * caller is expected to answer with CONTACT_REFUSED_MESSAGE — the same
       * sentence an unknown address gets. A distinct refusal here is a
       * notification that you have been blocked.
       */
      const blocks = await tx.chatBlock.findMany({
        where: { OR: [{ blockerId: actorId }, { blockedId: actorId }] },
      });
      if (isContactBlocked(blocks, actorId, otherUserId)) {
        throw new ChatWriteError('blocked', 'That conversation cannot be started', {});
      }

      const existing = await tx.chatConversation.findUnique({ where: { directKey } });
      if (existing) {
        /*
         * Re-opening one somebody left, rather than creating a second thread
         * with the same two people — which the unique constraint would refuse
         * anyway, as a 500 instead of an answer.
         */
        await this.reviveParticipant(tx, existing.id, actorId, 'active', null);
        await this.reviveParticipant(tx, existing.id, otherUserId, 'invited', actorId);
        return existing;
      }

      const conversation = await tx.chatConversation.create({
        data: { directKey, createdById: actorId },
      });
      await tx.chatParticipant.create({
        data: { conversationId: conversation.id, userId: actorId, status: 'active' },
      });
      await tx.chatParticipant.create({
        data: { conversationId: conversation.id, userId: otherUserId, status: 'invited', invitedById: actorId },
      });
      return conversation;
    });

    await this.events?.conversationChanged(conversation.id, 'started');
    return conversation;
  }

  /**
   * Create a group. ⚠ THE ONLY PATH THE CAP GUARDS.
   *
   * Direct chats are deliberately uncapped: the cap bounds how many rooms one
   * person can stand up, not who they may talk to.
   */
  async startGroup(
    actorId: string,
    input: { title: string; icon?: string | null; userIds: readonly string[] },
  ): Promise<ConversationRow> {
    const title = input.title.trim();
    if (!title) throw new ChatWriteError('invalid', 'A group needs a name', {});

    const conversation = await this.prisma.$transaction(async (tx) => {
      /*
       * ⚠ COUNTED INSIDE THE TRANSACTION, and the count is this module's own —
       * the checker resolves the cap and never learns what a conversation is.
       * Outside a transaction the check is advisory: two simultaneous creates
       * both read the same number and both pass.
       */
      const current = await tx.chatConversation.count({
        where: {
          createdById: actorId,
          archivedAt: null,
          directKey: null,
          participants: { some: { userId: actorId, status: 'active' } },
        },
      });

      const decision = await this.checker.check({ actorId, key: CHAT_LIMIT.groupChats, current });
      if (!decision.allowed) {
        throw new ChatWriteError('cap_reached', 'You have as many group chats as your role allows', {
          limit: decision.limit,
          current: decision.current,
        });
      }

      const blocks = await tx.chatBlock.findMany({
        where: { OR: [{ blockerId: actorId }, { blockedId: actorId }] },
      });

      const conversation = await tx.chatConversation.create({
        data: { title, icon: input.icon?.trim() || null, directKey: null, createdById: actorId },
      });
      await tx.chatParticipant.create({
        data: { conversationId: conversation.id, userId: actorId, status: 'active' },
      });

      for (const userId of new Set(input.userIds)) {
        /*
         * Blocked people are SKIPPED rather than refusing the whole create —
         * and silently, because naming them tells the creator who has blocked
         * them. The group is made with everybody who can be reached.
         */
        if (userId === actorId || isContactBlocked(blocks, actorId, userId)) continue;
        await tx.chatParticipant.create({
          data: { conversationId: conversation.id, userId, status: 'invited', invitedById: actorId },
        });
      }
      return conversation;
    });

    await this.events?.conversationChanged(conversation.id, 'started');
    return conversation;
  }

  /** Add somebody to a conversation the actor is in. */
  async invite(actorId: string, conversationId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const me = await this.rowFor(tx, conversationId, actorId);
      if (!canAccessConversation(me)) {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', { conversationId });
      }
      const conversation = await tx.chatConversation.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new ChatWriteError('not_found', 'No such conversation', { conversationId });
      /*
       * ⚠ A DIRECT CHAT CANNOT GROW. Two people are what its `directKey` means,
       * and adding a third would leave a conversation whose unique key no longer
       * describes who is in it. Turning a DM into a group is a different act and
       * is not offered.
       */
      if (conversation.directKey !== null) {
        throw new ChatWriteError('not_permitted', 'A direct chat cannot take a third person', { conversationId });
      }

      const blocks = await tx.chatBlock.findMany({
        where: { OR: [{ blockerId: actorId }, { blockedId: actorId }] },
      });
      if (isContactBlocked(blocks, actorId, userId)) {
        throw new ChatWriteError('blocked', 'That person cannot be added', {});
      }

      await this.reviveParticipant(tx, conversationId, userId, 'invited', actorId);
    });

    await this.events?.conversationChanged(conversationId, 'invited');
  }

  /** Accept or decline an invitation addressed to the actor. */
  async respondToInvitation(actorId: string, conversationId: string, accept: boolean): Promise<void> {
    await this.transition(actorId, conversationId, accept ? 'accept' : 'decline');
    /*
     * ⚠ `alsoTell` the person who answered, because declining takes them OUT of
     * the audience the publisher computes — and their other tabs are the ones
     * that most need to drop the invitation from the inbox.
     */
    await this.events?.conversationChanged(conversationId, accept ? 'accepted' : 'declined', [actorId]);
  }

  /**
   * Leave. ⚠ NO KEY GUARDS THIS — withholding one would be a lockout dressed as
   * a permission, and the creator leaving is how they free a cap slot honestly.
   */
  async leave(actorId: string, conversationId: string): Promise<void> {
    await this.transition(actorId, conversationId, 'leave');
    await this.events?.conversationChanged(conversationId, 'left', [actorId]);
  }

  /** Remove somebody else. The creator cannot be removed by anybody. */
  async removeParticipant(actorId: string, conversationId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new ChatWriteError('not_found', 'No such conversation', { conversationId });

      const actor = await this.rowFor(tx, conversationId, actorId);
      const target = await this.rowFor(tx, conversationId, userId);
      const refusal = refuseRemoval({ conversation, actor, target });
      if (refusal === 'not_a_participant') {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', { conversationId });
      }
      if (refusal === 'self_removal') {
        // Not an error the UI should show: they wanted to leave.
        throw new ChatWriteError('invalid', 'Leave the conversation instead', { conversationId });
      }
      if (refusal === 'creator') {
        throw new ChatWriteError('not_permitted', 'The person who started this cannot be removed', { conversationId });
      }
      if (refusal) throw new ChatWriteError('not_found', 'That person is not in this conversation', { userId });

      await tx.chatParticipant.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { status: 'removed', exitedAt: new Date() },
      });
    });

    // The removed person is told LAST and told at all: their client is the one
    // holding a conversation it may no longer read.
    await this.events?.conversationChanged(conversationId, 'removed', [userId]);
  }

  /**
   * Post a message.
   *
   * ⚠ IDEMPOTENT ON `clientMessageId`. Optimistic insert plus a flaky network
   * plus a retry equals two identical messages, and the unique index is only
   * half the fix — without this read the retry surfaces as a constraint
   * violation instead of the message the client already believes it sent.
   */
  async send(
    actorId: string,
    input: { conversationId: string; body: string; clientMessageId?: string | null; replyToMessageId?: string | null },
  ): Promise<MessageRow> {
    const prepared = prepareBody(input.body);
    if ('refused' in prepared) {
      throw new ChatWriteError(
        'invalid',
        prepared.refused === 'empty' ? 'Nothing to send' : 'That message is too long',
        {
          refused: prepared.refused,
        },
      );
    }

    const { message, isNew } = await this.prisma.$transaction(async (tx) => {
      const me = await this.rowFor(tx, input.conversationId, actorId);
      if (!canAccessConversation(me)) {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', {
          conversationId: input.conversationId,
        });
      }

      if (input.clientMessageId) {
        const already = await tx.chatMessage.findFirst({
          where: { conversationId: input.conversationId, clientMessageId: input.clientMessageId },
        });
        // The same message, returned again. A retry is not an error.
        if (already) return { message: already, isNew: false };
      }

      const message = await tx.chatMessage.create({
        data: {
          conversationId: input.conversationId,
          kind: 'user',
          authorId: actorId,
          body: prepared.body,
          clientMessageId: input.clientMessageId ?? null,
          replyToMessageId: input.replyToMessageId ?? null,
        },
      });

      /*
       * ⚠ Written from the MESSAGE'S OWN createdAt, which the database
       * generated — not from a second `new Date()`. Two clocks would let the
       * list order disagree with the thread order.
       */
      await tx.chatConversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: message.createdAt },
      });
      return { message, isNew: true };
    });

    /*
     * ⚠ A RETRY ANNOUNCES NOTHING. The first send already published this
     * message; publishing it again would append it twice on every screen but
     * the sender's — theirs dedupes on `clientMessageId`, which is exactly the
     * reason the other screens cannot.
     */
    if (isNew) await this.events?.messageSent(message);
    return message;
  }

  /** Edit your own message. Never touches `createdAt`. */
  async edit(actorId: string, messageId: string, body: string): Promise<MessageRow> {
    const prepared = prepareBody(body);
    if ('refused' in prepared) {
      throw new ChatWriteError('invalid', 'That message cannot be saved', { refused: prepared.refused });
    }

    const edited = await this.prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.findUnique({ where: { id: messageId } });
      if (!message) throw new ChatWriteError('not_found', 'No such message', { messageId });

      const me = await this.rowFor(tx, message.conversationId, actorId);
      if (!canAccessConversation(me)) {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', {});
      }
      if (!canEditMessage(message, actorId)) {
        throw new ChatWriteError('not_permitted', 'Only the author may edit a message', { messageId });
      }

      return tx.chatMessage.update({ where: { id: messageId }, data: editPatch(prepared.body, new Date()) });
    });
    await this.events?.messageChanged(edited);
    return edited;
  }

  /**
   * Delete a message — your own, or somebody else's with `chat:moderate`.
   *
   * ⚠ `mayModerate` is the KEY's answer and is passed in: this module does not
   * read grants. The other half — being in the conversation — is read here.
   */
  async delete(actorId: string, messageId: string, options: { mayModerate: boolean }): Promise<MessageRow> {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.findUnique({ where: { id: messageId } });
      if (!message) throw new ChatWriteError('not_found', 'No such message', { messageId });

      const me = await this.rowFor(tx, message.conversationId, actorId);
      const refusal = refuseDelete(message, me, options);
      if (refusal === 'not_a_participant') {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', {});
      }
      if (refusal === 'already_deleted') {
        throw new ChatWriteError('already_deleted', 'That message is already deleted', { messageId });
      }
      if (refusal) throw new ChatWriteError('not_permitted', 'You may not delete that message', { messageId });

      /*
       * ⚠ WHO and WHEN, both. `deletedById` is not redundant with `authorId`:
       * moderation deletes somebody else's message, and "who removed this" is
       * the question asked afterwards. Two columns instead of an audit
       * subsystem.
       */
      return tx.chatMessage.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedById: actorId },
      });
    });

    // The tombstone is an EVENT, not a silent disappearance: every open thread
    // has the body on screen already, and only a push can take it back.
    await this.events?.messageChanged(deleted);
    return deleted;
  }

  /** Rename or re-icon a group. Direct chats have no name to change. */
  async rename(
    actorId: string,
    conversationId: string,
    input: { title?: string | null; icon?: string | null },
  ): Promise<ConversationRow> {
    const renamed = await this.prisma.$transaction(async (tx) => {
      const me = await this.rowFor(tx, conversationId, actorId);
      if (!canAccessConversation(me)) {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', { conversationId });
      }
      const conversation = await tx.chatConversation.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new ChatWriteError('not_found', 'No such conversation', { conversationId });
      if (conversation.directKey !== null) {
        throw new ChatWriteError('not_permitted', 'A direct chat is named by who is in it', { conversationId });
      }

      return tx.chatConversation.update({
        where: { id: conversationId },
        data: {
          ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
          ...(input.icon !== undefined ? { icon: input.icon?.trim() || null } : {}),
        },
      });
    });

    await this.events?.conversationChanged(conversationId, 'renamed');
    return renamed;
  }

  /** Archive or restore. ⚠ Archiving FREES a cap slot for the creator. */
  async setArchived(actorId: string, conversationId: string, archived: boolean): Promise<ConversationRow> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new ChatWriteError('not_found', 'No such conversation', { conversationId });

      const me = await this.rowFor(tx, conversationId, actorId);
      if (!canAccessConversation(me)) {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', { conversationId });
      }
      /*
       * ⚠ THE CREATOR'S ALONE, because archiving is what spends and frees their
       * cap slot — see `countsTowardCap`. Letting any participant archive would
       * let one person clear somebody else's quota, or fill it back up.
       */
      if (conversation.createdById !== actorId) {
        throw new ChatWriteError('not_permitted', 'Only the person who started this can archive it', {
          conversationId,
        });
      }

      return tx.chatConversation.update({
        where: { id: conversationId },
        data: { archivedAt: archived ? new Date() : null },
      });
    });

    await this.events?.conversationChanged(conversationId, 'archived');
    return updated;
  }

  /**
   * Move the read mark forward.
   *
   * ⚠ FORWARD ONLY. A client that re-sends an older id — a background tab
   * catching up, a reordered response — would otherwise resurrect messages as
   * unread, and the badge would flicker for reasons nobody can reproduce.
   */
  async markRead(actorId: string, conversationId: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const me = await this.rowFor(tx, conversationId, actorId);
      if (!canAccessConversation(me)) {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', { conversationId });
      }

      const message = await tx.chatMessage.findUnique({ where: { id: messageId } });
      if (!message || message.conversationId !== conversationId) {
        throw new ChatWriteError('not_found', 'No such message', { messageId });
      }

      if (me.lastReadMessageId) {
        const mark = await tx.chatMessage.findUnique({ where: { id: me.lastReadMessageId } });
        if (mark && !isAfter(message, mark)) return;
      }

      await tx.chatParticipant.update({
        where: { conversationId_userId: { conversationId, userId: actorId } },
        data: { lastReadMessageId: messageId },
      });
    });
  }

  /** Block somebody. Existing conversations stay; new contact stops. */
  async setBlocked(actorId: string, userId: string, blocked: boolean): Promise<void> {
    if (actorId === userId) throw new ChatWriteError('invalid', 'You cannot block yourself', {});

    if (!blocked) {
      await this.prisma.chatBlock.deleteMany({ where: { blockerId: actorId, blockedId: userId } });
      return;
    }
    const already = await this.prisma.chatBlock.findMany({
      where: { OR: [{ blockerId: actorId }, { blockedId: actorId }] },
    });
    if (already.some((row) => row.blockerId === actorId && row.blockedId === userId)) return;
    await this.prisma.chatBlock.create({ data: { blockerId: actorId, blockedId: userId } });
  }

  /** The actor's own row, read INSIDE the transaction that will act on it. */
  private rowFor(tx: ChatTransaction, conversationId: string, userId: string) {
    return tx.chatParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  }

  /** accept / decline / leave, which are all the actor's own decision. */
  private async transition(actorId: string, conversationId: string, move: 'accept' | 'decline' | 'leave') {
    await this.prisma.$transaction(async (tx) => {
      const me = await this.rowFor(tx, conversationId, actorId);
      if (!isLiveParticipant(me)) {
        throw new ChatWriteError('not_found', 'No such conversation', { conversationId });
      }
      const next = nextParticipantStatus(me.status, move);
      if (!next) throw new ChatWriteError('invalid', 'That is not available from here', { status: me.status });

      await tx.chatParticipant.update({
        where: { conversationId_userId: { conversationId, userId: actorId } },
        data: { status: next, exitedAt: next === 'active' ? null : new Date() },
      });
    });
  }

  /**
   * Put somebody into a conversation, whether or not they have been here before.
   *
   * ⚠ FLIPS THE EXISTING ROW rather than inserting a second one. That is what
   * makes a decline BOUND re-invitation instead of resetting it: the row
   * remembers. A fresh row each time erases the memory, and "declining only
   * lets them ask again immediately" is the harassment vector this design
   * already refused once.
   */
  private async reviveParticipant(
    tx: ChatTransaction,
    conversationId: string,
    userId: string,
    status: 'active' | 'invited',
    invitedById: string | null,
  ) {
    const existing = await this.rowFor(tx, conversationId, userId);
    if (!existing) {
      await tx.chatParticipant.create({ data: { conversationId, userId, status, invitedById } });
      return;
    }
    if (existing.status === 'active') return;
    await tx.chatParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { status, invitedById, exitedAt: null },
    });
  }
}

/** Strictly later in the thread's own ordering — `(createdAt, id)`, both halves. */
function isAfter(candidate: MessageRow, mark: MessageRow): boolean {
  if (candidate.createdAt.getTime() !== mark.createdAt.getTime()) {
    return candidate.createdAt.getTime() > mark.createdAt.getTime();
  }
  return candidate.id > mark.id;
}
