'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import {
  createPermissionsClient,
  type OrganizationView,
  type PermissionsClient,
  type PlanView,
  type SubscriptionView,
} from '../permissions-client.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';
import { SubscriptionForm } from './subscription-form.js';

/**
 * /admin/subscriptions/new — put an organization, or one of its workspaces, on
 * a plan.
 *
 * Both lists are loaded together: the organizations carry their live workspaces
 * (so the scope picker can narrow to the chosen tenant, which is the check that
 * stops a cross-tenant row being expressible), and the plans are what there is
 * to sell.
 */
export function SubscriptionNewPage({
  client,
  listHref = '/admin/subscriptions',
  editHref = (subscriptionId: string) => `/admin/subscriptions/${subscriptionId}/edit`,
  plansHref = '/admin/plans',
}: {
  client?: PermissionsClient;
  listHref?: string;
  /** Where a freshly started subscription opens. */
  editHref?: (subscriptionId: string) => string;
  /** Where to send someone who has no plans to subscribe anybody to. */
  plansHref?: string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [organizations, setOrganizations] = useState<OrganizationView[] | null>(null);
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listOrganizations(), api.listPlans()])
      .then(([organizationList, planList]) => {
        if (cancelled) return;
        setOrganizations(organizationList);
        setPlans(planList);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load organizations and plans.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const onSaved = useCallback(
    (subscription: SubscriptionView) => window.location.assign(editHref(subscription.id)),
    [editHref],
  );

  /*
   * The two ways this form cannot be filled in, answered BEFORE it is rendered.
   *
   * An empty picker with a Save button is a screen that looks broken; saying
   * which list is empty, and where to go about it, is the difference between a
   * dead end and a next step. Plans are checked first because that is the one
   * somebody can fix from here.
   */
  const sellable = (plans ?? []).filter((plan) => !plan.archived);

  return (
    <AdminPage
      title="New subscription"
      description="A plan says what an organization bought. A role still has to grant those features to a person."
      feature={FEATURE.billingManage}
      backTo={{ href: listHref, label: 'Subscriptions' }}
    >
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : organizations === null || plans === null ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : sellable.length === 0 ? (
        <AdminPlaceholder>
          There are no live plans to subscribe anybody to. <a href={plansHref}>Define one first</a> — a subscription is
          a pointer at a plan, so it cannot be the first thing that exists.
        </AdminPlaceholder>
      ) : organizations.length === 0 ? (
        <AdminPlaceholder>
          There are no organizations yet. A subscription attaches a plan to a tenant, so one has to exist before this
          screen can do anything.
        </AdminPlaceholder>
      ) : (
        <SubscriptionForm
          client={api}
          organizations={organizations}
          plans={plans}
          onSaved={onSaved}
          cancelHref={listHref}
        />
      )}
    </AdminPage>
  );
}
