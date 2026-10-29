'use client';

import type { NavEntry } from '@kwtech/module-kit';
import type { AppRole } from '@kwtech/module-permissions';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { ChevronDown, LogOut, MonitorSmartphone, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isRunningInstalled } from '@/components/install/install-platform';
import { Avatar, initialsOf } from '@/components/layout/avatar';
import { switchLayout } from '@/components/layout/layout-switch';
import { iconFor } from '@/components/layout/nav-icons';
import { RoleBadge } from '@/components/layout/role-badge';

interface UserMenuProps {
  name: string | null;
  email: string;
  /**
   * What modules contributed to the `Account` group — profile, security, and
   * whatever a later module adds.
   *
   * Plain data, built on the server and already filtered against the caller's
   * grants. It arrives as a prop rather than being read here because computing
   * it means touching WEB_MODULES, which holds every module's page components —
   * importing that from a client component would drag them all into the bundle.
   */
  accountNav?: readonly NavEntry[];
  /**
   * The caller's APP-level roles, already sorted by key on the server.
   *
   * Almost always exactly one, and empty is normal — somebody whose rights come
   * only from an organization role holds none, and no badge is the right answer
   * rather than a "none" chip nobody needs to read.
   */
  roles?: readonly AppRole[];
  /**
   * Whether to offer "Use mobile view" (issue #22): on a phone or tablet, or
   * for somebody who switched to the full site — decided on the server from
   * the request, by `offersMobileView`.
   */
  offerMobileView?: boolean;
}

export function UserMenu({ name, email, accountNav = [], roles = [], offerMobileView = false }: UserMenuProps) {
  const initials = initialsOf(name, email);
  // `||`, not `??`: an empty-string display name is as absent as a null one,
  // and it comes from a nullable column.
  const display = name?.trim() || email;
  const signOutForm = useRef<HTMLFormElement>(null);
  /*
   * Hidden inside the installed app, where "Install app" would be a link to
   * instructions for what the person has already done. Decided in an effect:
   * the server cannot know, and starting at `false` means the browser tab —
   * the common case — never shows the entry appearing late.
   */
  const [installed, setInstalled] = useState(false);
  useEffect(() => setInstalled(isRunningInstalled()), []);

  return (
    <>
      {/*
       * A real form POST, not a link or a fetch: signing out changes server
       * state — it revokes the session row — and a GET that mutates is the
       * kind of thing a link prefetcher or a browser extension fires on its
       * own. The handler answers 303, so the browser follows with a GET.
       *
       * It lives here rather than inside the menu because the menu content is
       * portalled into document.body and unmounts the moment an item is
       * chosen; a form inside it would be racing its own removal.
       */}
      <form ref={signOutForm} action="/api/auth/signout" method="post" className="hidden" />

      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'group flex items-center gap-2 rounded-full border border-transparent py-1 pl-1 pr-2 text-sm',
            'transition-colors hover:border-border hover:bg-accent/60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            'data-[state=open]:border-border data-[state=open]:bg-accent/60',
          )}
          aria-label="Account menu"
        >
          <Avatar initials={initials} className="size-7 text-[0.6875rem]" />
          {/* The name is the first thing to go on a narrow viewport; the avatar
              still identifies the account, so nothing is lost but width. */}
          <span className="hidden max-w-36 truncate font-medium sm:block">{display}</span>
          {/*
            Every role, and unlike the name these do NOT hide on a narrow
            viewport: an icon costs about sixteen pixels, so the rare case of
            somebody holding two cannot push the control out of shape, and there
            is nothing to gain by hiding it. Nothing is rendered at all for the
            majority who hold none.
          */}
          {roles.map((role) => (
            <RoleBadge key={role.key} role={role} />
          ))}
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-xl p-1.5">
          <div className="flex items-center gap-3 px-2 py-2.5">
            <Avatar initials={initials} className="size-9 text-xs" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">{name?.trim() || 'Signed in'}</p>
              <p className="truncate text-xs leading-tight text-muted-foreground">{email}</p>
            </div>
          </div>

          <DropdownMenuSeparator className="my-1" />

          {/*
           * The account pages, ABOVE sign-out and separated from it.
           *
           * Order is not cosmetic: sign-out is the one item here that cannot be
           * undone, and putting it last — after a rule — means a mis-aimed click
           * lands on a navigation rather than on the end of the session.
           *
           * Rendered as real <a> elements, so middle-click and "open in new tab"
           * work and the browser shows the destination on hover. `asChild` hands
           * Radix the anchor to own instead of wrapping a link in a button.
           */}
          {accountNav.length > 0 ? (
            <>
              {accountNav.map((entry) => {
                const Icon = iconFor(entry.icon);
                return (
                  <DropdownMenuItem key={entry.href} asChild className="gap-2.5 rounded-lg px-2 py-2">
                    <a href={entry.href}>
                      <Icon aria-hidden className="opacity-80" />
                      {entry.label}
                    </a>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator className="my-1" />
            </>
          ) : null}

          {/*
           * The way onto a phone's home screen (app/install). Here rather than
           * in the drawer because it is about this person's device, not about
           * a feature they hold — and so it needs no feature key.
           */}
          {/*
           * Back to the phone layout. Only where it could matter (see the
           * prop): a computer that never asked for it is not offered it.
           */}
          {offerMobileView ? (
            <>
              <DropdownMenuItem onSelect={() => switchLayout('mobile')} className="gap-2.5 rounded-lg px-2 py-2">
                <MonitorSmartphone aria-hidden className="opacity-80" />
                Use mobile view
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1" />
            </>
          ) : null}

          {installed ? null : (
            <>
              <DropdownMenuItem asChild className="gap-2.5 rounded-lg px-2 py-2">
                <a href="/install">
                  <Smartphone aria-hidden className="opacity-80" />
                  Install app
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1" />
            </>
          )}

          <DropdownMenuItem
            onSelect={(event) => {
              // Radix closes the menu after onSelect, which unmounts this row.
              // Submitting explicitly, rather than relying on a click reaching
              // a submit button on its way out, keeps the two independent.
              event.preventDefault();
              signOutForm.current?.requestSubmit();
            }}
            className="gap-2.5 rounded-lg px-2 py-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <LogOut aria-hidden className="opacity-80" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
