'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import {
  createPermissionsClient,
  type FeatureView,
  type PermissionsClient,
  type PlanView,
} from '../permissions-client.js';
import { AdminPage } from './admin-page.js';
import { PlanForm } from './plan-form.js';

/**
 * /admin/plans/new — define a plan.
 *
 * ONE step, unlike the role create screen, which asks what the role is and
 * sends you elsewhere to pick features. That split exists because a role's
 * offerable features depend on its level, so the list would re-filter under the
 * cursor; a plan has no level, so the picker is stable from the start and there
 * is nothing to settle first. See `PlanForm`.
 *
 * The existing plans are still loaded: `validatePlanDraft` needs the keys
 * already taken, and the clone picker needs the plans themselves.
 */
export function PlanNewPage({
  client,
  listHref = '/admin/plans',
  editHref = (planKey: string) => `/admin/plans/${encodeURIComponent(planKey)}/edit`,
}: {
  client?: PermissionsClient;
  listHref?: string;
  /** Where a freshly created plan opens, so it can be adjusted. */
  editHref?: (planKey: string) => string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [features, setFeatures] = useState<FeatureView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /*
     * Both, together. The plans are for the clone picker and the duplicate-key
     * check; the features are the sellable vocabulary, which must come from the
     * API rather than this package's own registry — otherwise another module's
     * keys are invisible and a clone silently drops them.
     */
    Promise.all([api.listPlans(), api.listFeatures()])
      .then(([planList, featureList]) => {
        if (cancelled) return;
        setPlans(planList);
        setFeatures(featureList);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load existing plans.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /*
   * Into the new plan's EDITOR, not back to the list.
   *
   * The plan is complete when it saves — unlike a new role, which grants
   * nothing until features are chosen — so this is not a "you are half done"
   * redirect. It is where somebody goes next anyway: the first thing anyone
   * does after creating a plan is check what it says, and the editor is also
   * where archiving lives if it was created by mistake.
   */
  const onSaved = useCallback((plan: PlanView) => window.location.assign(editHref(plan.key)), [editHref]);

  return (
    <AdminPage
      title="New plan"
      description="A plan is exactly the list of features it sells, plus the caps it sets. A role still has to grant those features to a person."
      feature={FEATURE.plansCreate}
      backTo={{ href: listHref, label: 'Plans' }}
    >
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : plans === null || features === null ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : (
        <PlanForm client={api} allPlans={plans} features={features} onSaved={onSaved} cancelHref={listHref} />
      )}
    </AdminPage>
  );
}
