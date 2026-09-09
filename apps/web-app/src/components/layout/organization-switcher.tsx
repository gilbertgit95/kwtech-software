'use client';

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { iconFor } from '@/components/layout/nav-icons';

/**
 * The drawer's top row: which organization you are in, and a way to any other.
 *
 * ## It REPLACED the brand mark, deliberately
 *
 * The product name used to sit here. It is the one thing on the screen that
 * never changes, so it was spending the most valuable strip of the drawer
 * saying nothing — while the fact that DOES change under you, and that every
 * link below now depends on, had nowhere to be shown.
 *
 * The brand is not gone: with no organization active this row draws the product
 * name and its mark, exactly as before, and the menu becomes the way in. So the
 * strip says "where am I" in both states rather than "what is this app" in one
 * of them.
 *
 * ## Why the active organization must be visible at all
 *
 * Every entry beneath this one is now scoped: `/organizations/:id/members`
 * resolves at ORGANIZATION level, and the same person legitimately holds
 * different rights in two organizations. A drawer that showed those links
 * without saying which tenant they lead to would be showing a menu whose
 * meaning is invisible — and the failure mode is somebody administering the
 * wrong company's members in a second tab.
 *
 * ## A server-rendered list, passed in
 *
 * The organizations come from the shell, which already asks for them on every
 * render. Fetching here would mean the drawer flashing empty on first paint and
 * a request per navigation, for a list that changes when somebody joins or
 * leaves a company.
 */
export interface SwitcherOrganization {
  id: string;
  key: string;
  name: string;
  /** The viewer's role THERE. Null for a member holding none, which is normal. */
  roleLabel: string | null;
  /**
   * Icon NAME for that role — drawn to the LEFT of the label, so the role reads
   * as a badge rather than as a second line of the organization's name. Null
   * for a role that never chose one, and for no role at all; nothing is drawn
   * in either case, because `iconFor` falls back to a generic circle and a
   * circle beside "Not a member" would be decorating an absence.
   */
  roleIcon: string | null;
}

