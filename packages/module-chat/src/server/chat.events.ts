import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CHAT_EVENT, type ChatPubSub, type ConversationChange, NULL_CHAT_PUBSUB } from './chat.pubsub.js';
import type { ChatPrismaClient, MessageRow } from './chat.repository.js';
import { CHAT_PRISMA, CHAT_PUBSUB } from './chat.tokens.js';

/**
 * Announcing what just happened, to exactly the people it happened to.
 *
 * ## Why this is not four lines inside the write service
 *
 * Because the audience is a QUERY, and the rule about when it runs is easy to
 * get wrong in a way nothing catches:
 *
 *   ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction
 *   announces a message that a later rollback un-sends, and the subscribers
 *   have already rendered it. The write service therefore returns from
 *   `$transaction` first and calls in here second, which is a shape worth
 *   having one place rather than eleven.
 *
 *   ⚠ AND IT MUST NOT FAIL THE WRITE. The message is saved; the socket is an
 *   enhancement. Letting a pub/sub error propagate would turn a delivered
 *   message into a 500 and a client retry — so every publish here is caught and
 *   logged, and the caller cannot tell.
 */
@Injectable()
export class ChatEventPublisher {
  private readonly logger = new Logger('ChatEvents');

  constructor(
    @Inject(CHAT_PRISMA) private readonly prisma: ChatPrismaClient,
    @Optional() @Inject(CHAT_PUBSUB) private readonly pubsub?: ChatPubSub,
  ) {}

  private get engine(): ChatPubSub {
    return this.pubsub ?? NULL_CHAT_PUBSUB;
  }

  /**
   * A new message. ⚠ ACTIVE PARTICIPANTS ONLY.
   *
   * An invited person may see THAT they were invited and never what was said —
   * the same rule `canAccessConversation` enforces on every read, applied to the
   * one path that pushes content rather than answering a request for it. Getting
   * this wrong would leak a message body to somebody who has not accepted, which
   * is the exact thing the module was written rules-first to avoid.
   *
   * The author is included: their other tabs are subscribers too, and a message
   * that appears on one device and not the next reads as a bug.
   */
  async messageSent(message: MessageRow): Promise<void> {
    await this.publishMessage(message, 'sent');
  }

  /** An edit, a delete or a moderation. Same audience, different verb. */
  async messageChanged(message: MessageRow): Promise<void> {
    await this.publishMessage(message, 'changed');
  }

  private async publishMessage(message: MessageRow, change: 'sent' | 'changed'): Promise<void> {
    await this.safely(async () => {
      const audience = await this.activeIn(message.conversationId);
      if (audience.length === 0) return;
      await this.engine.publish(CHAT_EVENT.message, { audience, change, message });
    });
  }

  /**
   * The conversation itself moved — somebody joined, left, was removed, or it
   * was renamed or archived.
   *
   * `alsoTell` is for the person who is no longer in it. A removal computes an
   * audience that by definition excludes them, and their client is the one that
   * most needs to hear: without it a removed person keeps a dead conversation on
   * screen until they reload.
   */
  async conversationChanged(
    conversationId: string,
    change: ConversationChange,
    alsoTell: readonly string[] = [],
  ): Promise<void> {
    await this.safely(async () => {
      const present = await this.prisma.chatParticipant.findMany({
        where: { conversationId, status: { in: ['active', 'invited'] } },
      });
      const audience = [...new Set([...present.map((row) => row.userId), ...alsoTell])];
      if (audience.length === 0) return;
      await this.engine.publish(CHAT_EVENT.conversation, { audience, conversationId, change });
    });
  }

  private async activeIn(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.chatParticipant.findMany({ where: { conversationId, status: 'active' } });
    return rows.map((row) => row.userId);
  }

  /**
   * Publishing is best-effort, and the log line is what makes "best-effort"
   * different from "silently broken".
   */
  private async safely(publish: () => Promise<void>): Promise<void> {
    try {
      await publish();
    } catch (error) {
      this.logger.error(`A chat event could not be published: ${(error as Error).message}`);
    }
  }
}
