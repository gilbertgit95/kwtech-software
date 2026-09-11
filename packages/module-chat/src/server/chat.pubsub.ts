import type { MessageRow } from './chat.repository.js';

/**
 * The narrow slice of a pub/sub engine chat needs — declared structurally,
 * never imported from one. Bound by the host to `CHAT_PUBSUB`.
 *
 * ⚠ A DELIBERATE STRUCTURAL DUPLICATE of `PermissionsPubSub`, not an import of
 * it. Importing another module's port would make chat's events depend on
 * `module-permissions` being installed, which is the coupling §9 prohibits. The
 * app's `RealtimePubSub` satisfies both, which is the whole point: one engine
 * per process, chosen by the host, named by nobody.
 */
export interface ChatPubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/**
 * The events this module publishes.
 *
 * Named as data rather than written inline, for the reason feature keys are: a
 * trigger is a string on both sides of a wire, and two spellings of one event
 * is a subscription that silently never fires.
 *
 * ⚠ TWO TRIGGERS, not one per conversation. A topic per conversation would
 * mean a socket holding as many subscriptions as the person has threads, which
 * is the question §12.29 leaves open — so the answer here is that one socket
 * holds exactly one subscription, and the audience on each event decides who
 * receives it.
 */
export const CHAT_EVENT = {
  /** A message was posted, edited, deleted or moderated. */
  message: 'chat.message',
  /**
   * A conversation's shape changed — created, invited, answered, left,
   * removed, renamed, archived.
   *
   * ⚠ Carries NO conversation, deliberately. Unlike a message, what changed
   * here is small and cheap to re-read, and re-reading goes back through
   * `conversationFor`, which re-asks participation. So this event is the
   * `planChanged` shape — "something moved, re-read what you are showing" —
   * and it needs no second authorization path.
   */
  conversation: 'chat.conversation',
} as const;

export type ChatEventTrigger = (typeof CHAT_EVENT)[keyof typeof CHAT_EVENT];

/** Why a conversation event was published. Rendered to the client as-is. */
export type ConversationChange =
  | 'started'
  | 'invited'
  | 'accepted'
  | 'declined'
  | 'left'
  | 'removed'
  | 'renamed'
  | 'archived';

/**
 * What every published event carries, and the reason this module can stream at
 * all.
 *
 * ⚠ THE AUDIENCE IS COMPUTED AT PUBLISH TIME, from the participant rows as they
 * stand at that instant. A subscription is authorised ONCE, at subscribe, and
 * then streams for as long as the socket lives — so without this, somebody
 * removed from a conversation at 10:00 keeps receiving its messages until their
 * token expires. Re-reading the rows per publish is one query per event rather
 * than one per event per subscriber, and it is fresher than anything the
 * subscribe-time check could have known.
 *
 * It never reaches a client: the filter runs server-side and the audience is
 * dropped before rendering.
 */
export interface ChatAudience {
  readonly audience: readonly string[];
}

export interface ChatMessageEvent extends ChatAudience {
  /**
   * `sent` for a new message, `changed` for an edit, a delete or a moderation.
   * The client needs the difference: one appends, the other replaces in place.
   */
  change: 'sent' | 'changed';
  message: MessageRow;
}

export interface ChatConversationEvent extends ChatAudience {
  conversationId: string;
  change: ConversationChange;
}

/**
 * Whether one published event is for one viewer.
 *
 * Pure, and the only place the question is asked, so the per-publish filter is
 * testable without an engine, a socket or a database.
 */
export function deliverTo(event: ChatAudience, viewerId: string): boolean {
  return event.audience.includes(viewerId);
}

/**
 * A no-op engine, for a host that mounts chat without subscriptions.
 *
 * Publishing into nothing is correct there rather than an error — a worker
 * importing `ChatWriteService` has no GraphQL layer, no socket and nobody to
 * tell. Subscribing returns a stream that ENDS rather than one that hangs: a
 * closed stream is debuggable, a silent socket is not.
 */
export const NULL_CHAT_PUBSUB: ChatPubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
