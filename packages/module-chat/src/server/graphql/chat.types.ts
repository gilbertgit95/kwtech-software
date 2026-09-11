import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * The public shapes. Code-first, so these classes ARE the schema — there is no
 * SDL to keep in step, which is the whole reason the app's `graphql.options.ts`
 * names no module.
 *
 * ⚠ Dates cross as ISO STRINGS, matching every other type in this schema. A
 * `Date` scalar would be nicer and would be a second serialisation format in one
 * API, which is how two clients end up parsing two things.
 */

@ObjectType('ChatParticipant')
export class ChatParticipantType {
  @Field()
  userId!: string;

  /** Resolved through the host's `UserDirectory`, or the id when there is none. */
  @Field()
  displayName!: string;

  /** 'invited' | 'active'. Nothing else is ever listed — see the read service. */
  @Field()
  status!: string;
}

@ObjectType('ChatMessage')
export class ChatMessageType {
  @Field()
  id!: string;

  @Field()
  conversationId!: string;

  /** 'user' | 'system'. */
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  authorId!: string | null;

  /**
   * ⚠ NULL FOR A DELETED MESSAGE, always.
   *
   * The row keeps its body so a moderator's action is reversible in the
   * database, and serving it to a client would make the tombstone decorative.
   * Filtered HERE rather than in each query, so a new query cannot forget.
   */
  @Field(() => String, { nullable: true })
  body!: string | null;

  @Field(() => String, { nullable: true })
  replyToMessageId!: string | null;

  @Field()
  createdAt!: string;

  @Field(() => String, { nullable: true })
  editedAt!: string | null;

  @Field()
  deleted!: boolean;
}

@ObjectType('ChatConversation')
export class ChatConversationType {
  @Field()
  id!: string;

  /** Null for a direct chat, which is named by who is in it. */
  @Field(() => String, { nullable: true })
  title!: string | null;

  @Field(() => String, { nullable: true })
  icon!: string | null;

  @Field()
  isDirect!: boolean;

  @Field()
  createdById!: string;

  @Field()
  archived!: boolean;

  @Field(() => String, { nullable: true })
  lastMessageAt!: string | null;

  /** The viewer's own status: 'active' or 'invited'. */
  @Field()
  myStatus!: string;

  /**
   * WHO IS ASKING, which the thread cannot draw itself without.
   *
   * ⚠ Every message carries an `authorId` and nothing says which of them is
   * yours — so without this a client cannot align its own messages, or know
   * which it may edit. It is the same kind of fact as `myStatus` beside it: not
   * a property of the conversation, but of the viewer's standing in it.
   *
   * ⚠ NOT A SEPARATE `chatViewer` QUERY. That would be a new operation needing
   * its own binding, and a round trip for one string every list already
   * implies. It repeats across rows, which is the price of not adding a surface
   * to guard.
   */
  @Field()
  myUserId!: string;

  @Field(() => Int)
  unread!: number;

  @Field(() => [ChatParticipantType])
  participants!: ChatParticipantType[];
}

@ObjectType('ChatMessagePage')
export class ChatMessagePageType {
  @Field(() => [ChatMessageType])
  items!: ChatMessageType[];

  /**
   * The cursor to ask for the next (older) page with, or null at the beginning
   * of history. ⚠ Opaque on purpose: it encodes the `(createdAt, id)` pair, and
   * a client that built one itself would be building a keyset.
   */
  @Field(() => String, { nullable: true })
  nextCursor!: string | null;
}

/**
 * One thing that happened, pushed down the socket.
 *
 * ⚠ ONE TYPE FOR EVERY EVENT, rather than a union. A union would be tidier in
 * the schema and would cost every client an inline fragment per case, and the
 * cases differ by two nullable fields — so this is the shape that stays cheap
 * as step 8 adds presence and typing to it.
 *
 * `kind` says which shape this is; `change` says what happened within it.
 */
@ObjectType('ChatEvent')
export class ChatEventType {
  /**
   * 'sync' | 'message' | 'conversation'.
   *
   * ⚠ `sync` is the FIRST event on every connection and every reconnection, and
   * it carries nothing: it means "you have been away, re-read your list". It is
   * what makes an invitation, a removal or a rename survive a dropped socket
   * without any of them needing a replay of their own.
   */
  @Field()
  kind!: string;

  /** Absent only on `sync`, which is about everything at once. */
  @Field(() => String, { nullable: true })
  conversationId!: string | null;

  /**
   * For a message: 'sent' | 'changed' — one appends, the other replaces.
   * For a conversation: 'started' | 'invited' | 'accepted' | 'declined' |
   * 'left' | 'removed' | 'renamed' | 'archived'.
   */
  @Field(() => String, { nullable: true })
  change!: string | null;

  /**
   * ⚠ CARRIED, where a conversation event only says "re-read".
   *
   * The departure is deliberate and it is the one place chat does not follow
   * `planChanged`'s "an event is a hint, the guarded query is the data" rule. A
   * message that costs a round trip before it can be drawn is a chat that feels
   * broken, and the delivery decision is not weaker for it: the audience on
   * every published event is re-read from the participant rows AT PUBLISH TIME,
   * which is fresher than the check any query would repeat.
   *
   * What it does cost is bounded and known: entitlement — `chat:read` itself —
   * is checked once at subscribe, so a role change mid-socket is honoured only
   * when the socket next closes, which the token expiry guarantees within
   * minutes. Participation is not on that clock; the key is.
   */
  @Field(() => ChatMessageType, { nullable: true })
  message!: ChatMessageType | null;

  /**
   * Who this is about — a 'presence' or 'typing' event names a person rather
   * than a message.
   */
  @Field(() => String, { nullable: true })
  userId!: string | null;

  /** 'presence' only. Null elsewhere rather than false, which would read as "offline". */
  @Field(() => Boolean, { nullable: true })
  online!: boolean | null;

  /** 'presence' only, and never 'invisible' — see `ChatPresence`. */
  @Field(() => String, { nullable: true })
  availability!: string | null;
}

/**
 * One person's presence, as somebody entitled to it is told.
 *
 * ⚠ ALREADY THROUGH `publishedPresence` before this exists: an invisible person
 * is `{ online: false, availability: null }`, indistinguishable from one who is
 * genuinely away. A client that received "online, but do not show it" would
 * have been told, in a payload anybody can read.
 */
@ObjectType('ChatPresence')
export class ChatPresenceType {
  @Field()
  userId!: string;

  @Field()
  online!: boolean;

  /**
   * 'available' | 'busy' | 'dnd' | 'away'.
   *
   * ⚠ NULL when there is nothing to say, never 'available' as a stand-in for
   * "we are not telling you" — which a client would draw as a green dot. And
   * never 'invisible': that value describes a setting, and publishing it would
   * announce the very thing it exists to hide.
   */
  @Field(() => String, { nullable: true })
  availability!: string | null;
}

/** The viewer's OWN setting, which is the only one anybody may read in full. */
@ObjectType('ChatMyAvailability')
export class ChatMyAvailabilityType {
  /** ⚠ Includes 'invisible', because this is you asking about yourself. */
  @Field()
  availability!: string;

  /** When it stops meaning anything, derived on read. Null if it does not. */
  @Field(() => String, { nullable: true })
  clearAt!: string | null;
}

@ObjectType('ChatDirectoryMatch')
export class ChatDirectoryMatchType {
  @Field()
  userId!: string;

  @Field()
  displayName!: string;
}
