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
  /**
   * The plan THAT organization is on — drawn on its row, not only on the
   * selected one.
   *
   * The role says what the reader may do; the plan says what the organization
   * may do at all. Both belong on every row, because the menu is where somebody
   * is choosing BETWEEN tenants and "which of these is on Enterprise" is a
   * question the list could not answer while the plan lived only on the trigger.
   *
   * It costs nothing to carry: `myOrganizations` returns it with the list, in
   * the request the shell already makes.
   *
   * Null means the organization is on NO PLAN — where every one starts, and a
   * real thing to see in this list. Unlike the tenant screens, this cannot be
   * the "not allowed to look" state: the query is ungated and cannot refuse.
   */
  planLabel: string | null;
  /**
   * The plan's stable handle, shown in the hover card under the label.
   *
   * Worth carrying alongside the label because it is the one that never
   * changes: a label is renamed at will, so "we are on the wrong plan" is only
   * answerable against the key.
   */
  planKey: string | null;
  /** Icon NAME for the plan. Null draws no icon — see `roleIcon`. */
  planIcon: string | null;
}

/**
 * The meta line under an organization's name: the ROLE held there, then the
 * PLAN it is on.
 *
 * One line rather than two, separated by a middot, so a row stays two lines
 * tall whatever it has to say — a menu whose rows change height as you read
 * down it is harder to scan than one that repeats a shape.
 *
 * The role falls back to the KEY, matching the trigger above and the workspace
 * selector: a member holding no role still belongs somewhere, and the key is
 * the useful thing to say about the tenant instead. The plan simply drops out
 * when there is none, because "No plan" beside a role would read as a warning
 * about a state that is perfectly normal for a new organization.
 */
