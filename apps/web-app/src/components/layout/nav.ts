import {
  composeNav,
  composeNavGroups,
  type NavEntry,
  navGroupRank,
  type WebModuleDescriptor,
} from '@kwtech/module-kit';
import { ORGANIZATION_NAV_GROUP, WORKSPACE_NAV_GROUP } from '@kwtech/module-permissions/react';
import { WEB_MODULES } from '@/modules';

/**
 * The side drawer's contents.
 *
 * SERVER ONLY, and not by accident: `composeNav` reads WEB_MODULES, whose
 * descriptors hold every module's page components. Importing this from a
 * client component would drag all of them — RolesPage, the three auth pages —
 * into the browser bundle. The drawer is a client component, so it is handed
 * the finished array as plain data instead, which is also why every field here
 * is a string or a number.
 *
 * Two sources, one list:
 *
 *   - APP_NAV, below: pages this app owns itself. `/` is not a module's to
 *     contribute.
 *   - composeNav(WEB_MODULES): everything the composed modules contribute,
 *     already filtered against the caller's grants.
 *
 * GROUP PLACEMENT comes from the modules too, via `composeNavGroups`. It used to
 * be a hand-written array here, which meant adopting a module was a one-line
 * edit in @/modules PLUS a second edit nobody would think of — and forgetting it
 * silently dropped that module's group to the bottom of the drawer. Now the only
 * groups named in this file are the app's own.
 */

/** A `group` with its entries, in the order the drawer should render them. */
export interface NavGroup {
  group: string;
  items: NavEntry[];
}

/**
 * Pages owned by the application rather than by a module.
 *
 * No `feature`, so they survive the filter: the dashboard is what a signed-in
 * user with no grants at all still sees. A `feature` here would mean a user
 * could hold nothing and be shown an empty drawer.
 */
const APP_NAV: readonly NavEntry[] = [
  { group: 'Overview', order: 0, label: 'Dashboard', href: '/', icon: 'dashboard' },
];

/**
 * The app's OWN groups, declared in the same shape a module uses.
 *
 * A descriptor with no routes: `/` is a real Next page rather than a module
 * contribution, so it cannot be a `ModuleRoute` — but its GROUP can be placed by
 * exactly the same mechanism, which keeps one merging rule instead of two.
 *
 * 'Administration' and 'Account' are deliberately absent. They belong to
 * module-permissions and module-auth, and both now say so themselves.
 */
const APP_GROUPS: WebModuleDescriptor = {
  key: 'app',
  navGroups: [{ group: 'Overview', order: 10 }],
};

/**
 * Merged across every module plus this app, so a group nobody placed sorts last
 * rather than jumping to the top. Computed once at module scope: the modules do
 * not change between requests.
 */
const NAV_GROUPS = composeNavGroups([...WEB_MODULES, APP_GROUPS]);

/**
 * The group that renders in the ACCOUNT MENU rather than the side drawer.
 *
 * A module declares `nav: { group: 'Account' }` and does not care where that
 * lands — placement is the shell's business, and a module cannot know that this
 * app happens to have a header dropdown. So the declaration stays plain data and
 * this constant is the app's decision about where to put it.
 *
 * Why not the drawer: the drawer answers "what can I do here", and your own
 * profile is not a place in the application — it is a property of the person
 * using it. It belongs next to who you are, which is where the sign-out button
 * already lives.
 */
export const ACCOUNT_GROUP = 'Account';

/**
 * @param heldFeatures the caller's granted keys, or undefined when no
 * permission context could be resolved. Undefined is NOT "show everything":
 * `composeNav` treats it as "do not filter", so this passes an empty array in
 * that case and every keyed entry disappears. A drawer that fails open would
 * link a user straight to a page that turns them away, which is the exact
 * mismatch one shared key is supposed to prevent.
 */
export interface NavScopes {
  /** Grants AT APP LEVEL — filters `/admin/*` and this app's own pages. */
  app: readonly string[] | undefined;
  /** Grants IN THE SELECTED ORGANIZATION, or undefined when none is selected. */
  organization?: readonly string[] | undefined;
  /** Grants AT THE SELECTED WORKSPACE, or undefined when none is selected. */
  workspace?: readonly string[] | undefined;
  /**
   * Values for the `:params` in a route's path — `organizationId` and
   * `workspaceId` today.
   *
   * `composeNav` DROPS an entry whose parameters it cannot fill, which is what
   * makes the drawer drill into an organization and back out again without
   * anything having to declare that it switches: every `/organizations/:id/...`
   * entry simply has no href to be listed under until there is an active
   * organization, and then it has one.
   *
   * A partially-filled path is never produced — a link with `:organizationId`
   * still in it 404s, and one with the segment removed points at somebody
   * else's page.
   *
   * A plain param BAG rather than named fields, so a module contributing a
   * route with some other dynamic segment needs no change here.
   */
  params?: Readonly<Record<string, string | undefined>>;
}

