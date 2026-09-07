import { ArgsType, Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import type { PermissionContext } from '../../types.js';

/**
 * The module's GraphQL surface, code-first.
 *
 * These decorated classes live in the server layer, never in the pure core: a
 * browser bundle importing the module's types must not drag @nestjs/graphql in.
 * The shapes intentionally mirror ../types.ts — the pure interfaces stay the
 * vocabulary everything else speaks.
 */
/**
 * An app-level role the caller holds — the badge beside their name.
 *
 * Exposed because an interface has to be able to say WHO someone is, not only
 * what they may do. It carries no authority and nothing may branch on it; see
 * `AppRole` in ../../types.ts for why that line is drawn where it is.
 */
@ObjectType('PermissionRole')
export class PermissionRoleType {
  @Field()
  key!: string;

  @Field()
  label!: string;

  /**
   * Nullable, and the client must render a fallback rather than assuming a
   * name it recognises: a role may name no icon, and a name retired from the
   * frontend's set must degrade to a generic glyph instead of a blank page.
   */
  @Field(() => String, { nullable: true })
  icon!: string | null;
}

@ObjectType('PermissionContext')
export class PermissionContextType {
  @Field()
  subjectId!: string;

  @Field(() => String, { nullable: true })
  organizationId!: string | null;

  @Field(() => String, { nullable: true })
  workspaceId!: string | null;

  /**
   * The answer: every feature accessible at this scope, after role grants are
   * combined, filtered by the subscription, and unioned with app-level grants.
   * This is the list a client should drive its UI from.
   */
  @Field(() => [String])
  effective!: string[];

  /**
   * The inputs that produced it. Exposed so an admin diagnostic can show WHICH
   * step dropped a feature — a bare list cannot explain a denial, and "access
   * denied" with no reason is the ticket that takes a day to close.
   */
  @Field(() => [String])
  granted!: string[];

  @Field(() => [String], { nullable: true })
  entitled!: string[] | null;

  @Field(() => [String])
  grantedAtAppLevel!: string[];

  /**
   * The workspaces the caller has been ADDED to. Membership is required — no
   * role widens it. Null means every workspace, which only platform support
   * produces.
   */
  @Field(() => [String], { nullable: true })
  accessibleWorkspaceIds!: string[] | null;

  /**
   * Who the caller is on the platform, where every field above is what they may
   * do. App-level only — an organization role would stop being true the moment
   * they switched organization. Empty for almost everyone.
   */
  @Field(() => [PermissionRoleType])
  appRoles!: PermissionRoleType[];
}

@ObjectType('PermissionFeature')
export class PermissionFeatureType {
  @Field()
  key!: string;

  @Field()
  module!: string;

  @Field()
  label!: string;

  @Field()
  description!: string;

  @Field()
  isPrivileged!: boolean;

  /**
   * The level a role must be at to grant this.
   *
   * Exposed because the role editor filters on it: an organization-level role
   * may only collect organization-level keys, so offering the rest would
   * present a choice the write path refuses. Registry-only data — `perm_feature`
   * does not mirror it — which is precisely why the client cannot get it from
   * anywhere else.
   */
  @Field()
  level!: string;

  /**
   * The tag PATH, outermost first. Drives the editor's grouped picker.
   *
   * Also registry-only, and ordered: `['admin', 'roles']` nests as admin >
   * roles. See feature-tags.ts.
   */
  @Field(() => [String])
  tags!: string[];
}

/**
 * Projects the pure `PermissionContext` onto the GraphQL type.
 *
 * A mapper rather than a cast, and the difference is not ceremony: the pure
 * interface declares `readonly FeatureKey[]` because nothing downstream may
 * mutate a resolved grant set, while a GraphQL ObjectType has to expose plain
 * arrays for the driver to serialise. Copying is what keeps the first guarantee
 * true — handing the same array out would let a field resolver splice the
 * caller's own permissions.
 *
 * Written out field by field rather than spread, so a field ADDED to
 * PermissionContext does not silently appear in the public schema. Exposure is
 * a decision; this function is where it gets made.
 */
export function toPermissionContextType(context: PermissionContext): PermissionContextType {
  return {
    subjectId: context.subjectId,
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    effective: [...context.effective],
    granted: [...context.granted],
    entitled: context.entitled ? [...context.entitled] : null,
    grantedAtAppLevel: [...context.grantedAtAppLevel],
    accessibleWorkspaceIds: context.accessibleWorkspaceIds ? [...context.accessibleWorkspaceIds] : null,
    // Copied element by element, like every list above: handing out the same
    // objects would let a field resolver rename the caller's own roles.
    appRoles: context.appRoles.map((role) => ({ key: role.key, label: role.label, icon: role.icon })),
  };
}

/**
 * One page of the registry.
 *
 * A wrapper rather than a bare list, because a paginated list the caller cannot
 * count is a list they cannot render controls for — "next" has to know whether
 * there is a next. `limit` is echoed because it may not be the one requested:
 * the server clamps to MAX_PAGE_SIZE and saying so beats letting the client
 * infer it from a short page.
 */
@ObjectType('PermissionFeaturePage')
export class PermissionFeaturePageType {
  @Field(() => [PermissionFeatureType])
  items!: PermissionFeatureType[];

  /** Rows before paging, so a client can show "showing 10 of 250". */
  @Field(() => Int)
  total!: number;

  /** The limit actually applied. */
  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;

  @Field(() => Boolean)
  hasMore!: boolean;
}

/**
 * Paging arguments, as a class rather than inline `@Args`.
 *
 * Not a style choice: inline optional args emit `design:paramtypes` of
 * `Object`, and Nest's schema builder then fails at BOOT with "Cannot determine
 * a GraphQL input type for the limit" — a failure `tsc` cannot see, because the
 * schema is built at runtime from decorator metadata. An `@ArgsType()` class
 * carries the type on the FIELD, where it survives.
 *
 * Reusable, too: the next paged query takes the same three lines.
 */
@ArgsType()
export class PaginationArgs {
  /**
   * Omit for the server's default. Clamped to MAX_PAGE_SIZE, so this can only
   * ever narrow — see domain/pagination.ts.
   */
  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => Int, { nullable: true })
  offset?: number;
}

