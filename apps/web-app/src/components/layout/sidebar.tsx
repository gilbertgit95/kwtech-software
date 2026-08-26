'use client';

import { cn } from '@kwtech/web-ui/react';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { NavGroup } from '@/components/layout/nav';
import { iconFor } from '@/components/layout/nav-icons';
import { writeSidebarCookie } from '@/components/layout/sidebar-state';

interface SidebarProps {
  /**
   * Built and filtered on the server (see nav.ts). Plain data, deliberately:
   * the module descriptors this is derived from carry page components that
   * must not cross into the browser bundle.
   */
  groups: NavGroup[];
  /** Read from the cookie by the shell, so the first paint is already correct. */
  defaultCollapsed: boolean;
  /**
   * The product name and its second line, from APP_NAME / APP_TAGLINE.
   *
   * A PROP, not a `NEXT_PUBLIC_` read. This is a client component, so the only
   * way it could read the environment itself is a build-time inline — which
   * would mean one built image could never run under two names, and renaming
   * the product would need a rebuild rather than a restart.
   */
  brand: { name: string; tagline: string | null };
}

/**
 * The two-letter mark, derived rather than configured.
 *
 * Initials of the first two words when there are two ("Acme Corp" → AC),
 * otherwise the first two letters ("KWTech" → KW). A third variable for this
 * would be a third thing to update at a rename, to save one lookup.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0]?.slice(0, 2) ?? '');
  return letters.toUpperCase();
}

function isActive(pathname: string, href: string): boolean {
  // '/' would prefix-match every route in the app, so it is exact-only.
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ groups, defaultCollapsed, brand }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCookie(next);
  }

  return (
    <nav
      aria-label="Main"
      data-collapsed={collapsed ? '' : undefined}
      className={cn(
        'group/sidebar relative flex shrink-0 flex-col border-r border-border bg-card py-4',
        'transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        collapsed ? 'w-16 px-2' : 'w-56 px-3',
      )}
    >
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
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="main-nav"
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
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

      <div className={cn('flex items-center gap-2.5 pb-4', collapsed ? 'justify-center px-0' : 'px-2')}>
        <span
          aria-hidden
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-lg',
            'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground',
            'text-xs font-bold leading-none tracking-tight',
          )}
        >
          {initials(brand.name)}
        </span>
        <div
          className={cn(
            'min-w-0 overflow-hidden transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100',
          )}
        >
          <p className="truncate text-sm font-semibold leading-tight">{brand.name}</p>
          {/* Omitted rather than replaced by a placeholder: a product without a
              tagline should show one line, not an empty second one. */}
          {brand.tagline ? (
            <p className="truncate text-xs leading-tight text-muted-foreground">{brand.tagline}</p>
          ) : null}
        </div>
      </div>

      <div id="main-nav" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.group} className="flex flex-col gap-1">
            {/*
             * The heading becomes a rule when the panel narrows. Removing it
             * would let two groups run together into one undifferentiated
             * column of icons; a 1px line keeps the boundary the label was
             * carrying, in the width that is left.
             */}
            {collapsed ? (
              <span aria-hidden className="mx-auto my-1 h-px w-6 bg-border" />
            ) : (
              <p className="px-2.5 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                {group.group}
              </p>
            )}

            <ul className="flex flex-col gap-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = iconFor(item.icon);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      /*
                       * Only when collapsed: a native tooltip is what names an
                       * icon whose label is no longer on screen. A Radix
                       * tooltip would look better and would cost a dependency
                       * for one hover hint — and the label below stays in the
                       * DOM either way, so the accessible name never depends
                       * on this.
                       */
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'flex items-center rounded-lg py-2 text-sm transition-colors',
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
                          'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
                          collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100',
                        )}
                      >
                        {item.label}
                      </span>
                    </Link>
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
