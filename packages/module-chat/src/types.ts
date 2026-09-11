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
export const AVAILABILITIES = ['available', 'busy', 'dnd', 'away', 'invisible'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

/** What the domain needs to know about a participant row. */
export interface ParticipantView {
  conversationId: string;
  userId: string;
  status: ParticipantStatus;
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
