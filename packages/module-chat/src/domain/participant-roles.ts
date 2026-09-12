import type { ChatParticipantRole, ConversationView, ParticipantView } from '../types.js';
import { canAccessConversation } from './participation.js';

/**
 * WHO MAY DO WHAT INSIDE ONE CONVERSATION.
 *
 * ## Why this is not a permission level
 *
 * `FeatureLevel` stays app / organization / workspace, and a conversation is
 * none of them. A level is a scope the PERMISSION CONTEXT resolves at: the app
 * parses it from the URL, resolves it once per request, and levels reach
 * downward because they express containment. A conversation fails all three —
 * `/chat` carries no id in its path, one conversation list touches hundreds of
 * them, and a conversation is not inside an organization at all, because chat
 * is app level precisely so two people with no organization in common can talk.
 *
 * So authority here is a COLUMN ON A PARTICIPANT ROW, owned by this module and
 * read by nothing else. `module-permissions` never learns what a conversation
 * is, which is the same boundary in the same direction as everywhere else.
 *
 * ## But the app level still reaches DOWN into it
 *
 * Which is the property the levels already have — an app-level grant applies at
 * every scope, and support staff manage any organization without belonging to
 * it. A conversation is not a level, and it would be strange for it to be the
 * one thing in the product nobody can administer from above.
 *
 * So `asPlatformAdmin` is the second half of every rule below: somebody holding
 * the app-level `chat:manage_all` acts on a conversation WITHOUT STANDING IN
 * IT, with an owner's authority over its membership and its settings.
 *
 * ⚠ AND IT STOPS EXACTLY THERE. It is authority over MEMBERSHIP AND SETTINGS
 * and confers no right to read a single message. §12.42 is unchanged: this
 * product ships no read-any-conversation key, and "manage" quietly becoming
 * "read everyone's private messages" is precisely the drift that entry exists
 * to prevent. Renaming a group, adding somebody to it and deciding who runs it
 * are all answerable from metadata; none of them needs a word of what was said.
 *
 * ## The two questions, still asked in order
 *
 *   1. The KEY, checked by the guard: may this person use chat, or administer
 *      any conversation.
 *   2. The ROW, checked here: may they do this, HERE.
 *
 * "Participation is not permission" was the first half of that and this is the
 * second. Holding `chat:invite` may now mean adding somebody to a group you run
 * and not to one you merely belong to — which was inexpressible while the only
 * answer was an app-level key.
 */

/**
 * A caller, as the rules below see one.
 *
 * ⚠ BOTH HALVES, because a platform administrator has NO PARTICIPANT ROW. They
 * are not in the room, which is the whole point — so a rule that read only the
 * row would refuse them, and one that read only the flag would let an ordinary
 * member do anything.
 */
export interface ActorAuthority {
  /** Their own row here, or absent when they are not in it. */
  participant?: ParticipantView | null | undefined;
  /**
   * ⚠ THE ANSWER TO A QUESTION THIS MODULE DOES NOT ASK ITSELF.
   *
   * Whether the caller holds the app-level `chat:manage_all` is a permission
   * question, and this module may not read grants — the same seam `mayModerate`
   * already uses on `delete`. The host resolves it and passes a boolean.
   */
  asPlatformAdmin?: boolean;
}

/**
 * The role on a row, with absent read as the floor.
 *
 * ⚠ ABSENT IS `member`, NEVER `owner`. Every row written before the column
 * existed has no value, and the safe reading of "we do not know" is the one
 * that grants nothing.
 */
export function roleOf(participant: ParticipantView | null | undefined): ChatParticipantRole {
  return participant?.role ?? 'member';
}

/**
 * ⚠ STATUS FIRST, ALWAYS — for anybody who is in the room. A removed owner
 * still carries `owner` on their row (nothing rewrites it, and nothing should),
 * so a check that asked about the role without asking about the status would
 * let somebody taken out of a group keep running it.
 *
 * A platform administrator skips the row entirely, having none.
 */
