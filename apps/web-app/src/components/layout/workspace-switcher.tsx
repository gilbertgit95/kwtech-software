'use client';

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { ChevronsUpDown, Layers } from 'lucide-react';
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
   * Null is normal and covers two states this control does not need to tell
   * apart: a member given nothing yet, and platform support, who may enter
   * every workspace while belonging to none. The key is shown instead, which is
   * what the organization switcher does for a member with no role.
   */
  roleLabel: string | null;
  /** Icon NAME for that role. Null draws nothing — see the organization switcher. */
  roleIcon: string | null;
}

/** The role line under a workspace's name: its icon, then its label. */
function WorkspaceRole({ workspace }: { workspace: SwitcherWorkspace }) {
  const Icon = workspace.roleLabel && workspace.roleIcon ? iconFor(workspace.roleIcon) : null;
  return (
    <span className="flex items-center gap-1 text-xs leading-tight text-muted-foreground">
      {/* `aria-hidden`: the label beside it already names the role. */}
      {Icon ? <Icon aria-hidden className="size-3 shrink-0" /> : null}
      {/*
        The KEY when there is no role — the same fallback the organization
        switcher uses, and it keeps the row two lines tall either way so the
        drawer does not resize as you move between workspaces.
      */}
      <span className="truncate">{workspace.roleLabel ?? workspace.key}</span>
    </span>
  );
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  organizationId,
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
