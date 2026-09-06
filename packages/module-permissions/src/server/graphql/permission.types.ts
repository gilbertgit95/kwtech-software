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

  /** Null means every workspace in the organization (`workspaces:access_all`). */
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
