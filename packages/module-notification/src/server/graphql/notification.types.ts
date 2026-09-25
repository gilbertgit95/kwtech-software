import { ArgsType, Field, InputType, Int, ObjectType } from '@nestjs/graphql';

/**
 * The GraphQL shapes. Enums cross as documented `String` fields and dates as
 * ISO strings, as everywhere in this repo — no `registerEnumType`, no scalars.
 */

@ObjectType('NotificationAction')
export class NotificationActionType {
  /** 'link' | 'download'. */
  @Field()
  kind!: string;

  @Field()
  key!: string;

  @Field()
  label!: string;

  /** A same-origin path or an https URL — validated on write and on read. */
  @Field()
  href!: string;

  /** For a link: 'self' | 'blank'. An external link is always 'blank'. */
  @Field(() => String, { nullable: true })
  target!: string | null;

  /** For a download: the browser's suggested file name, if any. */
  @Field(() => String, { nullable: true })
  filename!: string | null;
}

@ObjectType('Notification')
export class NotificationType {
  @Field()
  id!: string;

  /** 'info' | 'success' | 'warning' | 'alert'. */
  @Field()
  severity!: string;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  body!: string | null;

  /** The declared source key. */
  @Field()
  source!: string;

  /** What a person reads: "Queue", "Platform". */
  @Field()
  sourceLabel!: string;

  /** Null when the notification is global. */
  @Field(() => String, { nullable: true })
  organizationId!: string | null;

  /** Set only together with `organizationId`. */
  @Field(() => String, { nullable: true })
  workspaceId!: string | null;

  /** "Acme · Front desk", as it was called when this was sent. */
  @Field(() => String, { nullable: true })
  contextLabel!: string | null;

  /** Empty once `expiresAt` has passed. */
  @Field(() => [NotificationActionType])
  actions!: NotificationActionType[];

  /** More than one when later notifications folded into this one. */
  @Field(() => Int)
  groupCount!: number;

  @Field()
  createdAt!: string;

  /** What the list is ordered by: bumped when a group grows. */
  @Field()
  occurredAt!: string;

  @Field(() => String, { nullable: true })
  readAt!: string | null;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;

  @Field(() => String, { nullable: true })
  expiresAt!: string | null;
}

@ObjectType('NotificationPage')
export class NotificationPageType {
  @Field(() => [NotificationType])
  items!: NotificationType[];

  @Field()
  hasNext!: boolean;

  @Field()
  hasPrevious!: boolean;

  /** Pass as `before` for the previous page. */
  @Field(() => String, { nullable: true })
  startCursor!: string | null;

  /** Pass as `after` for the next page. */
  @Field(() => String, { nullable: true })
  endCursor!: string | null;

  /** Everything the filter matches, across every page. */
  @Field(() => Int)
  totalCount!: number;

  /** How many of those are unread. */
  @Field(() => Int)
  unreadCount!: number;
}

@ObjectType('NotificationsMissed')
export class NotificationsMissedType {
  /** At most fifty, newest first. */
  @Field(() => [NotificationType])
  items!: NotificationType[];

  /** Every one missed — may be more than `items`. */
  @Field(() => Int)
  total!: number;
}

@ObjectType('NotificationSource')
export class NotificationSourceType {
  @Field()
  key!: string;

  @Field()
  label!: string;

  /** False for what is always delivered. */
  @Field()
  mutable!: boolean;
}

@ObjectType('NotificationEvent')
export class NotificationEventType {
  /**
   * 'sync' | 'created' | 'grouped' | 'read' | 'unread' | 'archived' |
   * 'unarchived' | 'recalled'.
   *
   * ⚠ `sync` is the FIRST event on every connection and every reconnection. It
   * carries nothing and means "you may have missed something — re-read". There
   * is no replay in pub/sub, so it is what makes a dropped socket lose nothing.
   */
  @Field()
  kind!: string;

