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
  /**
   * ⚠ ADMINISTER ANY GROUP WITHOUT BEING IN IT — the app level reaching DOWN
   * into a conversation, the way it already reaches into every organization.
   *
   * Renaming a group, adding and removing people, and deciding who runs it,
   * for a conversation the holder is not a participant of. Inside a
   * conversation those questions are answered by `ChatParticipant.role`; this
   * is the answer from above, and it is the only key in this module that acts
   * without standing in the room.
   *
   * ⚠ AND IT CONFERS NO RIGHT TO READ A MESSAGE. Not one. §12.42 ships no
   * read-any-conversation key and this is not it — "manage" quietly becoming
   * "read everyone's private messages" is exactly the drift that entry exists
   * to prevent. Every act it admits is answerable from MEMBERSHIP AND SETTINGS,
   * which is metadata: who is in a group and what it is called, never a word of
   * what was said in it. The message queries are bound to `chat:read` and
   * refuse a non-participant regardless of who is asking.
   *
   * PRIVILEGED, so the role editor flags it.
   */
  manageAll: 'chat:manage_all',
} as const;

export type ChatFeatureKey = (typeof CHAT_FEATURE)[keyof typeof CHAT_FEATURE];

/*
 * ── no key for leaving ──────────────────────────────────────────────────────
 *
 * Withholding one would be a LOCKOUT DRESSED AS A PERMISSION — the rule
 * module-auth's `account:*` removal already established. Anybody may leave any
 * conversation they are in.
 *
 * ── three mutations are deliberately UNBOUND ────────────────────────────────
 *
 * `leaveChat`, `respondToChatInvitation` and `setChatBlocked` carry no key, and
 * §12.15's warning applies — an operation that SHOULD be guarded and is not
 * looks exactly like one that is deliberately public, so this is the place it
 * is said out loud. All three are the person's OWN remedy over their own row:
 * leaving, answering an invitation addressed to them, and refusing contact.
 * Withholding any of them is a lockout dressed as a permission, and the last is
 * the only remedy anybody has, because §12.42 leaves the platform without one.
 *
 * They are still not open: every one of them refuses unless the caller's own
 * participant row says otherwise.
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
 * ⚠ THE BINDINGS ARE THE GUARD, and that is not a figure of speech here.
 *
 * `module-chat` cannot use `@RequireFeature` — the decorator belongs to
 * `module-permissions`, and a module may not import a module (§9). So every
 * operation is guarded by the binding below: the host composes this registry
 * into `featureRegistry`, and `FeatureGuard` refuses an operation whose bound
 * key the caller does not hold.
 *
 * ⚠ That path did not work until 2026-09-11. The guard built its binding index
 * from `FEATURE_REGISTRY` — permissions' OWN — so a contributed binding was
 * written to the database, offered by the role editor, and enforced NOWHERE.
 * It now builds from the composed registry, with a test naming this module.
 *
 * `ui_route` and `ui_component` bindings arrive with step 7.
 */
