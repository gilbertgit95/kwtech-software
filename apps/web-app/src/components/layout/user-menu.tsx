'use client';

import type { NavEntry } from '@kwtech/module-kit';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { ChevronDown, LogOut } from 'lucide-react';
import { useRef } from 'react';
import { iconFor } from '@/components/layout/nav-icons';

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
}

/**
 * Initials, not a generic person glyph. An avatar's job in a header is to be
 * recognisable at a glance, and every user sharing one silhouette defeats
 * that — two letters do it with no image to upload, store or serve.
 */
function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email.split('@')[0]?.replace(/[._-]+/g, ' ') || '';
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();

  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70',
        'font-semibold leading-none tracking-tight text-primary-foreground',
        className,
      )}
    >
      {initials}
    </span>
  );
}

export function UserMenu({ name, email, accountNav = [] }: UserMenuProps) {
  const initials = initialsOf(name, email);
  // `||`, not `??`: an empty-string display name is as absent as a null one,
  // and it comes from a nullable column.
  const display = name?.trim() || email;
  const signOutForm = useRef<HTMLFormElement>(null);

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
