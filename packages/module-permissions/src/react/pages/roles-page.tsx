'use client';

import { cn, DataGrid, type DataGridColumn, useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import { createPermissionsClient, type PermissionsClient, type RoleView } from '../permissions-client.js';
import { AdminPage } from './admin-page.js';

/**
 * The roles that exist, what each grants, and which are switched off.
 *
 * Unlike Features — whose rows are a compiled constant — these come from the
 * database, so this is the module's first screen with a query, a loading state
 * and a failure state. The client is a prop with a default for the reason
 * `permissions-client.ts` explains: the route it posts to belongs to another
 * module, and this one may not name it.
 *
 * ## Disabled roles are SHOWN
 *
 * Every grant path filters them out — a disabled role must grant nothing. A
 * list must do the opposite: hide them and the switch reads as a delete, and
 * nobody can find the role to turn it back on.
 *
 * ## This list is read-only
 *
 * The only action here is New; everything else — editing, and turning a role
 * off or back on — lives in the EDITOR, reached by double-clicking a row.
 *
 * That keeps the destructive control next to the thing it destroys. Disabling
 * from a list means acting on a row identified by a checkbox, where the only
 * confirmation of WHICH role is a name in a dialog; doing it from the editor
 * means the whole role is on screen — its level, its features, whether it is
 * already off — at the moment the decision is made.
 *
 * There is no delete anywhere. Every grant ever made points at the role row, so
 * removing it would either cascade that history away or fail on a foreign key.
 * Disabling is the reversible answer, and the read path stops honouring a
 * disabled role at all three levels.
 */

const LEVEL_LABEL: Record<string, string> = {
  app: 'App',
  organization: 'Organization',
  workspace: 'Workspace',
};

/**
 * WIDEST FIRST: app, organization, workspace.
 *
 * Deliberately the opposite of the Features grid, which ranks by blast radius
 * ascending. These are two different questions. A feature list is scanned to
 * find the dangerous ones, so the riskiest belong where the eye lands last and
 * lingers. A role list is a HIERARCHY being read top-down — an app role
 * contains organization concerns, which contain workspace ones — and printing
 * that inverted makes the reader assemble it backwards.
 */
const LEVEL_RANK: Record<string, number> = { app: 0, organization: 1, workspace: 2 };

/**
 * Each level gets its own COLOUR, and the intensity tracks reach.
 *
 * ## Why colour, and not the role's own icon
 *
 * The icon column already shows the role's icon, and that answers "which role
 * is this". Level answers a different question — "how far does it reach" — so
 * it needs a different visual channel, or the two collapse into one and neither
 * is scannable. Colour is the right channel because level has exactly three
 * values and no natural glyph.
 *
 * ## Why this does not contradict the uniform navbar badge
 *
 * The badge must not imply a rank: a role's rights are the list of features it
 * carries and nothing else, so styling one badge as more important would be a
 * second, unenforceable account of authority. Level is the opposite — a real,
 * ENFORCED property. `assertRoleFeatureLevels` refuses an app-level feature
 * inside an organization role, and `roles:manage_app` guards minting an app
 * role at all. Colouring the tiers says something the code already enforces.
 *
 * ## Why the status tokens
 *
 * They are the only colours in the system defined once for all ten palettes
 * rather than derived from the active one, and the only ones whose foreground
 * pairs are contrast-checked (`check:contrast`). A palette-derived colour would
 * make "app" green on the forest theme, which tells the reader nothing.
 *
 * Amber for app is a deliberate borrowing of `warning`: it is the tier that
 * applies in EVERY organization and skips the subscription filter, so caution
 * is the accurate signal. Workspace, the narrowest, gets no colour at all —
 * absence of emphasis is itself the third value, and it keeps the common case
 * quiet.
 */
const LEVEL_STYLE: Record<string, string> = {
  app: 'border-transparent bg-[var(--status-warning)] text-[var(--status-warning-foreground)]',
  organization: 'border-transparent bg-[var(--status-info)] text-[var(--status-info-foreground)]',
  workspace: 'border-border bg-transparent text-muted-foreground',
};

interface RoleRow extends RoleView {
  levelLabel: string;
  levelRank: number;
  featureCount: number;
  /** Joined so the grid's quick filter matches a feature key by substring. */
  featureText: string;
  status: string;
}

function toRow(role: RoleView): RoleRow {
  return {
    ...role,
    levelLabel: LEVEL_LABEL[role.level] ?? role.level,
    levelRank: LEVEL_RANK[role.level] ?? 99,
    featureCount: role.features.length,
    featureText: role.features.join(' '),
    status: role.disabled ? 'Disabled' : 'Active',
  };
}

/**
 * App, then organization, then workspace. Within a tier, the roles that grant
 * MOST come first; ties break alphabetically.
 *
 * Descending on feature count rather than ascending, so the ordering means one
 * thing the whole way down: reach, widest first. Level is the coarse axis and
 * feature count the fine one — super-admin above normal-user for the same
 * reason app sits above workspace. Ascending would put the empty roles at the
 * top of every tier, which is the least informative row in the list.
 *
 * The key is the final tiebreak so the order is TOTAL: two roles with the same
 * level and the same count must not swap places between renders, and the order
 * a database returns rows in is not a promise.
 */
function byLevelThenFeatures(a: RoleRow, b: RoleRow): number {
  return a.levelRank - b.levelRank || b.featureCount - a.featureCount || a.key.localeCompare(b.key);
}

export function RolesPage({
  client,
  newHref = '/admin/roles/new',
  editHref = (roleId: string) => `/admin/roles/${roleId}/edit`,
}: {
  client?: PermissionsClient;
  newHref?: string;
  editHref?: (roleId: string) => string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  /*
   * Name → component, from whatever the app published. Null when no
   * `IconSetProvider` is mounted, in which case the column falls back to the
   * NAME — still useful, and honest about the fact that this frontend cannot
   * draw it. The module never owns the vocabulary; see IconPicker.
   */
  const iconSet = useIconSet();
  const iconsByName = useMemo(() => new Map((iconSet ?? []).map((option) => [option.name, option.Icon])), [iconSet]);
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .listRoles()
      .then((list) => {
        if (!cancelled) {
          setRoles(list.map(toRow).sort(byLevelThenFeatures));
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load roles.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(load, [load]);

  const columns = useMemo<DataGridColumn<RoleRow>[]>(
    () => [
      {
        field: 'icon',
        headerName: '',
        /*
         * Sized to the glyph: 16px icon plus a little air, and pinned so the
         * flex sizing of the columns beside it cannot stretch a 16px cell into
         * a gap.
         */
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        resizable: false,
        sortable: false,
        /*
         * Centring happens on the CELL, not inside the renderer.
         *
         * AG Grid gives `.ag-cell` its own horizontal padding and aligns
         * content to the start, so a wrapper `<span>` inside it centres within
         * whatever the padding left over — visibly off-centre in a column this
         * narrow. Zeroing the padding and making the cell itself the flex
         * container is what centres against the full cell box, vertically and
         * horizontally.
         */
        cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
        /*
         * The role's own icon — the same glyph the navbar badge draws, so the
         * two are recognisably one thing.
         */
        cellRenderer: (params: { data?: RoleRow }) => {
          const name = params.data?.icon;
          if (!name) {
            // No icon set. An empty cell reads as "none chosen", where any
            // placeholder would read as an icon somebody picked.
            return null;
          }
          const Icon = iconsByName.get(name);
          if (Icon) return <Icon aria-label={name} className="size-4 text-muted-foreground" />;
          /*
           * A name this frontend cannot draw — no provider mounted, or an icon
           * retired from the set. A dot rather than the name itself: the column
           * is glyph-width by design, and the stored name is on the title where
           * it can be read without stretching every row.
           */
          return (
            // `role="img"` so the name is an accessible name: a bare <span> has
            // no role that supports one, and the dot would announce nothing.
            <span role="img" title={name} aria-label={name} className="size-1.5 rounded-full bg-muted-foreground/50" />
          );
        },
      },
      { field: 'key', headerName: 'Key', flex: 2 },
      { field: 'label', headerName: 'Label', flex: 2 },
      {
        field: 'levelRank',
        headerName: 'Level',
        width: 150,
        /*
         * Sorted on the RANK, displayed as the label. Sorting the text would
         * order it alphabetically — App, Organization, Workspace happens to be
         * right by accident here, and would stop being right the moment a level
         * is renamed or added.
         */
        cellRenderer: (params: { data?: RoleRow }) =>
          params.data ? (
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                LEVEL_STYLE[params.data.level] ?? 'border-border text-muted-foreground',
              )}
            >
              {params.data.levelLabel}
            </span>
          ) : null,
      },
      { field: 'featureCount', headerName: 'Features', width: 110 },
      {
        field: 'status',
        headerName: 'Status',
        width: 120,
        /*
         * The one column that is not plain text. A disabled role grants nothing,
         * and a reader scanning the list needs that before they scan anything
         * else — an "Active"/"Disabled" word in the same colour as its
         * neighbours is exactly what the eye skips.
         */
        cellRenderer: (params: { data?: RoleRow }) =>
          params.data?.disabled ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Disabled
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Active</span>
          ),
      },
      {
        field: 'isSystem',
        headerName: 'Source',
        width: 130,
        /*
         * Says why a row cannot be edited BEFORE someone tries. A system role is
         * replaced by `db:sync` on every deploy, so an edit would look saved and
         * be reverted — the trap the feature screens are built around.
         */
        cellRenderer: (params: { data?: RoleRow }) =>
          params.data?.isSystem ? (
            <span className="text-xs text-muted-foreground" title="Defined in the application; replaced on deploy">
              Built in
            </span>
          ) : (
            <span className="text-xs">Custom</span>
          ),
      },
      { field: 'featureText', headerName: 'Feature keys', flex: 3, hide: true },
    ],
    [iconsByName],
  );

  return (
    <AdminPage
      title="Roles"
      description="What each role grants, and who can hold it. A role is exactly the list of features it carries — there is no inheritance."
      feature={FEATURE.rolesRead}
      layout="fill"
    >
      <div className="flex h-full w-full flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FeatureGate allOf={[FEATURE.rolesCreate]}>
            <a href={newHref} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              New role
            </a>
          </FeatureGate>
          {/*
            The only way anyone learns the editor exists, now that both the Edit
            button and the Disable button have moved into it. Always visible —
            the moment to find out how to open a role is before you have picked
            one, and there is no selection here to hang it off any more.
          */}
          <p className="text-xs text-muted-foreground">Double-click a role to edit it.</p>
        </div>

        {error ? (
          <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {/* A skeleton, not a spinner: the shape is known, so reserving it stops
            the toolbar jumping when the rows land. */}
        {roles === null && !error ? (
          <div className="h-64 animate-pulse rounded-md bg-muted" />
        ) : (
          <DataGrid<RoleRow>
            rows={roles ?? []}
            columns={columns}
            height="fill"
            searchPlaceholder="Search roles…"
            // The role id, so sorting or filtering cannot slide the selection
            // onto a different row before Disable acts on it.
            getRowId={(role) => role.id}
            /*
             * Double-click is the ONLY route to the editor, by request — the
             * toolbar Edit button was removed.
             *
             * Worth knowing what that costs, since the grid convention here
             * assumes otherwise: a double-click is undiscoverable until someone
             * is told, and there is no double-click on a touchscreen. The hint
             * under the toolbar is what stands in for the button; if this ever
             * needs to work on a tablet it needs a control again.
             *
             * A SYSTEM role navigates too, rather than silently doing nothing.
             * The edit page explains why it cannot be changed and points at
             * cloning — which is far better feedback than a double-click that
             * appears broken.
             */
            onRowActivate={(role) => window.location.assign(editHref(role.id))}
          />
        )}
      </div>
    </AdminPage>
  );
}
