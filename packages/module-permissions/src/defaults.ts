/**
 * ── THE PLATFORM'S DEFAULTS, as a catalogue ──────────────────────────────────
 *
 * What the application does when nobody said what to do: the role a new account
 * gets, the role an organization's founder gets, the plan a new organization
 * starts on, the role a workspace's creator gets.
 *
 * ## Why these need somewhere to live at all
 *
 * The permission model is ADDITIVE. There is no default-on, so every one of
 * these processes currently ends with somebody holding nothing:
 *
 *   - `createOrganization` makes the founder a MEMBER and grants no role, so
 *     the person who just created a company cannot administer it;
 *   - `createWorkspace` does the same one level down — §12.33 requires
 *     membership to enter, and the creator gets entry and nothing else;
 *   - an organization starts on NO PLAN, so it is entitled to nothing and every
 *     organization-level key is filtered out of every member's context;
 *   - a new account with no app-level role holds nothing at all, which is what
 *     `defaultAppRoleKey` was added to the module options to fix.
 *
 * Each was patched where it hurt — a module option here, a sentence on a screen
 * there. This is the same question asked four times, so it gets one answer.
 *
 * ## A CATALOGUE in code, values in the database
 *
 * The same split `FEATURE_REGISTRY` makes, and for the same reasons. What a
 * default MEANS — what it applies to, what kind of thing it points at, what
 * happens when it is unset — is a fact about the code and belongs in a review
 * diff. What it is SET to is an operational decision somebody makes at 2am from
 * an admin screen, and belongs in a table.
 *
 * The consequence worth knowing: adding a default is a code change (an entry
 * here, and a call site that reads it), never a row somebody inserts. A key in
 * the table that this catalogue does not declare is IGNORED — see
 * `listDefaults` — so a typo cannot silently become policy.
 *
 * ## ⚠ Setting one of these IS the escalation decision
 *
 * `assignRole` refuses a role carrying features the granter does not hold, so
 * nobody can mint somebody more powerful than themselves. The defaults do not
 * run that check, and they cannot: the founder of an organization is granted
 * their role by the PLATFORM, not by a person who could be asked what they
 * hold. So `defaults:manage` is the whole of the trust — one person, once,
 * deciding what every founder from then on will hold — which is why it is
 * `isPrivileged` and app level, and why the screen says so out loud.
 *
 * Nothing here imports anything, so the server, the React admin screen and a
 * test all read one description of what a default is.
 */

/**
 * The KIND of thing a default points at, which is what tells a screen which
 * picker to draw and the server what to validate against.
 *
 * The three role kinds are separate rather than one `role` kind with a level
 * beside it, because the level is not a parameter of the choice — it IS the
 * choice. A role's level is immutable after creation, and an organization-level
 * role in the app-level slot would not merely be wrong: it would be granted and
 * then filtered out by the resolution order, producing an account that holds
 * nothing for a reason no screen could explain.
 */
export type AppDefaultKind =
  | 'app_role'
  | 'organization_role'
  | 'workspace_role'
  | 'plan'
  | 'subscription_status'
  | 'days';

/**
 * When the default is consulted — the process it is the default FOR.
 *
 * The screen groups by this, because somebody arrives asking "what happens when
 * a workspace is created" rather than "which defaults point at a role".
 */
export type AppDefaultMoment =
  | 'account_created'
  | 'organization_created'
  | 'organization_member_added'
  | 'invitation_sent'
  | 'workspace_created'
  | 'workspace_member_added';

export interface AppDefaultSpec {
  key: AppDefaultKey;
  kind: AppDefaultKind;
  moment: AppDefaultMoment;
  label: string;
  description: string;
  /**
   * What happens when this default is NOT set, in a sentence the screen shows.
   *
   * Written out rather than implied because unset is a legitimate configuration
   * for every one of these, and the consequence differs: an unset plan leaves
   * an organization entitled to nothing, while an unset workspace role leaves a
   * creator who can still enter the workspace they made. A screen that showed
   * "Not set" for both would be describing two very different situations with
   * one word.
   */
  whenUnset: string;
}

