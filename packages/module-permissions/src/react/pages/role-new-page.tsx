'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import {
  createPermissionsClient,
  type FeatureView,
  type PermissionsClient,
  type RoleView,
} from '../permissions-client.js';
import { AdminPage } from './admin-page.js';
import { RoleForm } from './role-form.js';

/**
 * /admin/roles/new — define a role.
 *
 * Asks only what the role IS — key, label, icon, level, organization. Features
 * come next, on the editor this redirects to, because which features may be
 * offered depends on the level being settled first.
 *
 * The existing roles are still loaded: `validateRoleDraft` needs the keys
 * already taken in this scope, which the DATABASE cannot enforce for app-level
 * roles and shared presets (organizationId is null there, and Postgres treats
 * NULLs as distinct in a unique index — PLAN §12.19).
 */
export function RoleNewPage({
  client,
  listHref = '/admin/roles',
  editHref = (roleId: string) => `/admin/roles/${roleId}/edit`,
  iconOptions,
}: {
  client?: PermissionsClient;
  listHref?: string;
  /** Where a freshly created role opens, so its features can be chosen. */
  editHref?: (roleId: string) => string;
  iconOptions?: readonly string[];
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [roles, setRoles] = useState<RoleView[] | null>(null);
  const [features, setFeatures] = useState<FeatureView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /*
     * Both, together. The roles are for the clone picker and the duplicate-key
     * check; the features are the grantable vocabulary, which must come from
     * the API rather than this package's own registry — otherwise another
     * module's keys are invisible and a clone silently drops them.
     */
    Promise.all([api.listRoles(), api.listFeatures()])
      .then(([roleList, featureList]) => {
        if (cancelled) return;
        setRoles(roleList);
        setFeatures(featureList);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load existing roles.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /*
   * Straight into the new role's EDITOR, not back to the list.
   *
   * A role created here grants nothing yet — features are the next step, and
   * the level had to be fixed first for the list to be filterable at all.
   * Returning to the list would leave someone looking at a row that does
   * nothing, with no indication that they are half done.
   */
  const onSaved = useCallback((role: RoleView) => window.location.assign(editHref(role.id)), [editHref]);

  return (
    <AdminPage
      title="New role"
      description="A role is exactly the list of features it carries. There is no inheritance."
      feature={FEATURE.rolesCreate}
      backTo={{ href: listHref, label: 'Roles' }}
    >
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : roles === null || features === null ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : (
        <RoleForm
          client={api}
          allRoles={roles}
          features={features}
          onSaved={onSaved}
          cancelHref={listHref}
          {...(iconOptions ? { iconOptions } : {})}
        />
      )}
    </AdminPage>
  );
}
