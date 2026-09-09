import { FEATURE } from '@kwtech/module-permissions';
import { RequireFeature } from '@kwtech/module-permissions/server';
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
   * ## Why by ID and not by search
   *
   * The caller already HOLDS these ids — they came from
   * `permissionOrganizationDetail`, which is itself guarded. So this discloses
   * nothing that was not already disclosed, which is what makes a batch
   * acceptable here where a batch of email searches would not be.
   *
   * ## Missing ids are simply absent
   *
   * A membership can outlive the account it names: `perm_membership.userId` has
   * no foreign key to `auth_user` by design (§12.12), so a deleted user leaves
   * a row pointing nowhere. Returning fewer rows than were asked for is the
   * honest answer, and the caller falls back to showing the id.
   */
  @RequireFeature(FEATURE.membersRead)
  @Query(() => [FoundUserType], { name: 'findUsersByIds' })
  async findUsersByIds(@Args('ids', { type: () => [String] }) ids: string[]): Promise<FoundUserType[]> {
    /*
     * De-duplicated and CAPPED. The cap is not about this screen — an
     * organization with two hundred members is ordinary — it is about the
     * endpoint: an uncapped `in` list is an unbounded query somebody can send,
     * and the request that finally hurts is never the one anybody tested.
     */
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))].slice(0, MAX_USER_LOOKUP);
    if (unique.length === 0) return [];

    return this.prisma.authUser.findMany({
      where: { id: { in: unique } },
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
