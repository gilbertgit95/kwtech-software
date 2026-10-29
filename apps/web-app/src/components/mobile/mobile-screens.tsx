'use client';

import type { MobileManageLevel } from '@kwtech/module-kit';
import { MobileSectionProvider } from '@kwtech/module-kit/react';
import { cn } from '@kwtech/web-ui/react';
import {
  ArrowUpRight,
  Building2,
  ChevronRight,
  House,
  Layers,
  LayoutGrid,
  MonitorSmartphone,
  Pin,
  PinOff,
  Settings,
  Shield,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { switchLayout } from '@/components/layout/layout-switch';
import { iconFor } from '@/components/layout/nav-icons';
import {
  BOTTOM_BAR_SLOTS,
  type MobileTab,
  type MobileView,
  pinnedApps,
  pinStorageKey,
} from '@/components/mobile/mobile-view';

/**
 * An app as the phone frame holds it: its tile, its sections, and the app
 * itself ALREADY RENDERED on the server — `node`, not a component. A component
 * reference cannot be handed from the server page to this client frame as a
 * value; an element can, and the frame decides only whether to mount it.
 *
 * ⚠ ALREADY FILTERED BY PERMISSION. The server page builds these only from
 * the apps the viewer holds at this workspace, and each app's `sections` only
 * from the sections they hold. Nothing here decides access: an app that is
 * not in this list cannot be launched, pinned or opened from the address.
 */
export interface MobileScreenEntry {
  key: string;
  label: string;
  icon?: string | undefined;
  /** An app, launched from Apps; or an administration page, listed on Manage under its `level`. */
  kind: 'app' | 'manage';
  level?: MobileManageLevel | undefined;
  sections: readonly { key: string; label: string }[];
  node: ReactNode;
}

/**
 * A module's bottom-bar destination as the frame holds it — Chat, Inbox —
 * rendered on the server like an app: `node` is the destination, `badge`
 * what sits on its icon. Already filtered by the viewer's app-level grants.
 */
export interface MobileTabEntry {
  key: string;
  label: string;
  icon?: string | undefined;
  node: ReactNode;
  badge: ReactNode | null;
}

/** What the Manage tab heads its groups with: the open workspace's and organization's names. */
export interface ManagePlaceNames {
  workspace: string;
  organization: string;
}

interface ScreensState {
  /**
   * Null on the workspace's own phone page, where the frame moves between
   * destinations in place. Otherwise the workspace's address: on a page that
   * is NOT the workspace's (a picker, "not on the mobile view yet") the
   * bottom bar still shows, and each destination is a trip there.
   */
  linkBase: string | null;
  screens: readonly MobileScreenEntry[];
  /** Module destinations for the bottom bar, in order — at most what fits beside the frame's own. */
  tabs: readonly MobileTabEntry[];
  view: MobileView;
  /** The open section of each app that has sections, by app key. */
  sections: Readonly<Record<string, string>>;
  pins: readonly string[];
  goTab: (tab: MobileTab) => void;
  openApp: (key: string) => void;
  /** Leaves the open app, back to the tab it was opened from. */
  closeApp: () => void;
  openSection: (app: string, section: string) => void;
  togglePin: (key: string) => void;
}

const ScreensContext = createContext<ScreensState>({
  linkBase: null,
  screens: [],
  tabs: [],
  view: { tab: 'home', app: null, section: null },
  sections: {},
  pins: [],
  goTab: () => {},
  openApp: () => {},
  closeApp: () => {},
  openSection: () => {},
  togglePin: () => {},
});

/**
 * Where the person is on a workspace's phone page (issue #22): a bottom-bar
 * destination, the app open on top of it, and that app's section.
 *
 * STATE, not navigation, for the reason a sub-app moves between its own
 * screens in place: leaving an app must not unmount the till somebody is half
 * way through. Visited apps stay mounted and hidden. The address follows along
 * (`?tab=`, `?screen=`, `?section=`, by `replaceState`) so a reload — or a
 * phone that dropped the page from memory — comes back to the same place,
 * without a history entry per tap for Back to walk through.
 */
export function MobileScreensProvider({
  workspaceId,
  linkBase = null,
  screens,
  tabs: offered,
  initial,
  children,
}: {
  /** Whose pins: they are kept per workspace. Null outside one, where there are no apps. */
  workspaceId: string | null;
  /** See `ScreensState.linkBase`. */
  linkBase?: string | null;
  screens: readonly MobileScreenEntry[];
  tabs: readonly MobileTabEntry[];
  initial: MobileView;
  children: ReactNode;
}) {
  const [view, setView] = useState<MobileView>(initial);
  /*
   * Module tabs take what the frame's own destinations leave of the five
   * slots — Home always, Apps and Manage when shown. Past that a tab is left
   * off, never squeezed in: a sixth target would shrink all of them.
   */
  const ownSlots =
    1 + (screens.some((one) => one.kind === 'app') ? 1 : 0) + (screens.some((one) => one.kind === 'manage') ? 1 : 0);
  const tabs = useMemo(() => offered.slice(0, Math.max(0, BOTTOM_BAR_SLOTS - ownSlots)), [offered, ownSlots]);
  const [sections, setSections] = useState<Record<string, string>>(
    initial.app && initial.section ? { [initial.app]: initial.section } : {},
  );
  const [pins, setPins] = useState<readonly string[]>(() => pinnedApps(null, screens));

  /*
   * Pins live in THIS browser only (localStorage): which tiles sit on a
   * phone's Home is a convenience of the device, like the theme, and losing
   * them costs a tap. Read after mount — there is no storage on the server.
   */
  useEffect(() => {
    if (!workspaceId) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(pinStorageKey(workspaceId));
    } catch {
      // Storage refused (a private window): the defaults stand.
    }
    setPins(pinnedApps(stored, screens));
  }, [workspaceId, screens]);

  const show = useCallback((next: MobileView) => {
    setView(next);
    const url = new URL(window.location.href);
    for (const [name, value] of [
      // Home is the page's own address; every other destination is named.
      ['tab', next.tab === 'home' ? null : next.tab],
      ['screen', next.app],
      ['section', next.app ? next.section : null],
    ] as const) {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const router = useRouter();

  const value = useMemo<ScreensState>(
    () => ({
      linkBase,
      screens,
      tabs,
      view,
      sections,
      pins,
      goTab: (tab) => {
        // Not the workspace's own page: go there, opening the tab asked for.
        if (linkBase) {
          router.push(tab === 'home' ? linkBase : `${linkBase}?tab=${encodeURIComponent(tab)}`);
          return;
        }
        show({ tab, app: null, section: null });
      },
      openApp: (key) => show({ tab: view.tab, app: key, section: sections[key] ?? null }),
      closeApp: () => show({ tab: view.tab, app: null, section: null }),
      openSection: (app, section) => {
        setSections((current) => ({ ...current, [app]: section }));
        if (view.app === app) show({ ...view, section });
      },
      togglePin: (key) => {
        const next = pins.includes(key) ? pins.filter((one) => one !== key) : [...pins, key];
        setPins(next);
        if (!workspaceId) return;
        try {
          localStorage.setItem(pinStorageKey(workspaceId), JSON.stringify(next));
        } catch {
          // Not kept past this visit; the pin still shows now.
        }
      },
    }),
    [linkBase, router, screens, tabs, view, sections, pins, show, workspaceId],
  );
  return <ScreensContext.Provider value={value}>{children}</ScreensContext.Provider>;
}

export function useMobileScreens(): ScreensState {
  return useContext(ScreensContext);
}

/** The open app's entry, or null on a tab. */
export function useOpenApp(): MobileScreenEntry | null {
  const { screens, view } = useMobileScreens();
  return screens.find((screen) => screen.key === view.app) ?? null;
}

/**
 * What fills the space between the bars: Home, the Apps launcher, or an open
 * app full screen.
 *
 * An app is mounted the first time it is opened and kept from then on, so
 * opening the page costs only Home, and returning to an app finds it as it
 * was. Each app is wrapped in its own section context: the frame owns which
 * section is open, the app only reads it (`useMobileSection`).
 */
export function MobileScreenStage({ home, places }: { home: ReactNode; places: ManagePlaceNames }) {
  const { screens, tabs, view, sections, openSection } = useMobileScreens();
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set(view.app ? [view.app] : []));
  if (view.app && !visited.has(view.app)) setVisited(new Set([...visited, view.app]));
  // A module tab is mounted on its first visit and kept, like an app: a half-written message survives a trip to Home.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<string>>(() => new Set([view.tab]));
  if (!visitedTabs.has(view.tab)) setVisitedTabs(new Set([...visitedTabs, view.tab]));

  return (
    <>
      {/*
       * A short fade as each one shows: the animation replays whenever an
       * element goes from hidden to shown, so moving between them eases rather
       * than snaps. Nothing moves for somebody who asked for less motion.
       */}
      <div hidden={view.app !== null || view.tab !== 'home'} className={cn('h-full overflow-y-auto', SHOW)}>
        {home}
      </div>
      <div hidden={view.app !== null || view.tab !== 'apps'} className={cn('h-full overflow-y-auto', SHOW)}>
        <AppsLauncher />
      </div>
      <div hidden={view.app !== null || view.tab !== 'manage'} className={cn('h-full overflow-y-auto', SHOW)}>
        <ManageList places={places} />
      </div>
      {tabs.map((tab) =>
        visitedTabs.has(tab.key) ? (
          <section
            key={tab.key}
            hidden={view.app !== null || view.tab !== tab.key}
            aria-label={tab.label}
            className={cn('h-full', SHOW)}
          >
            {tab.node}
          </section>
        ) : null,
      )}
      {screens.map((screen) =>
        visited.has(screen.key) ? (
          <section
            key={screen.key}
            hidden={view.app !== screen.key}
            aria-label={screen.label}
            className={cn('h-full', SHOW)}
          >
            <MobileSectionProvider
              value={{
                section: sections[screen.key] ?? screen.sections[0]?.key ?? null,
                open: (section) => openSection(screen.key, section),
              }}
            >
              {screen.node}
            </MobileSectionProvider>
          </section>
        ) : null,
      )}
    </>
  );
}

const SHOW = 'animate-in fade-in duration-200 motion-reduce:animate-none';

/*
 * ── HOW THE FRAME WIDENS ON A TABLET ─────────────────────────────────────
 *
 * The phone layout also serves a tablet switched to it (and, by the same
 * page, a phone held sideways). A phone-width column centred on an iPad left
 * two wide empty margins and a bottom bar with its buttons a hand apart
 * (reported by the operator, 2026-10-29). So, by the SCREEN's width — the
 * frame owns the whole screen, unlike a sub-app, which lays out by its box:
 *
 *   - the bars span the screen; the bottom bar keeps its buttons together in
 *     the middle, at a fixed width each, as a tablet's tab bar does;
 *   - lists and forms widen to a reading width (`md:max-w-2xl`), never the
 *     full screen — a line across a whole iPad is too long to read;
 *   - tile grids use the room: Apps 3 → 4 → 6 columns, pinned 2 → 3 → 4;
 *   - sheets float as a card above the bottom edge instead of a full strip.
 *
 * `md` is a tablet upright (768px), `lg` a tablet on its side and up.
 */

/**
 * The open app's sections, as a strip of chips under the top bar — only the
 * ones the viewer holds, and only when there are two or more to choose from.
 * Swipeable sideways when they do not fit.
 */
export function MobileSectionStrip() {
  const app = useOpenApp();
  const { sections, openSection } = useMobileScreens();
  if (!app || app.sections.length < 2) return null;
  const current = sections[app.key] ?? app.sections[0]?.key;

  return (
    <nav
      aria-label={`${app.label} sections`}
      className="shrink-0 border-b border-border/60 bg-card/85 backdrop-blur-xl"
    >
      <ul className="mx-auto flex max-w-lg gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] md:max-w-none md:px-5">
        {app.sections.map((section) => (
          <li key={section.key} className="shrink-0">
            <button
              type="button"
              onClick={() => openSection(app.key, section.key)}
              aria-current={current === section.key ? 'page' : undefined}
              className={cn(
                'min-h-9 rounded-full px-4 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                current === section.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground active:bg-accent',
              )}
            >
              {section.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The bottom bar: FIXED destinations, never a tab per app (see `mobile-view.ts`).
 * Home, Apps, the modules' tabs (Chat, Inbox), then Manage. Each shows only
 * for somebody who has something behind it — Manage only when an
 * administration page passed its key at its level, a module's tab only for
 * somebody holding its app-level key.
 *
 * Nothing at all when there is nothing but Home: Home says what to do instead.
 */
export function MobileBottomNav() {
  const { linkBase, screens, tabs, view, goTab } = useMobileScreens();
  const app = useOpenApp();
  if (screens.length === 0 && tabs.length === 0) return null;

  /*
   * An open app belongs to Apps, an open administration page to Manage —
   * whichever tab it was reached from. On a page that is not the workspace's
   * own (`linkBase`), none is current: the page is none of them.
   */
  const workspaceTab: MobileTab = app ? (app.kind === 'manage' ? 'manage' : 'apps') : view.tab;
  const current: MobileTab | null = linkBase ? null : workspaceTab;
  const hasApps = screens.some((screen) => screen.kind === 'app');
  const canManage = screens.some((screen) => screen.kind === 'manage');

  return (
    <nav
      aria-label="Main"
      className="shrink-0 border-t border-border/60 bg-card/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-1 md:max-w-none md:justify-center md:gap-3">
        <BottomTab label="Home" icon={<House />} current={current === 'home'} onClick={() => goTab('home')} />
        {hasApps ? (
          <BottomTab label="Apps" icon={<LayoutGrid />} current={current === 'apps'} onClick={() => goTab('apps')} />
        ) : null}
        {tabs.map((tab) => {
          const Icon = iconFor(tab.icon);
          return (
            <BottomTab
              key={tab.key}
              label={tab.label}
              icon={<Icon />}
              badge={tab.badge}
              current={current === tab.key}
              onClick={() => goTab(tab.key)}
            />
          );
        })}
        {/* Only for somebody who passed at least one administration page's key at its level. */}
        {canManage ? (
          <BottomTab
            label="Manage"
            icon={<Settings />}
            current={current === 'manage'}
            onClick={() => goTab('manage')}
          />
        ) : null}
      </ul>
    </nav>
  );
}

function BottomTab({
  label,
  icon,
  badge = null,
  current,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  /** A module's live count. Outside the decorative icon, so its spoken sentence is heard. */
  badge?: ReactNode;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <li className="flex flex-1 md:w-28 md:flex-none">
      <button
        type="button"
        onClick={onClick}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'group flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[0.6875rem] font-medium',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          current ? 'text-primary' : 'text-muted-foreground active:text-foreground',
        )}
      >
        <span className="relative">
          {/* The pill behind the icon is the current tab's mark — colour alone would not carry it. */}
          <span
            aria-hidden
            className={cn(
              'grid h-8 w-14 place-items-center rounded-full transition-all duration-200 [&>svg]:size-5',
              current ? 'bg-primary/12 [&>svg]:stroke-[2.25]' : 'group-active:bg-accent',
            )}
          >
            {icon}
          </span>
          {badge ? <span className="absolute -top-1 right-2">{badge}</span> : null}
        </span>
        <span className="max-w-full truncate px-1">{label}</span>
      </button>
    </li>
  );
}

/**
 * Every app the viewer holds here, as tiles. Each tile has a pin: pinned apps
 * also sit on Home, one tap from opening the page.
 */
function AppsLauncher() {
  const { screens: all, pins, openApp, togglePin } = useMobileScreens();
  const screens = all.filter((screen) => screen.kind === 'app');

  return (
    <div className="mx-auto w-full max-w-lg md:max-w-3xl lg:max-w-5xl px-4 pt-6 pb-10 md:px-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">Apps</h1>
      <p className="mt-1 text-sm text-muted-foreground">Tap the pin on the ones you use most to keep them on Home.</p>

      <ul className="mt-6 grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-6">
        {screens.map((screen, index) => {
          const Icon = iconFor(screen.icon);
          const pinned = pins.includes(screen.key);
          return (
            <li
              key={screen.key}
              style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
              className="relative animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300 motion-reduce:animate-none"
            >
              <button
                type="button"
                onClick={() => openApp(screen.key)}
                className={cn(
                  'flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-3xl border border-border/70 p-2 shadow-sm',
                  'bg-gradient-to-br from-primary/10 via-card to-card',
                  'transition-all active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <span
                  aria-hidden
                  className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-md"
                >
                  <Icon className="size-6" />
                </span>
                <span className="max-w-full truncate text-sm font-medium text-card-foreground">{screen.label}</span>
              </button>
              <button
                type="button"
                onClick={() => togglePin(screen.key)}
                aria-pressed={pinned}
                aria-label={pinned ? `Unpin ${screen.label} from Home` : `Pin ${screen.label} to Home`}
                className={cn(
                  'absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-full transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  pinned ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground/70 active:bg-accent',
                )}
              >
                <Pin aria-hidden className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The Manage tab: the administration pages the viewer passed, grouped by the
 * level each changes — this workspace, its organization, the platform — so
 * nobody edits an organization's roles thinking they are changing one
 * workspace. A row opens its page full screen, with "‹ Manage" to return.
 */
function ManageList({ places }: { places: ManagePlaceNames }) {
  const { screens, openApp } = useMobileScreens();
  const pages = screens.filter((screen) => screen.kind === 'manage');

  const groups: { level: MobileManageLevel; title: string; caption: string; icon: typeof Layers }[] = [
    { level: 'workspace', title: 'Workspace', caption: places.workspace, icon: Layers },
    { level: 'organization', title: 'Organization', caption: places.organization, icon: Building2 },
    { level: 'app', title: 'Platform', caption: 'Every organization', icon: Shield },
  ];

  return (
    <div className="mx-auto w-full max-w-lg md:max-w-2xl space-y-4 px-4 pt-6 pb-10">
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">Manage</h1>
        <p className="mt-1 text-sm text-muted-foreground">Settings and people, by where they apply.</p>
      </div>
      {groups.map((group) => {
        const rows = pages.filter((page) => page.level === group.level);
        if (rows.length === 0) return null;
        return (
          <section
            key={group.level}
            aria-label={group.title}
            className="animate-in fade-in slide-in-from-bottom-2 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm duration-300 motion-reduce:animate-none"
          >
            <header className="flex items-center gap-3 px-4 pt-4 pb-3">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-sm"
              >
                <group.icon className="size-[1.125rem]" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-tight text-foreground">{group.title}</h2>
                <p className="truncate text-xs text-muted-foreground">{group.caption}</p>
              </div>
            </header>
            <ul className="space-y-1 px-2 pb-2">
              {rows.map((page) => {
                const Icon = iconFor(page.icon);
                return (
                  <li key={page.key}>
                    <button
                      type="button"
                      onClick={() => openApp(page.key)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-all active:scale-[0.99] active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        aria-hidden
                        className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-card-foreground">
                        {page.label}
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * A workspace's Home tab: the date and a greeting, then the pinned apps.
 *
 * When the viewer holds no app it says so and offers the full site, rather
 * than an empty grid: their role may well hold things the phone layout does
 * not have yet, and that is the place to find them.
 */
export function MobileHome({
  greeting,
  today,
  workspaceName,
}: {
  greeting: string;
  /** "Thursday, 29 October", in the workspace's zone — written on the server, which knows it. */
  today: string;
  workspaceName: string;
}) {
  const { screens: all, tabs, pins, openApp, goTab } = useMobileScreens();
  const screens = all.filter((screen) => screen.kind === 'app');
  const pinned = pins
    .map((key) => screens.find((screen) => screen.key === key))
    .filter((screen): screen is MobileScreenEntry => screen !== undefined);

  return (
    <div className="mx-auto w-full max-w-lg md:max-w-3xl lg:max-w-5xl px-4 pt-6 pb-10 md:px-6">
      <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{today}</p>
        <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">{greeting}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{workspaceName}</p>
      </div>

      {screens.length === 0 && all.length > 0 ? (
        // No apps, but administration: say where it is rather than that there is nothing.
        <button
          type="button"
          onClick={() => goTab('manage')}
          className="mt-7 flex w-full items-center gap-3 rounded-3xl border border-border/70 bg-card p-5 text-left shadow-sm transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-sm"
          >
            <Settings className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-semibold text-card-foreground">Manage</span>
            <span className="block text-xs text-muted-foreground">Settings and people for this workspace</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : null}
      {all.length === 0 ? (
        /*
         * No app and no administration page. Say exactly that — with Chat or
         * the Inbox in the bar below, "nothing for you" would be untrue.
         */
        <MobileNotice
          title={
            tabs.length > 0 ? 'No workspace apps on the mobile view yet' : 'Nothing on the mobile view for you yet'
          }
          body={
            tabs.length > 0
              ? `${tabs.map((tab) => tab.label).join(' and ')} ${tabs.length === 1 ? 'is' : 'are'} in the bar below. This workspace's apps are on the full site for now.`
              : 'Your role may still hold things this workspace offers on the full site.'
          }
          action="full_site"
        />
      ) : null}
      {screens.length > 0 ? (
        <section className="mt-7" aria-labelledby="pinned-heading">
          <div className="flex items-center justify-between">
            <h2 id="pinned-heading" className="text-sm font-semibold text-foreground">
              Pinned
            </h2>
            <button
              type="button"
              onClick={() => goTab('apps')}
              className="flex min-h-9 items-center gap-0.5 rounded-full px-2 text-sm font-medium text-primary active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              All apps
              <ArrowUpRight aria-hidden className="size-3.5" />
            </button>
          </div>
          {pinned.length > 0 ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
              {pinned.map((screen, index) => (
                <PinnedTile key={screen.key} screen={screen} index={index} onOpen={() => openApp(screen.key)} />
              ))}
            </ul>
          ) : (
            <button
              type="button"
              onClick={() => goTab('apps')}
              className="mt-3 flex w-full items-center gap-3 rounded-3xl border border-dashed border-border p-5 text-left text-sm text-muted-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PinOff aria-hidden className="size-5 shrink-0" />
              Nothing pinned. Open Apps and tap the pin on the ones you use most.
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PinnedTile({ screen, index, onOpen }: { screen: MobileScreenEntry; index: number; onOpen: () => void }) {
  const Icon = iconFor(screen.icon);
  return (
    <li
      // One after another, a beat apart: the grid assembles rather than appearing at once.
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300 motion-reduce:animate-none"
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group flex aspect-[5/4] w-full flex-col justify-between overflow-hidden rounded-3xl border border-border/70 p-4 text-left shadow-sm',
          'bg-gradient-to-br from-primary/10 via-card to-card',
          'transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span
          aria-hidden
          className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-md"
        >
          <Icon className="size-6" />
        </span>
        <span className="flex items-end justify-between gap-2">
          <span className="text-base font-semibold tracking-tight text-card-foreground">{screen.label}</span>
          <ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </span>
      </button>
    </li>
  );
}

/**
 * Whether this device may switch to the full site — false on a phone, which
 * always gets the phone layout (`canUseFullSite`) — and whose choice a switch
 * saves (the signed-in person: the choice is per person on each device).
 * Provided by the shell from the request. NOTHING without a provider: an
 * unknown device is not offered a way onto a layout it may not be allowed.
 */
const FullSiteContext = createContext<{ allowed: boolean; userId: string | null }>({ allowed: false, userId: null });

export function FullSiteProvider({
  allowed,
  userId,
  children,
}: {
  allowed: boolean;
  userId: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ allowed, userId }), [allowed, userId]);
  return <FullSiteContext.Provider value={value}>{children}</FullSiteContext.Provider>;
}

/** Whether to offer "Use full site" / "Open full site" here. */
export function useCanUseFullSite(): boolean {
  const { allowed, userId } = useContext(FullSiteContext);
  return allowed && userId !== null;
}

/** Switches the signed-in person, on this device, to the full site. Does nothing where it is not offered. */
export function useOpenFullSite(): () => void {
  const { allowed, userId } = useContext(FullSiteContext);
  return useCallback(() => {
    if (allowed && userId) switchLayout('full', userId);
  }, [allowed, userId]);
}

/**
 * A plain card that says why there is nothing here, and what to do: the
 * empty Home, a page the phone layout does not have, no workspace to open.
 *
 * On a phone, which may not open the full site, a `full_site` notice says to
 * use a computer instead of offering a button that would do nothing.
 */
export function MobileNotice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  /** `full_site` offers the switch; null offers nothing — there is nothing for the full site to add. */
  action: 'full_site' | null;
}) {
  const canUseFullSite = useCanUseFullSite();
  const openFullSite = useOpenFullSite();
  return (
    <div className="mx-auto mt-6 max-w-xl animate-in fade-in slide-in-from-bottom-2 rounded-3xl border border-border/70 bg-card p-7 text-center shadow-sm duration-300 motion-reduce:animate-none">
      <span
        aria-hidden
        className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/10"
      >
        <MonitorSmartphone className="size-7" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {action === 'full_site' && !canUseFullSite ? (
        <p className="mt-4 text-xs font-medium text-muted-foreground">Open it on a computer to use it.</p>
      ) : null}
      {action === 'full_site' && canUseFullSite ? (
        <button
          type="button"
          onClick={openFullSite}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Open full site
        </button>
      ) : null}
    </div>
  );
}
