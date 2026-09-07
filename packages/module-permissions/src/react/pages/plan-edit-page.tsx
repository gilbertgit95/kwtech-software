'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import {
  createPermissionsClient,
  type FeatureView,
  type PermissionsClient,
  type PlanView,
} from '../permissions-client.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';
import { PlanForm } from './plan-form.js';

/**
 * /admin/plans/:planKey/edit — change what a plan sells.
 *
 * The entitlement twin of `RoleEditPage`, with one thing missing on purpose:
 * there is no read-only "this is a system plan" branch. Nothing seeds plans,
 * because WHICH products a platform sells is not a decision a module — or a
 * checkout — should make on an operator's behalf. Every plan was created by an
 * administrator, so every plan is theirs to change.
 */
export function PlanEditPage({
  planKey,
  client,
  listHref = '/admin/plans',
}: {
  planKey: string | undefined;
  client?: PermissionsClient;
  listHref?: string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [features, setFeatures] = useState<FeatureView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listPlans(), api.listFeatures()])
      .then(([planList, featureList]) => {
        if (cancelled) return;
        setPlans(planList);
        setFeatures(featureList);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the plan.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /*
   * STAYS ON THE PAGE, like the role editor and for the same reason: this is
   * the working surface, and a save is usually followed by another. It only
   * refreshes what the page is holding, so the feature count and archived state
   * stay true; the form shows its own "Saved." confirmation.
   */
  const onSaved = useCallback(
    (updated: PlanView) =>
      setPlans((current) => (current ?? []).map((candidate) => (candidate.key === updated.key ? updated : candidate))),
    [],
  );

  const plan = plans?.find((candidate) => candidate.key === planKey);

  const toggleArchived = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const updated = await api.setPlanArchived(plan.key, !plan.archived);
      onSaved(updated);
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the plan.');
    } finally {
      setBusy(false);
    }
  }, [api, plan, onSaved]);

  return (
    <AdminPage
      title={plan ? `Edit ${plan.label}` : 'Edit plan'}
      description="The key cannot change — every subscription ever written reads it."
      feature={FEATURE.plansUpdate}
      backTo={{ href: listHref, label: 'Plans' }}
    >
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : plans === null || features === null ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !plan ? (
        <AdminPlaceholder>No plan with that key. It may have been renamed.</AdminPlaceholder>
      ) : (
        <>
          {/*
            The archived state belongs HERE as well as on the list. Someone who
            opened a plan to change what it sells needs to know the answer is
            currently "nothing" — otherwise they adjust features, save, and
            wonder why subscribers still cannot do anything.
          */}
          {plan.archived ? (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
              <p className="text-sm text-destructive">
                This plan is archived. It entitles nothing and nothing new can subscribe to it — no subscription was
                deleted, and the features below are kept.
              </p>
              <FeatureGate allOf={[FEATURE.plansArchive]}>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                >
                  Restore
                </button>
              </FeatureGate>
            </div>
          ) : null}

          <PlanForm
            client={api}
            plan={plan}
            allPlans={plans}
            features={features}
            onSaved={onSaved}
            cancelHref={listHref}
          />

          {!plan.archived ? (
            <FeatureGate allOf={[FEATURE.plansArchive]}>
              {/*
                Below the form and visually quiet: retiring a plan is not part
                of editing it, and a control that cuts off entitlement for every
                live subscriber must not sit beside Save.
              */}
              <div className="mt-8 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                  className="text-sm text-destructive hover:underline disabled:opacity-60"
                >
                  Archive this plan
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Everyone currently on it stops being entitled. Nothing is deleted, and it can be restored. To stop
                  offering a plan while still honouring it, untick “Offer this plan in the catalogue” instead.
                </p>
              </div>
            </FeatureGate>
          ) : null}

          <ConfirmDialog
            open={confirming}
            title={plan.archived ? `Restore ${plan.label}?` : `Archive ${plan.label}?`}
            confirmLabel={plan.archived ? 'Restore' : 'Archive'}
            danger={!plan.archived}
            pending={busy}
            description={
              plan.archived ? (
                <>
                  Every organization still subscribed to <strong>{plan.key}</strong> gets its {plan.features.length}{' '}
                  feature{plan.features.length === 1 ? '' : 's'} back immediately.
                </>
              ) : (
                <>
                  <strong>{plan.key}</strong> will entitle nothing, and every organization on it loses those features on
                  their next request. No subscription is deleted and no history is lost — restore it and everything
                  returns.
                </>
              )
            }
            onConfirm={() => void toggleArchived()}
            onCancel={() => setConfirming(false)}
          />
        </>
      )}
    </AdminPage>
  );
}
