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
@InputType()
export class UpdateProfileInput {
  @Field(() => String, { nullable: true })
  displayName?: string | null;

  @Field(() => String, { nullable: true })
  username?: string;
}
