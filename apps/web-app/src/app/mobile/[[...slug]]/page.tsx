import { DEFAULT_TIME_ZONE, zonedHour } from '@kwtech/module-kit';
import { scopePath } from '@kwtech/module-permissions';
import type { Viewport } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { greetingFor } from '@/components/mobile/greeting';
import { getMobilePlace } from '@/components/mobile/mobile-place';
import { mobileRoute } from '@/components/mobile/mobile-routes';
import {
  MobileHome,
  MobileNotice,
  type MobileScreenEntry,
  MobileScreenStage,
  type MobileTabEntry,
} from '@/components/mobile/mobile-screens';
import { MobileShell } from '@/components/mobile/mobile-shell';
import { initialView } from '@/components/mobile/mobile-view';
import { NotOnMobile } from '@/components/mobile/not-on-mobile';
import { PlacePicker } from '@/components/mobile/place-picker';
import { MOBILE_MANAGE, MOBILE_SCREENS, MOBILE_TABS } from '@/mobile-modules';

/**
 * Edge to edge: the bars pad themselves by the notch's and the home
 * indicator's insets, which are zero without `cover`.
 */
export const viewport: Viewport = { viewportFit: 'cover' };

/**
 * The PHONE page (issue #22). Nobody types this address: `proxy.ts` rewrites
 * a phone's `/` and `/organizations/...` here, and the address bar keeps the
 * one that was asked for. Opened directly (`/mobile/...`), it shows the phone
 * layout on any device, which is how it is looked at from a computer.
 *
 * ⚠ It imports `MOBILE_SCREENS`, never `WEB_MODULES`: the desktop pages are
 * what a phone is spared downloading. What the phone layout does not have
 * says so and offers the full site — it does not render the desktop page
 * squeezed, because that page is not in this bundle.
 *
 * Every link it draws is the plain address (`/organizations/...`), never
 * `/mobile/...`: the proxy picks the layout again on each request, so the
 * same link opens the right layout on whichever device follows it.
 */
