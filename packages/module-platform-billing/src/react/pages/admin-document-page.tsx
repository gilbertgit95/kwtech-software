'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type BillingAdminClient,
  type BillingQueueItemView,
  createBillingAdminClient,
} from '../billing-admin-client.js';
import { buttonClass } from '../components/ui.js';
import { billingAdminRequestHref } from '../routes.js';
import { PrintedDocument } from './billing-document-page.js';

export interface AdminDocumentPageProps {
  requestId: string | undefined;
  kind: string | undefined;
  /** The printed number: `B-000012` or `R-000003`. */
  number: string | undefined;
  client?: BillingAdminClient;
}

/**
 * ONE BILL OR RECEIPT OF ANY ORGANIZATION, AS PRINTED (phase 7), for
 * platform staff reprinting what an organization lost. The same document the
 * organization prints (`PrintedDocument`), read through the platform's review
 * query, so it needs `queue_read` and no membership.
 *
 * ⚠ Everything on it is the document's own snapshot; only the stamp is
 * today's, exactly as on the organization's side.
 */
export function AdminDocumentPage({ requestId, kind, number, client }: AdminDocumentPageProps) {
  const api = useMemo(() => client ?? createBillingAdminClient(), [client]);
  const [item, setItem] = useState<BillingQueueItemView | null | undefined>(undefined);
  const [currency, setCurrency] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    Promise.all([api.review(requestId), api.settings()])
      .then(([next, settings]) => {
        if (cancelled) return;
        setItem(next);
        setCurrency(settings.currency);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the document.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, requestId]);

  const request = item?.request ?? null;
  const bill = kind === 'bill' ? (request?.bills.find((one) => one.number === number) ?? null) : null;
  const receipt = kind === 'receipt' ? (request?.receipts.find((one) => one.number === number) ?? null) : null;
  const missing = !requestId || item === null || (item !== undefined && !bill && !receipt);

  return (
    <div className="mx-auto w-full max-w-3xl p-6 text-foreground print:p-0">
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <a
          href={requestId ? billingAdminRequestHref(requestId) : '/admin/billing'}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to the request
        </a>
        {bill || receipt ? (
          <button type="button" className={buttonClass('primary')} onClick={() => window.print()}>
            Print
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : missing ? (
        <p role="alert" className="text-sm text-muted-foreground">
          That document does not exist. Open it from the request it belongs to.
        </p>
      ) : !item || !request || !currency ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted print:hidden" />
      ) : (
        <article className="rounded-lg border border-border bg-card p-8 print:border-0 print:p-0">
          <PrintedDocument
            overview={{ organizationName: item.organizationName, currency }}
            request={request}
            bill={bill}
            receipt={receipt}
            organizationId={request.organizationId}
          />
        </article>
      )}
    </div>
  );
}