function OrganizationMeta({ organization }: { organization: SwitcherOrganization }) {
  const RoleIcon = organization.roleLabel && organization.roleIcon ? iconFor(organization.roleIcon) : null;
  const PlanIcon = organization.planLabel && organization.planIcon ? iconFor(organization.planIcon) : null;

  return (
    <span className="flex items-center gap-1 text-xs leading-tight text-muted-foreground">
      {/* `aria-hidden`: the label beside each icon already names it. */}
      {RoleIcon ? <RoleIcon aria-hidden className="size-3 shrink-0" /> : null}
      <span className="truncate">{organization.roleLabel ?? organization.key}</span>
      {organization.planLabel ? (
        <>
          <span aria-hidden className="shrink-0 opacity-50">
            ·
          </span>
          {PlanIcon ? <PlanIcon aria-hidden className="size-3 shrink-0" /> : null}
          <span className="truncate">{organization.planLabel}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * The hover box on the plan mark — what the square would say if it had room.
 *
 * ## Why a hand-built box and not a tooltip component
 *
 * `web-ui` ships no tooltip, and the two obvious ways to get one are both worse
 * here. A Radix tooltip would need a portal nested inside a dropdown TRIGGER,
 * which is where focus handling goes wrong — the trigger and the tooltip fight
 * over the same pointer events and the menu starts opening on hover. A native
 * `title` is what this replaced: one line, no markup, no control over when it
 * appears, and it cannot show the icon that is the whole point of the mark.
 *
 * So: an absolutely positioned span, shown by `group-hover`. It costs no
 * JavaScript, it cannot steal the click that opens the menu, and it disappears
 * the moment the pointer leaves.
 *
 * ## Everything in it is phrasing content, and that is not stylistic
 *
 * This renders INSIDE the trigger `<button>`, whose content model is phrasing
 * content. A `<div>` or an `<a>` there is invalid HTML — browsers recover by
 * hoisting it out of the button, which breaks the layout in a way that looks
 * like a CSS bug. Hence spans with `block`, and hence the subscription line
 * being a SENTENCE rather than a link: a link inside a button is both invalid
 * and unclickable under `pointer-events-none`.
 *
 * `aria-hidden` and `pointer-events-none` together: it is a visual convenience,
 * the facts in it are repeated in the trigger's `sr-only` text, and nothing in
 * it should ever intercept a click meant for the menu.
 */
/**
 * How much the plan carries, as a sentence — used by the card and by the
 * trigger's spoken label, so the two cannot drift into saying different things.
 *
 * ⚠ THREE states, and the third is not a smaller version of the second:
 *
 *   a number  the capabilities this plan includes;
 *   0         an organization on no plan is entitled to NOTHING, which is a
 *             real state every organization starts in;
 *   null      the deployment has no entitlement model at all, so everything is
 *             entitled — "0 capabilities" there would be flatly wrong, which is
 *             why the null is carried this far rather than flattened on the way.
 */
function entitlementSentence(entitlements: number | null): string | null {
  if (entitlements === null) return null;
  if (entitlements === 0) return ' Entitled to nothing yet.';
  return ` Includes ${entitlements} ${entitlements === 1 ? 'capability' : 'capabilities'}.`;
}

function PlanCard({
  organizationName,
  planLabel,
  planKey,
  planIcon,
  entitlements,
  canReadSubscription,
}: {
  organizationName: string;
  planLabel: string;
  planKey: string | null;
  planIcon: string | null;
  entitlements: number | null;
  canReadSubscription: boolean;
}) {
  const Icon = planIcon ? iconFor(planIcon) : null;

  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-0 top-full z-50 mt-2 w-60 rounded-lg p-3',
        'border border-border bg-popover text-popover-foreground shadow-md',
        // Hidden by default and revealed by the MARK's hover, or by the
        // trigger's keyboard focus — so it is reachable without a pointer.
        'invisible opacity-0 transition-opacity duration-150',
        'group-hover/mark:visible group-hover/mark:opacity-100',
        'group-focus-visible/trigger:visible group-focus-visible/trigger:opacity-100',
      )}
    >
      <span className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground">Plan</span>

      <span className="mt-1 flex items-center gap-2">
        {Icon ? <Icon className="size-4 shrink-0 text-primary" /> : null}
        <span className="truncate text-sm font-semibold">{planLabel}</span>
      </span>

      {/*
        The KEY, in mono. It is the stable handle the API and every support
        conversation use, and unlike the label it never changes — so somebody
        reporting "we are on the wrong plan" can quote something unambiguous.
      */}
      {planKey ? (
        <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{planKey}</span>
      ) : null}

      {/* WHAT THE PLAN CARRIES — the part a name alone cannot say. See `entitlementSentence`. */}
      <span className="mt-2 block border-t border-border pt-2 text-xs text-muted-foreground">
        {entitlementSentence(entitlements)?.trim() ??
          'Everything is entitled — this deployment has no entitlement model.'}
      </span>

      {/*
        Only for somebody who may actually open it. `subscriptions:read` is a
        different key from the one that opened this page, so pointing everybody
        at a screen half of them are refused would be sending people to a door
        that does not open.
      */}
      {canReadSubscription ? (
        <span className="mt-1 block text-xs text-muted-foreground">
          See <span className="text-foreground">Subscription</span> for the dates and the full list.
        </span>
      ) : null}

      <span className="mt-2 block truncate border-t border-border pt-2 text-[0.6875rem] text-muted-foreground">
        {organizationName}
      </span>
    </span>
  );
}

export function OrganizationSwitcher({
  organizations,
  activeId,
  activeFallback,
  planDetail,
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
  /**
   * The extra facts the plan CARD shows, beyond the name and icon it takes from
   * the selected organization's own row.
   *
   * Separate from `SwitcherOrganization` because it is about the SELECTED
   * organization only: `entitled` is resolved per organization by the server,
   * so carrying it on every row would mean a permission context per tenant in
   * the drawer's query for a card that can only ever show one of them.
   */
  planDetail?: {
    /**
     * How many capabilities the plan includes.
     *
     * ⚠ `null` is NOT zero. It means the deployment has no entitlement model,
     * so everything is entitled; an organization on no plan gives 0. The card
     * says something different for each.
     */
    entitlements: number | null;
    /** Whether the viewer holds `subscriptions:read` here — the card offers the screen only then. */
    canReadSubscription: boolean;
  } | null;
  /**
   * ── THE MARK DRAWS THE PLAN ────────────────────────────────────────────────
   *
   * Taken from the selected organization's own row (or from `activeFallback`
   * for a tenant somebody is only visiting), so the square and the menu can
   * never name two different plans.
   *
   * The initials were derived from the name printed immediately beside them, so
   * the square was saying a second time what the label already said. The plan
   * is a fact that appears nowhere else in the chrome, and it is the one that
   * changes what the product will let you do.
   *
   * ⚠ The trade is real: COLLAPSED, this square is all that is left of the row,
   * so two organizations on the same plan look identical there. The mark's
   * `title` composes both facts in that state. Falling back to `initials` when
   * `collapsed` is a one-line change if that turns out to matter more.
   *
   * No plan, or a plan with no icon, falls back to the initials and offers no
   * tooltip — `iconFor` answers a generic circle for an unknown name, and a
   * circle there would decorate an absence rather than name a plan.
   */
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

  /*
   * The MARK's icon — the plan's, when there is a plan that chose one.
   *
   * Null falls the square back to the initials, which is the honest answer for
   * all three of the states that produce it: no organization selected (the
   * brand's own mark, exactly as before), no plan, and a plan the viewer may
   * not read. See the `plan` prop.
   */
  const PlanIcon = active?.planIcon ? iconFor(active.planIcon) : null;
  /*
   * The plan, for the SR text. The visual answer is `PlanCard` below.
   *
   * The mark used to carry a native `title` saying this, and it had to compose
   * the organization's name into it when collapsed — the square IS the button
   * in that state, so its own tooltip won over the button's. The card is not a
   * `title`, so that fight is gone: the button keeps naming the tenant when
   * collapsed and the card names the plan.
   *
   * `Plan: Pro` rather than `Pro plan`: the label is whatever an administrator
   * typed, and a plan somebody named "Pro plan" would otherwise read back as
   * "Pro plan plan".
   */
  const planTitle = active?.planLabel ? `Plan: ${active.planLabel}` : null;
  /*
   * The card, in one sentence. `entitlements` is only spoken when it is a
   * NUMBER — null there means the deployment has no entitlement model, which is
   * a fact about the installation rather than about this organization and would
   * be noise in a switcher's label.
   */
  const spokenLabel = planTitle
    ? `Switch organization. ${planTitle}.${entitlementSentence(planDetail?.entitlements ?? null) ?? ''}`
    : 'Switch organization';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={collapsed ? title : undefined}
          className={cn(
            'group/trigger flex w-full items-center gap-2.5 rounded-lg pb-0 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'hover:bg-accent/60',
            collapsed ? 'justify-center px-0 py-1.5' : 'px-2 py-1.5',
          )}
        >
          {/*
            THE MARK, and it now draws the PLAN rather than the initials.

            The square itself is unchanged — same size, same gradient, same
            corner — because it is the drawer's anchor point and moving it would
            be a different change. Only what is inside it swapped: initials
            derived from the name printed beside them, for the one fact about
            this organization that appears nowhere else in the chrome.

            `title` rather than a tooltip component: every other hover string in
            this drawer is a native `title`, and a tooltip here would be the
            only one — and would need a portal inside a dropdown trigger, which
            is where focus handling goes wrong.
          */}
          {/*
            `relative` so the card positions against the MARK rather than the
            button — which keeps it in the same place whether the drawer is
            expanded or collapsed to 4rem. `group/mark` is what reveals it; the
            button carries `group/trigger` so keyboard focus reveals it too.
          */}
          <span className="group/mark relative shrink-0">
            <span
              aria-hidden
              className={cn(
                'grid size-7 place-items-center rounded-lg',
                'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground',
                'text-xs font-bold leading-none tracking-tight',
              )}
            >
              {PlanIcon ? <PlanIcon className="size-4" /> : initials(title)}
            </span>
            {/*
              Only where there is a plan to describe. With none — no
              organization selected, none bought, or a tenant somebody is
              visiting without `subscriptions:read` — the mark is the initials
              and a card explaining an absence would be worse than no card.
            */}
            {active?.planLabel ? (
              <PlanCard
                organizationName={active.name}
                planLabel={active.planLabel}
                planKey={active.planKey}
                planIcon={active.planIcon}
                entitlements={planDetail?.entitlements ?? null}
                canReadSubscription={planDetail?.canReadSubscription ?? false}
              />
            ) : null}
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
          {/*
            The plan said HERE as well, because the mark that draws it is
            `aria-hidden` and a `title` on a hidden element is announced by
            nobody. Without this the change would have moved a fact out of the
            reach of anyone not using a pointer.
          */}
          {/*
            The card's facts, spoken. It is `aria-hidden` — a hover box is a
            pointer affordance — so without this the plan would reach only
            people using one.
          */}
          <span className="sr-only">{spokenLabel}</span>
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
                  {/*
                    What the reader is HERE and what this tenant is ON — the two
                    facts that distinguish one row from another once the names
                    have been read.
                  */}
                  <OrganizationMeta organization={organization} />
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
