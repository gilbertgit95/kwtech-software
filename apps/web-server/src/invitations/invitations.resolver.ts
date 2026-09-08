import { AuthService, Public } from '@kwtech/module-auth/server';
import { PermissionsWriteService } from '@kwtech/module-permissions/server';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Args, Field, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Accepting an organization invitation — including from somebody with no
 * account yet.
 *
 * ## Why it lives in the APP
 *
 * It creates an `auth_user` (module-auth) and a `perm_membership`
 * (module-permissions) in one gesture. Neither module may import the other
 * (PLAN §9), so neither can host it. Same seam as `users.resolver.ts` and
 * `auth/resolve-principal.ts`: the modules stay ignorant of each other and the
 * app, which already depends on both, does the composing.
 *
 * ## Why these are UNAUTHENTICATED
 *
 * Everything here is reached by somebody who holds nothing: no session, and in
 * the sign-up case not even an account. The invitation TOKEN is the
 * authorisation — 32 random bytes, stored only as a SHA-256 hash, live for
 * seven days, single use. There is nothing else it could be, because requiring
 * a right to accept an invitation would mean already being in the organization
 * the invitation is to.
 *
 * ## Why sign-up is on the graph when sign-in is not
 *
 * `AuthResolver` explains at length why every credential exchange stays on the
 * REST controller: GraphQL field aliasing repeats one field many times in a
 * single request, so a per-IP throttler counts fifty password attempts as one.
 * That argument does not reach this mutation. It is not a guessing surface —
 * each call needs a distinct unguessable token that a mailbox received — so
 * aliasing buys an attacker nothing but the work of finding fifty tokens.
 *
 * And it deliberately does NOT sign anybody in. It creates the account and
 * stops; the page then signs in through `/auth/signin` like any other sign-in,
 * so token minting, the credential throttler and the cookie adapter stay on the
 * one path built for them.
 */

@ObjectType('InvitationPreview')
export class InvitationPreviewType {
  /**
   * The organization being joined, or NULL for a PLATFORM invitation.
   *
   * Nullable since platform invitations landed: an offer to hold an app-level
   * role and belong to no tenant has no organization to name, and the page
   * renders a different sentence rather than inventing one.
   */
  @Field(() => String, { nullable: true })
  organizationName!: string | null;

  /**
   * What they will hold ACROSS the platform, as opposed to `roleLabel`, which
   * is what they will hold inside the organization. A platform invitation
   * carries only this one; an organization invitation may carry either, both or
   * neither.
   */
  @Field(() => String, { nullable: true })
  appRoleLabel!: string | null;

  /**
   * The address the invitation was SENT to.
   *
   * Shown so somebody can see which of their addresses this is about, and used
   * as the identifier when the new account is created — never taken from the
   * form. An invitation is addressed to a mailbox, and letting the accepting
   * page choose a different address would turn one into an account-creation
   * voucher for anything.
   */
  @Field()
  email!: string;

  /** What they will hold on joining, for a page that should not be vague about it. */
  @Field(() => String, { nullable: true })
  roleLabel!: string | null;

  /**
   * Whether that address already has an account, which decides what the page
   * asks for: a sign-in, or a password to create one.
   *
   * ⚠ This DOES disclose that an address is registered — to somebody holding a
   * live invitation token for that exact address, which they got by reading the
   * mailbox. Nothing is learned that opening the mailbox did not already tell
   * them. The alternative, a page that asks for a password and then says "that
   * account already exists", discloses the same fact with worse manners.
   */
  @Field()
  hasAccount!: boolean;

  @Field()
  expiresAt!: string;
}

@ObjectType('InvitationSignUpResult')
export class InvitationSignUpResultType {
  /** The address to sign in with. The page never had a chance to choose it. */
  @Field()
  email!: string;

  /** Null when the invitation was to the platform rather than to a tenant. */
  @Field(() => String, { nullable: true })
  organizationName!: string | null;
}

@Injectable()
@Resolver()
export class InvitationsResolver {
  constructor(
    private readonly auth: AuthService,
    private readonly permissions: PermissionsWriteService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * What the link is for, for the page showing it.
   *
   * Null for anything not live — unknown token, revoked, already accepted,
   * expired. ONE answer for all four, because the difference is exactly what
   * somebody probing tokens wants, and the person holding a stale link has to
   * ask the sender either way.
   */
  @Public('Read by whoever holds an invitation link, who by definition has no session yet')
  @Query(() => InvitationPreviewType, { name: 'invitationPreview', nullable: true })
  async invitationPreview(@Args('token') token: string): Promise<InvitationPreviewType | null> {
    const invitation = await this.permissions.previewInvitation(token);
    if (!invitation) return null;

    const account = await this.prisma.authUser.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });

    return {
      organizationName: invitation.organizationName,
      appRoleLabel: invitation.appRoleLabel,
      email: invitation.email,
      roleLabel: invitation.roleLabel,
      hasAccount: account !== null,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Creates an account for the address the invitation was sent to, and joins
   * the organization with it.
   *
   * ## The address comes from the INVITATION
   *
   * Never from the caller. That is what stops this being a way to create an
   * account at any address of one's choosing: the only reachable addresses are
   * ones somebody holding `members:manage` typed into an invite form, and the
   * only way to hold the token is to have received the email.
   *
   * ## Two writes, and what happens if the second fails
   *
   * The account is created first, then the invitation accepted. They are not
   * one transaction — they are two clients over two modules' tables, and a
   * shared transaction would mean one module reaching into the other's.
   *
   * If the accept fails, an account exists that is in no organization. That is
   * recoverable and visible: the person can sign in, the invitation is still
   * pending, and following the link again joins them. The reverse order would
   * not be recoverable — an accepted invitation with no account behind it is a
   * membership pointing at nobody.
   */
  @Public('Creates the account. There is nobody to authenticate — the token is the authorisation')
  @Mutation(() => InvitationSignUpResultType, { name: 'signUpFromInvitation' })
  async signUpFromInvitation(
    @Args('token') token: string,
    @Args('password') password: string,
    @Args('displayName', { type: () => String, nullable: true }) displayName?: string | null,
  ): Promise<InvitationSignUpResultType> {
    const invitation = await this.permissions.previewInvitation(token);
    if (!invitation) {
      throw new BadRequestException({ message: 'That invitation is not valid' });
    }

    // Throws on a weak password or an address that is already taken — both are
    // things the person at the form can act on, and `createAccount` says which.
    // `?? null`, not the bare argument: `exactOptionalPropertyTypes` treats an
    // absent optional and an explicit undefined as different things, and a
    // nullable GraphQL arg arrives as the second.
    const user = await this.auth.createAccount({ email: invitation.email, displayName: displayName ?? null, password });

    await this.permissions.acceptInvitation({ token, userId: user.id });

    return { email: invitation.email, organizationName: invitation.organizationName };
  }
}
