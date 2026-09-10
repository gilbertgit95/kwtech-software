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
import { ChevronsUpDown, Layers, Plus } from 'lucide-react';
import Link from 'next/link';
import { iconFor } from '@/components/layout/nav-icons';

/**
 * The workspace selector, DIRECTLY BENEATH the organization one.
 *
 * ## It has to read as "inside that organization", not as a second switcher
 *
 * A workspace only means anything within an organization — the same key can
 * exist in two tenants and they are different places — so a picker sitting
 * beside the organization one, at the same weight, would invite exactly the
 * wrong reading: two independent choices. Three things say otherwise, and they
 * are cheap:
 *
 *   - it is INDENTED, with a short elbow rule running from the organization row
 *     into it. That is the tree convention every file browser uses, and it
 *     reads before any label does;
 *   - it is visually LIGHTER — smaller text, no bold, a muted icon — so the
 *     organization stays the heading and this stays a detail of it;
 *   - it says "Workspace" when nothing is chosen, so the empty state names the
 *     thing rather than being a blank strip nobody can identify.
 *
 * ## Disabled means DISABLED, and says why
 *
 * With no organization selected there is nothing to list, so the control is a
 * `<button disabled>` rather than a menu that opens onto an empty list — the
 * second is the shape that makes people click twice and then file a bug. Its
 * tooltip says what to do instead of what went wrong.
 *
 * ## The list is what the viewer may ENTER, not what the organization has
 *
 * `workspaces` comes from their own `accessibleWorkspaceIds`. Workspace
 * membership is required and no role widens it (§12.33), so offering the rest
 * would put rows in a picker that the guard refuses on arrival — the mismatch
 * one shared feature key exists to prevent. An organization with workspaces the
 * viewer is in none of therefore shows an empty menu, which is honest: there is
 * nowhere for them to go yet.
 */
export interface SwitcherWorkspace {
  id: string;
  key: string;
  name: string;
  /**
   * The viewer's WORKSPACE-level role here, drawn beside its icon exactly as
   * the organization switcher draws theirs — so "what am I in this place" reads
   * the same way at both levels.
   *
   * Null is normal — the COMMON case, in fact — and covers two states this
   * control does not need to tell apart: a member given nothing yet, which is
   * everybody until an administrator assigns one, and platform support, who may
   * enter every workspace while belonging to none. Both hold no role HERE, and
   * the line says exactly that rather than falling back to the workspace's key.
   */
  roleLabel: string | null;
  /** Icon NAME for that role. Null draws nothing — see the organization switcher. */
  roleIcon: string | null;
}

/**
 * The role line under a workspace's name: its icon, then its label.
 *
 * ## "No role" is the answer when there is none, NOT the workspace's key
 *
 * The key was the fallback, and it was answering a question nobody asked. A
 * workspace named "Design" keyed `design` produced a row reading "Design" over
 * "design", which looks like a rendering fault; worse, it left the ROLE — the
 * thing this line exists for — invisible in the state where it is most worth
 * saying, and that state is the common one.
 *
 * It is common because membership and role are separate in this model:
 * `createWorkspace` puts its creator in the workspace and grants them NO role,
 * and `addWorkspaceMember` does the same. So somebody in three workspaces
 * ordinarily holds no workspace role in any of them until an administrator
 * assigns one — they can enter, and §12.33 is what entry rests on.
 *
 * `No role` is the wording `/organizations` already uses for the same state one
 * level up, where its own comment calls a member with no role "a real and
 * unremarkable state". Muted, so it reads as an absence rather than as the name
 * of a role somebody was given.
 *
 * ⚠ It is deliberately not "Member": platform support reaches every workspace
 * while belonging to none, and their rows come back roleless too. "No role" is
 * true for both of them; "Member" would be a claim about standing that this
 * control cannot check.
 *
 * Either way the line renders, which keeps a row two lines tall whatever it has
 * to say — a menu that changes height as you read down it is harder to scan.
 */
