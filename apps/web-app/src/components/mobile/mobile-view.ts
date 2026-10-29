/**
 * Where a phone's workspace page opens, and which apps are pinned to Home
 * (issue #22). Pure rules over plain values, so the server page and the
 * client frame read them the same way.
 *
 * The bottom bar is FIXED destinations, never one tab per app: Home and Apps
 * today, Chat, Inbox and Manage as they arrive — five at most, and each only
 * when there is something behind it. Apps are launched from the Apps tab (or
 * a pin on Home) and open full screen with "‹ Apps" to leave. A bar that grew
 * a tab per app reshuffled itself every time an app was added, and ran out of
 * room at five.
 */

/**
 * A bottom-bar destination: the frame's own three, or a module's tab by its
 * key (`chat`, `inbox`). A module cannot take the frame's names —
 * `composeMobileTabs` refuses them — so the two never collide.
 */
export type MobileTab = 'home' | 'apps' | 'manage' | (string & {});

/**
 * How many destinations the bottom bar holds: five targets a thumb can hit
 * at a readable label. Home, Apps and Manage count against it when shown; a
 * module's tab past the limit is left off rather than squeezing every target.
 */
export const BOTTOM_BAR_SLOTS = 5;

export interface MobileView {
  /** The bottom-bar destination. While an app is open, the one it was opened from. */
  tab: MobileTab;
  /** The open app's key, or null for the tab itself. */
  app: string | null;
  /** The open app's section, or null for its first. */
  section: string | null;
}

/** What the frame needs to know about an app the viewer holds. */
export interface HeldApp {
  key: string;
  /** An app (Apps tab) or an administration page (Manage tab). */
  kind: 'app' | 'manage';
  sections: readonly { key: string }[];
}

/**
 * The view the address asks for (`?tab=apps`, `?screen=sell&section=orders`),
 * kept only where the viewer holds it. An app or section they do not hold —
 * an old link, a role that changed — opens the tab instead of nothing.
 */
export function initialView(
  query: { tab?: string | undefined; screen?: string | undefined; section?: string | undefined },
  held: readonly HeldApp[],
  /** The module tabs the viewer holds, by key. */
  tabs: readonly string[] = [],
): MobileView {
  // Manage, or a module's tab, only for somebody holding it: an old link opens Home rather than an empty tab.
  const tab: MobileTab =
    query.tab === 'apps' ||
    (query.tab === 'manage' && held.some((one) => one.kind === 'manage')) ||
    (query.tab !== undefined && tabs.includes(query.tab))
      ? query.tab
      : 'home';
  const app = held.find((one) => one.key === query.screen);
  if (!app) return { tab, app: null, section: null };
  const section = app.sections.some((one) => one.key === query.section) ? (query.section ?? null) : null;
  return { tab, app: app.key, section };
}

/** How many apps are pinned to Home before anybody chooses: a row of tiles. */
export const DEFAULT_PIN_COUNT = 3;

/**
 * The apps pinned to Home: the stored choice, kept to the apps the viewer
 * still holds, in the order they chose; or the first few in launcher order
 * when nothing is stored or the stored value is unreadable.
 *
 * An EMPTY stored list is a choice — everything unpinned — and is kept.
 */
export function pinnedApps(stored: string | null, held: readonly { key: string; kind: 'app' | 'manage' }[]): string[] {
  // Apps only: an administration page belongs to Manage and is never pinned to Home.
  const keys = held.filter((one) => one.kind === 'app').map((one) => one.key);
  const fallback = keys.slice(0, DEFAULT_PIN_COUNT);
  if (stored === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter((key): key is string => typeof key === 'string' && keys.includes(key));
  } catch {
    return fallback;
  }
}

/** The localStorage key for one workspace's pins. Per workspace: a till's pins mean nothing in the books' workspace. */
export function pinStorageKey(workspaceId: string): string {
  return `kwtech_mobile_pins:${workspaceId}`;
}
