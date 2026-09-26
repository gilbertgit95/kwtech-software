import { Field, ObjectType } from '@nestjs/graphql';

/**
 * The public shape. Code-first, so this class IS the schema.
 *
 * Both layouts cross as JSON TEXT, validated server-side — see `operations.ts`
 * for why not a typed object.
 */
@ObjectType('AppHubLayouts')
export class AppHubLayoutsType {
  /** The viewer's own layout, or null when they have not arranged one. */
  @Field(() => String, { nullable: true })
  mine!: string | null;

  /** The workspace default, or null when nobody has set one. */
  @Field(() => String, { nullable: true })
  workspace!: string | null;
}
