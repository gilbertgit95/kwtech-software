'use client';

import { DataGrid, type DataGridColumn, useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIMIT_REGISTRY } from '../../domain/limits.js';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import { createPermissionsClient, type PermissionsClient, type PlanView } from '../permissions-client.js';
import { PLAN_CHANGED, type RealtimeConnection } from '../realtime-contract.js';
import { AdminPage } from './admin-page.js';

/**
 * The plans the platform sells, what each entitles, and which are retired.
 *
 * The entitlement twin of the Roles list, and built the same way for the same
 * reasons — a plan is a named collection of features an organization can BUY,
 * as a role is one a person can be GIVEN. Where the two screens differ is
 * commented at the difference and nowhere else.
 *
 * ## Archived plans are SHOWN
 *
 * The entitlement path filters them out — an archived plan entitles nothing.
 * A list must do the opposite: hide them and the switch reads as a delete, and
 * nobody can find the plan to bring it back.
 *
 * ## This list is read-only
 *
 * The only action here is New; editing, archiving and un-archiving live in the
 * EDITOR, reached by double-clicking a row. That keeps the destructive control
 * next to the thing it destroys — archiving a plan cuts entitlement off for
 * every live subscriber, so the decision belongs on a screen showing what the
 * plan carries rather than beside a checkbox.
 *
 * There is no delete anywhere. Every subscription ever written points at the
 * plan row, so removing it would either cascade that history away or fail on a
 * foreign key.
 */

/**
 * The plan-sourced caps, in registry order, as columns.
 *
 * Derived rather than listed, so a limit added to `LIMIT_REGISTRY` appears here
 * on the next build. A hand-written list would silently stop showing a cap that
 * a plan is nonetheless selling — which is the failure mode this whole registry
 * pattern exists to avoid.
 *
 * Role-sourced caps are excluded: `user:organizations` comes from an app-level
 * role and has no meaning inside a plan, so a column for it would be blank on
 * every row forever.
 */
const PLAN_LIMITS = LIMIT_REGISTRY.filter((spec) => spec.source === 'plan');

interface PlanRow extends PlanView {
  featureCount: number;
  /** Joined so the grid's quick filter matches a feature key by substring. */
  featureText: string;
  status: string;
  visibility: string;
  /** Flattened, because a grid column reads a field and cannot walk a list. */
  limitValues: Record<string, number | null>;
}

function toRow(plan: PlanView): PlanRow {
  const byKey = new Map(plan.limits.map((limit) => [limit.limitKey, limit.value]));
  return {
    ...plan,
    featureCount: plan.features.length,
    featureText: plan.features.join(' '),
    status: plan.archived ? 'Archived' : 'Live',
    visibility: plan.isPublic ? 'Public' : 'Private',
    limitValues: Object.fromEntries(PLAN_LIMITS.map((spec) => [spec.key, byKey.get(spec.key) ?? null])),
  };
}

/**
 * Live plans first, then archived; within each, the plans that entitle MOST
 * come first, and ties break by key.
 *
 * Descending on feature count for the reason the roles list gives: the ordering
 * then means one thing the whole way down — reach, widest first — and ascending
 * would put the empty plans at the top, which is the least informative row in
 * the list. The key is the final tiebreak so the order is TOTAL: two plans with
 * the same count must not swap places between renders, and the order a database
 * returns rows in is not a promise.
 */
function byStatusThenFeatures(a: PlanRow, b: PlanRow): number {
  return Number(a.archived) - Number(b.archived) || b.featureCount - a.featureCount || a.key.localeCompare(b.key);
}