/**
 * Narrowing the registry, server-side.
 *
 * An `@InputType()` class for the same reason `PaginationArgs` is an
 * `@ArgsType()`: inline optional args emit `design:paramtypes` of `Object` and
 * the schema builder fails at BOOT, which no typecheck can see.
 *
 * Every field is nullable — a client sending none gets the whole (paged)
 * registry, which is what "no filter" should mean.
 */
@InputType('FeatureFilterInput')
export class FeatureFilterInput {
  /** Case-insensitive substring across key, label, description, module, tags and bindings. */
  @Field(() => String, { nullable: true })
  search?: string;

  /** ANY of these. A feature has one module, so requiring all would match nothing. */
  @Field(() => [String], { nullable: true })
  modules?: string[];

  /** ANY of these, for the same reason. */
  @Field(() => [String], { nullable: true })
  levels?: string[];

  /** ALL of these. A feature has many tags, so intersecting is the meaningful operation. */
  @Field(() => [String], { nullable: true })
  tags?: string[];

  /** `true` for privileged only, `false` for ordinary only, omitted for both. */
  @Field(() => Boolean, { nullable: true })
  isPrivileged?: boolean;

  /** Keys with no binding — the ones that read as coverage while guarding nothing. */
  @Field(() => Boolean, { nullable: true })
  unboundOnly?: boolean;
}

/**
 * A role DEFINITION, as the admin screens read it.
 *
 * Distinct from `PermissionRole`, which is the badge on a context: that one
 * says who somebody is, this one says what a role is and is loaded for every
 * role rather than the ones a person holds. `disabled` and `isSystem` appear
 * here and nowhere else, because no permission CHECK consults either.
 */
@ObjectType('PermissionRoleDetail')
export class PermissionRoleDetailType {
  @Field()
  id!: string;

  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field()
  level!: string;

  @Field(() => String, { nullable: true })
  organizationId!: string | null;

  @Field(() => String, { nullable: true })
  icon!: string | null;

