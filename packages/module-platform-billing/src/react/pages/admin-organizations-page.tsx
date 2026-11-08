'use client';

import { cn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BillingAdminClient,
  type BillingOrganizationPageView,
  createBillingAdminClient,
} from '../billing-admin-client.js';
import { buttonClass, ErrorLine, Reason, Section } from '../components/ui.js';
import { BILLING_ADMIN_REPORTS_ROUTE, billingAdminOrganizationsHref, billingAdminRequestHref } from '../routes.js';
import { formatMoney } from '../view/billing-view.js';
import { STANDING_FILTER_OPTIONS, standingLine } from '../view/report-view.js';

export interface AdminOrganizationsPageProps {
  /** The filter from the address (`?filter=`), or none. */
  filter: string | undefined;
  client?: BillingAdminClient;
}

/**
 * `/admin/billing/organizations` (phase 7b): every organization's standing,
 * plan, the day it turns on, its credit or what it owes, and a waiting
 * request to open. Filtered on the server, and paged by organization: a
 * filtered page may come back short, and Show more goes on from where it
 * stopped looking.
 */
export function AdminOrganizationsPage({ filter, client }: AdminOrganizationsPageProps) {
  const api = useMemo(() => client ?? createBillingAdminClient(), [client]);
  const [page, setPage] = useState<BillingOrganizationPageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState('PHP');
  const [loadingMore, setLoadingMore] = useState(false);
  /** Bumped per fresh read: a "Show more" for an older list is dropped. */
  const generation = useRef(0);
  const chosen = filter ?? null;

  const load = useCallback(() => {
    const mine = ++generation.current;
    setPage(null);
    setError(null);
    setLoadingMore(false);
    Promise.all([api.organizations(null, chosen), api.settings()])
      .then(([next, settings]) => {
        if (mine !== generation.current) return;
        setPage(next);
        setCurrency(settings.currency);
      })
      .catch((cause: unknown) => {
        if (mine === generation.current)
          setError(cause instanceof Error ? cause.message : 'Could not load the organizations.');
      });
  }, [api, chosen]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  /** The next page, kept only if the list in view still ends where it was asked from. */
  async function more() {
    const cursor = page?.nextCursor;
    if (!cursor || loadingMore) return;
    const asked = generation.current;
    setLoadingMore(true);
    try {
      const next = await api.organizations(cursor, chosen);
      if (asked !== generation.current) return;
      setPage((current) => {
        if (!current || current.nextCursor !== cursor) return current;
        const seen = new Set(current.items.map((one) => one.organizationId));
        return {
          ...current,
          items: [...current.items, ...next.items.filter((one) => !seen.has(one.organizationId))],
          nextCursor: next.nextCursor,
        };
      });
    } catch (cause) {
      if (asked === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load more.');
    } finally {
      if (asked === generation.current) setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations’ billing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where every organization stands today, in the billing time zone, and the credit it holds or owes.
          </p>
        </div>
        <a href={BILLING_ADMIN_REPORTS_ROUTE} className={buttonClass()}>
          Reports
        </a>
      </header>

      <nav aria-label="Filter organizations" className="flex flex-wrap gap-2">
        {STANDING_FILTER_OPTIONS.map((option) => (
          <a
            key={option.label}
            href={billingAdminOrganizationsHref(option.value)}
            aria-current={option.value === chosen ? 'page' : undefined}
            className={cn(
              'rounded-full border border-border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring',
              option.value === chosen ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {option.label}
          </a>
        ))}
      </nav>

      {error ? <ErrorLine message={error} onDismiss={() => setError(null)} onReload={load} /> : null}

      <Section title="Organizations">
        {!page ? (
          error ? null : (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          )
        ) : !page.available ? (
          <Reason>The app does not list organizations to billing, so their standings cannot be shown.</Reason>
        ) : page.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {page.nextCursor
              ? 'None matched among the organizations looked at so far. Show more looks further.'
              : 'No organization matches.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1 font-medium">Organization</th>
                  <th className="py-1 font-medium">Plan</th>
                  <th className="py-1 font-medium">Standing</th>
                  <th className="py-1 text-right font-medium">Credit</th>
                  <th className="py-1 font-medium">
                    <span className="sr-only">Waiting request</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((one) => {
                  const line = standingLine(one);
                  return (
                    <tr key={one.organizationId} className="border-b border-border align-top">
                      <td className="py-2">{one.name}</td>
                      <td className="py-2">{one.standing.planLabel ?? '—'}</td>
                      <td className="py-2">
                        <span
                          className={
                            line.tone === 'warning'
                              ? 'font-medium'
                              : line.tone === 'muted'
                                ? 'text-muted-foreground'
                                : ''
                          }
                        >
                          {line.word}
                        </span>
                        {line.detail ? (
                          <span className="block text-xs text-muted-foreground">{line.detail}</span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {one.creditBalance === 0
                          ? '—'
                          : one.creditBalance > 0
                            ? formatMoney(one.creditBalance, currency)
                            : `owes ${formatMoney(-one.creditBalance, currency)}`}
                      </td>
                      <td className="py-2 text-right">
                        {one.pendingRequestId ? (
                          <a href={billingAdminRequestHref(one.pendingRequestId)} className="underline">
                            Request waiting
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {page?.nextCursor ? (
          <button type="button" className={`${buttonClass()} mt-3`} disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? 'Loading…' : 'Show more'}
          </button>
        ) : null}
      </Section>
    </div>
  );
}