export function PlansPage({
  client,
  realtime,
  newHref = '/admin/plans/new',
  editHref = (planKey: string) => `/admin/plans/${encodeURIComponent(planKey)}/edit`,
}: {
  client?: PermissionsClient;
  /**
   * Live updates, if the app wired a socket.
   *
   * OPTIONAL, and the page is fully usable without it — the list loads over
   * HTTP and every action works. That is deliberate: a WebSocket is an
   * enhancement, and a screen that needed one would be a screen that breaks
   * behind a proxy that blocks upgrades.
   */
  realtime?: RealtimeConnection;
  newHref?: string;
  editHref?: (planKey: string) => string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  /*
   * Name → component, from whatever the app published. Null when no
   * `IconSetProvider` is mounted, in which case the column degrades to a dot
   * rather than disappearing — see the cell renderer.
   */
  const iconSet = useIconSet();
  const iconsByName = useMemo(() => new Map((iconSet ?? []).map((option) => [option.name, option.Icon])), [iconSet]);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .listPlans()
      .then((list) => {
        if (!cancelled) {
          setPlans(list.map(toRow).sort(byStatusThenFeatures));
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load plans.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(load, [load]);

  /*
   * Re-read when somebody else changes a plan.
   *
   * The event carries only the KEY, and this deliberately ignores it and
   * reloads the list. Two reasons, and the second is the important one: the
   * grid shows every plan, so a targeted patch would still need the row; and
   * re-reading goes back through the GUARDED query, so what lands on screen is
   * what this reader is allowed to see rather than whatever the writer sent.
   * One authorization path, not two.
   *
   * This is what closes the concurrent-edit gap on this screen: two
   * administrators no longer see different truths until one of them reloads.
   */
  useEffect(() => {
    if (!realtime) return;
    return realtime.subscribe(PLAN_CHANGED, () => load());
  }, [realtime, load]);

  const columns = useMemo<DataGridColumn<PlanRow>[]>(
    () => [
      {
        field: 'icon',
        headerName: '',
        /*
         * Sized to the glyph and pinned, so the flex sizing of the columns
         * beside it cannot stretch a 16px cell into a gap. The same column the
         * roles grid carries, and deliberately identical: a plan badge and a
         * role badge are the same kind of thing in two lists.
         */
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        resizable: false,
        sortable: false,
        /*
         * Centring happens on the CELL, not inside the renderer: AG Grid gives
         * `.ag-cell` its own padding and start alignment, so a wrapper span
         * centres within whatever the padding left over — visibly off-centre in
         * a column this narrow.
         */
        cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
        cellRenderer: (params: { data?: PlanRow }) => {
          const name = params.data?.icon;
          // An empty cell reads as "none chosen", where any placeholder would
          // read as an icon somebody picked.
          if (!name) return null;
          const Icon = iconsByName.get(name);
          if (Icon) return <Icon aria-label={name} className="size-4 text-muted-foreground" />;
          /*
           * A name this frontend cannot draw — no provider mounted, or an icon
           * retired from the set. A dot rather than the name: the column is
           * glyph-width by design, and the stored name is on the title where it
           * can be read without stretching every row.
           */
          return (
            // `role="img"` so the name is an accessible name: a bare span has no
            // role that supports one, and the dot would announce nothing.
            <span role="img" title={name} aria-label={name} className="size-1.5 rounded-full bg-muted-foreground/50" />
          );
        },
      },
      { field: 'key', headerName: 'Key', flex: 2 },
      { field: 'label', headerName: 'Label', flex: 2 },
      { field: 'featureCount', headerName: 'Features', width: 110 },
      /*
       * One column per plan-sourced cap, addressed by `colId` rather than
       * `field`: a field is a path into the row and cannot carry a colon, which
       * 'organization:members' has. The cell reads the flattened map instead.
       *
       * `sortable: false` follows from that, and is the cost worth naming: AG
       * Grid sorts on a field or a value getter, and this column has neither.
       * Ordering plans by seat count is a real thing to want; when it is wanted,
       * the fix is a typed getter, not a re-keyed registry.
       */
      ...PLAN_LIMITS.map(
        (spec): DataGridColumn<PlanRow> => ({
          colId: spec.key,
          headerName: spec.label,
          width: 160,
          sortable: false,
          /*
           * An unset cap shows an em dash, not a blank and not the floor.
           *
           * The floor would be a lie in the most expensive direction: a required
           * cap is refused at write time when absent, so an empty cell means
           * something is wrong with the row rather than that it sells one seat.
           */
          cellRenderer: (params: { data?: PlanRow }) => {
            const value = params.data?.limitValues[spec.key] ?? null;
            return value === null ? <span className="text-muted-foreground">—</span> : <span>{value}</span>;
          },
        }),
      ),
      {
        field: 'visibility',
        headerName: 'Visibility',
        width: 120,
        /*
         * Listing, not entitlement. A private plan is fully live for whoever is
         * already on it, which is why this is a separate column from Status
         * rather than a second value inside it.
         */
        cellRenderer: (params: { data?: PlanRow }) =>
          params.data?.isPublic ? (
            <span className="text-xs text-muted-foreground">Public</span>
          ) : (
            <span
              className="text-xs text-muted-foreground"
              title="Not offered in the catalogue. Still honoured for anyone already subscribed."
            >
              Private
            </span>
          ),
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 120,
        /*
         * The one column that is not plain text, for the reason the roles grid
         * highlights Disabled: an archived plan entitles nothing, and a reader
         * scanning the list needs that before anything else — a word in the
         * same colour as its neighbours is exactly what the eye skips.
         */
        cellRenderer: (params: { data?: PlanRow }) =>
          params.data?.archived ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Archived
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Live</span>
          ),
      },
      { field: 'featureText', headerName: 'Feature keys', flex: 3, hide: true },
    ],
    [iconsByName],
  );

  return (
    <AdminPage
      title="Plans"
      description="What each plan entitles an organization to. A plan is exactly the list of features it carries — a role still has to grant them to a person."
      feature={FEATURE.plansRead}
      layout="fill"
    >
      <div className="flex h-full w-full flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FeatureGate allOf={[FEATURE.plansCreate]}>
            <a href={newHref} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              New plan
            </a>
          </FeatureGate>
          {/*
            The only way anyone learns the editor exists. Always visible — the
            moment to find out how to open a plan is before you have picked one,
            and there is no selection here to hang it off.

            Worth knowing what double-click costs, since it is the only route:
            it is undiscoverable until someone is told, and there is no
            double-click on a touchscreen. The same trade the roles list makes.
          */}
          <p className="text-xs text-muted-foreground">Double-click a plan to edit it.</p>
        </div>

        {error ? (
          <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {plans === null && !error ? (
          <div className="h-64 animate-pulse rounded-md bg-muted" />
        ) : (
          <DataGrid<PlanRow>
            rows={plans ?? []}
            columns={columns}
            height="fill"
            searchPlaceholder="Search plans…"
            // The plan key, which IS the primary key — so sorting or filtering
            // cannot slide the selection onto a different row.
            getRowId={(plan) => plan.key}
            onRowActivate={(plan) => window.location.assign(editHref(plan.key))}
          />
        )}
      </div>
    </AdminPage>
  );
}