  /**
   * Defined in the application and replaced on every deploy, so the screens
   * offer no edit. Exposed rather than inferred from the key, because "is this
   * mine to change" is the question the UI actually asks.
   */
  @Field()
  isSystem!: boolean;

  /** Grants nothing while true. The row, and every grant from it, stay put. */
  @Field()
  disabled!: boolean;

  @Field(() => [String])
  features!: string[];
}

/**
 * A role being written. One input for create and update, because the FORM is
 * one form — and two inputs would be two places for the field list to drift.
 *
 * `key` and `level` are ignored on update: both are read by grants that
 * already exist, and changing one silently re-interprets them. See `updateRole`.
 *
 * There is no `organizationId`. Every role written here is a shared preset —
 * what scopes a role is its LEVEL, not an owner. See domain/role-draft.ts.
 */
@InputType('RoleDraftInput')
export class RoleDraftInput {
  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field()
  level!: string;

  @Field(() => String, { nullable: true })
  icon!: string | null;

  @Field(() => [String])
  features!: string[];
}

/** One feature a clone could not bring across, and why. */
@ObjectType('RoleCloneSkip')
export class RoleCloneSkipType {
  @Field()
  key!: string;

  /** 'wrong_level' | 'not_held' | 'unregistered'. */
  @Field()
  reason!: string;
}

/**
 * What a clone WOULD do. Nothing is written until the form is saved, so this is
 * the dialog's content rather than a result.
 */
@ObjectType('RoleClonePreview')
export class RoleClonePreviewType {
  @Field(() => [String])
  features!: string[];

  @Field(() => [String])
  added!: string[];

  /**
   * Shown, never swallowed. A clone that granted less than the role it copied
   * and said nothing would be discovered as a denial weeks later, by which time
   * nobody remembers cloning anything.
   */
  @Field(() => [RoleCloneSkipType])
  skipped!: RoleCloneSkipType[];
}

/**
 * A plan DEFINITION, as the admin screens read it.
 *
 * The entitlement counterpart of `PermissionRoleDetail`: that one says what a
 * role grants, this says what a plan sells. `archived` and `isPublic` appear
 * here and nowhere else, because no entitlement CHECK consults either — the
 * read path filters archived plans in its query, and `isPublic` is about a
 * catalogue rather than about access at all.
 */
@ObjectType('PermissionPlanDetail')
export class PermissionPlanDetailType {
  /** The primary key, and the id every screen addresses a plan by. */
  @Field()
  key!: string;

  @Field()
  label!: string;

  /** Whether the plan appears in a catalogue customers can see. Listing, not entitlement. */
  @Field()
  isPublic!: boolean;

  /**
   * The badge icon NAME, or null.
   *
   * Nullable, and the client must render a fallback rather than assuming a name
   * it recognises — the same contract `PermissionRole.icon` carries: a plan may
   * name no icon, and a name retired from the frontend's set must degrade to a
   * generic glyph instead of a blank page.
   */
  @Field(() => String, { nullable: true })
  icon!: string | null;

  /** Entitles nothing while true. The row, and every subscription from it, stay put. */
  @Field()
  archived!: boolean;

  @Field(() => [String])
  features!: string[];

  /**
   * The caps this plan sells, as key/value pairs rather than a map.
   *
   * GraphQL has no untyped-object scalar in this schema, and adding one to
   * carry four integers would put an unvalidated blob in the public contract.
   * A list of pairs is longer to read and impossible to get wrong.
   */
  @Field(() => [PermissionPlanLimitType])
  limits!: PermissionPlanLimitType[];
}

@ObjectType('PermissionPlanLimit')
export class PermissionPlanLimitType {
  /** A key from LIMIT_REGISTRY: 'organization:members', 'workspace:members'. */
  @Field()
  limitKey!: string;

  @Field(() => Int)
  value!: number;
}

@InputType('PlanLimitInput')
export class PlanLimitInput {
  @Field()
  limitKey!: string;

