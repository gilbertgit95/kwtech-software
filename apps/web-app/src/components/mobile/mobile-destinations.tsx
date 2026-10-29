import { getMobilePlace } from '@/components/mobile/mobile-place';
import type { MobileScreenEntry, MobileTabEntry } from '@/components/mobile/mobile-screens';
import { MOBILE_MANAGE, MOBILE_SCREENS, MOBILE_TABS } from '@/mobile-modules';

/**
 * Everything a viewer may reach from the phone's bottom bar in ONE workspace —
 * its apps, its Manage pages, and the person's own tabs (Chat, Inbox) — after
 * THE PERMISSION FILTER (issue #22), each at its own level:
 *
 *   apps        the workspace's effective grants: an app needs its `feature`,
 *               a section its own (a section with none goes to everybody
 *               holding the app);
 *   Manage      each page at ITS level's reading — the workspace's effective
 *               grants, the organization's (granted, cut to the plan, app
 *               roles passing the plan as the guard lets them), or the
 *               app-level grants for the platform; the readings the desktop
 *               drawer filters each level with;
 *   tabs        app-level grants, as the desktop header tools — a person's
 *               chat is not a fact about the workspace that is open. A tab
 *               with no `feature` is for everybody signed in.
 *
 * Fails closed: an unread level holds nothing. The frame receives only what
 * passed, so it cannot launch, pin or open anything else from the address —
 * and every module's API authorises again anyway.
 *
 * ONE function for both the workspace's own phone page (`withNodes`: the apps
 * and tabs rendered, to be mounted) and every other phone page that knows the
 * workspace (pickers, "not on the mobile view yet"), whose bottom bar LINKS to
 * the workspace page. Two copies of these rules would drift into two answers.
 *
 * The readings come from `getMobilePlace` at the workspace's scope — cached,
 * so on the workspace page itself this is no second request.
 *
 * Keys of Manage pages are prefixed `manage.` so one can never be taken for an
 * app of the same name in `?screen=`.
 */
export async function mobileDestinations(
  organizationId: string,
  workspaceId: string,
  { withNodes }: { withNodes: boolean },
): Promise<{ screens: MobileScreenEntry[]; tabs: MobileTabEntry[] }> {
  const place = await getMobilePlace(organizationId, workspaceId);
  const held = place.snapshot.permissions?.effective ?? [];

  const apps: MobileScreenEntry[] = MOBILE_SCREENS.filter((screen) => held.includes(screen.feature)).map((screen) => ({
    key: screen.key,
    label: screen.label,
    icon: screen.icon,
    kind: 'app',
    sections: (screen.sections ?? [])
      .filter((section) => section.feature === undefined || held.includes(section.feature))
      .map((section) => ({ key: section.key, label: section.label })),
    node: withNodes ? <screen.component organizationId={organizationId} workspaceId={workspaceId} /> : null,
  }));

  const heldAt = { workspace: held, organization: place.organizationEffective, app: place.appGranted };
  const manage: MobileScreenEntry[] = MOBILE_MANAGE.filter((page) => heldAt[page.level].includes(page.feature)).map(
    (page) => ({
      key: `manage.${page.key}`,
      label: page.label,
      icon: page.icon,
      kind: 'manage',
      level: page.level,
      sections: [],
      node: withNodes ? (
        <page.component
          organizationId={page.level === 'app' ? null : organizationId}
          workspaceId={page.level === 'workspace' ? workspaceId : null}
        />
      ) : null,
    }),
  );

  const tabs: MobileTabEntry[] = MOBILE_TABS.filter(
    (tab) => tab.feature === undefined || place.appGranted.includes(tab.feature),
  ).map((tab) => ({
    key: tab.key,
    label: tab.label,
    icon: tab.icon,
    node: withNodes ? <tab.component /> : null,
    // Always rendered: the badge is live, and the Inbox's is the phone's notification centre (toasts too).
    badge: tab.badge ? <tab.badge /> : null,
  }));

  return { screens: [...apps, ...manage], tabs };
}
