'use client';

import { cn, Tooltip } from '@kwtech/web-ui/react';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import type { NavGroup } from '@/components/layout/nav';
import { iconFor } from '@/components/layout/nav-icons';
import { OrganizationSwitcher, type SwitcherOrganization } from '@/components/layout/organization-switcher';
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH,
  writeSidebarCookie,
  writeSidebarWidthCookie,
} from '@/components/layout/sidebar-state';
import { type SwitcherWorkspace, WorkspaceSwitcher } from '@/components/layout/workspace-switcher';

interface SidebarProps {
  /**
   * Built and filtered on the server (see nav.ts). Plain data, deliberately:
   * the module descriptors this is derived from carry page components that
   * must not cross into the browser bundle.
   */
  groups: NavGroup[];
  /** Read from the cookie by the shell, so the first paint is already correct. */
  defaultCollapsed: boolean;
  /** The expanded width in pixels, from its cookie, already clamped. */
  defaultWidth: number;
  /**
   * The product name and its second line, from APP_NAME / APP_TAGLINE.
   *
   * A PROP, not a `NEXT_PUBLIC_` read. This is a client component, so the only
   * way it could read the environment itself is a build-time inline — which
   * would mean one built image could never run under two names, and renaming
   * the product would need a rebuild rather than a restart.
   */
  brand: { name: string; tagline: string | null };
  /**
   * The viewer's organizations, for the switcher that replaced the brand row.
   *
   * Passed in rather than fetched: the shell already asks for them on every
   * render, and fetching in here would flash an empty menu on first paint.
   */
  organizations: readonly SwitcherOrganization[];
  /**
   * The selected organization when it is not one of the viewer's own — see the
   * switcher. Null for everybody who is a member of the one they are in.
   */
  activeOrganizationFallback: SwitcherOrganization | null;
  /**
   * What the plan's hover card shows beyond its name and icon — how much the
   * plan carries, and whether this reader may open the subscription screen.
   *
   * About the SELECTED organization only, which is the one the mark draws.
   */
  organizationPlanDetail: { entitlements: number | null; canReadSubscription: boolean } | null;
  /**
   * The SELECTED organization's workspaces that the viewer may ENTER — not
   * every workspace it has. Empty when no organization is selected, which is
   * what leaves the workspace selector disabled.
   */
  workspaces: readonly SwitcherWorkspace[];
  /** The selected workspace, or null. Null again the moment the organization changes. */
  activeWorkspaceId: string | null;
  /**
   * Whether the viewer may create a workspace IN the selected organization —
   * `workspaces:create`, read from the organization-scoped half of their
   * grants. It is what puts "New workspace" in the workspace selector, and
   * leaving it out is what keeps the menu honest for a member who may enter
   * workspaces and not make them.
   */
  canCreateWorkspace: boolean;
  /**
   * Which one the current URL is inside, or null.
   *
   * Read on the SERVER by `parseScope`, not derived from `usePathname()` here.
   * The convention that decides this is the same one the API's guard reads, and
   * a second implementation of it in a client component is exactly the fork
   * `scope.ts` exists to prevent — a drawer that disagreed with the guard about
   * which tenant a URL names would highlight one organization while the page
   * showed another's data.
   */
  activeOrganizationId: string | null;
}

