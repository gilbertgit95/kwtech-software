'use client';

import { useId, useMemo, useState } from 'react';
import {
  type SubscriptionDraft,
  type SubscriptionDraftErrors,
  subscriptionPeriodField,
  validateSubscriptionDraft,
} from '../../domain/subscription-draft.js';
import { SUBSCRIPTION_STATUSES } from '../../types.js';
import type { OrganizationView, PermissionsClient, PlanView, SubscriptionView } from '../permissions-client.js';

/**
 * The one form behind both New and Edit — but the two show DIFFERENT fields,
 * and that asymmetry is the design rather than an omission.
 *
 * Starting a subscription chooses a target and a plan. Editing one may change
 * neither: every entitlement decision the row ever produced read the
 * organization, the workspace and the plan, so moving a live subscription to
 * another plan silently re-interprets its own history — "what was this
 * organization entitled to in March" would answer with what they are entitled
 * to now. Changing plan is two acts, End then New, which leaves two rows and a
 * timestamp that reconstruct the change. See domain/subscription-draft.ts.
 *
 * So the locked fields are RENDERED, not hidden. Somebody editing a
 * subscription needs to see which one they are editing, and a form showing only
 * a status dropdown is a form you can apply to the wrong customer.
 */

const STATUS_LABEL: Record<string, string> = {
  active: 'Active — entitles the plan’s features',
  past_due: 'Past due — entitles nothing until it is active again',
  canceled: 'Canceled — entitles nothing',
};

export interface SubscriptionFormProps {
  client: PermissionsClient;
  /** Absent when starting one. Present to edit one. */
  subscription?: SubscriptionView;
  /** The tenants and their live workspaces. Empty when editing, which needs neither. */
  organizations: readonly OrganizationView[];
  /** Every plan, for the picker. Archived ones are shown but cannot be chosen. */
  plans: readonly PlanView[];
  onSaved: (subscription: SubscriptionView) => void;
  cancelHref: string;
}

