import { DEFAULT_TIME_ZONE, zonedHour } from '@kwtech/module-kit';
import { scopePath } from '@kwtech/module-permissions';
import type { Viewport } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { greetingFor } from '@/components/mobile/greeting';
import { mobileDestinations } from '@/components/mobile/mobile-destinations';
import { getMobilePlace } from '@/components/mobile/mobile-place';
import { mobileRoute } from '@/components/mobile/mobile-routes';
import { MobileHome, MobileNotice, MobileScreenStage } from '@/components/mobile/mobile-screens';
import { MobileShell } from '@/components/mobile/mobile-shell';
import { initialView } from '@/components/mobile/mobile-view';
import { NotOnMobile } from '@/components/mobile/not-on-mobile';
import { PlacePicker } from '@/components/mobile/place-picker';

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

  // The place the address names — on a page the phone does not have too, so its bottom bar is that workspace's.
  const place = await getMobilePlace(
    route.kind === 'home' ? null : (route.organizationId ?? null),
    route.kind === 'workspace' || route.kind === 'elsewhere' ? (route.workspaceId ?? null) : null,
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

      // What the viewer may reach here — apps, Manage pages, Chat and Inbox — filtered by their keys at each level.
      const { screens, tabs } = await mobileDestinations(route.organizationId, route.workspaceId, { withNodes: true });
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
      <div className="mx-auto w-full max-w-lg md:max-w-2xl px-4 pt-2 pb-8">{children}</div>
    </div>
  );
}