function isActive(pathname: string, href: string): boolean {
  // '/' would prefix-match every route in the app, so it is exact-only.
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  groups,
  defaultCollapsed,
  defaultWidth,
  brand,
  organizations,
  activeOrganizationId,
  activeOrganizationFallback,
  organizationPlanDetail,
  workspaces,
  activeWorkspaceId,
  canCreateWorkspace,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const [width, setWidth] = useState(defaultWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; fromX: number; start: number } | null>(null);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCookie(next);
  }

  function resizeTo(next: number) {
    const clamped = clampSidebarWidth(next);
    setWidth(clamped);
    writeSidebarWidthCookie(clamped);
  }

  /*
   * The cookie is written once, on release, not on every move: a drag emits a
   * pointer event per frame, and each write is a `document.cookie` assignment
   * that nothing reads until the next server render anyway.
   */
  function onResizeStart(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // Stops the press from starting a text selection across the page beside it.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, fromX: event.clientX, start: width };
    setResizing(true);
  }

  function onResizeMove(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setWidth(clampSidebarWidth(active.start + event.clientX - active.fromX));
  }

  function onResizeEnd(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    resizeTo(active.start + event.clientX - active.fromX);
  }

  /*
   * The keyboard half of the handle, so resizing is not a mouse-only feature:
   * arrows step, Shift steps further, Home and End go to the bounds — the keys
   * the WAI-ARIA window-splitter pattern names.
   */
  function onResizeKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16;
    const targets: Record<string, number> = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: SIDEBAR_WIDTH.min,
      End: SIDEBAR_WIDTH.max,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    resizeTo(next);
  }

  return (
    <nav
      aria-label="Main"
      data-collapsed={collapsed ? '' : undefined}
      /*
       * Inline only while expanded: the collapsed width is the class below,
       * and an inline width would override it.
       */
      style={collapsed ? undefined : { width }}
      className={cn(
        // max-w keeps a width chosen on a wide monitor from swallowing a laptop screen.
        'group/sidebar relative flex max-w-[50vw] shrink-0 flex-col border-r border-border bg-card py-4',
        /*
         * No transition while dragging. The 300ms ease is for the collapse
         * toggle; applied to a drag it makes the edge trail the pointer.
         */
        resizing ? 'select-none' : 'transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        collapsed ? 'w-16 px-2' : 'px-3',
      )}
    >
      {/*
       * THE RESIZE HANDLE: the drawer's right border, widened to an 8px hit
       * area that straddles it. Below the collapse button (z-10 against its
       * z-20), so the button stays clickable where the two overlap.
       *
       * Not rendered while collapsed. The collapsed drawer is a fixed rail of
       * icons, and a width you could drag it to would be a third state nobody
       * asked for. Double-click puts the default back.
       */}
      {collapsed ? null : (
        <Tooltip text="Drag to resize · double-click to reset" side="right">
          {(tooltip) => (
            // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or pointer events; a focusable separator is the ARIA window-splitter pattern.
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize navigation"
              aria-controls="main-nav"
              aria-valuenow={width}
              aria-valuemin={SIDEBAR_WIDTH.min}
              aria-valuemax={SIDEBAR_WIDTH.max}
              tabIndex={0}
              {...tooltip}
              // Both, for the two events the handle and the hint each listen to: a later prop replaces the spread one.
              onPointerDown={(event) => {
                tooltip.onPointerDown();
                onResizeStart(event);
              }}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
              onKeyDown={(event) => {
                tooltip.onKeyDown(event);
                onResizeKey(event);
              }}
              onDoubleClick={() => resizeTo(SIDEBAR_WIDTH.default)}
              className={cn(
                // touch-none: a finger dragging the edge resizes instead of scrolling.
                'absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none',
                'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors',
                'hover:after:bg-primary/40 focus-visible:outline-none focus-visible:after:bg-ring',
                resizing && 'after:bg-primary/60',
              )}
            />
          )}
        </Tooltip>
      )}
      {/*
       * The handle sits ON the edge it moves, half outside the panel, rather
       * than tucked inside the header. It is the affordance for the border it
       * straddles, so there is nothing to hunt for and nothing to explain —
       * and unlike a header button it never has to be re-centred or hidden
       * when the panel narrows.
       *
       * Always visible, not revealed on hover: hiding it is the fashionable
       * choice and it makes the control undiscoverable on a touch screen.
       */}
      <Tooltip text={collapsed ? 'Expand navigation' : 'Collapse navigation'} side="right" describes={false}>
        {(tooltip) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="main-nav"
            className={cn(
              // top-[1.125rem] is not arbitrary: py-4 (16px) plus half the 28px
              // brand mark puts that mark's centre at 30px, and a 24px handle
              // centres there at 18px — so the handle reads as belonging to the
              // first row rather than floating near it.
              'absolute -right-3 top-[1.125rem] z-20 grid size-6 place-items-center rounded-full',
              'border border-border bg-card text-muted-foreground shadow-sm',
              'transition-[transform,color,border-color,box-shadow] duration-200 ease-out',
              'hover:scale-110 hover:border-primary/40 hover:text-foreground hover:shadow-md',
              'active:scale-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
            {...tooltip}
          >
            {/*
             * One chevron that turns, not two icons that swap. A swap is a cut;
             * the rotation runs the same 300ms as the panel's width, so the arrow
             * and the edge it points at move together.
             */}
            <ChevronLeft
              aria-hidden
              className={cn(
                'size-3.5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
                collapsed && 'rotate-180',
              )}
            />
            <span className="sr-only">{collapsed ? 'Expand navigation' : 'Collapse navigation'}</span>
          </button>
        )}
      </Tooltip>

      {/*
        THE SWITCHER SITS WHERE THE BRAND USED TO.
        
        The product name is the one thing on this screen that never changes, so
        it was spending the drawer's most valuable strip saying nothing — while
        the fact that DOES change under you, and that every scoped link below
        depends on, had nowhere to be shown. With no organization active the
        switcher draws the brand exactly as this block did, so nothing is lost
        in the state where there is nothing else to say.
      */}
      {/*
        The two selectors are ONE block, and the workspace one is nested inside
        it rather than being a sibling of the nav groups below. A workspace only
        means something within an organization — the same key can exist in two
        tenants and they are different places — so the markup says so before any
        label has to.
      */}
      <div className="flex flex-col gap-0.5 pb-4">
        <OrganizationSwitcher
          organizations={organizations}
          activeId={activeOrganizationId}
          activeFallback={activeOrganizationFallback}
          planDetail={organizationPlanDetail}
          brand={brand}
          collapsed={collapsed}
        />
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeId={activeWorkspaceId}
          organizationId={activeOrganizationId}
          canCreate={canCreateWorkspace}
          collapsed={collapsed}
        />
      </div>

      <div id="main-nav" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {groups.map((group, index) => (
          <div
            key={group.group}
            /*
             * A DIVIDER between sections, not just white space. Tightening the
             * rows (below) took away most of the gap that used to separate one
             * section from the next, and a gap is the weakest cue there is: at
             * a glance a long drawer read as one list. A full-width rule reads
             * as a boundary in both widths, so the collapsed drawer no longer
             * needs a stand-in line of its own.
             */
            className={cn('flex flex-col', index > 0 && 'mt-2.5 border-t border-border pt-2.5')}
          >
            {collapsed ? null : (
              /*
               * The group's own name, which for the tenant section is the
               * static word "Organization" rather than the company's.
               *
               * It briefly drew the organization's NAME here. That was worse:
               * the switcher sits directly above this and already says which
               * organization you are in, so the name appeared twice in the
               * space of two rows and the second one carried nothing the first
               * had not. A static word beside a live name reads as a label for
               * it, which is what a section heading is for.
               *
               * Semibold and at foreground contrast rather than muted: it has
               * to read as a heading OVER the muted link labels beneath it, not
               * as one more of them.
               */
              <p className="mb-1 px-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
                {group.group}
              </p>
            )}

            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = iconFor(item.icon);
                return (
                  <li key={item.href}>
                    {/*
                     * Only when collapsed: the hint is what names an icon whose
                     * label is no longer on screen. `describes={false}` because
                     * the label below stays in the DOM either way, so the
                     * accessible name never depends on this — described as
                     * well, a screen reader would say it twice.
                     */}
                    <Tooltip text={collapsed ? item.label : null} side="right" describes={false}>
                      {(tooltip) => (
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          {...tooltip}
                          className={cn(
                            // py-1.5, not py-2: a drawer with four sections outgrew a
                            // laptop screen, and the rows are still a 32px target.
                            'relative flex items-center rounded-md py-1.5 text-sm transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            collapsed ? 'justify-center gap-0 px-0' : 'gap-2.5 px-2.5',
                            active
                              ? 'bg-accent font-medium text-accent-foreground'
                              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                          )}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          {/*
                           * Collapsed to zero width, NOT removed and not sr-only.
                           * `max-w-0 overflow-hidden` still exposes the text to a
                           * screen reader — dropping it would leave a column of
                           * unlabelled links, which is not a smaller drawer but a
                           * broken one — and unlike sr-only it is a property that
                           * animates, so the labels slide away with the panel
                           * instead of vanishing a frame before it moves.
                           */}
                          <span
                            className={cn(
                              'truncate transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
                              collapsed ? 'max-w-0 opacity-0' : 'max-w-full opacity-100',
                            )}
                          >
                            {item.label}
                          </span>
                          {/*
                            WHAT A MODULE HANGS OFF ITS OWN ENTRY — an unread count
                            today. The drawer draws it and never learns what it
                            counts.

                            ⚠ RENDERED, never called. `item.Badge` is a client
                            component reference carried through `composeNav`, and
                            the entry it belongs to has already been filtered by its
                            feature key — so a badge that subscribes never runs for
                            somebody the API would refuse.

                            Two placements, because a collapsed drawer has no room
                            beside the label: pinned to the icon when collapsed,
                            pushed to the far edge when open. The badge itself knows
                            neither — the shell decides where it sits and the module
                            decides what it says.
                          */}
                          {item.Badge ? (
                            <span className={cn('shrink-0', collapsed ? 'absolute right-1 top-1' : 'ml-auto')}>
                              <item.Badge />
                            </span>
                          ) : null}
                        </Link>
                      )}
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