export function SubscriptionForm({
  client,
  subscription,
  organizations,
  plans,
  onSaved,
  cancelHref,
}: SubscriptionFormProps) {
  const editing = subscription !== undefined;

  const [draft, setDraft] = useState<SubscriptionDraft>({
    organizationId: subscription?.organizationId ?? '',
    workspaceId: subscription?.workspaceId ?? null,
    planKey: subscription?.planKey ?? '',
    /*
     * `past_due` for a new one — see EMPTY_SUBSCRIPTION_DRAFT. Starting a
     * subscription is the moment entitlement changes for a whole tenant, and
     * defaulting the dropdown to the value that switches features on would make
     * that the outcome of not reading the form.
     */
    status: subscription?.status ?? 'past_due',
    currentPeriodEnd: subscriptionPeriodField(subscription?.currentPeriodEnd ?? null),
  });
  const [errors, setErrors] = useState<SubscriptionDraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const organization = useMemo(
    () => organizations.find((candidate) => candidate.id === draft.organizationId) ?? null,
    [organizations, draft.organizationId],
  );

  /**
   * Only the chosen organization's workspaces, and only live ones.
   *
   * The narrowing is the check, not a convenience: a workspace from another
   * tenant paired with this organization is a perfectly well-formed row that
   * would entitle one customer's workspace off another customer's plan. The
   * validator refuses it and the write service re-reads the pairing inside its
   * transaction; this stops it being expressible in the first place.
   */
  const workspaces = organization?.workspaces ?? [];

  /**
   * Archived plans are LISTED and disabled, not removed.
   *
   * Removing them would leave somebody staring at a picker missing the plan
   * they were told to use, with nothing to explain where it went. Disabled and
   * labelled says why in the place they are looking.
   */
  const planOptions = useMemo(
    () => [...plans].sort((a, b) => Number(a.archived) - Number(b.archived) || a.label.localeCompare(b.label)),
    [plans],
  );

  const edit = (next: SubscriptionDraft | ((current: SubscriptionDraft) => SubscriptionDraft)) => {
    setSaved(false);
    setDraft(next);
  };

  async function save() {
    /*
     * Validated HERE and again on the server. This one is the fast, per-field
     * answer a form needs; the server's is the one that must be true, since the
     * write service is reachable from a worker and a CLI with no form in front
     * of it.
     */
    const found = validateSubscriptionDraft(draft, {
      planKeys: plans.filter((plan) => !plan.archived).map((plan) => plan.key),
      ...(editing
        ? {}
        : {
            organizationIds: organizations.map((org) => org.id),
            workspaceIds: workspaces.map((workspace) => workspace.id),
          }),
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setFailure(null);
    try {
      onSaved(
        editing
          ? await client.updateSubscription(subscription.id, draft.status, draft.currentPeriodEnd)
          : await client.createSubscription({
              organizationId: draft.organizationId,
              workspaceId: draft.workspaceId,
              planKey: draft.planKey,
              status: draft.status,
              currentPeriodEnd: draft.currentPeriodEnd,
            }),
      );
      setSaved(true);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not save the subscription.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Field
        label="Organization"
        error={errors.organizationId}
        hint="The billing entity. Entitlement is uniform across its workspaces unless one has a plan of its own."
      >
        {(id) =>
          editing ? (
            <ReadOnlyValue id={id} value={subscription.organizationName} />
          ) : (
            <select
              id={id}
              value={draft.organizationId}
              onChange={(event) =>
                // The workspace is cleared with the organization, not left
                // pointing at another tenant's. Without this the picker would
                // hold a stale id that only the validator would catch.
                edit((current) => ({ ...current, organizationId: event.target.value, workspaceId: null }))
              }
              className={inputClass(Boolean(errors.organizationId))}
            >
              <option value="">Choose an organization…</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )
        }
      </Field>

      <Field
        label="Scope"
        error={errors.workspaceId}
        hint="A workspace subscription ADDS to what the organization already bought — it never replaces it."
      >
        {(id) =>
          editing ? (
            <ReadOnlyValue id={id} value={subscription.workspaceName ?? 'Organization-wide'} />
          ) : (
            <select
              id={id}
              value={draft.workspaceId ?? ''}
              onChange={(event) =>
                edit((current) => ({ ...current, workspaceId: event.target.value === '' ? null : event.target.value }))
              }
              disabled={!organization}
              className={inputClass(Boolean(errors.workspaceId))}
            >
              <option value="">The whole organization</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          )
        }
      </Field>

      <Field
        label="Plan"
        error={errors.planKey}
        hint={
          editing
            ? 'Fixed. Changing plan is End then New, so the two rows and their dates reconstruct the change.'
            : 'What this subscription entitles. Archived plans cannot be chosen.'
        }
      >
        {(id) =>
          editing ? (
            <ReadOnlyValue id={id} value={subscription.planLabel} />
          ) : (
            <select
              id={id}
              value={draft.planKey}
              onChange={(event) => edit((current) => ({ ...current, planKey: event.target.value }))}
              className={inputClass(Boolean(errors.planKey))}
            >
              <option value="">Choose a plan…</option>
              {planOptions.map((plan) => (
                <option key={plan.key} value={plan.key} disabled={plan.archived}>
                  {plan.label} ({plan.features.length} feature{plan.features.length === 1 ? '' : 's'})
                  {plan.archived ? ' — archived' : ''}
                </option>
              ))}
            </select>
          )
        }
      </Field>

      <Field label="Status" error={errors.status} hint="Only “Active” entitles anything.">
        {(id) => (
          <select
            id={id}
            value={draft.status}
            onChange={(event) => edit((current) => ({ ...current, status: event.target.value }))}
            className={inputClass(Boolean(errors.status))}
          >
            {SUBSCRIPTION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value] ?? value}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field
        label="Renews on"
        error={errors.currentPeriodEnd}
        hint="Recorded, not enforced. Nothing reads this to decide entitlement — status does that, so a lapsed date cannot switch access off without a row saying so."
      >
        {(id) => (
          <input
            id={id}
            type="date"
            value={draft.currentPeriodEnd}
            onChange={(event) => edit((current) => ({ ...current, currentPeriodEnd: event.target.value }))}
            className={inputClass(Boolean(errors.currentPeriodEnd))}
          />
        )}
      </Field>

      {failure ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {failure}
        </p>
      ) : saved ? (
        <p
          role="status"
          className="rounded-md bg-[var(--status-success)] px-3 py-2 text-sm text-[var(--status-success-foreground)]"
        >
          Saved.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Start subscription'}
        </button>
        <a href={cancelHref} className="text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </a>
      </div>
    </div>
  );
}

/**
 * A field that is shown but cannot be changed.
 *
 * A `<div>` rather than a disabled `<input>`: a disabled input reads as
 * "temporarily unavailable — fill in something else first", which is a
 * different claim from "this is fixed for the life of the row". `id` is carried
 * so the label's `htmlFor` still lands somewhere a screen reader can announce.
 */
function ReadOnlyValue({ id, value }: { id: string; value: string }) {
  return (
    <div id={id} className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
      {value}
    </div>
  );
}

function inputClass(invalid: boolean): string {
  return `w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60 ${
    invalid ? 'border-destructive' : 'border-border'
  }`;
}

/** A labelled field. See the same helper in role-form.tsx for why `children` is a function. */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
