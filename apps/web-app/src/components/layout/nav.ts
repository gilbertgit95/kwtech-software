import {
  composeNav,
  composeNavGroups,
  type NavEntry,
  navGroupRank,
  type WebModuleDescriptor,
} from '@kwtech/module-kit';
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
export function buildNav(heldFeatures: readonly string[] | undefined): NavGroup[] {
  const entries = [...APP_NAV, ...composeNav(WEB_MODULES, heldFeatures ?? [])].filter(
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
