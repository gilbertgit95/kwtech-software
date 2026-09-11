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

@ObjectType('ChatDirectoryMatch')
export class ChatDirectoryMatchType {
  @Field()
  userId!: string;

  @Field()
  displayName!: string;
}
