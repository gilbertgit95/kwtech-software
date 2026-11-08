'use client';

import { DEFAULT_TIME_ZONE } from '@kwtech/module-kit';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type BillingAdminClient,
  type BillingQueuePageView,
  createBillingAdminClient,
} from '../billing-admin-client.js';
import { buttonClass, ErrorLine, Section } from '../components/ui.js';
import { billingAdminRequestHref } from '../routes.js';
import { isReadyToCheck, queueChecks, sortQueue } from '../view/admin-view.js';
import { formatInstantDay, formatMoney, requestKindLabel, requestStateLabel } from '../view/billing-view.js';

export interface AdminQueuePageProps {
  client?: BillingAdminClient;
}

/**
 * `/admin/billing` (phase 7): the platform's billing queue. Waiting requests,
 * the ones whose payment details cover the bill first (ready to check), then
 * the oldest; each with what the organization asked for, its bill and every
 * check that flags. And the decided requests, newest first: where an approval
 * to void, or any past bill or receipt, is found.
 */
export function AdminQueuePage({ client }: AdminQueuePageProps = {}) {
  const api = useMemo(() => client ?? createBillingAdminClient(), [client]);
  const [tab, setTab] = useState<'waiting' | 'decided'>('waiting');
  const [page, setPage] = useState<BillingQueuePageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The billing time zone, from the settings: every request's day is shown in it. */
  const [timeZone, setTimeZone] = useState<string>(DEFAULT_TIME_ZONE);

  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((settings) => {
        if (!cancelled) setTimeZone(settings.timeZone);
      })
      .catch(() => {
        // A queue reader without the settings still sees the queue; days then fall back to the default zone.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const load = useCallback(
    (which: 'waiting' | 'decided', isCancelled: () => boolean = () => false) => {
      setPage(null);
      setError(null);
      (which === 'waiting' ? api.queue(null) : api.decided(null))
        .then((next) => {
          if (!isCancelled()) setPage(next);
        })
        .catch((cause: unknown) => {
          if (!isCancelled()) setError(cause instanceof Error ? cause.message : 'Could not load the queue.');
        });
    },
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    load(tab, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load, tab]);

  /** The next page of the list in view, appended without repeats. */
  async function more() {
    if (!page?.nextCursor) return;
    try {
      const next = await (tab === 'waiting' ? api.queue(page.nextCursor) : api.decided(page.nextCursor));
      setPage((current) => {
        const shown = current?.items ?? [];
        const seen = new Set(shown.map((item) => item.request.id));
        return {
          items: [...shown, ...next.items.filter((item) => !seen.has(item.request.id))],
          nextCursor: next.nextCursor,
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load more.');
    }
  }

  const items = page ? (tab === 'waiting' ? sortQueue(page.items) : page.items) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Requests from every organization. A request is approved once its payment is confirmed; the checks below flag
            what to look at, and never decide.
          </p>
        </div>
      </header>

      <div role="tablist" aria-label="Requests" className="flex gap-2">
        {(['waiting', 'decided'] as const).map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            aria-selected={tab === which}
            className={buttonClass(tab === which ? 'primary' : 'secondary')}
            onClick={() => setTab(which)}
          >
            {which === 'waiting' ? 'Waiting' : 'Decided'}
          </button>
        ))}
      </div>

      {error ? <ErrorLine message={error} onDismiss={() => setError(null)} onReload={() => load(tab)} /> : null}

      <Section title={tab === 'waiting' ? 'Waiting for a decision' : 'Decided, newest first'}>
        {items === null ? (
          error ? null : (
            <div className="h-32 animate-pulse rounded-md bg-muted" />
          )
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tab === 'waiting' ? 'Nothing is waiting.' : 'Nothing has been decided yet.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const { request } = item;
              const currency = request.bill?.currency ?? 'PHP';
              const checks = queueChecks(item.flags, currency);
              return (
                <li key={request.id}>
                  <a
                    href={billingAdminRequestHref(request.id)}
                    className="block rounded-md border border-border p-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium">
                        {item.organizationName ?? request.organizationId}: {requestKindLabel(request.kind)},{' '}
                        {request.bill?.planLabel ?? request.planKey}
                      </span>
                      <span className="text-muted-foreground">
                        {tab === 'waiting'
                          ? isReadyToCheck(request)
                            ? 'Ready to check'
                            : 'Waiting for payment details'
                          : requestStateLabel(request.state)}{' '}
                        · {formatInstantDay(request.requestedAt, timeZone)}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                      {request.bill ? (
                        <span>
                          Bill {request.bill.number}: {formatMoney(request.bill.total, currency)}
                        </span>
                      ) : null}
                      {tab === 'waiting' && checks.length > 0 ? (
                        <span>{checks.length === 1 ? '1 check to read' : `${checks.length} checks to read`}</span>
                      ) : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        {page?.nextCursor ? (
          <button type="button" className={`${buttonClass()} mt-3`} onClick={() => void more()}>
            Show more
          </button>
        ) : null}
      </Section>
    </div>
  );
}
