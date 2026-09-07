'use client';

import { cn, DataGrid, type DataGridColumn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import { createPermissionsClient, type PermissionsClient, type SubscriptionView } from '../permissions-client.js';
import { AdminPage } from './admin-page.js';

/**
 * Subscriptions — what each organization bought, as opposed to what its people
 * may do.
 *
 * The distinction is the model's, not this page's: a plan supplies ENTITLEMENTS
 * and a role supplies GRANTS, and a feature needs both. Keeping them on
 * separate screens is what stops "upgrade your plan" and "ask an administrator"
 * from being answered by the same button — see domain/grants.ts.
 *
 * ## Ended subscriptions are SHOWN
 *
 * For a different reason than an archived plan or a disabled role are shown:
 * those appear so somebody can switch them back on, and an ended subscription
 * has no switch. It appears because it IS the history — "what was this
 * organization entitled to in March" is answered by reading these rows, and a
 * list of only live ones would make every plan change look like it had always
 * been that way. They sort to the bottom and are drawn quietly.
 *
 * ## This list is read-only
 *
 * New is the only action here; changing a status or ending a subscription lives
 * in the editor, reached by double-clicking a row. Ending one cuts a customer's
 * access off, so the decision belongs on a screen showing what they are on and
 * since when — not beside a checkbox in a grid.
 */

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
};

/**
 * Only `active` entitles, so it is the only one drawn as a positive state.
 *
 * `past_due` takes the warning token rather than the destructive one, and that
 * is the accurate signal: it entitles nothing TODAY but is expected to recover,
 * so it is not the same as canceled. A screen that painted them alike would
 * make "chase the payment" and "they left" look like one situation.
 *
 * The status tokens are used for the reason the roles grid gives: they are the
 * only colours defined once across all ten palettes and the only ones whose
 * foreground pairs are contrast-checked.
 */
const STATUS_STYLE: Record<string, string> = {
  active: 'border-transparent bg-[var(--status-success)] text-[var(--status-success-foreground)]',
  past_due: 'border-transparent bg-[var(--status-warning)] text-[var(--status-warning-foreground)]',
  canceled: 'border-border bg-transparent text-muted-foreground',
};

interface SubscriptionRow extends SubscriptionView {
  /** 'Organization-wide', or the workspace name. The question the column answers. */
  scope: string;
  statusLabel: string;
  /**
   * Whether this row entitles anything AT ALL, right now.
   *
   * Two independent things switch entitlement off — the subscription's own
   * status and the plan's archived flag — and a reader scanning a grid cannot
   * be expected to cross-reference two columns to work out that an `active`
   * row on an archived plan is giving nobody anything. This is that
   * cross-reference, done once.
   */
  entitling: boolean;
  ended: boolean;
  renewsOn: string;
}

/** A date, or an em dash. Rendered in the reader's locale, never computed with. */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function toRow(subscription: SubscriptionView): SubscriptionRow {
  const ended = subscription.endedAt !== null;
  return {
    ...subscription,
    scope: subscription.workspaceName ?? 'Organization-wide',
    statusLabel: STATUS_LABEL[subscription.status] ?? subscription.status,
    entitling: !ended && subscription.status === 'active' && !subscription.planArchived,
    ended,
    renewsOn: formatDate(subscription.currentPeriodEnd),
  };
}

/**
 * Live rows first, then ended; within each, by organization, then by scope, then
 * by plan.
 *
 * Organization is the coarse axis because that is how anyone reads this screen —
 * "what is Acme on" — and grouping a tenant's rows together is what makes the
 * organization-wide plan and its workspace additions legible as one picture.
 * The final tiebreak is the id so the order is TOTAL: two rows that agree on
 * everything else must not swap places between renders.
 */
function byOrganizationThenScope(a: SubscriptionRow, b: SubscriptionRow): number {
  return (
    Number(a.ended) - Number(b.ended) ||
    a.organizationName.localeCompare(b.organizationName) ||
    a.scope.localeCompare(b.scope) ||
    a.planLabel.localeCompare(b.planLabel) ||
    a.id.localeCompare(b.id)
  );
}