export const CHAT_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: CHAT_FEATURE.read,
    module: 'chat',
    level: 'app',
    label: 'Use chat',
    description: 'See conversations and read messages in them.',
    tags: ['chat'],
    bindings: [
      { surface: 'graphql_operation', identifier: 'Query.chatConversations' },
      { surface: 'graphql_operation', identifier: 'Query.chatConversation' },
      { surface: 'graphql_operation', identifier: 'Query.chatMessages' },
      { surface: 'graphql_operation', identifier: 'Mutation.markChatRead' },
      /*
       * ⚠ ITS OWN SURFACE, and that distinction is the point of
       * `graphql_subscription` existing separately. A subscription is
       * authorised ONCE, here, and then streams for as long as the socket
       * lives — so this key is checked at subscribe and never again, and the
       * socket closing at token expiry is what bounds how stale that answer can
       * get. Participation is NOT on that clock: it is re-read on every
       * publish.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.chatEvents' },
      /*
       * ⚠ PRESENCE READS UNDER `chat:read`, not a key of its own.
       *
       * Who is here is only ever answered about people you already share a
       * conversation with — the service filters to that, and it is the same
       * question `chat:read` already lets you ask by opening the thread. A
       * separate key would suggest presence can be granted without chat, which
       * it cannot: there would be nobody it could resolve for.
       */
      { surface: 'graphql_operation', identifier: 'Query.chatPresence' },
      { surface: 'graphql_operation', identifier: 'Query.chatMyAvailability' },
      { surface: 'graphql_operation', identifier: 'Mutation.setChatAvailability' },
    ],
  },
  {
    key: CHAT_FEATURE.start,
    module: 'chat',
    level: 'app',
    label: 'Start a conversation',
    description: 'Open a direct chat or create a group. Subject to the group-chat cap.',
    tags: ['chat'],
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.startDirectChat' },
      { surface: 'graphql_operation', identifier: 'Mutation.startGroupChat' },
      { surface: 'graphql_operation', identifier: 'Mutation.renameChat' },
      { surface: 'graphql_operation', identifier: 'Mutation.setChatArchived' },
    ],
  },
  {
    key: CHAT_FEATURE.invite,
    module: 'chat',
    level: 'app',
    label: 'Invite to a conversation',
    description: 'Add somebody to a conversation you are in.',
    tags: ['chat'],
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.inviteToChat' }],
  },
  {
    key: CHAT_FEATURE.removeParticipant,
    module: 'chat',
    level: 'app',
    label: 'Remove a participant',
    description: 'Remove somebody else from a conversation you are in. The creator cannot be removed.',
    tags: ['chat'],
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.removeChatParticipant' },
      /*
       * ⚠ THE SAME KEY AS REMOVAL, not `chat:start`.
       *
       * Deciding who RUNS a conversation is the same kind of act as deciding
       * who is IN it — both change what other people may do — and the rule
       * inside narrows it further to the owner alone. The key says you may take
       * part in managing membership; the row says whether you may here.
       */
      { surface: 'graphql_operation', identifier: 'Mutation.setChatParticipantRole' },
    ],
  },
  {
    key: CHAT_FEATURE.send,
    module: 'chat',
    level: 'app',
    label: 'Send messages',
    description: 'Post into a conversation you are in.',
    tags: ['chat'],
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.sendChatMessage' },
      { surface: 'graphql_operation', identifier: 'Mutation.editChatMessage' },
      { surface: 'graphql_operation', identifier: 'Mutation.deleteChatMessage' },
      /*
       * ⚠ TYPING IS A WRITE, and it binds with the other writes. A ping puts an
       * indicator on somebody else's screen, so the person doing it must be
       * allowed to say something at all — and the resolver re-asks participation
       * on top, because the key says nothing about conversation 42.
       */
      { surface: 'graphql_operation', identifier: 'Mutation.sendChatTyping' },
    ],
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
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.moderateChatMessage' }],
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
    bindings: [{ surface: 'graphql_operation', identifier: 'Query.chatDirectoryLookup' }],
  },
  {
    key: CHAT_FEATURE.manageAll,
    module: 'chat',
    /*
     * ⚠ The app level reaching DOWN into a conversation, which is what every
     * other level already does — support staff manage any organization without
     * belonging to it, and a conversation being the one thing in the product
     * nobody can administer from above would be the odd case, not this.
     *
     * PRIVILEGED because it acts on rooms the holder is not in. What it may NOT
     * do is read them: §12.42 ships no read-any-conversation key, every message
     * query is bound to `chat:read` and refuses a non-participant, and this key
     * changes none of that.
     */
    isPrivileged: true,
    level: 'app',
    label: 'Administer any conversation',
    description:
      'Rename any group, add and remove its people, and decide who runs it — without being in it. Does not grant reading any message.',
    tags: ['chat'],
    /*
     * ⚠ NO BINDINGS, and that is not an oversight — it is the one key in this
     * module the guard cannot enforce by itself.
     *
     * A binding says "this operation requires this key", which would REFUSE an
     * ordinary owner renaming their own group. This key WIDENS who may reach an
     * operation rather than gating it, so it is resolved by the host inside the
     * request — `resolvePlatformAdmin` — and handed to the domain as a boolean,
     * the same seam `mayModerate` already uses. The operations themselves stay
     * bound to the ordinary keys.
     */
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

/**
 * A role a host MAY create, exported as DATA and never seeded by this module.
 *
 * The `createPlanIfAbsent` lesson: which roles a platform offers is an operator
 * decision, and a seed preserves it by GETTING OUT OF THE WAY rather than by
 * there being no seed at all. So this module ships the shape and the app decides
 * whether to create it — created if absent, never rewritten.
 *
 * ⚠ Not seeded automatically, and the consequence is deliberate: adopting chat
 * grants nobody anything until somebody says who may use it. `chat:read` is
 * genuinely deniable — a contractor account that may not message staff is a real
 * configuration — so a module that handed itself out on install would be
 * removing the decision it exists to offer.
 */
export interface ChatRolePreset {
  key: string;
  label: string;
  icon: string;
  features: readonly string[];
  /** Caps this role grants. Role-sourced, so only meaningful at app level. */
  limits: Readonly<Record<string, number>>;
}

export const CHAT_ROLE_PRESETS: readonly ChatRolePreset[] = [
  {
    key: 'chat-user',
    label: 'Chat user',
    icon: 'message-circle',
    features: [CHAT_FEATURE.read, CHAT_FEATURE.start, CHAT_FEATURE.send, CHAT_FEATURE.invite, CHAT_FEATURE.directory],
    // The default from the registry, restated so the role is self-describing:
    // a preset that inherited its cap silently would change meaning the day the
    // default did.
    limits: { [CHAT_LIMIT.groupChats]: 20 },
  },
  {
    key: 'chat-moderator',
    label: 'Chat moderator',
    icon: 'shield',
    features: [
      CHAT_FEATURE.read,
      CHAT_FEATURE.start,
      CHAT_FEATURE.send,
      CHAT_FEATURE.invite,
      CHAT_FEATURE.directory,
      CHAT_FEATURE.removeParticipant,
      CHAT_FEATURE.moderate,
    ],
    limits: { [CHAT_LIMIT.groupChats]: 50 },
  },
];
