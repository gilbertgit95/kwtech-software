'use client';

import { useEffect, useId, useState } from 'react';
import { PLATFORM_BILLING_MONTH_CHOICES } from '../../domain/quotes.js';
import type { BillingClient, BillingOverviewView, BillingPreviewView, ChosenPlanKind } from '../billing-client.js';
import { formatDay, formatMoney, lineLabel, monthsLabel, planChoices } from '../view/billing-view.js';
import { buttonClass, Section } from './ui.js';

/** What the panel asks for: a renewal of the current plan, or a plan someone chooses. */
export type PlanRequestMode = 'renew' | ChosenPlanKind;

const TITLES: Readonly<Record<PlanRequestMode, string>> = {
  renew: 'Renew',
  subscribe: 'Choose a plan',
  change_plan: 'Change plan',
  replace: 'Choose a replacement plan',
};

/** What the panel submits: the plan (null for a renewal), the months paid at once, and whether to turn auto-renew on (#129). */
export interface PlanRequestChoice {
  planKey: string | null;
  months: number;
  turnOnAutoRenew: boolean;
}

/** The kinds that buy whole months, so may pay for several at once (#129). A plan change runs to the period's end. */
function buysMonths(mode: PlanRequestMode): boolean {
  return mode !== 'change_plan';
}

/**
 * A request before it is made: the plan (unless it is a renewal), the price
 * worked out by the server for today (`platformBillingPreview`), and either
 * the button that makes it or the reason it cannot be made, with the next
 * step. The preview is the same check the submission runs, so what is shown
 * here is what will happen.
 */
