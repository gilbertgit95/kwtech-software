import type { LimitChecker } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CHAT_DEFAULT, type ChatDefaultReader } from '../defaults.js';
import { clearAtFrom, effectiveAvailability, isAvailability } from '../domain/availability.js';
import { isContactBlocked } from '../domain/blocking.js';
import { directKeyFor } from '../domain/conversations.js';
import { canEditMessage, editPatch, prepareBody, refuseDelete } from '../domain/messages.js';
import { shouldNotify } from '../domain/notify.js';
import {
  type ActorAuthority,
  canArchiveConversation,
  canInviteToConversation,
  canManageConversation,
  isChatParticipantRole,
  refuseRoleChange,
  refuseRoleRemoval,
  roleOf,
  successorTo,
  transferOwnership,
} from '../domain/participant-roles.js';
import { canAccessConversation, isLiveParticipant, nextParticipantStatus } from '../domain/participation.js';
import { CHAT_LIMIT } from '../feature-keys.js';
import type { ChatParticipantRole } from '../types.js';
import { ChatWriteError } from './chat.errors.js';
import { ChatEventPublisher } from './chat.events.js';
import type { ChatNotifier } from './chat.notifier.js';
import { CHAT_DEFAULT_LIMIT_CHECKER } from './chat.options.js';
import { ChatPresenceService } from './chat.presence.service.js';
import type {
  AvailabilityRow,
  ChatTransaction,
  ChatWriteClient,
  ConversationRow,
  MessageRow,
  ParticipantRow,
} from './chat.repository.js';
import { CHAT_DEFAULTS, CHAT_LIMIT_CHECKER, CHAT_NOTIFIER, CHAT_PRISMA_WRITE } from './chat.tokens.js';

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
    /**
     * Absent means availability is saved and nobody is told, which is the shape
     * a worker gets. The ephemeral half of this feature has no meaning without
     * a socket.
     */
    @Optional() private readonly presence?: ChatPresenceService,
    /**
     * Absent means every default is unset — the creator owns the group and
     * everybody else joins as a member, exactly as before the settings existed.
     */
    @Optional() @Inject(CHAT_DEFAULTS) private readonly defaults?: ChatDefaultReader,
    /**
     * ⚠ Absent means NOBODY IS TOLD unless their tab is open — the behaviour
     * that existed before this port, and a working product rather than a broken
     * one. §12.50 is the entry that says it does not meet the requirement.
     */
    @Optional() @Inject(CHAT_NOTIFIER) private readonly notifier?: ChatNotifier,
  ) {}

  /**
   * What an operator chose, or the built-in answer.
   *
   * ⚠ VALIDATED, not trusted. The value is a string in somebody else's table
   * and can be anything — a role renamed out of existence, a typo, a key set
   * before this module declared its choices. An unrecognised value falls back
   * rather than being written, because a participant row carrying a role the
   * enum does not have is a row every rule reads as `member` anyway, with no
   * error to explain why.
   */
  private async defaultRole(key: string, fallback: ChatParticipantRole): Promise<ChatParticipantRole> {
    const chosen = await this.defaults?.read(key).catch(() => null);
    return isChatParticipantRole(chosen) ? chosen : fallback;
  }

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

    /*
     * ⚠ READ BEFORE THE TRANSACTION OPENS. The values live in another module's
     * table, reached through a port that may do its own query — and holding a
     * transaction open across a call into somebody else's service is how one
     * slow read becomes a lock somebody else is waiting on.
     */
    const [creatorRole, memberRole] = await Promise.all([
      this.defaultRole(CHAT_DEFAULT.creatorRole, 'owner'),
      this.defaultRole(CHAT_DEFAULT.memberRole, 'member'),
    ]);

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
      /*
       * ⚠ THE CREATOR IS THE OWNER, and this is the only place a group's owner
       * is minted. Everywhere else the role moves — handed on deliberately, or
       * passed to a successor when the owner leaves — but a group has to start
       * with exactly one, and this is the moment it has one participant.
       *
       * ⚠ THE OPERATOR MAY DISAGREE, and the setting says what that costs: a
       * group whose creator is not the owner has NO owner, because nothing else
       * mints one. It is their decision to make and the description on the
       * screen states the consequence rather than the screen refusing it.
       */
      await tx.chatParticipant.create({
        data: { conversationId: conversation.id, userId: actorId, status: 'active', role: creatorRole },
      });

      for (const userId of new Set(input.userIds)) {
        /*
         * Blocked people are SKIPPED rather than refusing the whole create —
         * and silently, because naming them tells the creator who has blocked
         * them. The group is made with everybody who can be reached.
         */
        if (userId === actorId || isContactBlocked(blocks, actorId, userId)) continue;
        await tx.chatParticipant.create({
          data: { conversationId: conversation.id, userId, status: 'invited', role: memberRole, invitedById: actorId },
        });
      }
      return conversation;
    });

    await this.events?.conversationChanged(conversation.id, 'started');
    return conversation;
  }

  /** Add somebody to a conversation the actor is in. */
  async invite(
    actorId: string,
    conversationId: string,
    userId: string,
    options: { asPlatformAdmin?: boolean } = {},
  ): Promise<void> {
    // Read outside the transaction — see `startGroup`.
    const memberRole = await this.defaultRole(CHAT_DEFAULT.memberRole, 'member');

    await this.prisma.$transaction(async (tx) => {
      const me = await this.rowFor(tx, conversationId, actorId);
      /*
       * ⚠ THE ROLE, not merely the row. Holding `chat:invite` says you may add
       * people to conversations you run; it says nothing about a group you
       * merely belong to. That distinction was inexpressible while the only
       * answer was an app-level key.
       */
      if (!canInviteToConversation({ participant: me, asPlatformAdmin: options.asPlatformAdmin })) {
        throw new ChatWriteError('not_permitted', 'Only an owner or an admin can add somebody', { conversationId });
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

      await this.reviveParticipant(tx, conversationId, userId, 'invited', actorId, memberRole);
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
   *
   * ⚠ AN OWNER LEAVING HANDS THE GROUP ON, in the same transaction. The
   * alternatives were both worse: refusing to let them go strands a group when
   * an account is closed, and letting them go without a successor leaves a room
   * nobody can rename, archive or hand on — a dead end that reads as a bug
   * months later. See `successorTo` for who gets it and why.
   */
  async leave(actorId: string, conversationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const me = await this.rowFor(tx, conversationId, actorId);
      if (!isLiveParticipant(me)) {
        throw new ChatWriteError('not_found', 'No such conversation', { conversationId });
      }

      if (roleOf(me) === 'owner') {
        const everyone = await tx.chatParticipant.findMany({ where: { conversationId } });
        const successor = successorTo(everyone, actorId, (one) => rowOf(everyone, one.userId)?.joinedAt.getTime() ?? 0);

        /*
         * Nobody left to hand it to means they are the last one here, and the
         * room goes with them — archived rather than deleted, so coming back is
         * an invitation rather than an act of recovery.
         */
        if (successor) {
          await tx.chatParticipant.update({
            where: { conversationId_userId: { conversationId, userId: successor } },
            data: { role: 'owner' },
          });
        }
      }

      await this.applyTransition(tx, actorId, conversationId, 'leave');
    });

    await this.events?.conversationChanged(conversationId, 'left', [actorId]);
  }

  /**
   * Take somebody out. ⚠ THE OWNER CANNOT BE, by anybody — see
   * `refuseRoleRemoval`.
   */
  async removeParticipant(
    actorId: string,
    conversationId: string,
    userId: string,
    options: { asPlatformAdmin?: boolean } = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new ChatWriteError('not_found', 'No such conversation', { conversationId });

      const actor = await this.rowFor(tx, conversationId, actorId);
      const target = await this.rowFor(tx, conversationId, userId);
      const refusal = refuseRoleRemoval({
        actor: { participant: actor, asPlatformAdmin: options.asPlatformAdmin },
        target,
      });
      if (refusal === 'not_a_participant') {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', { conversationId });
      }
      if (refusal === 'self_removal') {
        // Not an error the UI should show: they wanted to leave.
        throw new ChatWriteError('invalid', 'Leave the conversation instead', { conversationId });
      }
      if (refusal === 'owner') {
        throw new ChatWriteError('not_permitted', 'The owner of a conversation cannot be removed', { conversationId });
      }
      if (refusal === 'not_permitted') {
        throw new ChatWriteError('not_permitted', 'You cannot remove that person', { conversationId, userId });
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

    /*
     * ⚠ AFTER THE PUBLISH, AND AWAITED RATHER THAN FLOATED.
     *
     * After, because the socket is the fast path and a mail transport must
     * never sit in front of it. Awaited, because a floating promise here is an
     * unhandled rejection in a Node process — `notifyAbsent` swallows
     * everything internally, so this costs nothing and keeps the failure
     * inside a function that is allowed to have one.
     *
     * ⚠ And only for a NEW message: a retry already notified whoever was owed
     * a notification the first time.
     */
    if (isNew) await this.notifyAbsent(message);
    return message;
  }

  /**
   * Tell whoever is not looking, and never let it break the send.
   *
   * ## ⚠ Everything in here is best-effort, deliberately
   *
   * The message is already committed and already on every open socket by the
   * time this runs. A mail server that is down, a port that throws, a presence
   * service that is not bound — none of them may turn a delivered message into
   * a failed `send`, because the message WAS delivered. So the whole body is
   * inside one try/catch that swallows, which is a shape worth justifying
   * exactly once rather than apologising for at each call.
   *
   * ## ⚠ The decision is the DOMAIN's, per recipient
   *
   * `shouldNotify` is pure and holds all seven refusals. This function's job is
   * only to gather what it asks for: who is in the room, who holds a socket,
   * what each of them declared, and when each was last told.
   */
  private async notifyAbsent(message: MessageRow): Promise<void> {
    if (!this.notifier) return;

    try {
      const conversation = await this.prisma.chatConversation.findUnique({ where: { id: message.conversationId } });
      if (!conversation) return;

      const participants = await this.prisma.chatParticipant.findMany({
        where: { conversationId: message.conversationId },
      });

      const now = new Date();

      /*
       * ⚠ Presence is OPTIONAL, and its absence must not read as "everybody is
       * online" — that would silence every notification in a host that binds no
       * ephemeral tier, which is the failure that looks like the feature simply
       * not working. Unbound means nobody holds a socket, so everybody is
       * reachable, which is the safe direction.
       */
      const online = (userId: string) => this.presence?.isOnline(userId) ?? false;

      /*
       * ⚠ DECLARED AVAILABILITY, read here rather than through
       * `presenceFor` — that one filters to the VIEWER's partners, which is
       * the right answer to a different question and would drop people this
       * one has to decide about.
       *
       * §12.44 said `dnd` would stop being presentation and start being
       * delivery the day a notification system existed. This is that line.
       */
      const declared = await this.prisma.chatAvailability.findMany({
        where: { userId: { in: participants.map((row) => row.userId) } },
      });
      const availabilityOf = new Map(declared.map((row) => [row.userId, effectiveAvailability(row, now)]));

      const owed = participants.filter((row) =>
        shouldNotify({
          recipientId: row.userId,
          authorId: message.authorId,
          status: row.status,
          recipientOnline: online(row.userId),
          availability: availabilityOf.get(row.userId) ?? 'available',
          mutedUntil: row.mutedUntil,
          lastNotifiedAt: row.lastNotifiedAt,
          now,
        }),
      );
      if (owed.length === 0) return;

      /*
       * ⚠ STAMPED BEFORE SENDING, not after.
       *
       * The cooldown exists to bound how much mail one conversation can
       * generate, and a transport that is slow or retries is exactly when that
       * matters most. Stamping after would let a second message arriving
       * mid-send read a stale mark and notify again. The cost of this order is
       * that a notification which then fails to send still consumes the
       * window — one missed nudge, against an unbounded flood, which is not a
       * close call.
       */
      await this.prisma.chatParticipant.updateMany({
        where: { conversationId: message.conversationId, userId: { in: owed.map((row) => row.userId) } },
        data: { lastNotifiedAt: now },
      });

      await Promise.all(
        owed.map((row) =>
          this.notifier?.notify({
            recipientId: row.userId,
            senderId: message.authorId as string,
            conversationId: message.conversationId,
            isGroup: conversation.directKey === null,
          }),
        ),
      );
    } catch {
      // See above. A message that was delivered must not report a failure
      // because the thing that tells people about it is unwell.
    }
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
    options: { asPlatformAdmin?: boolean } = {},
  ): Promise<ConversationRow> {
    const renamed = await this.prisma.$transaction(async (tx) => {
      const me = await this.rowFor(tx, conversationId, actorId);
      /*
       * ⚠ NARROWED. This was open to every active participant, so anybody in a
       * group could rename it for everybody — not a decision, the absence of
       * one.
       */
      if (!canManageConversation({ participant: me, asPlatformAdmin: options.asPlatformAdmin })) {
        throw new ChatWriteError('not_permitted', 'Only an owner or an admin can rename this', { conversationId });
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
  async setArchived(
    actorId: string,
    conversationId: string,
    archived: boolean,
    options: { asPlatformAdmin?: boolean } = {},
  ): Promise<ConversationRow> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new ChatWriteError('not_found', 'No such conversation', { conversationId });

      const me = await this.rowFor(tx, conversationId, actorId);
      /*
       * ⚠ THE OWNER'S ALONE, and an admin does not get it.
       *
       * It was the CREATOR's — a hardcoded `createdById` check, which was the
       * right answer before there was a word for authority and the wrong one
       * after: the creator can hand a group on, or leave it, and the person
       * running it afterwards is the one who should be able to put it away.
       *
       * The cap still follows `createdById` and is untouched by this. Archiving
       * frees the CREATOR's slot whoever presses the button, because the slot
       * was theirs to spend — two different questions, answered by two
       * different columns.
       */
      if (!canArchiveConversation({ participant: me, asPlatformAdmin: options.asPlatformAdmin })) {
        throw new ChatWriteError('not_permitted', 'Only the owner can archive this conversation', {
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

  /**
   * What somebody says about themselves.
   *
   * ⚠ THEIR OWN ROW AND NOBODY ELSE'S. There is no `userId` argument here and
   * there must never be one: availability is a declaration, and a declaration
   * somebody else can make on your behalf is not one.
   *
   * ⚠ `minutes` BECOMES A MOMENT, and the moment is compared on read. Storing a
   * duration would start it counting from an `updatedAt` somebody eventually
   * forgets to read; storing "expired" would need a scheduler this server does
   * not have (§12.40).
   */
  async setAvailability(actorId: string, availability: string, minutes?: number | null): Promise<AvailabilityRow> {
    // The GraphQL field is a String — the enum lives in the database and in the
    // domain, not in the transport — so anything can arrive here.
    if (!isAvailability(availability)) {
      throw new ChatWriteError('invalid', 'That is not an availability', { availability });
    }

    const clearAt = clearAtFrom(minutes, new Date());
    /*
     * ⚠ UPSERT, because a person has one answer or none. There is no "create
     * your availability" moment, and a create racing with itself across two
     * tabs would surface a unique-constraint error on a preference change.
     */
    const row = await this.prisma.chatAvailability.upsert({
      where: { userId: actorId },
      create: { userId: actorId, availability, clearAt },
      update: { availability, clearAt },
    });

    // After the write, like every other publish here — and it is the presence
    // service that decides who may be told.
    await this.presence?.availabilityChanged(actorId);
    return row;
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
    await this.prisma.$transaction((tx) => this.applyTransition(tx, actorId, conversationId, move));
  }

  /**
   * The move itself, INSIDE a transaction the caller already opened.
   *
   * Split out because `leave` needs to hand the group on in the same
   * transaction — a successor promoted in one transaction and the owner's
   * departure committed in another is a window with two owners or none, and
   * the window is exactly as long as a database round trip.
   */
  private async applyTransition(
    tx: ChatTransaction,
    actorId: string,
    conversationId: string,
    move: 'accept' | 'decline' | 'leave',
  ) {
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
  }

  /**
   * Hand the conversation to somebody else, or change what they may do in it.
   *
   * ⚠ OWNERSHIP IS A TRANSFER, never a second owner. `transferOwnership`
   * promotes and demotes in one answer so the demotion cannot be lost, and both
   * writes land in one transaction — there is no instant at which the group has
   * two owners or none.
   */
  async setParticipantRole(
    actorId: string,
    conversationId: string,
    userId: string,
    next: ChatParticipantRole,
    options: { asPlatformAdmin?: boolean } = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const actor = await this.rowFor(tx, conversationId, actorId);
      const target = await this.rowFor(tx, conversationId, userId);

      const refusal = refuseRoleChange({
        actor: { participant: actor, asPlatformAdmin: options.asPlatformAdmin },
        target,
        next,
      });
      if (refusal === 'not_a_participant') {
        throw new ChatWriteError('not_a_participant', 'You are not in that conversation', { conversationId });
      }
      if (refusal === 'self_demotion') {
        throw new ChatWriteError('invalid', 'Hand the conversation to somebody else instead', { conversationId });
      }
      if (refusal === 'not_permitted') {
        throw new ChatWriteError('not_permitted', 'Only the owner can change what somebody may do here', {
          conversationId,
        });
      }
      if (refusal) throw new ChatWriteError('not_found', 'That person is not in this conversation', { userId });

      const everyone = await tx.chatParticipant.findMany({ where: { conversationId } });
      const changes = next === 'owner' ? transferOwnership(everyone, userId) : [{ userId, role: next }];

      for (const change of changes) {
        await tx.chatParticipant.update({
          where: { conversationId_userId: { conversationId, userId: change.userId } },
          data: { role: change.role },
        });
      }
    });

    await this.events?.conversationChanged(conversationId, 'renamed');
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
    /**
     * ⚠ ONLY ON A NEW ROW. Somebody coming BACK keeps the role they had — a
     * re-invitation is not a demotion, and an admin who was removed by mistake
     * and added again should not quietly return as a member.
     */
    role?: ChatParticipantRole,
  ) {
    const existing = await this.rowFor(tx, conversationId, userId);
    if (!existing) {
      await tx.chatParticipant.create({
        data: { conversationId, userId, status, invitedById, ...(role ? { role } : {}) },
      });
      return;
    }
    if (existing.status === 'active') return;
    await tx.chatParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { status, invitedById, exitedAt: null },
    });
  }
}

/** One row out of a set already loaded, for the successor's joining order. */
function rowOf(rows: readonly ParticipantRow[], userId: string): ParticipantRow | undefined {
  return rows.find((one) => one.userId === userId);
}

/** Strictly later in the thread's own ordering — `(createdAt, id)`, both halves. */
function isAfter(candidate: MessageRow, mark: MessageRow): boolean {
  if (candidate.createdAt.getTime() !== mark.createdAt.getTime()) {
    return candidate.createdAt.getTime() > mark.createdAt.getTime();
  }
  return candidate.id > mark.id;
}