  /**
   * A STRING, deliberately, matching `PlanDraft.limits`.
   *
   * The form's `<input type="number">` yields `''` mid-edit and the domain
   * validator is the single place that decides what a number is. Accepting an
   * `Int` here would move half of that decision into the GraphQL layer, where
   * "blank" becomes indistinguishable from "absent" and the error message a
   * person sees stops naming the field.
   */
  @Field()
  value!: string;
}

/**
 * A plan being written. One input for create and update, because the FORM is
 * one form — the same argument `RoleDraftInput` makes.
 *
 * `key` is ignored on update: it is the primary key, referenced by every
 * subscription and every plan-feature row. See `updatePlan`.
 */
@InputType('PlanDraftInput')
export class PlanDraftInput {
  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field()
  isPublic!: boolean;

  @Field(() => String, { nullable: true })
  icon!: string | null;

  @Field(() => [String])
  features!: string[];

  @Field(() => [PlanLimitInput])
  limits!: PlanLimitInput[];
}

/** What a plan clone WOULD do. Nothing is written until the form is saved. */
@ObjectType('PlanClonePreview')
export class PlanClonePreviewType {
  @Field(() => [String])
  features!: string[];

  @Field(() => [String])
  added!: string[];

  /**
   * Shown, never swallowed — the same rule the role clone follows. A clone that
   * sold less than the plan it copied and said nothing would be discovered as a
   * customer's denial weeks later.
   */
  @Field(() => [RoleCloneSkipType])
  skipped!: RoleCloneSkipType[];
}

/**
 * A subscription, as the admin screens read it: who is on what.
 *
 * Carries the organization and workspace NAMES beside their ids. A grid of
 * cuids is not a screen anybody can read, and the alternative is a join done in
 * a browser over the network.
 */
@ObjectType('PermissionSubscription')
export class PermissionSubscriptionType {
  @Field()
  id!: string;

  @Field()
  organizationId!: string;

  @Field()
  organizationName!: string;

  /** Null means the whole organization is entitled. See PermSubscription. */
  @Field(() => String, { nullable: true })
  workspaceId!: string | null;

  @Field(() => String, { nullable: true })
  workspaceName!: string | null;

  @Field()
  planKey!: string;

  @Field()
  planLabel!: string;

  /**
   * Whether the plan behind this row has been archived.
   *
   * Exposed because an archived plan entitles nothing — `loadContext` filters
   * it out — so a row that still reads `active` can be entitling nobody. That
   * is exactly the state somebody opens this screen to explain, and without
   * this field the screen cannot.
   */
  @Field()
  planArchived!: boolean;

  /** 'active' | 'past_due' | 'canceled'. Only 'active' entitles. */
  @Field()
  status!: string;

  /** ISO date, or null for a subscription with no renewal date recorded. */
  @Field(() => String, { nullable: true })
  currentPeriodEnd!: string | null;

  /** Set when the subscription was ended. Rows are kept, never deleted. */
  @Field(() => String, { nullable: true })
  endedAt!: string | null;
}

/**
 * A subscription being STARTED. There is no update counterpart carrying these
 * fields, and that is the point: the target and the plan are fixed at creation
 * because every entitlement decision the row produced read all three. See
 * domain/subscription-draft.ts.
 */
@InputType('SubscriptionDraftInput')
export class SubscriptionDraftInput {
  @Field()
  organizationId!: string;

  /** Null for an organization-wide subscription; an id for one workspace. */
  @Field(() => String, { nullable: true })
  workspaceId!: string | null;

  @Field()
  planKey!: string;

  @Field()
  status!: string;

  /** `YYYY-MM-DD`, or empty for no renewal date. */
  @Field()
  currentPeriodEnd!: string;
}

/** An organization and its live workspaces, for the subscription form's pickers. */
@ObjectType('PermissionOrganization')
export class PermissionOrganizationType {
  @Field()
  id!: string;

  @Field()
  key!: string;

  @Field()
  name!: string;

  /** ACTIVE members only — an invited or suspended row cannot act. */
  @Field(() => Int)
  memberCount!: number;

  /** Live workspaces only; archived ones are excluded from the count. */
  @Field(() => Int)
  workspaceCount!: number;

