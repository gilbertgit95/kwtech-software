'use client';

import { useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE, FEATURE_REGISTRY } from '../../feature-keys.js';
import type { PermissionsClient, SubscriptionView } from '../permissions-client.js';
import { createPermissionsClient } from '../permissions-client.js';
import { organizationHref } from '../tenant-nav.js';
import { usePermissions } from '../use-permissions.js';
import { AdminPlaceholder } from './admin-page.js';
import { when } from './organization-sections.js';
import { TenantPage } from './tenant-page.js';

/**
 * `/organizations/:organizationId/subscription` — what this tenant is on.
 *
 * ## Read only, and it will stay that way
 *
 * Changing a subscription takes `billing:manage` and happens on
 * `/admin/subscriptions`, because until a payment provider exists there is
 * nothing for a customer to do here that is not "ask somebody to change it for
 * me" (§12.40 — billing is unbuilt, and deliberately not to be built before the
 * provider is chosen). A self-serve upgrade button would be a button that
 * charges nobody.
 *
 * ## ⚠ It says plainly that a lapse is not enforced
 *
 * `currentPeriodEnd` is written, rendered, and NEVER compared to the clock:
 * `status` decides entitlement, and nothing writes that status on a lapse
 * because there is no scheduler. So an `active` row entitles for ever,
 * whatever the date beside it says.
 *
 * The admin screens have carried that hazard silently. On a CUSTOMER'S screen
 * it would be worse than silent — a renewal date presented without qualification
 * is a promise about what happens on that date, and the promise is false. Saying
 * so costs two lines and was available long before the billing module is.
 *
 * ## Entitlement is shown as FEATURES, not as a marketing bullet list
 *
 * What a plan means here is exactly the set of keys it entitles, and a reader
 * asking "why can I not do X" is asking whether X is in that set. The labels
 * come from the compiled registry rather than from the server, because they are
 * the same list the role editor renders and this page does not need a round trip
 * to name a key it already has.
 */
