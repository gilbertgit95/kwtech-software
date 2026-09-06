'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import {
  createPermissionsClient,
  type FeatureView,
  type PermissionsClient,
  type RoleView,
} from '../permissions-client.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';
import { RoleForm } from './role-form.js';

/**
 * /admin/roles/:roleId/edit — change what a role grants.
 *
 * A SYSTEM role is refused here rather than saved and reverted: `db:sync`
 * replaces what those grant on every deploy from the definitions in the
 * checkout, so an edit would look accepted and disappear at the next release.
 * The write path refuses it too — this is the half that explains why.
 */
export function RoleEditPage({
  roleId,
  client,
  listHref = '/admin/roles',
  iconOptions,
}: {
  roleId: string | undefined;
  client?: PermissionsClient;
  listHref?: string;
  iconOptions?: readonly string[];
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [roles, setRoles] = useState<RoleView[] | null>(null);
  const [features, setFeatures] = useState<FeatureView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

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
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the role.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /*
   * STAYS ON THE PAGE, unlike the create screen which redirects here.
   *
   * This is the working surface: features are assigned a few at a time, and
   * every save is usually followed by another. Bouncing to the list after each
   * one would make the loop the create flow deliberately sets up — land here,
   * assign, save — cost a navigation every iteration. The form shows its own
   * "Saved." confirmation; this only refreshes what the page is holding, so the
   * feature count and disabled state stay true.
   */
  const onSaved = useCallback(
    (updated: RoleView) =>
      setRoles((current) => (current ?? []).map((candidate) => (candidate.id === updated.id ? updated : candidate))),
    [],
  );

  const role = roles?.find((candidate) => candidate.id === roleId);

  const toggleDisabled = useCallback(async () => {
    if (!role) return;
    setBusy(true);
    try {
      const updated = await api.setRoleDisabled(role.id, !role.disabled);
      onSaved(updated);
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the role.');
    } finally {
      setBusy(false);
    }
  }, [api, role, onSaved]);

  return (
    <AdminPage
      title={role ? `Edit ${role.label}` : 'Edit role'}
      description="The key and level cannot change — every grant already made reads both."
      feature={FEATURE.rolesUpdate}
      backTo={{ href: listHref, label: 'Roles' }}
    >
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : roles === null || features === null ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !role ? (
        <AdminPlaceholder>No role with that id. It may have been removed.</AdminPlaceholder>
      ) : role.isSystem ? (
        /*
         * SHOWN, not refused.
         *
         * This used to render an explanation instead of the role, which meant
         * the one thing a reader came for — what does this role actually grant?
         * — was the one thing they could not see. A built-in role is also the
         * most useful thing to inspect: it is the worked example somebody
         * clones when making their own.
         */
        <>
          <div className="mb-6 rounded-md border border-border bg-muted px-4 py-3">
            <p className="text-sm font-medium">This role is not editable.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              <strong>{role.key}</strong> is defined in the application and rewritten on every deploy, so a change made
              here would be reverted at the next release. To make a variation of it, create a new role and clone this
              one into it.
            </p>
          </div>
          <RoleForm
            client={api}
            role={role}
            allRoles={roles}
            features={features}
            readOnly
            onSaved={onSaved}
            cancelHref={listHref}
            {...(iconOptions ? { iconOptions } : {})}
          />
        </>
      ) : (
        <>
          {/*
            The disabled state belongs HERE as well as on the list. Someone who
            opened a role to change what it grants needs to know the answer is
            currently "nothing" — otherwise they assign features, save, and
            wonder why the holders still cannot do anything.
          */}
          {role.disabled ? (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
              <p className="text-sm text-destructive">
                This role is disabled. It grants nothing until it is turned back on — nobody has lost it, and the
                features below are kept.
              </p>
              <FeatureGate allOf={[FEATURE.rolesDisable]}>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                >
                  Enable
                </button>
              </FeatureGate>
            </div>
          ) : null}

          <RoleForm
            client={api}
            role={role}
            allRoles={roles}
            features={features}
            onSaved={onSaved}
            cancelHref={listHref}
            {...(iconOptions ? { iconOptions } : {})}
          />

          {!role.disabled && !role.isSystem ? (
            <FeatureGate allOf={[FEATURE.rolesDisable]}>
              {/*
                Below the form and visually quiet: turning a role off is not
                part of editing it, and a destructive control sitting beside
                Save is one mis-aimed click from an outage.
              */}
              <div className="mt-8 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                  className="text-sm text-destructive hover:underline disabled:opacity-60"
                >
                  Disable this role
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                  It stops granting anything. Nobody loses it, nothing is deleted, and it can be turned back on.
                </p>
              </div>
            </FeatureGate>
          ) : null}

          <ConfirmDialog
            open={confirming}
            title={role.disabled ? `Enable ${role.label}?` : `Disable ${role.label}?`}
            confirmLabel={role.disabled ? 'Enable' : 'Disable'}
            danger={!role.disabled}
            pending={busy}
            description={
              role.disabled ? (
                <>
                  Everyone holding <strong>{role.key}</strong> gets its {role.features.length} feature
                  {role.features.length === 1 ? '' : 's'} back immediately.
                </>
              ) : (
                <>
                  <strong>{role.key}</strong> will grant nothing. Nobody loses the role and no history is deleted — turn
                  it back on and everything returns.
                </>
              )
            }
            onConfirm={() => void toggleDisabled()}
            onCancel={() => setConfirming(false)}
          />
        </>
      )}
    </AdminPage>
  );
}