/**
 * The keys themselves.
 *
 * Namespaced by the thing they are a default FOR, not by the thing they point
 * AT — `organization.founder_role` rather than `role.organization_founder` —
 * because the process is what somebody is looking for when they open the
 * screen, and two defaults about organizations should sort together.
 *
 * ⚠ These strings are stored in the database. Renaming one silently unsets the
 * default it names: the old row stops matching the catalogue and is ignored,
 * and the new key has no row. A rename therefore needs a migration, exactly as
 * a feature key does.
 */
export const APP_DEFAULT = {
  /** The app-level role a newly created account is granted. */
  accountRole: 'account.app_role',
  /** The organization-level role the FOUNDER of a new organization is granted. */
  organizationFounderRole: 'organization.founder_role',
  /** The organization-level role somebody JOINING gets when nothing named one. */
  organizationMemberRole: 'organization.member_role',
  /** The plan a new organization is subscribed to. */
  organizationPlan: 'organization.plan',
  /** The status that subscription starts in. */
  organizationPlanStatus: 'organization.plan_status',
  /** How many days that subscription's first period runs for. */
  organizationPlanPeriodDays: 'organization.plan_period_days',
  /** How long an invitation stays valid. */
  invitationExpiryDays: 'invitation.expiry_days',
  /** The workspace-level role the CREATOR of a new workspace is granted. */
  workspaceCreatorRole: 'workspace.creator_role',
  /** The workspace-level role somebody ADDED to a workspace is granted. */
  workspaceMemberRole: 'workspace.member_role',
} as const;

export type AppDefaultKey = (typeof APP_DEFAULT)[keyof typeof APP_DEFAULT];

/**
 * Every default the platform has, in the order the screen shows them —
 * account, then organization, then workspace, which is the order a person
 * actually moves through the product.
 */
export const APP_DEFAULT_REGISTRY: readonly AppDefaultSpec[] = [
  {
    key: APP_DEFAULT.accountRole,
    kind: 'app_role',
    moment: 'account_created',
    label: 'Role for a new account',
    /*
     * ⚠ NOT "by sign-up". There is no public sign-up in this app — every
     * account is created through `signUpFromInvitation`, which mints the
     * account and then calls `acceptInvitation`, and that is the one place this
     * default is read. Naming a path that does not exist would send somebody
     * looking for the registration form this describes.
     */
    description:
      'Granted to every account created from then on. Accounts are created by following an invitation — platform or organization — and this fills in the app-level role when the invitation named none.',
    whenUnset:
      'A new account holds nothing at all. It can sign in, and every gated screen — including its own settings — is closed to it.',
  },
  {
    key: APP_DEFAULT.organizationFounderRole,
    kind: 'organization_role',
    moment: 'organization_created',
    label: "Role for an organization's founder",
    description:
      'Granted inside the new organization to whoever created it. Only organization-level roles can be chosen — that is the level the founder is being given standing at.',
    whenUnset:
      'The founder is a member of their own organization and holds no role in it, so they cannot administer the company they just created.',
  },
  {
    key: APP_DEFAULT.organizationMemberRole,
    kind: 'organization_role',
    moment: 'organization_member_added',
    label: 'Role for a new member',
    description:
      'Granted to somebody joining an organization when nothing else named a role — added by an administrator, or accepting an invitation that left the role blank. An invitation that DOES name one always wins.',
    whenUnset:
      'A new member belongs to the organization and holds no role in it. They can be seen in the members list and can do nothing.',
  },
  {
    key: APP_DEFAULT.organizationPlan,
    kind: 'plan',
    moment: 'organization_created',
    description:
      'A live, organization-wide subscription started for every new organization. Archived plans cannot be chosen, and an archived plan entitles nothing even where it is already subscribed.',
    label: 'Plan for a new organization',
    whenUnset:
      'The organization starts on no plan and is therefore entitled to nothing: every organization-level key is filtered out of every member’s context until somebody starts a subscription by hand.',
  },
  {
    key: APP_DEFAULT.organizationPlanStatus,
    kind: 'subscription_status',
    moment: 'organization_created',
    label: 'Status that subscription starts in',
    description:
      'Only `active` entitles anything. ⚠ Nothing compares a subscription to the clock (§12.40), so `past_due` is a label a screen can show and not an expiry the guard enforces.',
    whenUnset: 'The subscription starts active, which is the only status that entitles anything.',
  },
  {
    key: APP_DEFAULT.organizationPlanPeriodDays,
    kind: 'days',
    moment: 'organization_created',
    label: 'Length of the first period',
    description:
      'Sets the new subscription’s renewal date, that many days out. Useful as a trial length — but read the next line before treating it as one.',
    whenUnset:
      'The subscription has no renewal date at all. ⚠ That is also what it means when set: an `active` row entitles regardless of the date (§12.40), so this records an intention for a billing provider to act on and expires nothing on its own.',
  },
  {
    key: APP_DEFAULT.invitationExpiryDays,
    kind: 'days',
    moment: 'invitation_sent',
    label: 'How long an invitation stays valid',
    description:
      'Both kinds — joining an organization and joining the platform. ⚠ Expiry is DERIVED from this date on every read, not written into the row’s status, so shortening it retires invitations already sent as well as future ones.',
    whenUnset:
      'Seven days, the built-in figure: long enough to survive a holiday and a forwarded email, short enough that a mailbox compromised months later is not a way in.',
  },
  {
    key: APP_DEFAULT.workspaceCreatorRole,
    kind: 'workspace_role',
    moment: 'workspace_created',
    label: "Role for a workspace's creator",
    description: 'Granted inside the new workspace to whoever created it. Only workspace-level roles can be chosen.',
    whenUnset:
      'The creator is a member of the workspace — which is what lets them enter it at all (§12.33) — and holds no role there.',
  },
  {
    key: APP_DEFAULT.workspaceMemberRole,
    kind: 'workspace_role',
    moment: 'workspace_member_added',
    label: 'Role for a new workspace member',
    description:
      'Granted to somebody added to a workspace when the person adding them named no role. Whoever adds them may still choose one, and their choice wins.',
    whenUnset: 'They can enter the workspace and hold no role in it, which is the state §12.33 describes.',
  },
];

