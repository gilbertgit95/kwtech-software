import { Field, ObjectType } from '@nestjs/graphql';

/**
 * The module's GraphQL surface, code-first.
 *
 * These decorated classes live in the server layer, never in the pure core: a
 * browser bundle importing the module's types must not drag @nestjs/graphql in.
 * The shapes intentionally mirror ../types.ts — the pure interfaces stay the
 * vocabulary everything else speaks.
 */
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
}