function commands(actor: ActorAuthority, roles: readonly ChatParticipantRole[]): boolean {
  if (actor.asPlatformAdmin) return true;
  if (!canAccessConversation(actor.participant)) return false;
  return roles.includes(roleOf(actor.participant));
}

/**
 * Rename the group, change its icon — the conversation's own settings.
 *
 * ⚠ THIS NARROWS WHAT SHIPPED. Renaming was bound to `chat:start` and therefore
 * open to every active participant, so anybody in a group could rename it for
 * everybody. That was not a decision, it was the absence of one.
 */
export function canManageConversation(actor: ActorAuthority): boolean {
  return commands(actor, ['owner', 'admin']);
}

/**
 * ARCHIVING IS THE OWNER'S ALONE, and an admin does not get it.
 *
 * It is the one setting that is not merely presentational: archiving a group
 * frees the CREATOR's cap slot and takes the conversation off everybody's list
 * at once. A delegate who can add people should not be able to put the room
 * away.
 */
export function canArchiveConversation(actor: ActorAuthority): boolean {
  return commands(actor, ['owner']);
}

/** Add somebody. The delegate's whole reason for existing. */
export function canInviteToConversation(actor: ActorAuthority): boolean {
  return commands(actor, ['owner', 'admin']);
}

/**
 * Why a removal is refused, or `null` to allow it.
 *
 * Reasons rather than a boolean, like every other refusal in this module: they
 * are different situations and only one of them is an error worth showing.
 */
export type RoleRemovalRefusal =
  | 'not_a_participant'
  | 'target_not_present'
  | 'self_removal'
  | 'not_permitted'
  | 'owner';

export function refuseRoleRemoval({
  actor,
  target,
}: {
  actor: ActorAuthority;
  target: ParticipantView | null | undefined;
}): RoleRemovalRefusal | null {
  if (!actor.asPlatformAdmin && !canAccessConversation(actor.participant)) return 'not_a_participant';
  if (!canAccessConversation(target)) return 'target_not_present';

  // Not an error to show: they wanted to leave, which is a different verb and
  // needs no role at all. A platform administrator has no row, so no self.
  if (actor.participant && actor.participant.userId === target.userId) return 'self_removal';

  /*
   * ⚠ THE OWNER CANNOT BE REMOVED BY ANYBODY — not an admin, not another owner
   * (there is only one), and NOT A PLATFORM ADMINISTRATOR EITHER.
   *
   * That last one is deliberate rather than an oversight. Every rule in this
   * file leans on "a live group has exactly one owner", and an exception would
   * be the one path that breaks it. Somebody with the platform key who needs an
   * owner gone hands the group to another member FIRST and removes them second
   * — two steps, one invariant, and an order that leaves the room with somebody
   * in charge at every moment.
   */
  if (roleOf(target) === 'owner') return 'owner';

  const actorRole = actor.asPlatformAdmin ? 'owner' : roleOf(actor.participant);
  if (actorRole === 'owner') return null;

  /*
   * ⚠ AN ADMIN MAY REMOVE MEMBERS AND NOT OTHER ADMINS.
   *
   * Two admins who can remove each other is a race with a winner, and the
   * winner is whoever clicks first. Peers do not police peers; the owner
   * settles it, which is what having exactly one owner is for.
   */
  if (actorRole === 'admin' && roleOf(target) === 'member') return null;
  return 'not_permitted';
}

/** Why a role change is refused, or `null` to allow it. */
export type RoleChangeRefusal = 'not_a_participant' | 'target_not_present' | 'not_permitted' | 'self_demotion';

/**
 * Who may change somebody's role, and to what.
 *
 * ⚠ THE OWNER ALONE, or the platform. An admin promoting another admin is an
 * admin granting their own power away, and an admin demoting one is the peer
 * war above with a longer fuse.
 */
