import { Field, InputType } from '@nestjs/graphql';

/**
 * What a profile form may change.
 *
 * Every field is OPTIONAL and absent means "leave it alone", which is what lets
 * one mutation serve a form that edits a single field. `displayName` is
 * additionally NULLABLE — sending null clears it, which is a different intent
 * from omitting it, and collapsing the two would make "remove my display name"
 * impossible to express.
 *
 * **Email is deliberately not here.** Changing the address a password reset is
 * delivered to, without first proving the new one, is an account-takeover
 * primitive: take a session, change the email, request a reset, receive it. It
 * needs a confirmation flow with the old address left working until the new one
 * is clicked — see AuthService.updateProfile.
 */
/**
 * A change to the caller's display sizes. Each field optional, absent meaning
 * "leave it alone", like the profile. Plain strings on the wire, checked by
 * `prepareDisplayChange`: a GraphQL enum would make the schema a fourth copy of
 * the steps (src/domain/display.ts).
 */
@InputType()
export class UpdateDisplayInput {
  /** `desktop` (the default, the full site) or `mobile` (the phone layout) — issue #22. */
  @Field(() => String, { nullable: true })
  layout?: string;

  @Field(() => String, { nullable: true })
  textSize?: string;

  @Field(() => String, { nullable: true })
  spacing?: string;
}

@InputType()
export class UpdateProfileInput {
  @Field(() => String, { nullable: true })
  displayName?: string | null;

  @Field(() => String, { nullable: true })
  username?: string;
}
