'use client';

import { cn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type BillingClient, createBillingClient } from '../billing-client.js';
import { buttonClass, ErrorLine, Section } from '../components/ui.js';
import { billingPageHref } from '../routes.js';
import { capCell, featureGroups, type PlanComparisonView, priceCell } from '../view/comparison-view.js';

export interface BillingPlansPageProps {
  organizationId: string | undefined;
  client?: BillingClient;
}

/**
 * `/organizations/:organizationId/billing/plans` (#101): every plan on offer
 * side by side, with the organization's own, today's prices, how many of each
 * thing it allows and what it includes. Read from the same plan rows the caps
 * and features are enforced from, so the page cannot promise what the app
 * refuses. Choosing a plan stays on the Billing page, where the price of a
 * change is shown before it is asked for.
 */
export function BillingPlansPage({ organizationId, client }: BillingPlansPageProps) {
  const api = useMemo(() => client ?? createBillingClient(), [client]);
  const [comparison, setComparison] = useState<PlanComparisonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped per read: an answer for an older organization is dropped. */
  const generation = useRef(0);

  const load = useCallback(() => {
    if (!organizationId) return;
    const mine = ++generation.current;
    setComparison(null);
    setError(null);
    api
      .planComparison(organizationId)
      .then((next) => {
        if (mine === generation.current) setComparison(next);
      })
      .catch((cause: unknown) => {
        if (mine === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load the plans.');
      });
  }, [api, organizationId]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  if (!organizationId) return <p className="text-sm text-muted-foreground">No organization in the address.</p>;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What each plan allows and includes, at today’s prices. Change plan on the Billing page, which shows the
            price of the change first.
          </p>
        </div>
        <a href={billingPageHref(organizationId)} className={buttonClass()}>
          ← Back to billing
        </a>
      </header>

      {error ? <ErrorLine message={error} onDismiss={() => setError(null)} onReload={load} /> : null}

      {!comparison ? (
        error ? null : (
          <p className="text-sm text-muted-foreground">Loading the plans…</p>
        )
      ) : comparison.plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plan is on offer right now.</p>
      ) : (
        <Section title="Plans">
          {/* A wide table scrolls inside its own box, never the page (phone width). */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 text-left font-medium text-muted-foreground">
                    <span className="sr-only">What</span>
                  </th>
                  {comparison.plans.map((plan) => (
                    <th
                      key={plan.key}
                      scope="col"
                      className={cn('px-3 py-2 text-left align-bottom', plan.current && 'bg-primary/10')}
                    >
                      <div className="font-semibold text-foreground">{plan.label}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {priceCell(plan, comparison.currency)}
                      </div>
                      {plan.current ? <div className="text-xs font-medium text-primary">Your plan</div> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.limits.length > 0 ? (
                  <tr>
                    <th scope="colgroup" colSpan={comparison.plans.length + 1} className="pt-4 pb-1 text-left">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        How many
                      </span>
                    </th>
                  </tr>
                ) : null}
                {comparison.limits.map((limit) => (
                  <tr key={limit.key} className="border-b border-border/60">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground">
                      {limit.label}
                    </th>
                    {comparison.plans.map((plan) => (
                      <td key={plan.key} className={cn('px-3 py-2 tabular-nums', plan.current && 'bg-primary/10')}>
                        {capCell(plan.limits.find((one) => one.key === limit.key)?.value)}
                      </td>
                    ))}
                  </tr>
                ))}
                {comparison.features.length > 0 ? (
                  <tr>
                    <th scope="colgroup" colSpan={comparison.plans.length + 1} className="pt-4 pb-1 text-left">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Includes
                      </span>
                    </th>
                  </tr>
                ) : null}
                {featureGroups(comparison).flatMap((group) =>
                  group.features.map((feature) => (
                    <tr key={feature.key} className="border-b border-border/60">
                      <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground">
                        {feature.label}
                      </th>
                      {comparison.plans.map((plan) => {
                        const included = plan.features.includes(feature.key);
                        return (
                          <td key={plan.key} className={cn('px-3 py-2', plan.current && 'bg-primary/10')}>
                            <span aria-hidden="true" className={included ? 'text-primary' : 'text-muted-foreground'}>
                              {included ? '✓' : '—'}
                            </span>
                            <span className="sr-only">{included ? 'Included' : 'Not included'}</span>
                          </td>
                        );
                      })}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
