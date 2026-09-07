'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import {
  createPermissionsClient,
  type PermissionsClient,
  type PlanView,
  type SubscriptionView,
} from '../permissions-client.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';
import { SubscriptionForm } from './subscription-form.js';

/**
 * /admin/subscriptions/:subscriptionId/edit — change a subscription's status or
 * renewal date, or end it.
 *
 * Not its plan, and not its target. Both are read by every entitlement decision
 * the row ever produced, so changing one silently re-interprets its own
 * history; changing plan is End then New, which leaves two rows and a timestamp
 * that reconstruct the change. See domain/subscription-draft.ts.
 *
 * An ENDED subscription is shown read-only rather than refused. The one thing a
 * reader came for — what was this customer on, and until when — is the one
 * thing a refusal would hide, and an ended row is the most useful kind to
 * inspect: it is the answer to "why did their access stop".
 */
export function SubscriptionEditPage({
  subscriptionId,
  client,
  listHref = '/admin/subscriptions',
  newHref = '/admin/subscriptions/new',
}: {
  subscriptionId: string | undefined;
  client?: PermissionsClient;
  listHref?: string;
  /** Where "put them on a different plan" goes. */
  newHref?: string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[] | null>(null);
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /*
     * The plans come along for the form's plan field, which is read-only here
     * but still has to name the plan. Organizations are NOT loaded: the target
     * cannot change, so the picker they feed does not exist on this screen —
     * and that query needs `billing:manage`, which this page already has but
     * would be spending on nothing.
     */
    Promise.all([api.listSubscriptions(), api.listPlans()])
      .then(([subscriptionList, planList]) => {
        if (cancelled) return;
        setSubscriptions(subscriptionList);
        setPlans(planList);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the subscription.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /*
   * STAYS ON THE PAGE, like the role and plan editors. It only refreshes what
   * the page is holding, so the status and the ended state stay true; the form
   * shows its own "Saved." confirmation.
   */
  const onSaved = useCallback(
    (updated: SubscriptionView) =>
      setSubscriptions((current) =>
        (current ?? []).map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      ),
    [],
  );

  const subscription = subscriptions?.find((candidate) => candidate.id === subscriptionId);
  const ended = subscription?.endedAt !== null && subscription?.endedAt !== undefined;

  const end = useCallback(async () => {
    if (!subscription) return;
    setBusy(true);
    try {
      const updated = await api.endSubscription(subscription.id);
      onSaved(updated);
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not end the subscription.');
    } finally {
      setBusy(false);
    }
  }, [api, subscription, onSaved]);

  return (
    <AdminPage
      title={subscription ? `${subscription.organizationName} — ${subscription.planLabel}` : 'Edit subscription'}
      description="The organization, the workspace and the plan cannot change — every entitlement decision this row produced read all three."
      feature={FEATURE.billingManage}
      backTo={{ href: listHref, label: 'Subscriptions' }}
    >
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : subscriptions === null || plans === null ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !subscription ? (
        <AdminPlaceholder>No subscription with that id.</AdminPlaceholder>
      ) : ended ? (
        /*
         * SHOWN, not refused — the same call the role editor makes about a
         * system role. What this customer was on, and until when, is exactly
         * what somebody opens an ended subscription to find out.
         */
        <>
          <div className="mb-6 rounded-md border border-border bg-muted px-4 py-3">
            <p className="text-sm font-medium">This subscription has ended.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              It stopped entitling on {new Date(subscription.endedAt as string).toLocaleDateString()} and cannot be
              reopened — the row is kept so past entitlement stays reconstructable. To put{' '}
              <strong>{subscription.organizationName}</strong> back on a plan,{' '}
              <a href={newHref}>start a new subscription</a>. A new row makes the gap visible, where reopening this one
              would erase it.
            </p>
          </div>
          <SubscriptionDetails subscription={subscription} />
          <a href={listHref} className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground">
            Back to subscriptions
          </a>
        </>
      ) : (
        <>
          {/*
            An archived plan entitles nothing, however live this row looks —
            said HERE because it is the state somebody opens this screen to
            explain, and the form's read-only plan field cannot carry it.
          */}
          {subscription.planArchived ? (
            <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
              <p className="text-sm text-destructive">
                <strong>{subscription.planLabel}</strong> has been archived, so this subscription entitles nothing
                whatever its status says. Restore the plan, or end this subscription and start one on a live plan.
              </p>
            </div>
          ) : null}

          <SubscriptionForm
            client={api}
            subscription={subscription}
            organizations={[]}
            plans={plans}
            onSaved={onSaved}
            cancelHref={listHref}
          />

          {/*
            Below the form and visually quiet: ending a subscription is not part
            of editing it, and a control that cuts a customer's access off must
            not sit beside Save.
          */}
          <div className="mt-8 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="text-sm text-destructive hover:underline disabled:opacity-60"
            >
              End this subscription
            </button>
            <p className="mt-1 text-xs text-muted-foreground">
              It stops entitling immediately. The row is kept, so past entitlement stays readable — but there is no
              un-end: bringing them back is a new subscription, which is what makes the gap visible.
            </p>
          </div>

          <ConfirmDialog
            open={confirming}
            title={`End ${subscription.organizationName}’s subscription?`}
            confirmLabel="End it"
            danger
            pending={busy}
            description={
              <>
                <strong>{subscription.organizationName}</strong>
                {subscription.workspaceName ? ` (${subscription.workspaceName})` : ''} stops being entitled to{' '}
                <strong>{subscription.planLabel}</strong> on their next request. Nothing is deleted, and this cannot be
                undone — putting them back on a plan is a new subscription.
              </>
            }
            onConfirm={() => void end()}
            onCancel={() => setConfirming(false)}
          />
        </>
      )}
    </AdminPage>
  );
}

/**
 * An ended subscription, as a read-only summary.
 *
 * Not `SubscriptionForm` with everything disabled: a form full of disabled
 * controls reads as "fill this in later", where this row can never be filled in
 * again. Saying it plainly is shorter and more honest than styling a form to
 * look inert.
 */
function SubscriptionDetails({ subscription }: { subscription: SubscriptionView }) {
  const rows: [string, string][] = [
    ['Organization', subscription.organizationName],
    ['Scope', subscription.workspaceName ?? 'Organization-wide'],
    ['Plan', subscription.planLabel],
    ['Status', subscription.status],
    ['Renewed on', formatDate(subscription.currentPeriodEnd)],
    ['Ended', formatDate(subscription.endedAt)],
  ];

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm font-medium">{label}</dt>
          <dd className="text-sm text-muted-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}