export function SubscriptionsPage({
  client,
  newHref = '/admin/subscriptions/new',
  editHref = (subscriptionId: string) => `/admin/subscriptions/${subscriptionId}/edit`,
}: {
  client?: PermissionsClient;
  newHref?: string;
  editHref?: (subscriptionId: string) => string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .listSubscriptions()
      .then((list) => {
        if (!cancelled) {
          setRows(list.map(toRow).sort(byOrganizationThenScope));
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load subscriptions.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(load, [load]);

  const columns = useMemo<DataGridColumn<SubscriptionRow>[]>(
    () => [
      { field: 'organizationName', headerName: 'Organization', flex: 2 },
      {
        field: 'scope',
        headerName: 'Scope',
        flex: 2,
        /*
         * Organization-wide is drawn quietly and a workspace name plainly,
         * because the two are not alternatives: a workspace subscription ADDS
         * to whatever the organization already bought. Styling them as equals
         * invites reading the workspace row as a replacement, which is exactly
         * the override semantics the model refuses to have.
         */
        cellRenderer: (params: { data?: SubscriptionRow }) =>
          params.data?.workspaceName ? (
            <span>{params.data.workspaceName}</span>
          ) : (
            <span className="text-muted-foreground">Organization-wide</span>
          ),
      },
      {
        field: 'planLabel',
        headerName: 'Plan',
        flex: 2,
        cellRenderer: (params: { data?: SubscriptionRow }) =>
          params.data ? (
            <span className="inline-flex items-center gap-2">
              <span>{params.data.planLabel}</span>
              {/*
                An archived plan entitles nothing however live the row looks.
                Said HERE, on the plan, because that is where the cause is —
                putting it only in the status column would blame the
                subscription for something the plan did.
              */}
              {params.data.planArchived ? (
                <span
                  className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                  title="This plan is archived, so it entitles nothing — whatever this subscription's status says."
                >
                  Plan archived
                </span>
              ) : null}
            </span>
          ) : null,
      },
      {
        field: 'statusLabel',
        headerName: 'Status',
        width: 130,
        cellRenderer: (params: { data?: SubscriptionRow }) =>
          params.data ? (
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                STATUS_STYLE[params.data.status] ?? 'border-border text-muted-foreground',
              )}
            >
              {params.data.statusLabel}
            </span>
          ) : null,
      },
      { field: 'renewsOn', headerName: 'Renews', width: 130 },
      {
        field: 'entitling',
        headerName: 'Entitling',
        width: 120,
        /*
         * The answer to the question this screen is actually opened to ask.
         * Three separate facts decide it — ended, status, plan archived — and
         * asking a reader to combine three columns correctly, every time, is
         * how a lapsed customer gets told their access is fine.
         */
        cellRenderer: (params: { data?: SubscriptionRow }) =>
          params.data?.entitling ? (
            <span className="text-xs text-muted-foreground">Yes</span>
          ) : (
            <span className="text-xs font-medium text-destructive">No</span>
          ),
      },
      {
        field: 'endedAt',
        headerName: 'Ended',
        width: 130,
        cellRenderer: (params: { data?: SubscriptionRow }) => (
          <span className="text-xs text-muted-foreground">{formatDate(params.data?.endedAt ?? null)}</span>
        ),
      },
      { field: 'planKey', headerName: 'Plan key', flex: 1, hide: true },
    ],
    [],
  );

  return (
    <AdminPage
      title="Subscriptions"
      description="Which plan each organization is on, what it entitles them to, and when it renews. A plan says what was bought; a role still has to grant it to a person."
      feature={FEATURE.subscriptionsRead}
      layout="fill"
    >
      <div className="flex h-full w-full flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FeatureGate allOf={[FEATURE.billingManage]}>
            <a href={newHref} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              New subscription
            </a>
          </FeatureGate>
          <p className="text-xs text-muted-foreground">Double-click a subscription to change or end it.</p>
        </div>

        {error ? (
          <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {rows === null && !error ? (
          <div className="h-64 animate-pulse rounded-md bg-muted" />
        ) : (
          <DataGrid<SubscriptionRow>
            rows={rows ?? []}
            columns={columns}
            height="fill"
            searchPlaceholder="Search subscriptions…"
            getRowId={(row) => row.id}
            /*
             * An ENDED row navigates too, rather than silently doing nothing.
             * The editor explains that it cannot be changed and points at
             * starting a new one — far better feedback than a double-click that
             * appears broken. The same call the roles list makes about system
             * roles.
             */
            onRowActivate={(row) => window.location.assign(editHref(row.id))}
          />
        )}
      </div>
    </AdminPage>
  );
}
