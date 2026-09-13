import { FEATURE } from '@kwtech/module-permissions';
import { RequireFeature, RequireScope } from '@kwtech/module-permissions/server';
import { Injectable } from '@nestjs/common';
import { Args, Field, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Reading `auth_user` from a screen that holds permission rows.
 *
 * ## Why this lives in the APP and can live nowhere else
 *
 * It queries `auth_user`, which `@kwtech/module-auth` owns, and it is guarded
 * by `members:manage`, which `@kwtech/module-permissions` owns. Neither module
 * may import the other (PLAN §9), so neither can host it — the app is the only
 * layer that already depends on both.
 *
 * That is the same arrangement as `auth/resolve-principal.ts` and the web
 * shell's one line, and it does NOT widen the seam: the two modules still know
 * nothing of each other. This composes them, in the layer whose job is
 * composing them.
 *
 * ## Exact match only, and that is a security decision
 *
 * A prefix or substring search over `auth_user` is a customer-list harvester
 * for anybody holding `members:manage`. This answers one question — "does THIS
 * address have an account" — for one address at a time, which is the least it
 * can do and still let an administrator invite a colleague.
 *
 * ⚠ It still discloses whether an address is registered, to anyone holding the
 * key. That is an accepted trade rather than an oversight, and `members:manage`
 * is privileged and held by few. If that stops being true, the answer is a
 * narrower question, not a fuzzier search.
 *
 * ## The members screen no longer calls this
 *
 * It INVITES by address now (`inviteMember`), so it never needs to turn an
 * email into a userId — an invitation is addressed to a mailbox and does not
 * care whether an account is behind it. `findUserByEmail` stays because it
 * answers a question nothing else does, and because the alternative to keeping
 * it is deleting a guarded, tested lookup on the guess that nothing will want
 * it again.
 *
 * Null for an unknown address, which is a normal answer rather than an error.
 */

/**
 * The most ids one `findUsersByIds` call may name.
 *
 * Two hundred is comfortably more than any members grid shows at once and
 * comfortably less than a query worth worrying about. It silently truncates
 * rather than refusing: a caller asking for more than it can render is a bug in
 * the caller, and a 400 in the middle of a screen load helps nobody.
 */
const MAX_USER_LOOKUP = 200;

@ObjectType('FoundUser')
export class FoundUserType {
  @Field()
  id!: string;

  @Field()
  email!: string;

  @Field(() => String, { nullable: true })
  displayName!: string | null;

  @Field(() => String, { nullable: true })
  username!: string | null;
}

@Injectable()
@Resolver()
export class UsersResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The people behind a set of ids, for a screen that has membership rows and
   * no names.
   *
   * ## ⚠ IT IS SCOPED TO AN ORGANIZATION, and it was not
   *
   * This used to take ids alone, with no `@RequireScope`. A GraphQL request has
   * no organization in its URL, so the guard fell through to the path
   * convention and resolved the request at **APP LEVEL** — where `members:read`
   * is held by platform administrators and by nobody else. The effect was
   * precise and easy to miss: a super administrator saw names everywhere, and
   * an ordinary member of an organization — who holds `members:read` INSIDE
   * their organization — saw raw ids on every roster. The lookup failed, the
   * client fails soft, and the id is the fallback.
   *
   * So the caller names the organization it is asking about, the guard resolves
   * that scope, and an organization-level grant applies. An app-level grant
   * still applies too (`composeContext` adds app-level features to every
   * scope), so platform administrators are unaffected.
   *
   * ## ⚠ AND THE ANSWER IS INTERSECTED WITH THAT ORGANIZATION'S MEMBERSHIP
   *
   * This is the half that the scope change makes necessary rather than
   * optional. The old comment argued that a batch of ids "discloses nothing
   * that was not already disclosed, because the caller already holds them" —
   * true of a screen, and not true of an ENDPOINT, which accepts whatever ids
   * it is sent. While the key was app-level that gap was reachable only by
   * platform administrators. Widening it to every organization member would
   * have turned it into a directory harvester over the whole platform: send
   * your own organization id and a hundred guessed user ids, collect names and
   * email addresses.
   *
   * So a user is returned only if they are a MEMBER of the organization named —
   * which is exactly the set the roster already shows the caller.
   *
   * ## Missing ids are simply absent
   *
   * A membership can outlive the account it names: `perm_membership.userId` has
   * no foreign key to `auth_user` by design (§12.12), so a deleted user leaves
   * a row pointing nowhere. Returning fewer rows than were asked for is the
   * honest answer, and the caller falls back to showing the id.
   */
  @RequireFeature(FEATURE.membersRead)
  @RequireScope('organization')
  @Query(() => [FoundUserType], { name: 'findUsersByIds' })
  async findUsersByIds(
    @Args('organizationId') organizationId: string,
    @Args('ids', { type: () => [String] }) ids: string[],
  ): Promise<FoundUserType[]> {
    /*
     * De-duplicated and CAPPED. The cap is not about this screen — an
     * organization with two hundred members is ordinary — it is about the
     * endpoint: an uncapped `in` list is an unbounded query somebody can send,
     * and the request that finally hurts is never the one anybody tested.
     */
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))].slice(0, MAX_USER_LOOKUP);
    if (unique.length === 0) return [];

    /*
     * ⚠ THE INTERSECTION, and it is done in the database rather than by
     * filtering afterwards: asking `auth_user` for everybody and then dropping
     * non-members would still have READ them, and a mistake in the filter would
     * be a disclosure rather than an empty list.
     *
     * ⚠ Any membership STATUS counts, not just active. A suspended or invited
     * member is on the roster the caller is already looking at — showing their
     * id but not their name would make a screen that is half legible for a
     * reason nobody could explain.
     */
    const memberships = await this.prisma.permMembership.findMany({
      where: { organizationId, userId: { in: unique } },
      select: { userId: true },
    });

    const members = memberships.map((row) => row.userId);
    if (members.length === 0) return [];

    return this.prisma.authUser.findMany({
      where: { id: { in: members } },
      select: { id: true, email: true, displayName: true, username: true },
    });
  }

  /**
   * Null when there is no account, which is a normal answer rather than an
   * error — the caller is a form checking an address somebody typed.
   */
  @RequireFeature(FEATURE.membersRead)
  @Query(() => FoundUserType, { name: 'findUserByEmail', nullable: true })
  async findUserByEmail(@Args('email') email: string): Promise<FoundUserType | null> {
    /*
     * Normalised the same way the auth module stores it. Doing it differently
     * here would mean 'Alice@Acme.com' finds nobody while signing in with it
     * works — the class of bug that only appears for the one person whose email
     * client capitalises.
     */
    const normalised = email.trim().toLowerCase();
    if (!normalised) return null;

    const user = await this.prisma.authUser.findUnique({
      where: { email: normalised },
      select: { id: true, email: true, displayName: true, username: true },
    });

    return user ?? null;
  }
}