export function OrganizationSubscriptionPage({
  organizationId,
  client,
}: {
  organizationId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const _permissions = usePermissions();
  const iconSet = useIconSet();
  const iconsByName = useMemo(() => new Map((iconSet ?? []).map((option) => [option.name, option.Icon])), [iconSet]);
  const [rows, setRows] = useState<SubscriptionView[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setRows(null);
      return;
    }
    try {
      setRows(await api.listMyOrganizationSubscriptions(organizationId));
      setError(null);
    } catch (cause) {
      setRows(null);
      setError(cause instanceof Error ? cause.message : 'Could not load this subscription.');
    }
  }, [api, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Three conditions, each of which has bitten somewhere in this codebase:
   * `active` because a canceled row still names a plan; an unarchived plan
   * because an archived one entitles nothing however live the row looks; and
   * `workspaceId === null` because a workspace's own plan ADDS to the
   * organization's rather than being it.
   */
  const organizationWide = rows?.find(
    (row) => row.workspaceId === null && row.status === 'active' && !row.planArchived,
  );
  const workspacePlans = rows?.filter(
    (row) => row.workspaceId !== null && row.status === 'active' && !row.planArchived,
  );
  /** Rows that no longer entitle: the history, which is why they are kept. */
  const past = rows?.filter((row) => row.status !== 'active' || row.planArchived) ?? [];

  const PlanIcon = organizationWide?.planIcon ? iconsByName.get(organizationWide.planIcon) : undefined;

  return (
    <TenantPage
      title="Subscription"
      feature={FEATURE.subscriptionsRead}
      backTo={{ href: organizationHref(organizationId ?? ''), label: 'Organization' }}
    >
      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {rows === undefined ? (
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      ) : rows === null ? (
        <AdminPlaceholder>Could not read this organization&rsquo;s subscription.</AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="rounded-lg border border-border px-4 py-4">
            {organizationWide ? (
              <>
                <p className="flex items-center gap-2 text-lg font-medium">
                  {/* Decorative: the label beside it already names the plan. */}
                  {PlanIcon ? <PlanIcon aria-hidden="true" className="size-5 text-muted-foreground" /> : null}
                  {organizationWide.planLabel}
                </p>
                {organizationWide.currentPeriodEnd ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Renews {when(organizationWide.currentPeriodEnd)}.{' '}
                    {/*
                      ⚠ See the file header. The date is informational: nothing
                      compares it to the clock, and no job changes the status
                      when it passes.
                    */}
                    <span className="text-foreground">
                      This date is a note, not an expiry — access does not change when it passes.
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No renewal date recorded.</p>
                )}
              </>
            ) : (
              /*
               * Stated as a CONSEQUENCE rather than as an absence. "No plan"
               * alone reads as a field nobody filled in; the sentence says what
               * it costs, which is what somebody staring at a refused button
               * needs to know.
               */
              <p className="text-sm">
                <span className="font-medium">No plan.</span>{' '}
                <span className="text-muted-foreground">
                  This organization is entitled to nothing at organization level, so features are refused even where a
                  role grants them.
                </span>
              </p>
            )}

            {workspacePlans && workspacePlans.length > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Plus {workspacePlans.length} workspace plan{workspacePlans.length === 1 ? '' : 's'}:{' '}
                {workspacePlans.map((row) => row.workspaceName ?? row.workspaceId).join(', ')}. A workspace plan adds to
                what the organization bought rather than replacing it.
              </p>
            ) : null}

            <p className="mt-3 text-xs text-muted-foreground">
              Changing a plan is not something this screen can do — ask whoever handles billing for your account.
            </p>
          </section>

          <Entitlements />

          {past.length > 0 ? (
            <section>
              <h2 className="text-lg font-medium">Past subscriptions</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Kept rather than deleted, so how this organization got here stays readable. None of these entitles
                anything.
              </p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {past.map((row) => (
                  <li key={row.id} className="flex flex-wrap justify-between gap-2 border-t border-border py-2">
                    <span>
                      {row.planLabel}
                      {row.workspaceName ? <span className="text-muted-foreground"> · {row.workspaceName}</span> : null}
                      {/*
                        `past_due` and `canceled` are deliberately not collapsed
                        into one word: "your payment bounced" and "you cancelled"
                        lead to different actions, and a screen that cannot tell
                        them apart sends the reader to the wrong place.
                      */}
                      <span className="text-muted-foreground"> · {row.planArchived ? 'plan retired' : row.status}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{when(row.endedAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </TenantPage>
  );
}

/**
 * What the viewer can actually do here, and why.
 *
 * Read off the resolved context rather than off the plan, and the difference is
 * the point of the whole model: `entitled` is what the organization BOUGHT,
 * `granted` is what this person's roles give them, and `effective` is the
 * intersection plus their app-level rights. A screen that showed only the plan
 * would answer "is my company allowed this" when the reader is asking "am I".
 *
 * `entitled: null` means the deployment has no entitlement model at all, which
 * is not the same as "entitled to nothing" — it is why the two states are said
 * differently below.
 */
function Entitlements() {
  const permissions = usePermissions();
  const labels = useMemo(() => new Map(FEATURE_REGISTRY.map((spec) => [spec.key, spec.label])), []);

  if (!permissions) return null;

  const effective = new Set(permissions.effective);
  /*
   * Keys the ROLES grant that the PLAN does not include — the ones a role
   * promises and billing refuses. These are exactly the denials that read as
   * permission bugs, so naming them here is the cheapest support ticket this
   * page can prevent.
   */
  const blockedByPlan = permissions.granted.filter(
    (key) => !effective.has(key) && !permissions.grantedAtAppLevel.includes(key),
  );

  return (
    <section>
      <h2 className="text-lg font-medium">What you can do here</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your roles in this organization, filtered by what it is subscribed to. A right needs both.
      </p>

      {permissions.effective.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing yet — you hold no role here.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {[...permissions.effective].sort().map((key) => (
            <li key={key} className="rounded-full border border-border px-2.5 py-1 text-xs" title={key}>
              {labels.get(key) ?? key}
            </li>
          ))}
        </ul>
      )}

      {blockedByPlan.length > 0 ? (
        <div className="mt-4 rounded-md border border-border px-4 py-3">
          <p className="text-sm font-medium">Granted by a role, not included in the plan</p>
          <p className="mt-1 text-xs text-muted-foreground">
            These are refused because of the subscription rather than because of your role — an upgrade would enable
            them, asking an administrator would not.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {[...blockedByPlan].sort().map((key) => (
              <li
                key={key}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground"
                title={key}
              >
                {labels.get(key) ?? key}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