export function refuseRoleChange({
  actor,
  target,
}: {
  actor: ActorAuthority;
  target: ParticipantView | null | undefined;
  next: ChatParticipantRole;
}): RoleChangeRefusal | null {
  if (!actor.asPlatformAdmin && !canAccessConversation(actor.participant)) return 'not_a_participant';
  if (!canAccessConversation(target)) return 'target_not_present';

  if (!actor.asPlatformAdmin && roleOf(actor.participant) !== 'owner') return 'not_permitted';

  /*
   * ⚠ AN OWNER CANNOT DEMOTE THEMSELVES, because a group with no owner is one
   * nobody can archive or hand on — a dead end reachable in one click.
   *
   * Setting somebody ELSE to `owner` is the way out, and it is a TRANSFER: the
   * previous owner becomes an admin in the same act, so there is never a moment
   * with two owners or none. See `transferOwnership`.
   *
   * A platform administrator is not subject to it, having no row to demote.
   */
  if (actor.participant && actor.participant.userId === target.userId) return 'self_demotion';
  return null;
}

/**
 * The rows as they stand after `toUserId` is made the owner.
 *
 * ⚠ ONE FUNCTION, so the demotion cannot be forgotten. Written as two
 * statements at a call site, the second is the one a refactor loses — and the
 * result is two owners, which every rule here assumes is impossible.
 */
export function transferOwnership(
  participants: readonly ParticipantView[],
  toUserId: string,
): { userId: string; role: ChatParticipantRole }[] {
  const changes: { userId: string; role: ChatParticipantRole }[] = [];

  for (const one of participants) {
    // The outgoing owner becomes an ADMIN rather than a member: they built the
    // room, and dropping them to the floor in the act of handing it over is a
    // punishment nobody asked for.
    if (roleOf(one) === 'owner' && one.userId !== toUserId) changes.push({ userId: one.userId, role: 'admin' });
    if (one.userId === toUserId && roleOf(one) !== 'owner') changes.push({ userId: one.userId, role: 'owner' });
  }
  return changes;
}

/**
 * Who becomes owner when the owner leaves, or `undefined` if nobody can.
 *
 * ⚠ AUTOMATIC, AND DETERMINISTIC. The alternatives are both worse: refusing to
 * let an owner leave strands a group when somebody's account is closed, and
 * leaving it ownerless produces a room nobody can rename, archive or hand on —
 * a dead end that reads as a bug months later.
 *
 * ⚠ THE CAP DOES NOT FOLLOW. `createdById` stays where it is, because it
 * records who spent a group-chat slot and handing a slot to somebody who never
 * asked for it was rejected when the cap was designed. The creator's slot frees
 * on its own the moment they stop being active — which is exactly this moment.
 *
 * Admins first, then members, oldest membership first in both. Longest-standing
 * rather than most recent: the person who has been in the room longest is the
 * likeliest to know what it is for, and "whoever joined last" hands a group to
 * its newest arrival.
 */
export function successorTo(
  participants: readonly ParticipantView[],
  leavingUserId: string,
  joinedAt: (participant: ParticipantView) => number,
): string | undefined {
  const candidates = participants
    .filter((one) => one.userId !== leavingUserId && canAccessConversation(one))
    .sort((a, b) => joinedAt(a) - joinedAt(b));

  return (
    candidates.find((one) => roleOf(one) === 'admin')?.userId ??
    candidates.find((one) => roleOf(one) === 'member')?.userId
  );
}

/**
 * Whether roles are consulted at all here.
 *
 * ⚠ A DIRECT CHAT HAS NONE. Two people are equal in it, and every act a role
 * governs is already refused: it cannot be renamed (it is named by who is in
 * it), it cannot take a third person (its `directKey` says who it is), and it
 * is not one person's to archive on the other's behalf. The column exists on
 * those rows and means nothing, which is cheaper than a second table.
 */
export function rolesApply(conversation: Pick<ConversationView, 'directKey'>): boolean {
  /*
   * ⚠ READ FROM `directKey`, not from an `isDirect` flag. The column IS the
   * answer — a direct chat is exactly a conversation with a key naming the two
   * people in it — and the domain reasons about rows rather than about the
   * rendered shape a resolver derives from them.
   */
  return conversation.directKey === null;
}
