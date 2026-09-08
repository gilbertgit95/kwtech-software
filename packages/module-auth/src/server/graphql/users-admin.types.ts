import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * The administration surface's GraphQL shapes.
 *
 * Separate from auth.types.ts for the reason `AuthAdminService` is separate
 * from `AuthService`: everything here describes SOMEBODY ELSE'S account, and
 * keeping the two files apart means the type a screen renders says which of the
 * two it is looking at.
 */

/**
 * An account as the back office sees it.
 *
 * Compare `ViewerType`, which is the same person seen by themselves: this
 * carries `status`, `createdAt` and `lastLoginAt` — the operational history an
 * administrator needs and the account's owner has no use for — and neither
 * carries anything resembling a credential.
 */
@ObjectType('AdminUser')
export class AdminUserType {
  @Field()
  id!: string;

  @Field()
  email!: string;

  @Field(() => String, { nullable: true })
  username!: string | null;

  @Field(() => String, { nullable: true })
  displayName!: string | null;

  /** `active` or `suspended`. A plain string, mirroring `AuthUserStatus`. */
  @Field()
  status!: string;

  @Field()
  createdAt!: string;

  @Field(() => String, { nullable: true })
  lastLoginAt!: string | null;
}

/**
 * One account, opened.
 *
 * A separate type from the row above, and the reason is a query rather than a
 * taste: `hasTwoFactor` and `activeSessions` each need their own read, so
 * carrying them on the LIST row would mean two extra queries per account per
 * page — the N+1 that turns a 200-row page into 401 queries. A detail screen
 * pays for them once, for the one account it is showing.
 */
@ObjectType('AdminUserDetail')
export class AdminUserDetailType extends AdminUserType {
  /**
   * Whether the account holds a CONFIRMED second factor.
   *
   * A boolean rather than the factors themselves: a screen deciding whether to
   * offer "remove two-step verification" needs to know one exists and nothing
   * more. The label and the enrolment date belong to the account's owner.
   */
  @Field()
  hasTwoFactor!: boolean;

  /** How many live sessions it holds, for a screen that offers to end them. */
  @Field(() => Int)
  activeSessions!: number;
}

/** A page of accounts, with the total the pager needs. */
@ObjectType('AdminUserPage')
export class AdminUserPageType {
  @Field(() => [AdminUserType])
  rows!: AdminUserType[];

  /**
   * Every account matching the FILTER, not the number returned. A pager that
   * only knows the current page cannot say how many pages there are.
   */
  @Field(() => Int)
  total!: number;
}

/**
 * One live session, as an administrator sees it.
 *
 * No refresh-token hash, deliberately — see `AuthAdminSessionRow`. `ipAddress`
 * and `userAgent` are here because they are the whole point of the screen:
 * "sign out the device you do not recognise" needs the device to be nameable.
 */
@ObjectType('AdminUserSession')
export class AdminUserSessionType {
  @Field()
  id!: string;

  @Field()
  issuedAt!: string;

  /** Null when the session has not been used since it was issued. */
  @Field(() => String, { nullable: true })
  lastUsedAt!: string | null;

  @Field()
  expiresAt!: string;

  /** Whether a second factor was satisfied for THIS session. */
  @Field()
  mfaSatisfied!: boolean;

  @Field(() => String, { nullable: true })
  ipAddress!: string | null;

  @Field(() => String, { nullable: true })
  userAgent!: string | null;
}

/**
 * What a write returns.
 *
 * `changed` rather than a bare boolean success: every mutation here is
 * idempotent-ish — suspending a suspended account, removing a factor that is
 * not there — and a screen that says "done" for a no-op teaches people the
 * button is unreliable. The count says what actually moved.
 */
@ObjectType('AdminUserWriteResult')
export class AdminUserWriteResultType {
  @Field()
  changed!: boolean;

  /** Sessions ended by this write, when it ends any. */
  @Field(() => Int)
  sessionsRevoked!: number;

  /** The account after the write, absent when the write deleted it. */
  @Field(() => AdminUserType, { nullable: true })
  user!: AdminUserType | null;
}