/** The spec for one key, or undefined for a key this build does not declare. */
export function appDefaultSpec(key: string): AppDefaultSpec | undefined {
  return APP_DEFAULT_REGISTRY.find((spec) => spec.key === key);
}

/**
 * The ROLE LEVEL a role-kinded default must point at, or null for a default
 * that does not point at a role.
 *
 * One function rather than the mapping written out at each call site: the
 * server validates against it, the screen filters its picker with it, and a
 * screen offering a level the server refuses is the mismatch one shared
 * declaration exists to prevent.
 */
export function appDefaultRoleLevel(kind: AppDefaultKind): 'app' | 'organization' | 'workspace' | null {
  if (kind === 'app_role') return 'app';
  if (kind === 'organization_role') return 'organization';
  if (kind === 'workspace_role') return 'workspace';
  return null;
}

/**
 * Whether a stored value is a sane shape for its kind.
 *
 * SHAPE only — it says nothing about whether the role exists or the plan is
 * archived, which needs the database and happens on the write. Here so the
 * screen can refuse an obviously bad value without a round trip, and so the
 * server has one place to reject `days: -3` however it arrived.
 *
 * `null` — clearing the default — is valid for every kind. Unset is a real
 * configuration, not a missing answer.
 */
export function isValidAppDefaultValue(kind: AppDefaultKind, value: string | null): boolean {
  if (value === null) return true;
  if (kind === 'subscription_status') return value === 'active' || value === 'past_due' || value === 'canceled';
  if (kind === 'days') {
    const days = Number(value);
    // A whole number of days, at least one. Zero would mean "a period that ends
    // the moment it starts", which is not a trial — it is a bug somebody typed.
    return Number.isInteger(days) && days >= 1 && days <= 3650;
  }
  // The role and plan kinds hold an id or a key; anything non-empty is a shape
  // the database can be asked about, and asking is the server's job.
  return value.trim().length > 0;
}