/**
 * @param scopes one grant set per LEVEL, because the drawer spans three of them.
 *
 * An options object rather than four positional arguments: three of them are
 * `readonly string[] | undefined` and adjacent, which is the shape where a
 * transposed pair typechecks perfectly and filters the wrong section.
 */
export function buildNav(scopes: NavScopes): NavGroup[] {
  const { app: appFeatures, organization: organizationFeatures, workspace: workspaceFeatures, params = {} } = scopes;
  /*
   * ── EVERY ENTRY IS FILTERED AT THE LEVEL OF THE ROUTE IT POINTS AT ────────
   *
   * Three passes, and each grant set is genuinely wrong for the others' entries.
   *
   * `roles:read` and `subscriptions:read` are ORGANIZATION-level keys that also
   * gate `/admin/roles` and `/admin/subscriptions` — platform screens that
   * resolve at APP level, where an organization-level grant does not
   * participate. Filter the whole drawer with one organization-scoped context
   * and an organization admin is offered the platform's roles screen and
   * refused by it on arrival. That is precisely the mismatch one shared feature
   * key exists to prevent, and it was demonstrated before this split: the
   * drawer listed Administration while the page it linked to rendered a denial.
   *
   * The workspace pass exists for the opposite failure. A WORKSPACE-level key
   * hangs off a workspace membership, so an organization-scoped context does
   * not carry it — filtering that section with the organization's grants would
   * hide a page from exactly the people who hold the right to it.
   *
   * The split is by GROUP rather than by inspecting paths, because the group is
   * already the first-class marker for which area an entry belongs to — and
   * module-permissions' own suite asserts that every entry in each carries the
   * parameters that section needs, so the two cannot drift apart silently.
   */
  const scoped = new Set<string>([ORGANIZATION_NAV_GROUP, WORKSPACE_NAV_GROUP]);

  const appEntries = composeNav(WEB_MODULES, appFeatures ?? []).filter((entry) => !scoped.has(entry.group));

  /*
   * Each skipped entirely when nothing is selected at that level — `composeNav`
   * would drop the entries for want of a parameter anyway, so this only avoids
   * the work.
   */
  const organizationEntries = organizationFeatures
    ? composeNav(WEB_MODULES, organizationFeatures, { params }).filter(
        (entry) => entry.group === ORGANIZATION_NAV_GROUP,
      )
    : [];

  const workspaceEntries = workspaceFeatures
    ? composeNav(WEB_MODULES, workspaceFeatures, { params }).filter((entry) => entry.group === WORKSPACE_NAV_GROUP)
    : [];

  const entries = [...APP_NAV, ...appEntries, ...organizationEntries, ...workspaceEntries].filter(
    // Rendered by the account menu instead — see ACCOUNT_GROUP. Filtered here
    // rather than at the source so a module still declares one kind of thing.
    (entry) => entry.group !== ACCOUNT_GROUP,
  );

  entries.sort(
    (a, b) =>
      navGroupRank(NAV_GROUPS, a.group) - navGroupRank(NAV_GROUPS, b.group) ||
      // Two groups nobody placed both rank last; alphabetical keeps them stable
      // relative to each other rather than dependent on module list order.
      a.group.localeCompare(b.group) ||
      a.order - b.order ||
      a.label.localeCompare(b.label),
  );

  const groups: NavGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last?.group === entry.group) last.items.push(entry);
    else groups.push({ group: entry.group, items: [entry] });
  }
  return groups;
}

/**
 * The entries that belong in the account menu.
 *
 * Filtered against the caller's grants by the same `composeNav` call the drawer
 * uses, so an entry cannot appear in the menu that would be refused at the page
 * — the mismatch one shared feature key exists to prevent. The auth module's
 * two entries carry no key at all, deliberately: managing your own account is
 * not a grantable right.
 */
export function buildAccountNav(heldFeatures: readonly string[] | undefined): NavEntry[] {
  return composeNav(WEB_MODULES, heldFeatures ?? [])
    .filter((entry) => entry.group === ACCOUNT_GROUP)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