  /** The notifications this event is about. Empty on `sync` and on "mark all read". */
  @Field(() => [String])
  ids!: string[];

  @Field(() => String, { nullable: true })
  batchId!: string | null;

  /** Carried on `created` and `grouped` — a toast draws from it without a second request. */
  @Field(() => NotificationType, { nullable: true })
  notification!: NotificationType | null;
}

@ObjectType('NotificationBatch')
export class NotificationBatchType {
  @Field()
  id!: string;

  /** Who pressed send. Null for the system. Never shown to recipients. */
  @Field(() => String, { nullable: true })
  senderId!: string | null;

  @Field(() => String, { nullable: true })
  senderName!: string | null;

  @Field()
  source!: string;

  @Field()
  sourceLabel!: string;

  /** 'info' | 'success' | 'warning' | 'alert' — how loud the send was. */
  @Field()
  severity!: string;

  @Field()
  title!: string;

  @Field(() => Int)
  recipientCount!: number;

  @Field(() => Int)
  readCount!: number;

  @Field()
  createdAt!: string;

  @Field(() => String, { nullable: true })
  recalledAt!: string | null;

  @Field(() => String, { nullable: true })
  recalledById!: string | null;
}

@ObjectType('NotificationBatchPage')
export class NotificationBatchPageType {
  @Field(() => [NotificationBatchType])
  items!: NotificationBatchType[];

  @Field(() => String, { nullable: true })
  nextCursor!: string | null;
}

@ObjectType('NotificationRecipient')
export class NotificationRecipientType {
  @Field()
  userId!: string;

  @Field()
  displayName!: string;

  @Field()
  email!: string;
}

/**
 * The inbox's arguments, as a class rather than inline `@Args`: inline OPTIONAL
 * args emit `design:paramtypes` of `Object`, and the schema builder then fails
 * at boot — a failure `tsc` cannot see. See `PaginationArgs` in permissions.
 */
@ArgsType()
export class NotificationListArgs {
  /** Page size. Default 20, clamped to 100. */
  @Field(() => Int, { nullable: true })
  first?: number | null;

  @Field(() => String, { nullable: true })
  after?: string | null;

  @Field(() => String, { nullable: true })
  before?: string | null;

  /** 'unread_first' (default) | 'newest'. */
  @Field(() => String, { nullable: true })
  order?: string | null;

  @Field(() => Boolean, { nullable: true })
  unreadOnly?: boolean | null;

  /** True lists the archive instead of the inbox. */
  @Field(() => Boolean, { nullable: true })
  archived?: boolean | null;

  @Field(() => String, { nullable: true })
  severity?: string | null;

  @Field(() => String, { nullable: true })
  source?: string | null;

  @Field(() => String, { nullable: true })
  organizationId?: string | null;

  /** Only notifications with no organization. Wins over `organizationId`. */
  @Field(() => Boolean, { nullable: true })
  globalOnly?: boolean | null;
}

@ArgsType()
export class NotificationBatchArgs {
  @Field(() => Int, { nullable: true })
  first?: number | null;

  @Field(() => String, { nullable: true })
  after?: string | null;

  @Field(() => Boolean, { nullable: true })
  mineOnly?: boolean | null;
}

/**
 * What the compose screen sends. It always goes out as the PLATFORM source; the
 * person who pressed send is recorded on the batch, never shown.
 *
 * One optional link rather than a list of buttons: a person composing by hand
 * needs one "Open" at most, and producers — which may want three — send through
 * `NotificationSender` in code.
 */
@InputType('NotificationSendInput')
export class NotificationSendInputType {
  @Field(() => [String])
  recipientIds!: string[];

  /** 'info' | 'success' | 'warning' | 'alert'. Defaults to 'info'. */
  @Field(() => String, { nullable: true })
  severity?: string | null;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  body?: string | null;

  @Field(() => String, { nullable: true })
  linkLabel?: string | null;

  @Field(() => String, { nullable: true })
  linkHref?: string | null;
}
