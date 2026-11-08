'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import { useState } from 'react';
import { PLATFORM_BILLING_FEATURE } from '../../feature-keys.js';
import type { BillingClient } from '../billing-client.js';
import { BillingHistory } from '../components/billing-history.js';
import { PendingRequest } from '../components/pending-request.js';
import { PlanRequest, type PlanRequestMode } from '../components/plan-request.js';
import { buttonClass, ErrorLine, Reason, toneClass } from '../components/ui.js';
import { useBilling } from '../use-billing.js';
import {
  type BillingAbilities,
  billingStatus,
  cancelControl,
  changePlanControl,
  formatDay,
  formatMoney,
  mainAction,
} from '../view/billing-view.js';

export interface BillingPageProps {
  organizationId: string | undefined;
  client?: BillingClient;
}

/**
 * `/organizations/:organizationId/billing` (plan §7): the organization's own
 * billing, replacing the read-only subscription page.
 *
 * ## One main button that follows the status
 *
 * Subscribe, renew, replace an archived plan, or (with a request waiting)
 * the request itself with its payment form. Change plan and Cancel sit
 * beside it, off with the reason when the status or the role does not allow
 * them (D8: the owner chooses the plan; an admin renews and pays).
 *
 * ## Every date says which rule made it
 *
 * The status explains access past the due date (grace, a hold), a trial, a
 * cancel, an archived plan and an expiry in words (`billingStatus`), and a
 * request that cannot be made shows the server's own refusal and next step,
 * before anybody presses anything (`platformBillingPreview`).
 *
 * ⚠ Hiding a control is cosmetic: the API authorises every act again.
 */
export function BillingPage(props: BillingPageProps) {
  // ⚠ Keyed by organization: a new organization starts from nothing, never from the last one's
  // overview and pending request (whose id would then be sent with the new organization's).
  return <OrganizationBilling key={props.organizationId ?? ''} {...props} />;
}

