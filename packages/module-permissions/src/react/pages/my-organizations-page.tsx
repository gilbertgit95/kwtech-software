'use client';

import { useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MyOrganizationView, PermissionsClient } from '../permissions-client.js';
import { createPermissionsClient } from '../permissions-client.js';
import { ORGANIZATION_NEW_HREF, organizationHref } from '../tenant-nav.js';
import { AdminPlaceholder } from './admin-page.js';
import { TenantPage } from './tenant-page.js';

/**
 * `/organizations` — where the viewer belongs, and the way into each.
 *
 * ## Unguarded, and that is the whole point
 *
 * Every other screen in this area takes `organization:read`, which is an
 * ORGANIZATION-level key: you hold it inside a tenant, granted by a role there.
 * This one cannot take it, because somebody who belongs nowhere holds nothing
 * anywhere — and they are exactly the person who needs to reach this page, to
 * find the organization an invitation put them in or to create their first.
 *
 * A key here would be a key you need before you can be given any key.
 *
 * ## Not a grid
 *
 * The admin organization list is a `DataGrid`, because its job is comparing
 * hundreds of tenants against each other — filtering, sorting, counting. This
 * list is somewhere between one and five rows and its job is "take me in". A
 * grid of three rows makes a destination look like a dataset.
 *
 * ## The role is shown
 *
 * A person's role differs per organization — that is the point of the level —
 * so "which one am I an owner of" is a real question this list can answer and
 * the switcher in the drawer also answers. It is drawn from the icon set the
 * app published; with no set mounted the label stands alone.
 */
export function MyOrganizationsPage({ client }: { client?: PermissionsClient }) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const iconSet = useIconSet();
  const iconsByName = useMemo(() => new Map((iconSet ?? []).map((option) => [option.name, option.Icon])), [iconSet]);
  const [rows, setRows] = useState<MyOrganizationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.listMyOrganizations());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your organizations.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TenantPage
      title="Organizations"
      description="The organizations you belong to. Open one to see its people, its workspaces and what it is subscribed to."
    >
      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mb-4 flex justify-end">
        {/*
          Always offered, never gated. `createOrganization` is bounded by the
          `user:organizations` LIMIT rather than by a feature — there is no
          organization yet to grant the right — so there is no key to hide this
          behind, and the cap does the refusing at the write. Hiding it on a
          guess about somebody's cap would mean reading a limit to decide
          whether to show a button that then reports the limit anyway.
        */}
        <a
          href={ORGANIZATION_NEW_HREF}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          New organization
        </a>
      </div>

      {rows === null ? (
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      ) : rows.length === 0 ? (
        <AdminPlaceholder>
          You are not in any organization yet. Create one, or ask somebody to invite you to theirs — an invitation
          arrives by email and can create your membership on the spot.
        </AdminPlaceholder>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const RoleIcon = row.roleIcon ? iconsByName.get(row.roleIcon) : undefined;
            return (
              <li key={row.organizationId}>
                <a
                  href={organizationHref(row.organizationId)}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{row.organizationName}</span>
                    {/*
                      The DESCRIPTION where it says something the name does not,
                      otherwise the key.
                      
                      Every organization starts with its name copied into the
                      description, so showing it unconditionally would print the
                      same string twice on most rows — which reads as a
                      rendering bug rather than as a default. The key is the
                      useful fallback: it is what appears in the URL and what
                      somebody would say out loud, where the id is a cuid nobody
                      reads.
                    */}
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.organizationDescription && row.organizationDescription !== row.organizationName
                        ? row.organizationDescription
                        : row.organizationKey}
                    </span>
                  </span>
                  {row.roleLabel ? (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                      {RoleIcon ? <RoleIcon aria-hidden="true" className="size-3.5" /> : null}
                      {row.roleLabel}
                    </span>
                  ) : (
                    /*
                      A member with no role is a real and unremarkable state —
                      somebody was added and not yet given anything. Saying so
                      beats an empty space, which reads as a rendering failure.
                    */
                    <span className="shrink-0 text-xs text-muted-foreground">No role</span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </TenantPage>
  );
}