  /** LIVE workspaces, for the subscription form's scope picker. */
  @Field(() => [PermissionWorkspaceType])
  workspaces!: PermissionWorkspaceType[];
}

@ObjectType('PermissionWorkspace')
export class PermissionWorkspaceType {
  @Field()
  id!: string;

  @Field()
  key!: string;

  @Field()
  name!: string;
}

/**
 * What `planChanged` delivers.
 *
 * Deliberately just the key. A subscription payload is not filtered per
 * subscriber the way a query result is — everyone on the topic gets the same
 * object — so pushing the whole plan would hand every reader whatever the
 * writer could see. A key, plus a re-read through the guarded `permissionPlans`
 * query, keeps ONE authorization path rather than two that must agree.
 *
 * It is also what makes the event cheap enough to publish on every write: no
 * joins, no per-subscriber work, and a client that is not showing that plan can
 * ignore it without a round trip.
 */
@ObjectType('PermissionPlanChanged')
export class PermissionPlanChangedType {
  @Field()
  planKey!: string;
}

/**
 * One organization, with its people and workspaces.
 *
 * ⚠ A member is a `userId` and nothing else — no name, no email. This module
 * does not own identity (§12.12), and inventing a `name` field here would be
 * the module claiming something it cannot know. The app joins display names by
 * composing this with its own user query, which is the only layer allowed to
 * import both modules.
 */
@ObjectType('PermissionOrganizationDetail')
export class PermissionOrganizationDetailType {
  @Field()
  id!: string;

  @Field()
  key!: string;

  @Field()
  name!: string;

  @Field(() => [PermissionWorkspaceDetailType])
  workspaces!: PermissionWorkspaceDetailType[];

  @Field(() => [PermissionMemberType])
  members!: PermissionMemberType[];

  /** Who has been ASKED, and what became of the asking. */
  @Field(() => [PermissionInvitationType])
  invitations!: PermissionInvitationType[];
}

@ObjectType('PermissionWorkspaceDetail')
export class PermissionWorkspaceDetailType {
  @Field()
  id!: string;

  @Field()
  key!: string;

  @Field()
  name!: string;

  /** Archived workspaces are SHOWN, so the switch does not read as a delete. */
  @Field()
  archived!: boolean;

  @Field(() => Int)
  memberCount!: number;

  /** Who is in it, and what they hold THERE. Workspace-level roles only. */
  @Field(() => [PermissionWorkspaceMemberType])
  members!: PermissionWorkspaceMemberType[];
}

@ObjectType('PermissionWorkspaceMember')
export class PermissionWorkspaceMemberType {
  /** The PermWorkspaceMember row, which workspace role grants hang from. */
  @Field()
  workspaceMemberId!: string;

  /** The organization membership. A workspace member is always one of these. */
  @Field()
  membershipId!: string;

  /** The person, as an opaque id — the app joins the name. */
  @Field()
  userId!: string;

  /**
   * The WORKSPACE-level role, held here rather than on the membership.
   *
   * At most ONE — the same rule as an organization role, enforced by
   * `@@unique([workspaceMemberId])`. A list rather than a single field because
   * the shape predates the rule and a row written before it should still
   * render; readers take the first.
   */
  @Field(() => [PermissionMemberRoleType])
  roles!: PermissionMemberRoleType[];
}

@ObjectType('PermissionMember')
export class PermissionMemberType {
  /** The membership row, which is what workspace membership and grants hang from. */
  @Field()
  membershipId!: string;

  /**
   * The person, as an opaque id. See the note on PermissionOrganizationDetail:
   * resolving it to a name is the app's job, not this module's.
   */
  @Field()
  userId!: string;

  /** 'active' | 'invited' | 'suspended'. Only `active` participates in a check. */
  @Field()
  status!: string;

  /** ISO timestamp. */
  @Field()
  joinedAt!: string;

  /** Organization-level roles only. Workspace roles hang off workspace membership. */
  @Field(() => [PermissionMemberRoleType])
  roles!: PermissionMemberRoleType[];

  /** Which workspaces they have been added to. */
  @Field(() => [String])
  workspaceIds!: string[];
}