/** The page for one organization; `BillingPage` remounts it when the organization changes. */
function OrganizationBilling({ organizationId, client }: BillingPageProps) {
  const state = useBilling(organizationId ?? '', client ? { client } : {});
  const can: BillingAbilities = {
    choosePlan: useHoldsFeature(PLATFORM_BILLING_FEATURE.changePlan),
    renew: useHoldsFeature(PLATFORM_BILLING_FEATURE.renew),
    enterPayment: useHoldsFeature(PLATFORM_BILLING_FEATURE.enterPayment),
  };
  const [mode, setMode] = useState<PlanRequestMode | null>(null);
  const [cancelling, setCancelling] = useState(false);

  if (!organizationId) {
    return <p className="text-sm text-muted-foreground">No organization in the address.</p>;
  }
  const overview = state.overview;
  const status = overview ? billingStatus(overview) : null;
  const main = overview ? mainAction(overview, can) : null;
  const change = overview ? changePlanControl(overview, can) : null;
  const cancel = overview ? cancelControl(overview, can) : null;

  /** Makes the request the open panel previewed; closes the panel once it is made. */
  async function submit(planKey: string | null) {
    if (!mode || !organizationId) return;
    const done = await state.run(
      (api) => (mode === 'renew' ? api.renew(organizationId) : api.requestPlan(organizationId, mode, planKey ?? '')),
      'Requested. Pay outside the app, then add your payment details below.',
    );
    if (done) setMode(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your plan, what is due and when, and every request with its bill and receipt. Payment is made outside the app
          (cash, e-wallet or bank transfer); we confirm it and apply the plan.
        </p>
      </header>

      {state.error ? (
        <ErrorLine
          message={state.error}
          onDismiss={state.dismissError}
          // Beside the page it explains: a failed re-read after an act is fixed by reading again, not by repeating the act.
          onReload={
            state.overview
              ? () => {
                  state.dismissError();
                  void state.reload();
                }
              : undefined
          }
        />
      ) : null}
      {state.notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      ) : null}

      {!overview || !status || !main || !change || !cancel ? (
        state.error ? (
          // A first load that failed can be tried again: dismissing the error alone would leave the skeleton for ever.
          <button
            type="button"
            className={buttonClass()}
            onClick={() => {
              state.dismissError();
              void state.reload();
            }}
          >
            Try again
          </button>
        ) : (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        )
      ) : (
        <>
          <section aria-labelledby="billing-status" className={cn('rounded-lg border p-4', toneClass(status.tone))}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="billing-status" className="text-lg font-semibold">
                  {status.headline}
                </h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {status.details.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Period</dt>
                <dd>
                  {overview.standing.periodStart
                    ? `${formatDay(overview.standing.periodStart)} – ${formatDay(overview.standing.periodEnd)}`
                    : '—'}
                </dd>
                <dt className="text-muted-foreground">Due</dt>
                <dd>{formatDay(overview.standing.periodEnd)}</dd>
                <dt className="text-muted-foreground">Credit</dt>
                <dd className="tabular-nums">{formatMoney(overview.creditBalance, overview.currency)}</dd>
              </dl>
            </div>

            {main.kind === 'pending' ? null : (
              <div className="mt-4 flex flex-wrap items-start gap-3">
                <div>
                  <button
                    type="button"
                    className={buttonClass('primary')}
                    disabled={state.busy || main.disabledReason !== null}
                    onClick={() => setMode(main.kind)}
                  >
                    {main.label}
                  </button>
                  {main.disabledReason ? <Reason>{main.disabledReason}</Reason> : null}
                </div>
                {change.enabled || change.reason ? (
                  <div>
                    <button
                      type="button"
                      className={buttonClass()}
                      disabled={state.busy || !change.enabled}
                      onClick={() => setMode('change_plan')}
                    >
                      Change plan
                    </button>
                    {change.reason ? <Reason>{change.reason}</Reason> : null}
                  </div>
                ) : null}
                {cancel.enabled || cancel.reason ? (
                  <div>
                    <button
                      type="button"
                      className={buttonClass('danger')}
                      disabled={state.busy || !cancel.enabled}
                      onClick={() => setCancelling(true)}
                    >
                      Cancel at the end of the period
                    </button>
                    {cancel.reason ? <Reason>{cancel.reason}</Reason> : null}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {mode ? (
            <PlanRequest
              key={mode}
              overview={overview}
              client={state.client}
              mode={mode}
              busy={state.busy}
              onSubmit={(planKey) => void submit(planKey)}
              onClose={() => setMode(null)}
            />
          ) : null}

          {overview.pending ? (
            <PendingRequest
              key={`${overview.pending.id}-${overview.pending.detailsVersion}`}
              overview={overview}
              request={overview.pending}
              canEnterPayment={can.enterPayment}
              busy={state.busy}
              onSavePayment={(payment) =>
                state.run(
                  (api) => api.enterPayment(organizationId, overview.pending?.id ?? '', payment),
                  'Payment details saved. We will check them and approve the request.',
                )
              }
              onWithdraw={() =>
                state.run(
                  (api) => api.withdraw(organizationId, overview.pending?.id ?? '', null),
                  'Request withdrawn. Its bill is cancelled.',
                )
              }
            />
          ) : null}

          <BillingHistory
            history={state.history}
            currency={overview.currency}
            timeZone={overview.timeZone}
            onLoadMore={() => void state.loadMore()}
          />

          <ConfirmDialog
            open={cancelling}
            title={`Cancel ${overview.standing.planLabel ?? 'the plan'}?`}
            confirmLabel="Cancel at the end of the period"
            danger
            pending={state.busy}
            description={`Access ends on ${formatDay(overview.standing.periodEnd)}, with no grace after it and no credit for what is left. You can renew before then to keep it.`}
            onConfirm={() => {
              void state
                .run((api) => api.cancel(organizationId), 'Cancelled. Access ends at the close of the period.')
                .then((done) => {
                  if (done) setCancelling(false);
                });
            }}
            onCancel={() => setCancelling(false)}
          />
        </>
      )}
    </div>
  );
}
