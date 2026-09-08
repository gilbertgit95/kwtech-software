'use client';

import { DataGrid, type DataGridColumn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import {
  createPermissionsClient,
  type OrganizationView,
  type PermissionsClient,
  type SubscriptionView,
} from '../permissions-client.js';
import { AdminPage } from './admin-page.js';

/**
 * The tenants on the platform.
 *
 * ## A PLATFORM view, not a tenant one
 *
 * Gated on `organizations:read`, which is APP level: this lists every
 * organization, so it answers a question only platform staff have. A tenant
 * administrator reading their OWN organization is a different screen and needs
 * the active-organization scope that PLAN §12.13 still defers — until then, an
 * organization-level role sees nothing here, because `/admin/*` resolves at app
 * level and their role never participates.
 *
 * That is worth knowing before this screen is shown to a customer: it is built
 * for the people who run the platform.
 *
 * ## The list is read-only
 *
 * New is the only action; everything else — members, workspaces, roles — lives
 * on the detail screen, reached by double-clicking a row. The same arrangement
 * the roles and plans lists use, and for the same reason: removing somebody
 * from a tenant is a decision that belongs on a screen showing who they are.
 */

interface OrganizationRow extends OrganizationView {
  /** Joined so the grid's quick filter matches a workspace name by substring. */
  workspaceText: string;
  /**
   * What this tenant is currently entitled by, as a label.
   *
   * A STRING rather than the subscription, because a grid column reads a field
   * and the three states it has to distinguish — a live plan, none, and "not
   * allowed to know" — are three sentences rather than three shapes.
   */
  planLabel: string;
}

/**
 * The organization-wide subscription that is actually entitling.
 *
 * Three conditions, and each has bitten somewhere in this codebase already:
 * `status: 'active'` because a canceled row still names a plan; an unarchived
 * plan because an archived one entitles nothing however live the row looks; and
 * `workspaceId === null` because a workspace's own plan ADDS to the
 * organization's rather than being it — showing one in this column would report
 * a tenant as subscribed on the strength of a plan that covers one workspace.
 */
function organizationWidePlan(subscriptions: readonly SubscriptionView[], organizationId: string) {
  return subscriptions.find(
    (subscription) =>
      subscription.organizationId === organizationId &&
      subscription.workspaceId === null &&
      subscription.status === 'active' &&
      !subscription.planArchived,
  );
}

function toRow(organization: OrganizationView, subscriptions: readonly SubscriptionView[] | null): OrganizationRow {
  const plan = subscriptions ? organizationWidePlan(subscriptions, organization.id) : undefined;
  return {
    ...organization,
    workspaceText: organization.workspaces.map((w) => w.name).join(' '),
    /*
     * Three states, said in three ways. An em dash for "cannot be read here" is
     * deliberately not the same as "no plan": the subscriptions read is guarded
     * by `subscriptions:read`, a different key from the one that opens this
     * page, so a legitimate reader may see the tenants and not what they bought.
     */
    planLabel: subscriptions === null ? '—' : (plan?.planLabel ?? 'No plan'),
  };
}

export function OrganizationsPage({
  client,
  newHref = '/admin/organizations/new',
  detailHref = (organizationId: string) => `/admin/organizations/${organizationId}`,
}: {
  client?: PermissionsClient;
  newHref?: string;
  detailHref?: (organizationId: string) => string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [rows, setRows] = useState<OrganizationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    /*
     * Two reads behind two different keys. The subscriptions one FAILS SOFT to
     * null — a reader holding `organizations:read` and not `subscriptions:read`
     * is a legitimate configuration, and the honest result for them is a column
     * that says nothing rather than a page that says nothing.
     *
     * Joined here rather than server-side for the same reason: embedding the
     * plan in the organization read would hand it to whoever may list tenants,
     * collapsing a split the registry makes on purpose.
     */
    Promise.all([api.listOrganizations(), api.listSubscriptions().catch(() => null)])
      .then(([list, subscriptions]) => {
        if (!cancelled) {
          // Already sorted by name server-side; mapped, not re-sorted, so the
          // two agree about order rather than each having an opinion.
          setRows(list.map((organization) => toRow(organization, subscriptions)));
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load organizations.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(load, [load]);

  const columns = useMemo<DataGridColumn<OrganizationRow>[]>(
    () => [
      { field: 'name', headerName: 'Organization', flex: 3 },
      { field: 'key', headerName: 'Key', flex: 2 },
      {
        field: 'memberCount',
        headerName: 'Members',
        width: 120,
        /*
         * ACTIVE members. An invited or suspended row is a person who cannot
         * act, and counting them would make a seat cap look breached when it is
         * not — `assertCapacity` counts the same way, which is the point.
         */
      },
      { field: 'workspaceCount', headerName: 'Workspaces', width: 130 },
      /*
       * What they are entitled BY, which is the question the members and
       * workspace counts cannot answer: an organization with no active plan is
       * entitled to nothing at organization level, however many people are in
       * it.
       */
      { field: 'planLabel', headerName: 'Plan', width: 150 },
      { field: 'workspaceText', headerName: 'Workspace names', flex: 3, hide: true },
    ],
    [],
  );

  return (
    <AdminPage
      title="Organizations"
      description="The tenants on this platform, their people and their workspaces. A subscription attaches a plan to one of these."
      feature={FEATURE.organizationsRead}
      layout="fill"
    >
      <div className="flex h-full w-full flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/*
            No FeatureGate around New, deliberately.

            `createOrganization` is guarded by the `user:organizations` LIMIT
            rather than by a feature — creating an organization is not a right an
            organization grants, because there is no organization yet to grant
            it. There is no key to gate this button on, and inventing one would
            contradict the model. The cap refuses at the write.
          */}
          <a href={newHref} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            New organization
          </a>
          <p className="text-xs text-muted-foreground">Double-click an organization to manage it.</p>
        </div>

        {error ? (
          <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {rows === null && !error ? (
          <div className="h-64 animate-pulse rounded-md bg-muted" />
        ) : (
          <DataGrid<OrganizationRow>
            rows={rows ?? []}
            columns={columns}
            height="fill"
            searchPlaceholder="Search organizations…"
            getRowId={(organization) => organization.id}
            onRowActivate={(organization) => window.location.assign(detailHref(organization.id))}
          />
        )}
      </div>
    </AdminPage>
  );
}