export function PlanRequest({
  overview,
  client,
  mode,
  busy,
  canChoosePlan,
  onSubmit,
  onClose,
}: {
  overview: BillingOverviewView;
  client: BillingClient;
  mode: PlanRequestMode;
  busy: boolean;
  /** The owner's key (D8): only they may turn auto-renew on. */
  canChoosePlan: boolean;
  onSubmit: (choice: PlanRequestChoice) => void;
  onClose: () => void;
}) {
  const groupId = useId();
  const monthsId = useId();
  const autoId = useId();
  const choices = planChoices(overview.plans, mode);
  const [planKey, setPlanKey] = useState<string | null>(mode === 'renew' ? null : (choices[0]?.key ?? null));
  const [months, setMonths] = useState(1);
  const [turnOnAutoRenew, setTurnOnAutoRenew] = useState(true);
  const [latestPreview, setPreview] = useState<{ months: number; view: BillingPreviewView } | null>(null);
  // ⚠ Shown, and pressable, only for the selection it priced: a quote from the plan or months clicked before never stands for this one.
  const preview =
    latestPreview &&
    latestPreview.view.kind === mode &&
    latestPreview.view.planKey === planKey &&
    latestPreview.months === months
      ? latestPreview.view
      : null;
  const [failure, setFailure] = useState<string | null>(null);
  const offerAutoRenew = buysMonths(mode) && months > 1 && canChoosePlan && !overview.autoRenew.enabled;

  useEffect(() => {
    if (mode !== 'renew' && !planKey) return;
    let cancelled = false;
    setPreview(null);
    setFailure(null);
    client
      .preview(overview.organizationId, mode, planKey, months)
      .then((next) => {
        if (!cancelled) setPreview({ months, view: next });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure(cause instanceof Error ? cause.message : 'Could not price this request.');
      });
    return () => {
      cancelled = true;
    };
  }, [client, overview.organizationId, mode, planKey, months]);

  const money = (amount: number) => formatMoney(amount, overview.currency);
  const quote = preview?.quote ?? null;

  return (
    <Section
      title={TITLES[mode]}
      actions={
        <button type="button" className={buttonClass()} onClick={onClose}>
          Close
        </button>
      }
    >
      {mode === 'renew' ? (
        <p className="text-sm text-muted-foreground">Another month of {overview.standing.planLabel ?? 'your plan'}.</p>
      ) : choices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other plan is offered right now.</p>
      ) : (
        <fieldset aria-labelledby={groupId} className="grid gap-2 sm:grid-cols-2">
          <legend id={groupId} className="sr-only">
            Plan
          </legend>
          {choices.map((plan) => (
            <label
              key={plan.key}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={groupId}
                  value={plan.key}
                  checked={planKey === plan.key}
                  onChange={() => setPlanKey(plan.key)}
                />
                <span className="text-sm font-medium">{plan.label}</span>
              </span>
              <span className="text-sm text-muted-foreground">{money(plan.monthly ?? 0)} a month</span>
            </label>
          ))}
        </fieldset>
      )}

      {buysMonths(mode) ? (
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor={monthsId} className="text-sm font-medium">
            Pay for
          </label>
          <select
            id={monthsId}
            className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            value={months}
            aria-describedby={`${monthsId}-hint`}
            onChange={(event) => setMonths(Number(event.target.value))}
          >
            {PLATFORM_BILLING_MONTH_CHOICES.map((count) => (
              <option key={count} value={count}>
                {monthsLabel(count)}
              </option>
            ))}
          </select>
          <p id={`${monthsId}-hint`} className="text-xs text-muted-foreground">
            {months > 1
              ? `This month is paid by the bill. The other ${monthsLabel(months - 1)} are kept as credit and pay each renewal after it.`
              : 'Pay for several months at once and the extra is kept as credit for the renewals after this one.'}
          </p>
          {offerAutoRenew ? (
            <label htmlFor={autoId} className="flex items-start gap-2 text-sm">
              <input
                id={autoId}
                type="checkbox"
                className="mt-0.5"
                checked={turnOnAutoRenew}
                onChange={(event) => setTurnOnAutoRenew(event.target.checked)}
              />
              <span>
                Renew automatically from credit, so the months paid ahead need no renewal each month. You can turn it
                off on this page.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4" aria-live="polite">
        {failure ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : !preview ? (
          mode === 'renew' || planKey ? (
            <p className="text-sm text-muted-foreground">Working out the price…</p>
          ) : null
        ) : !preview.allowed ? (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium text-destructive">{preview.message}</p>
            {preview.nextStep ? <p className="mt-1">{preview.nextStep}</p> : null}
            {preview.overruns.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {preview.overruns.map((overrun) => (
                  <li key={overrun.limit}>
                    {overrun.limit}: the plan allows {overrun.allowed} and you have {overrun.have}. Remove{' '}
                    {overrun.remove}.
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : quote ? (
          <div className="rounded-md border border-border p-3">
            <table className="w-full text-sm">
              <tbody>
                {quote.lines.map((line) => (
                  <tr key={`${line.kind}-${line.amount}-${line.months ?? 0}`}>
                    <td className="py-1">{lineLabel(line.kind, line.days, line.months)}</td>
                    <td className="py-1 text-right tabular-nums">{money(line.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold">
                  <td className="py-1">To pay</td>
                  <td className="py-1 text-right tabular-nums">{money(quote.total)}</td>
                </tr>
              </tbody>
            </table>
            {quote.creditAdded > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {quote.billAtSubmission
                  ? `${money(quote.creditAdded)} is added to your credit.`
                  : `Credit is worked out on the day the change is approved. Today's estimate: ${money(quote.creditAdded)}.`}
              </p>
            ) : null}
            {quote.periodEnd ? (
              <p className="mt-1 text-xs text-muted-foreground">For the period ending {formatDay(quote.periodEnd)}.</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Making the request issues {quote.billAtSubmission ? 'its bill now' : 'its bill when it is approved'}. Pay
              outside the app, then add your payment details here so we can approve it.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={busy || !preview?.allowed}
          onClick={() =>
            onSubmit({
              planKey: mode === 'renew' ? null : planKey,
              months: buysMonths(mode) ? months : 1,
              turnOnAutoRenew: offerAutoRenew && turnOnAutoRenew,
            })
          }
        >
          {busy ? 'Requesting…' : mode === 'renew' ? 'Request renewal' : 'Request this plan'}
        </button>
      </div>
    </Section>
  );
}