function WorkspaceRole({ workspace }: { workspace: SwitcherWorkspace }) {
  const Icon = workspace.roleLabel && workspace.roleIcon ? iconFor(workspace.roleIcon) : null;
  return (
    <span className="flex items-center gap-1 text-xs leading-tight text-muted-foreground">
      {/* `aria-hidden`: the label beside it already names the role. */}
      {Icon ? <Icon aria-hidden className="size-3 shrink-0" /> : null}
      <span className={cn('truncate', workspace.roleLabel ? undefined : 'italic opacity-70')}>
        {workspace.roleLabel ?? 'No role'}
      </span>
    </span>
  );
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  organizationId,
  canCreate,
  collapsed,
}: {
  /** The selected organization's workspaces that the viewer may enter. Empty when none is selected. */
  workspaces: readonly SwitcherWorkspace[];
  /**
   * The selected workspace, resolved by the shell.
   *
   * Null the moment the organization changes: the selection is validated
   * against THIS organization's list, so one remembered from another tenant is
   * simply not in it. See `resolveActiveWorkspace`.
   */
  activeId: string | null;
  /** Null when no organization is selected — which is what disables this. */
  organizationId: string | null;
  /**
   * Whether the viewer holds `workspaces:create` IN the selected organization.
   *
   * GATED, unlike the organization switcher's "New organization" — and the
   * asymmetry is the model's, not an inconsistency. Creating an organization is
   * bounded by the `user:organizations` limit rather than by a feature, because
   * there is no organization yet to grant the right; creating a workspace is a
   * right a tenant grants, and `workspaces:create` is the organization-level
   * key the mutation is guarded by. Offering the item to somebody without it
   * would put a row in a menu that the server refuses on submit — the mismatch
   * between what is offered and what is permitted that one shared feature key
   * exists to prevent, which is the same reason the list above shows only the
   * workspaces they may actually enter.
   *
   * Resolved by the shell from the ORGANIZATION-scoped reading of their grants,
   * so it changes with the selection rather than with the page's own scope.
   */
  canCreate: boolean;
  collapsed: boolean;
}) {
  const active = workspaces.find((workspace) => workspace.id === activeId) ?? null;
  const disabled = !organizationId;

  /*
   * Collapsed, the drawer is 4rem wide and the organization row is already
   * reduced to its mark. A second row under it would be two anonymous squares
   * with nothing to tell them apart, so this one is dropped entirely — the
   * organization is the one that must survive, because it is what every link
   * below is scoped to.
   */
  if (collapsed) return null;

  const label = disabled ? 'Workspace' : (active?.name ?? 'All workspaces');

  return (
    <div className="flex items-stretch gap-1 pl-2.5">
      {/*
        The elbow: a short vertical rule turning right into the row. Drawn with
        borders rather than an SVG because it has to match the drawer's own
        border colour in both themes, and a token does that for free.

        `aria-hidden` — it is the indentation made visible, and the menu's own
        label already says what this is. A screen reader gets the nesting from
        the heading order, not from a line.
      */}
      <span aria-hidden className="mt-0 w-2 shrink-0 rounded-bl-md border-b border-l border-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            disabled={disabled}
            title={
              disabled
                ? 'Select an organization first — workspaces belong to one.'
                : (active?.name ?? 'Choose a workspace')
            }
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent/60',
            )}
          >
            <Layers aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-xs leading-tight',
                  // Muted until something is chosen, so "Workspace" reads as the
                  // placeholder it is rather than as the name of one.
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {/*
                The role only once a workspace is actually chosen. "All
                workspaces" and the disabled placeholder are not places, so
                there is nothing to hold a role in.
              */}
              {active ? <WorkspaceRole workspace={active} /> : null}
            </span>
            {disabled ? null : <ChevronsUpDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />}
            <span className="sr-only">
              {disabled ? 'Workspace selector, disabled until an organization is selected' : 'Switch workspace'}
            </span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>

          {workspaces.length === 0 ? (
            /*
              Not an error. Membership is required to enter a workspace, so an
              organization whose workspaces the viewer is in none of is a normal
              state — and the sentence says which of the two possible reasons it
              is, because "there are none" and "you are in none" lead somewhere
              different.
            */
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No workspaces here that you are a member of. Somebody already inside one can add you.
            </p>
          ) : (
            workspaces.map((workspace) => (
              <DropdownMenuItem key={workspace.id} asChild>
                {/*
                  Straight to the workspace's own page, the way the organization
                  switcher opens an organization's. A selector that only set a
                  hidden preference would be a control with no visible effect,
                  and nobody would trust it.
                */}
                <Link
                  href={`/organizations/${encodeURIComponent(organizationId ?? '')}/workspaces/${encodeURIComponent(workspace.id)}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{workspace.name}</span>
                    {/*
                      The ROLE held here, falling back to the key — so the menu
                      answers "what am I in each of these" rather than repeating
                      a name the row above already shows.
                    */}
                    <WorkspaceRole workspace={workspace} />
                  </span>
                  {workspace.id === activeId ? (
                    <span aria-hidden className="ml-2 text-xs text-muted-foreground">
                      ✓
                    </span>
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))
          )}

          {/*
            THE WAY OUT OF THE EMPTY STATE, and the mirror of the organization
            switcher's "New organization".

            It matters most in exactly the case above: an organization whose
            workspaces the viewer is in none of shows a menu with nothing in it,
            and a picker that offers no way forward is where somebody stops. The
            sentence there says who can add them to an EXISTING workspace; this
            says they may make one.

            Separated from the list rather than appended to it, because it is
            not a place you can switch to — the rows above navigate INTO a
            workspace, this one goes to a form.
          */}
          {canCreate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                {/*
                  Scoped to the SELECTED organization, and it has to be: a
                  workspace is created inside one, so there is no app-level
                  `/workspaces/new` to point at. `organizationId` is non-null
                  here — the trigger is disabled without one, so this menu
                  cannot open — and the `?? ''` is only what satisfies the type.
                */}
                <Link href={`/organizations/${encodeURIComponent(organizationId ?? '')}/workspaces/new`}>
                  <Plus aria-hidden className="size-3.5" />
                  New workspace
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