export function OrganizationSwitcher({
  organizations,
  activeId,
  activeFallback,
  brand,
  collapsed,
}: {
  organizations: readonly SwitcherOrganization[];
  /**
   * The SELECTED organization — the URL's when the page is a tenant's own,
   * otherwise the one remembered from the last time one was opened.
   *
   * Resolved by the shell, not here: it is a cookie the server reads during the
   * render that produces this row, so the right name is in the first paint
   * rather than appearing after hydration. A remembered id the viewer is no
   * longer a member of is refused there and arrives as null.
   */
  activeId: string | null;
  /**
   * The selected organization when it is NOT one of the viewer's own.
   *
   * Platform staff drill into customers they hold no membership in — that is
   * what `platform:support_access` is for — so `organizations` cannot name the
   * tenant the URL is pointing at. Without this the switcher fell back to the
   * product name while the page beside it showed a customer's data, which is
   * the header contradicting the content.
   *
   * Null for everybody else, because for them the organization IS in the list.
   */
  activeFallback?: SwitcherOrganization | null;
  brand: { name: string; tagline: string | null };
  collapsed: boolean;
}) {
  const owned = organizations.find((organization) => organization.id === activeId) ?? null;
  /*
   * The fallback is only ever consulted for the id that is actually selected —
   * a stale one from a previous render must not label the current selection.
   */
  const active = owned ?? (activeId && activeFallback?.id === activeId ? activeFallback : null);
  /** Selected, and not one of theirs: staff looking at a customer. */
  const visiting = active !== null && owned === null;

  /*
   * The label falls back to the BRAND, not to "Select an organization".
   *
   * That fallback is rarer than it looks: a selection PERSISTS, so once
   * somebody has opened an organization this row keeps naming it on the
   * dashboard and in `/admin/*` too. The brand shows for somebody who belongs
   * nowhere, or who has not opened one yet — and nothing is wrong in either
   * case, so a prompt to choose would read as an unfinished setup step on a
   * page that never needed one.
   */
  const title = active?.name ?? brand.name;
  /*
   * The role where there is one, else the key — and for a tenant the viewer is
   * only VISITING, the fact that they hold no role in it, which is the thing
   * worth knowing about the organization they are looking at.
   */
  const subtitle = visiting ? 'Not a member — viewing' : active ? (active.roleLabel ?? active.key) : brand.tagline;
  /*
   * Only when there is a ROLE to draw it for. A visiting engineer holds none,
   * and a member with no role shows their organization's key instead — an icon
   * beside either would be labelling something that is not a role.
   */
  const RoleIcon = !visiting && active?.roleLabel && active.roleIcon ? iconFor(active.roleIcon) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={collapsed ? title : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg pb-0 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'hover:bg-accent/60',
            collapsed ? 'justify-center px-0 py-1.5' : 'px-2 py-1.5',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-lg',
              'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground',
              'text-xs font-bold leading-none tracking-tight',
            )}
          >
            {initials(title)}
          </span>
          {/*
            Collapsed to zero width rather than removed, the same treatment the
            nav labels get: `max-w-0 overflow-hidden` keeps the text in the
            accessibility tree, so the button never becomes an unlabelled
            square, and unlike `sr-only` it is a property that animates with the
            panel.
          */}
          <span
            className={cn(
              'min-w-0 flex-1 overflow-hidden text-left transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
              collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100',
            )}
          >
            <span className="block truncate text-sm font-semibold leading-tight">{title}</span>
            {subtitle ? (
              <span className="flex items-center gap-1 text-xs leading-tight text-muted-foreground">
                {/*
                  `aria-hidden`: the label beside it already names the role, so
                  announcing the icon would read the same fact twice.
                */}
                {RoleIcon ? <RoleIcon aria-hidden className="size-3 shrink-0" /> : null}
                <span className="truncate">{subtitle}</span>
              </span>
            ) : null}
          </span>
          {collapsed ? null : <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="sr-only">Switch organization</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        {/*
          Named ABOVE the list rather than inside it, when the viewer is only
          visiting. The list below is "the organizations you belong to", and
          putting a tenant they hold no membership in among them would say they
          do — while leaving it out entirely would orphan the tick and make the
          menu look like it had lost the current selection.
        */}
        {visiting && active ? (
          <>
            <DropdownMenuLabel>Viewing</DropdownMenuLabel>
            <p className="px-2 pb-1 text-xs text-muted-foreground">
              <span className="block truncate text-foreground">{active.name}</span>
              You are not a member of this organization.
            </p>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuLabel>Organizations</DropdownMenuLabel>

        {organizations.length === 0 ? (
          /*
            Not an error state. A brand-new account belongs nowhere until it
            creates an organization or accepts an invitation, and both of those
            are reachable from the two items below.
          */
          <p className="px-2 py-1.5 text-xs text-muted-foreground">You are not in any organization yet.</p>
        ) : (
          organizations.map((organization) => (
            <DropdownMenuItem key={organization.id} asChild>
              {/*
                Straight to the organization's HOME, not to the equivalent of
                the page currently open. Switching company mid-task and landing
                on the other tenant's Members screen is how somebody edits the
                wrong one — the home page makes the switch visible before
                anything else happens.
              */}
              <Link href={`/organizations/${encodeURIComponent(organization.id)}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{organization.name}</span>
                  {organization.roleLabel ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {(() => {
                        const Icon = organization.roleIcon ? iconFor(organization.roleIcon) : null;
                        return Icon ? <Icon aria-hidden className="size-3 shrink-0" /> : null;
                      })()}
                      <span className="truncate">{organization.roleLabel}</span>
                    </span>
                  ) : null}
                </span>
                {organization.id === activeId ? (
                  <span aria-hidden className="ml-2 text-xs text-muted-foreground">
                    ✓
                  </span>
                ) : null}
              </Link>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/organizations">All organizations</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          {/*
            Never gated. `createOrganization` is bounded by the
            `user:organizations` LIMIT rather than by a feature — there is no
            organization yet to grant the right — so there is no key to hide
            this behind, and the cap refuses at the write with a message that
            says what the cap is.
          */}
          <Link href="/organizations/new">
            <Plus aria-hidden className="size-3.5" />
            New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The two-letter mark, derived rather than configured.
 *
 * Moved here from the sidebar along with the row it draws. Initials of the
 * first two words when there are two ("Acme Corp" → AC), otherwise the first
 * two letters ("KWTech" → KW) — and it now runs over an organization's name as
 * readily as over the product's, which is the same job.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0]?.slice(0, 2) ?? '');
  return letters.toUpperCase();
}