/**
 * A role as it appears on a member.
 *
 * Distinct from `PermissionRoleDetail` — that one carries what a role GRANTS,
 * loaded for every role. This is the badge on a person, and deliberately
 * carries no feature list: a members grid showing every role's features would
 * be answering a question the roles screen already answers.
 */
@ObjectType('PermissionMemberRole')
export class PermissionMemberRoleType {
  @Field()
  id!: string;

  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field()
  level!: string;

  @Field(() => String, { nullable: true })
  icon!: string | null;
}

/** What a write returned. A result, not a row — the screen re-reads to render. */
@ObjectType('PermissionWriteResult')
export class PermissionWriteResultType {
  /**
   * Whether the write CHANGED anything.
   *
   * False is a success, not a failure: re-granting a role somebody already
   * holds, or removing them from a workspace they are not in, leaves the world
   * in the state asked for. Distinguishing it lets a screen say "already done"
   * rather than claiming an action it did not take — see `assignRole`.
   */
  @Field()
  changed!: boolean;

  /** The row the write produced or acted on, when there is one. */
  @Field(() => String, { nullable: true })
  id!: string | null;

  /**
   * Whether something was DISPLACED to make room.
   *
   * Only `assignRole` sets it today: a member holds at most one
   * organization-level role, so granting one silently removes the previous
   * one. A screen that said "granted" and nothing else would be hiding the
   * half of the outcome somebody might not have intended.
   */
  @Field()
  replaced!: boolean;
}

/**
 * An invitation, as the organization screen shows it.
 *
 * ⚠ There is no token field and never will be. The token is handed out ONCE,
 * in the email, and stored only as a hash — a field here would put a working
 * invitation link behind any read of this query.
 */
@ObjectType('PermissionInvitation')
export class PermissionInvitationType {
  @Field()
  id!: string;

  @Field()
  email!: string;

  /**
   * 'pending' | 'accepted' | 'revoked' | 'expired'.
   *
   * DERIVED, not the stored column: expiry is computed from `expiresAt`, so a
   * row that has run out reads `expired` here while still saying `pending` in
   * storage. One implementation — `invitationState` — so this and the accept
   * path cannot disagree.
   */
  @Field()
  state!: string;

  /** ISO timestamps. Rendered, never computed with. */
  @Field()
  expiresAt!: string;

  @Field()
  createdAt!: string;

  @Field(() => String, { nullable: true })
  acceptedAt!: string | null;

  @Field(() => String, { nullable: true })
  revokedAt!: string | null;

  /** Who sent it. An opaque id — the app joins the name. */
  @Field()
  invitedByUserId!: string;

  /**
   * Who accepted, which need not be who was invited: an address is a mailbox,
   * and anybody who reads it can follow the link. Recorded rather than
   * prevented, so a surprise is visible afterwards.
   */
  @Field(() => String, { nullable: true })
  acceptedByUserId!: string | null;

  /** The organization role they will hold on acceptance. Null invites with none. */
  @Field(() => PermissionMemberRoleType, { nullable: true })
  role!: PermissionMemberRoleType | null;
}

/**
 * What `inviteMember` returns.
 *
 * ⚠ NO TOKEN, and there will never be one. The token is minted, hashed, stored
 * as the hash and handed straight to the host's `sendInvitationEmail` hook — it
 * never leaves the server. Returning it here would put a working invitation
 * link in a browser, in a network tab, and in whatever logs the response along
 * the way, for the sake of a value the client has nothing to do with.
 *
 * So the client learns two things: which row was made, and whether the email
 * actually went out.
 */
@ObjectType('PermissionInvitationResult')
export class PermissionInvitationResultType {
  @Field()
  invitationId!: string;

  /**
   * Whether the email was accepted for delivery.
   *
   * False means the invitation EXISTS and is valid but nobody was told about
   * it — a mail outage, a missing SMTP configuration. The row is deliberately
   * kept rather than rolled back, so the screen can say so and offer to revoke,
   * instead of a live invitation existing that nothing ever mentioned.
   */
  @Field()
  delivered!: boolean;
}
