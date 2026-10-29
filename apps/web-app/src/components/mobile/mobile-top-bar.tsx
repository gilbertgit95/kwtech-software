'use client';

import type { Viewer } from '@kwtech/module-auth';
import { DisplayMobilePanel, PasswordMobilePanel, ProfileMobilePanel } from '@kwtech/module-auth/mobile';
import { FeatureAccessProvider } from '@kwtech/module-kit/react';
import { ALargeSmall, ChevronDown, ChevronLeft, KeyRound, LogOut, Monitor, Smartphone, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { isRunningInstalled } from '@/components/install/install-platform';
import { Avatar, initialsOf } from '@/components/layout/avatar';
import { switchLayout } from '@/components/layout/layout-switch';
import { MobileAppearance } from '@/components/mobile/mobile-appearance';
import { useCanUseFullSite, useMobileScreens, useOpenApp } from '@/components/mobile/mobile-screens';
import { MobilePanel, MobileSheet, SheetRow } from '@/components/mobile/mobile-sheet';
import type { MobileTab } from '@/components/mobile/mobile-view';
import { PlaceSheet } from '@/components/mobile/place-sheet';

/** Plain data, built on the server: the frame is a client component. */
export interface MobilePlace {
  id: string;
  name: string;
  /** The viewer's role there, as the desktop switcher shows it. */
  detail?: string | null;
}

/**
 * The phone layout's top bar (issue #22): where you are on the left, who you
 * are on the right.
 *
 * - **Where:** the workspace's name — or the open screen's, with the
 *   workspace under it — as a button that opens the switcher. Changing
 *   workspace is the one navigation a seller does, so it is one tap from
 *   every screen rather than in a menu.
 * - **Who:** the account sheet: theme, the full site, install, sign out.
 *
 * Translucent over the content, and padded by the notch's inset: the page
 * opts into `viewport-fit=cover`, so without the padding the bar would sit
 * under the status bar on an iPhone.
 */
export function MobileTopBar({
  brandName,
  viewer,
  account,
  accountGrants,
  organizations,
  workspaces,
  activeOrganizationId,
  activeWorkspaceId,
}: {
  brandName: string;
  viewer: { name: string | null; email: string };
  /** The signed-in account, for the Profile panel. */
  account: Viewer;
  /**
   * The viewer's APP-level effective keys, for the account panels:
   * `account:profile_write` is app level, and the frame's own feature context
   * is read at the page's scope (a workspace), which is not where it lives.
   */
  accountGrants: readonly string[];
  organizations: readonly MobilePlace[];
  /** The ACTIVE organization's workspaces that the viewer may enter. */
  workspaces: readonly MobilePlace[];
  activeOrganizationId: string | null;
  activeWorkspaceId: string | null;
}) {
  const { view, closeApp } = useMobileScreens();
  const app = useOpenApp();
  const [sheet, setSheet] = useState<'place' | 'account' | null>(null);
  const [panel, setPanel] = useState<AccountPanel | null>(null);
  const router = useRouter();

  const organization = organizations.find((one) => one.id === activeOrganizationId) ?? null;
  const workspace = workspaces.find((one) => one.id === activeWorkspaceId) ?? null;
  const heading = workspace?.name ?? organization?.name ?? brandName;
  const subheading = workspace ? (organization?.name ?? null) : null;

  return (
    <>
      <header className="shrink-0 border-b border-border/60 bg-card/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-2 px-2">
          {app ? (
            /*
             * INSIDE AN APP the left side is the way out, not the switcher:
             * "‹ Apps" (or "‹ Home", wherever it was opened from) and the
             * app's name. Switching workspace from inside an app would leave
             * it anyway, and one back control in one place is what makes the
             * way out obvious.
             */
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={closeApp}
                className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-full pr-2.5 pl-1 text-sm font-medium text-primary transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft aria-hidden className="size-5" />
                {BACK_LABEL[view.tab] ?? 'Back'}
              </button>
              <h1 className="truncate text-base font-semibold tracking-tight text-foreground">{app.label}</h1>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSheet('place')}
              aria-label={`${heading}${subheading ? `, ${subheading}` : ''}. Switch workspace or organization`}
              className="flex min-w-0 items-center gap-2.5 rounded-2xl py-1.5 pr-2 pl-1.5 text-left transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/*
               * The place's badge: its initials on the palette's colour. Where the
               * person is, recognised at a glance before the name is read — and
               * the same badge whichever screen is open, while the title changes.
               */}
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-xs font-semibold tracking-tight text-primary-foreground shadow-sm"
              >
                {initialsOf(workspace?.name ?? organization?.name ?? brandName, '')}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold leading-tight tracking-tight text-foreground">
                  {heading}
                </span>
                {subheading ? (
                  <span className="block truncate text-xs leading-tight text-muted-foreground">{subheading}</span>
                ) : null}
              </span>
              <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setSheet('account')}
            aria-label="Account"
            className="grid size-11 shrink-0 place-items-center rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar initials={initialsOf(viewer.name, viewer.email)} className="size-8 text-xs" />
          </button>
        </div>
      </header>

      <PlaceSheet
        open={sheet === 'place'}
        onClose={() => setSheet(null)}
        organizations={organizations}
        workspaces={workspaces}
        activeOrganizationId={activeOrganizationId}
        activeWorkspaceId={activeWorkspaceId}
      />
      <AccountSheet
        open={sheet === 'account'}
        onClose={() => setSheet(null)}
        viewer={viewer}
        onOpenPanel={(next) => {
          setSheet(null);
          setPanel(next);
        }}
      />
      {/*
       * The account panels, over everything, with app-level keys: the profile
       * write is an app-level key the page's own (workspace) context does not
       * carry. Closing a panel re-reads the page, so a new display name shows
       * in this bar at once.
       */}
      <FeatureAccessProvider value={accountGrants}>
        <MobilePanel
          open={panel !== null}
          onClose={() => {
            setPanel(null);
            router.refresh();
          }}
          title={panel ? PANEL_TITLE[panel] : ''}
          backLabel="Account"
        >
          {panel === 'profile' ? <ProfileMobilePanel viewer={account} /> : null}
          {panel === 'password' ? <PasswordMobilePanel /> : null}
          {panel === 'display' ? <DisplayMobilePanel /> : null}
        </MobilePanel>
      </FeatureAccessProvider>
    </>
  );
}

