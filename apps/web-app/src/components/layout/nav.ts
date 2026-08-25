import { composeNav, type NavEntry } from '@kwtech/module-kit';
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
 * Group order, by name, because `composeNav` can only sort alphabetically and
 * "Administration" is not what should greet someone above "Overview".
 *
 * Anything not listed sorts after these, alphabetically — a new module's group
 * appears at the bottom rather than silently jumping to the top, and this array
 * is the one place to promote it.
 */
const GROUP_ORDER: readonly string[] = ['Overview', 'Administration'];

function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

/**
 * @param heldFeatures the caller's granted keys, or undefined when no
 * permission context could be resolved. Undefined is NOT "show everything":
 * `composeNav` treats it as "do not filter", so this passes an empty array in
 * that case and every keyed entry disappears. A drawer that fails open would
 * link a user straight to a page that turns them away, which is the exact
 * mismatch one shared key is supposed to prevent.
 */
export function buildNav(heldFeatures: readonly string[] | undefined): NavGroup[] {
  const entries = [...APP_NAV, ...composeNav(WEB_MODULES, heldFeatures ?? [])];

  entries.sort(
    (a, b) =>
      groupRank(a.group) - groupRank(b.group) ||
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
