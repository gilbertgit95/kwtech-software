'use client';

import { DataGrid, type DataGridColumn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { createPermissionsClient, type OrganizationView, type PermissionsClient } from '../permissions-client.js';
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
}

function toRow(organization: OrganizationView): OrganizationRow {
  return { ...organization, workspaceText: organization.workspaces.map((w) => w.name).join(' ') };
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
    api
      .listOrganizations()
      .then((list) => {
        if (!cancelled) {
          // Already sorted by name server-side; mapped, not re-sorted, so the
          // two agree about order rather than each having an opinion.
          setRows(list.map(toRow));
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
