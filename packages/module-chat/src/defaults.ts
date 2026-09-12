import type { DefaultContribution, DefaultMomentContribution } from '@kwtech/module-kit';
import { CHAT_PARTICIPANT_ROLES } from './types.js';

/**
 * The two decisions an OPERATOR should make once rather than chat making them.
 *
 * ⚠ EXACTLY THE PAIR `workspace.*` ALREADY HAS — the role a creator gets, and
 * the role somebody added gets — which is the tell that these are defaults
 * rather than constants. Both were hardcoded when group roles landed: `owner`
 * for the creator, `member` for everybody added.
 *
 * ## Why chat could not declare them until now
 *
 * `APP_DEFAULT_REGISTRY` was a const inside `module-permissions` with no
 * contribution path, so the only ways to have these were to hardcode them or to
 * have the permissions module import chat — which §9 forbids. `DefaultContribution`
 * in `module-kit` is the third of these ports, after features and limits, and
 * exists for the same reason both of those do.
 *
 * ## ⚠ Why `kind: 'choice'`
 *
 * Every default the permissions module shipped points at something it stores —
 * a role row, a plan row — so its screen offers a picker over rows it can list.
 * These point at neither: a participant role is an enum in THIS module's schema
 * and not a row anybody can enumerate. So the choices travel with the
 * declaration, and the screen renders them.
 */

export const CHAT_DEFAULT = {
  /** The role a group's CREATOR is given. Hardcoded `owner` before this. */
  creatorRole: 'chat.creator_role',
  /** The role somebody ADDED to a group is given. Hardcoded `member` before this. */
  memberRole: 'chat.member_role',
} as const;

export type ChatDefaultKey = (typeof CHAT_DEFAULT)[keyof typeof CHAT_DEFAULT];

/** The three roles, as a picker's options. One list, from the vocabulary itself. */
const ROLE_CHOICES = CHAT_PARTICIPANT_ROLES.map((value) => ({
  value,
  label: { owner: 'Owner', admin: 'Admin', member: 'Member' }[value],
}));

export const CHAT_DEFAULT_REGISTRY: readonly DefaultContribution[] = [
  {
    key: CHAT_DEFAULT.creatorRole,
    module: 'chat',
    kind: 'choice',
    moment: 'chat_conversation_created',
    label: "Role for a group's creator",
    description:
      'Given in the new group to whoever created it. ⚠ Setting this to anything but Owner leaves a group with NO owner — nobody who can archive it or hand it on — because nothing else mints one.',
    whenUnset: 'The creator is the owner, which is what every group created before this setting existed has.',
    choices: ROLE_CHOICES,
  },
  {
    key: CHAT_DEFAULT.memberRole,
    module: 'chat',
    kind: 'choice',
    moment: 'chat_participant_added',
    label: 'Role for somebody added to a group',
    description:
      'Given to anybody invited into a group. ⚠ Owner is refused here: a group has exactly one, and handing that to every arrival would demote the person who made it on the next invitation.',
    whenUnset: 'They join as a member — in the group, able to read and write in it, and running nothing.',
    /*
     * ⚠ NO `owner` AMONG THEM. It is not a matter of taste: `transferOwnership`
     * is what mints an owner, in one act that demotes the previous one, and an
     * arrival silently becoming owner would take the group from whoever built
     * it. The write path refuses it too — this is the picker agreeing.
     */
    choices: ROLE_CHOICES.filter((choice) => choice.value !== 'owner'),
  },
];

/**
 * THE TWO SECTIONS chat's defaults appear under, and why they are declared at
 * all.
 *
 * The defaults screen groups by MOMENT and used to know only the six
 * `module-permissions` ships. A default at a moment it had never heard of got
 * no section and therefore never rendered — declared, composed, settable
 * through the API, and invisible on the only screen anybody sets it from. So
 * the heading travels with the module that owns the process.
 *
 * ⚠ Ordered AFTER the six (10–60), because they are the shape of the
 * product an operator reads first: an account, then an organization, then a
 * workspace. Chat is a feature inside that, not a step through it.
 */
export const CHAT_DEFAULT_MOMENT_REGISTRY: readonly DefaultMomentContribution[] = [
  {
    moment: 'chat_conversation_created',
    order: 70,
    title: 'When a group is created',
    blurb:
      'Direct conversations have no roles — two people, both able to leave and neither able to remove the other — so this is about GROUPS only.',
  },
  {
    moment: 'chat_participant_added',
    order: 80,
    title: 'When somebody is added to a group',
    blurb:
      'Applies to an invitation nobody named a role on, which is every invitation today. ⚠ Somebody coming BACK keeps the role they had: a re-invitation is not a demotion.',
  },
];

/**
 * Reading what the operator chose.
 *
 * ⚠ A PORT, because the VALUE lives in `perm_default` — a table
 * `module-permissions` owns — while the DECLARATION lives here. The same split
 * as the cap: chat declares `chat:group_chats` and calls a `LimitChecker` to
 * find out the number.
 *
 * ⚠ Absent means every default is unset, which is the documented fallback and a
 * working product: a host with no permission model still creates groups whose
 * creator owns them.
 */
export interface ChatDefaultReader {
  /** @returns the stored value, or null when nobody has chosen one. */
  read(key: string): Promise<string | null>;
}
