/**
 * The vocabulary, and the SHAPES THE DOMAIN REASONS ABOUT.
 *
 * Structural row types rather than Prisma's generated ones, for the reason this
 * package has no Prisma dependency at all: every function below is pure and
 * testable with a literal, and the day a host runs this module against a
 * different client the domain does not notice. The generated types are narrower
 * than these and assignable to them, so the server passes rows straight in.
 */

/**
 * `invited → active | declined`, plus `left` and `removed`.
 *
 * Mirrors `ChatParticipantStatus` in the Prisma fragment. Duplicated rather than
 * imported for the reason `FeatureLevel` is duplicated in module-kit: this file
 * must not depend on a generated client, and five string literals are a smaller
 * cost than that dependency.
 */
export const PARTICIPANT_STATUSES = ['invited', 'active', 'declined', 'left', 'removed'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export const MESSAGE_KINDS = ['user', 'system'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * What somebody DECLARES about themselves — mirrors `ChatAvailabilityKind`.
 *
 * ⚠ NOT CALLED `status`, which is taken four times already in this codebase; a
 * fifth meaning is a bug report nobody can read. And an ENUM rather than free
 * text: free text is user-generated content rendered into other people's
 * browsers, which means escaping, a length cap and moderation for something
 * nobody asked for.
 */
/**
 * AUTHORITY INSIDE ONE CONVERSATION — mirrors `ChatParticipantRole`.
 *
 * ⚠ THREE, and each earns its place:
 *
 *   owner   exactly one, and the only role that can be exactly one. Handing the
 *           group to somebody else needs a single answer, and two owners is a
 *           demotion war.
 *   admin   the delegate, and it exists for one concrete reason: the owner is
 *           away and somebody still has to add a person.
 *   member  the floor. Every row that existed before this column backfills to
 *           it, and a group where everybody is an admin has no roles at all.
 *
 * ⚠ THERE IS NO `moderator`. Deleting somebody's words is a different kind of
 * power from managing membership: it is governed by the app-level, PRIVILEGED
 * `chat:moderate` plus participation, and letting a group owner appoint
 * message-deleters is a decision §12.42 deliberately keeps narrow. These roles
 * govern MEMBERSHIP AND SETTINGS and nothing else.
 *
 * ⚠ AND THEY ARE NOT A FOURTH PERMISSION LEVEL. `FeatureLevel` stays
 * app/organization/workspace. A conversation is not a scope the permission
 * context resolves at — `/chat` carries no id, the context is resolved once per
 * request, and a conversation is not inside an organization because chat is app
 * level so two people with no organization in common can talk. This is a column
 * on a participant row, owned by this module and read by nothing else.
 */
export const CHAT_PARTICIPANT_ROLES = ['owner', 'admin', 'member'] as const;
export type ChatParticipantRole = (typeof CHAT_PARTICIPANT_ROLES)[number];

export const AVAILABILITIES = ['available', 'busy', 'dnd', 'away', 'invisible'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

/** What the domain needs to know about a participant row. */
export interface ParticipantView {
  conversationId: string;
  userId: string;
  status: ParticipantStatus;
  /**
   * Authority in THIS conversation. Optional so every existing caller and every
   * test literal still satisfies the shape — and absent reads as `member`,
   * which is the floor and the safe answer.
   *
   * ⚠ SEPARATE FROM `status`, and the two are asked in that order: `status`
   * says whether you are in the room, `role` says what you may do once you are.
   * A removed owner is still `owner` on a row that grants nothing, because
   * status is checked first, everywhere.
   */
  role?: ChatParticipantRole | null;
  lastReadMessageId?: string | null;
}

/** What the domain needs to know about a conversation row. */
export interface ConversationView {
  id: string;
  /** Null for a group. Sorted `lowUserId:highUserId` for a direct chat. */
  directKey: string | null;
  createdById: string;
  archivedAt?: Date | null;
}

/** What the domain needs to know about a message row. */
export interface MessageView {
  id: string;
  conversationId: string;
  kind: MessageKind;
  /** Null for a system message — it is not from anybody. */
  authorId: string | null;
  createdAt: Date;
  deletedAt?: Date | null;
}

/**
 * One blocking relationship. Direction matters and is read BOTH ways: a block
 * stops contact whichever end tries to open it.
 */
export interface BlockView {
  blockerId: string;
  blockedId: string;
}