function AccountSheet({
  open,
  onClose,
  viewer,
  onOpenPanel,
}: {
  open: boolean;
  onClose: () => void;
  viewer: { name: string | null; email: string };
  onOpenPanel: (panel: AccountPanel) => void;
}) {
  const canUseFullSite = useCanUseFullSite();
  const signOutForm = useRef<HTMLFormElement>(null);
  // As in the desktop menu: no "Install app" inside the installed app. Decided after mount; the server cannot know.
  const [installed, setInstalled] = useState(false);
  useEffect(() => setInstalled(isRunningInstalled()), []);

  return (
    <MobileSheet open={open} onClose={onClose} title="Account">
      {/* A real form POST, as the desktop menu's: signing out revokes the session, and a GET must not. */}
      <form ref={signOutForm} action="/api/auth/signout" method="post" className="hidden" />
      <div className="flex items-center gap-3 px-3 py-3">
        <Avatar initials={initialsOf(viewer.name, viewer.email)} className="size-11 text-sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{viewer.name?.trim() || 'Signed in'}</p>
          <p className="truncate text-xs text-muted-foreground">{viewer.email}</p>
        </div>
      </div>
      {/* The account's own settings, on the phone: a phone may not open the full site's pages. */}
      <SheetGroup label="Your account">
        <SheetRow icon={<User className="size-5" />} label="Profile" onClick={() => onOpenPanel('profile')} />
        <SheetRow icon={<KeyRound className="size-5" />} label="Password" onClick={() => onOpenPanel('password')} />
        <SheetRow
          icon={<ALargeSmall className="size-5" />}
          label="Display"
          detail="Text size and spacing on phones"
          onClick={() => onOpenPanel('display')}
        />
      </SheetGroup>
      <SheetGroup label="Appearance">
        <MobileAppearance />
      </SheetGroup>
      <SheetGroup label="This device">
        {/* Not on a phone: a phone always gets the phone layout (`canUseFullSite`). */}
        {canUseFullSite ? (
          <SheetRow icon={<Monitor className="size-5" />} label="Use full site" onClick={() => switchLayout('full')} />
        ) : null}
        {installed ? null : <SheetRow icon={<Smartphone className="size-5" />} label="Install app" href="/install" />}
      </SheetGroup>
      <div className="mt-1 border-t border-border pt-1">
        <SheetRow
          icon={<LogOut className="size-5" />}
          label="Sign out"
          tone="danger"
          onClick={() => signOutForm.current?.requestSubmit()}
        />
      </div>
    </MobileSheet>
  );
}

function SheetGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * "‹ Apps", "‹ Home", "‹ Manage": back to the tab the open app or page was
 * reached from. Only these three open anything; a module's tab never does.
 */
const BACK_LABEL: Readonly<Record<MobileTab, string | undefined>> = { home: 'Home', apps: 'Apps', manage: 'Manage' };

/** The account's settings on the phone, each a full-screen panel from the account sheet. */
type AccountPanel = 'profile' | 'password' | 'display';

const PANEL_TITLE: Record<AccountPanel, string> = { profile: 'Profile', password: 'Password', display: 'Display' };
