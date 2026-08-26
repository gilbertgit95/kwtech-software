import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * The module's GraphQL surface, code-first.
 *
 * These decorated classes live in the server layer, never in the pure core: a
 * browser bundle importing the module's types must not drag @nestjs/graphql in.
 * The shapes mirror ../../types.ts — the pure interfaces stay the vocabulary
 * everything else speaks.
 */

@ObjectType('Viewer')
export class ViewerType {
  @Field()
  id!: string;

  @Field()
  email!: string;

  @Field(() => String, { nullable: true })
  username!: string | null;

  /**
   * The human name. Never an identifier — see AuthUser.displayName in the
   * schema. Nullable because an account created by a federated sign-in has none.
   */
  @Field(() => String, { nullable: true })
  displayName!: string | null;
}

/**
 * What the TOKEN says, as opposed to what the user row says.
 *
 * Kept separate from `Viewer` for the reason /auth/me and /auth/profile are two
 * endpoints: this needs no database read, so a page that only wants to know
 * "am I still fully authenticated" should not pay for a query. A client asking
 * for `viewer` and `session` in one operation gets exactly one round trip and
 * one database read regardless.
 */
@ObjectType('SessionInfo')
export class SessionInfoType {
  @Field()
  userId!: string;

  /** `full`, `pwd_change` or `mfa`. A step-up scope grants nothing elsewhere. */
  @Field()
  scope!: string;

  /** Access-token expiry, epoch seconds — what a client schedules a refresh on. */
  @Field(() => Int)
  expiresAt!: number;

  /**
   * How long an access token lives, in seconds — AUTH_ACCESS_TOKEN_TTL.
   *
   * Published because it is the REVOCATION WINDOW, and a settings page has to be
   * able to tell someone how long "sign out everywhere" takes to bite. Hardcoding
   * "fifteen minutes" in the copy was the alternative, and it becomes a lie the
   * first time a deployment changes the variable.
   *
   * Not a secret: it is derivable from any two tokens' `iat` and `exp`, and it
   * describes a published contract rather than a credential.
   */
  @Field(() => Int)
  accessTokenTtl!: number;
}

/**
 * An enrolled second factor, as a settings page sees it.
 *
 * Never carries `secret` — not even encrypted. The enrolment response is the
 * only place a secret is ever returned, exactly once, and no query can hand it
 * back later because the stored value is ciphertext under a key the resolver
 * would have to decrypt on purpose. Leaving it off the type means that decision
 * cannot be reversed by adding a field name to a document.
 */
@ObjectType('MfaFactor')
export class MfaFactorType {
  @Field()
  id!: string;

  /** `totp` today. `webauthn` is a reserved enum value with no implementation. */
  @Field()
  type!: string;

  /** The user's own name for it — "iPhone", "1Password". */
  @Field()
  label!: string;

  /** Null until proved once. An unconfirmed factor grants and blocks nothing. */
  @Field(() => String, { nullable: true })
  confirmedAt!: string | null;

  @Field(() => String, { nullable: true })
  lastUsedAt!: string | null;
}