export default async function MobilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug = [] }, query] = await Promise.all([params, searchParams]);
  const route = mobileRoute(slug);

  const place = await getMobilePlace(
    route.kind === 'organization' || route.kind === 'workspace' ? route.organizationId : null,
    route.kind === 'workspace' ? route.workspaceId : null,
  );
  const { snapshot, activeOrganizationId, activeWorkspaceId, workspaces, activeWorkspace } = place;
  const { viewer } = snapshot;
  const name = viewer ? (viewer.displayName ?? viewer.username) : null;
  // One instant for both lines, so the greeting and the date cannot straddle midnight.
  const now = new Date();
  const timeZone = activeWorkspace?.timeZone ?? DEFAULT_TIME_ZONE;
  const greeting = greetingFor(zonedHour(now, timeZone), name);

  switch (route.kind) {
    case 'home':
    case 'organization': {
      /*
       * Straight in when there is nothing to choose: from `/`, the remembered
       * or only workspace; from an organization's own address, only when it
       * has exactly one. Tapping an organization in the switcher is asking to
       * see its workspaces, so the remembered one does not skip that.
       */
      // `/?choose=organization` is the picker's "‹ Organizations": a request to choose, so nothing is chosen for them.
      const choosing = route.kind === 'home' && query.choose === 'organization';
      const straightIn =
        !choosing &&
        viewer &&
        activeOrganizationId &&
        activeWorkspaceId &&
        (route.kind === 'home' || workspaces.length === 1);
      if (straightIn) redirect(scopePath({ organizationId: activeOrganizationId, workspaceId: activeWorkspaceId }));

      const organization = snapshot.organizations.find((one) => one.organizationId === activeOrganizationId);
      return (
        <MobileShell place={place}>
          <PlacePicker
            greeting={greeting}
            organization={
              activeOrganizationId && !choosing
                ? { id: activeOrganizationId, name: organization?.organizationName ?? 'This organization' }
                : null
            }
            workspaces={workspaces.map((workspace) => ({
              id: workspace.id,
              name: workspace.name,
              detail: workspace.roleLabel,
            }))}
            organizations={snapshot.organizations.map((one) => ({
              id: one.organizationId,
              name: one.organizationName,
              detail: one.roleLabel,
            }))}
          />
        </MobileShell>
      );
    }

    case 'workspace': {
      // A workspace the viewer may not enter: say so here, the same refusal the API would give.
      if (activeWorkspaceId !== route.workspaceId || !activeWorkspace) {
        return (
          <MobileShell place={place}>
            <Scroll>
              <MobileNotice
                title="You can't open this workspace"
                body="It may have been archived, or you are no longer one of its members."
                action={null}
              />
            </Scroll>
          </MobileShell>
        );
      }

      /*
       * THE PERMISSION FILTER for the phone's apps, at workspace scope — the
       * reading the snapshot was taken at. An app shows only to somebody
       * holding its `feature`; each of its sections only to somebody holding
       * that section's (a section with none goes to everybody holding the
       * app). Fails closed: no context, nothing held, no apps. The frame
       * receives only what passed, so it cannot launch, pin or open from the
       * address anything else — and every app's API authorises again anyway.
       */
      const held = snapshot.permissions?.effective ?? [];
      const apps: MobileScreenEntry[] = MOBILE_SCREENS.filter((screen) => held.includes(screen.feature)).map(
        (screen) => ({
          key: screen.key,
          label: screen.label,
          icon: screen.icon,
          kind: 'app',
          sections: (screen.sections ?? [])
            .filter((section) => section.feature === undefined || held.includes(section.feature))
            .map((section) => ({ key: section.key, label: section.label })),
          node: <screen.component organizationId={route.organizationId} workspaceId={route.workspaceId} />,
        }),
      );
      /*
       * THE PERMISSION FILTER for the Manage tab: each page at ITS level's
       * reading — the workspace's effective grants (as for the apps), the
       * organization's effective grants (granted, cut to the plan, app roles
       * passing the plan as the guard lets them), or the app-level grants for
       * the platform. The same readings the desktop drawer filters each level
       * with. Fails closed: an unread level holds nothing.
       *
       * Keys are prefixed `manage.` in the frame so a page can never be taken
       * for an app of the same name in `?screen=`.
       */
      const heldAt = { workspace: held, organization: place.organizationEffective, app: place.appGranted };
      const manage: MobileScreenEntry[] = MOBILE_MANAGE.filter((page) => heldAt[page.level].includes(page.feature)).map(
        (page) => ({
          key: `manage.${page.key}`,
          label: page.label,
          icon: page.icon,
          kind: 'manage',
          level: page.level,
          sections: [],
          node: (
            <page.component
              organizationId={page.level === 'app' ? null : route.organizationId}
              workspaceId={page.level === 'workspace' ? route.workspaceId : null}
            />
          ),
        }),
      );
      const screens = [...apps, ...manage];
      /*
       * THE PERMISSION FILTER for the modules' bottom-bar tabs (Chat, Inbox):
       * APP-level grants, as the desktop header tools are filtered — a
       * person's chat is not a fact about the workspace that is open. A tab
       * with no `feature` is for everybody signed in.
       */
      const tabs: MobileTabEntry[] = MOBILE_TABS.filter(
        (tab) => tab.feature === undefined || place.appGranted.includes(tab.feature),
      ).map((tab) => ({
        key: tab.key,
        label: tab.label,
        icon: tab.icon,
        node: <tab.component />,
        badge: tab.badge ? <tab.badge /> : null,
      }));
      const param = (name: string) => (typeof query[name] === 'string' ? query[name] : undefined);
      const view = initialView(
        { tab: param('tab'), screen: param('screen'), section: param('section') },
        screens,
        tabs.map((tab) => tab.key),
      );

      return (
        <MobileShell place={place} screens={screens} tabs={tabs} initialView={view}>
          <MobileScreenStage
            places={{
              workspace: activeWorkspace.name,
              organization:
                snapshot.organizations.find((one) => one.organizationId === route.organizationId)?.organizationName ??
                'This organization',
            }}
            home={
              <MobileHome
                greeting={greeting}
                today={now.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone })}
                workspaceName={activeWorkspace.name}
              />
            }
          />
        </MobileShell>
      );
    }

    case 'elsewhere':
      return (
        <MobileShell place={place}>
          <NotOnMobile />
        </MobileShell>
      );
  }
}

function Scroll({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-lg px-4 pt-2 pb-8">{children}</div>
    </div>
  );
}
