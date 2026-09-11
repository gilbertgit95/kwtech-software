import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What chat lets somebody do, and how much of it.
 *
 * ⚠ EVERY KEY IS APP LEVEL, and that is free rather than chosen: §12.13 settled
 * that the level comes from the URL, and `/chat/*` is not `/organizations/*`.
 * The trap that made every organization-level key grant nothing for weeks
 * cannot fire here, because it only fires below app level.
 *
 * The COST is recorded rather than discovered (§12.41): a plan may only sell
 * organization- and workspace-level features, so an app key in a plan entitles
 * nobody and "group chat is a Pro feature" is unexpressible while chat is app
 * level. Accepted deliberately — chat is person-to-person, and two people with
 * no organization in common must be able to reach each other. The role-sourced
 * CAP is the commercial lever instead.
 *
 * Keys are ATOMIC and split by RISK, per 2026-09-09: `members:manage` carried
 * nine bindings and meant nobody could invite without also being able to remove.
 */
export const CHAT_FEATURE = {
  /**
   * ⚠ THIS ONE EARNS A KEY, and it is worth saying out loud because the
   * precedent points the other way.
   *
   * §12.23 removed `account:*` on the rule that a surface gets a key only when
   * it needs AUTHORISATION, not merely a session. Chat is genuinely deniable: a
   * contractor account that may not message staff is a real configuration,
   * where a settings page you would be locked out of is not.
   */
  read: 'chat:read',
  /** Opening a conversation. ⚠ Where the cap is counted. */
  start: 'chat:start',
  invite: 'chat:invite',
  removeParticipant: 'chat:remove_participant',
  send: 'chat:send',
  /** Deleting somebody ELSE's message, in a conversation you are IN. */
  moderate: 'chat:moderate',
  /** The exact-email lookup. Its own key because it reads `auth_user`. */
  directory: 'chat:directory',
} as const;

export type ChatFeatureKey = (typeof CHAT_FEATURE)[keyof typeof CHAT_FEATURE];

/*
 * ── no key for leaving ──────────────────────────────────────────────────────
 *
 * Withholding one would be a LOCKOUT DRESSED AS A PERMISSION — the rule
 * module-auth's `account:*` removal already established. Anybody may leave any
 * conversation they are in.
 *
 * ── and no read-any-conversation key ────────────────────────────────────────
 *
 * §12.42, deliberately. `platform:support_access` is the single exemption in the
 * permission model and must not quietly become "read everyone's private
 * messages". `chat:moderate` deletes a message in a conversation the actor
 * PARTICIPATES in, which is a different act. The pressure will come from abuse
 * reports, and the honest answer then is a separate, isPrivileged, audited key —
 * not widening support access, and not an unlogged database console.
 */

/**
 * Contributed to the app's composed registry, exactly as `AUTH_FEATURE_REGISTRY`
 * is. The host spreads it into `seed/registry.ts`: one import, one line.
 *
 * ⚠ Bindings name where each key is ENFORCED. A key with no bindings guards
 * nothing while reading as coverage; one whose binding names a surface that has
 * no guard is worse. They are filled in as each surface lands — steps 4 to 7 —
 * so `auditRegistry()` reports an unbound key rather than this file claiming
 * enforcement that does not exist yet.
 */
export const CHAT_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: CHAT_FEATURE.read,
    module: 'chat',
    level: 'app',
    label: 'Use chat',
    description: 'See conversations and read messages in them.',
    tags: ['chat'],
  },
  {
    key: CHAT_FEATURE.start,
    module: 'chat',
    level: 'app',
    label: 'Start a conversation',
    description: 'Open a direct chat or create a group. Subject to the group-chat cap.',
    tags: ['chat'],
  },
  {
    key: CHAT_FEATURE.invite,
    module: 'chat',
    level: 'app',
    label: 'Invite to a conversation',
    description: 'Add somebody to a conversation you are in.',
    tags: ['chat'],
  },
  {
    key: CHAT_FEATURE.removeParticipant,
    module: 'chat',
    level: 'app',
    label: 'Remove a participant',
    description: 'Remove somebody else from a conversation you are in. The creator cannot be removed.',
    tags: ['chat'],
  },
  {
    key: CHAT_FEATURE.send,
    module: 'chat',
    level: 'app',
    label: 'Send messages',
    description: 'Post into a conversation you are in.',
    tags: ['chat'],
  },
  {
    key: CHAT_FEATURE.moderate,
    module: 'chat',
    /*
     * Deleting what somebody else wrote is irreversible to them and is recorded
     * on the tombstone — `deletedById` exists for exactly this key.
     */
    isPrivileged: true,
    level: 'app',
    label: 'Moderate a conversation',
    description: "Delete somebody else's message in a conversation you are in.",
    tags: ['chat'],
  },
  {
    key: CHAT_FEATURE.directory,
    module: 'chat',
    /*
     * ⚠ A USER-ENUMERATION ORACLE over `auth_user`, which is the exact surface
     * §12.36 refused to expose on sign-up. Its own key, exact-email-match only,
     * rate-limited: you must already know the address, and there is no way to
     * harvest a list. Prefix search was rejected — it is a far better
     * type-ahead and a full staff directory for anyone holding the key.
     */
    isPrivileged: true,
    level: 'app',
    label: 'Look somebody up to invite them',
    description: 'Find a person by their exact email address. No prefix or partial search.',
    tags: ['chat'],
  },
];

export const CHAT_LIMIT = {
  /** How many live group chats one person may have OPEN AT ONCE. */
  groupChats: 'chat:group_chats',
} as const;

/**
 * The cap, declared through module-kit so the app can compose it.
 *
 * ⚠ ROLE-SOURCED, and it has to be: every `chat:*` key is app level, and a
 * plan-sourced limit has no meaning before an organization exists. Two users
 * with no organization between them have no subscription to read.
 *
 * ⚠ And it counts LIVE CHATS YOU CREATED AND ARE STILL IN — see
 * `countsTowardCap`. Archiving frees a slot, so the cap is something a person
 * can clear rather than a wall, and being INVITED to a chat costs the invitee
 * nothing: a cap other people can spend on your behalf is a griefing tool, not
 * a limit.
 */
export const CHAT_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: CHAT_LIMIT.groupChats,
    module: 'chat',
    label: 'Group chats',
    description: 'How many live group conversations this person may have open at once. Archiving frees a slot.',
    source: 'role',
    countedOver: 'user',
    required: false,
    /*
     * Twenty. Large enough that nobody meets it in ordinary use, small enough
     * that a script cannot open ten thousand rows before anybody notices.
     *
     * ⚠ NOT null. This is the number handed to somebody nobody has configured —
     * an unconfigured role, a fresh deployment — and null there is an unbounded
     * resource for an unknown party.
     */
    defaultValue: 20,
  },
];
