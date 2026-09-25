'use client';

import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useState } from 'react';
import type { NotificationBatchView, NotificationClient } from '../../notification-client.js';
import { initialsOf, readShare } from '../../view/compose-view.js';
import { groupByDay, relativeTime } from '../../view/inbox-view.js';
import { severityLook } from '../../view/severity-view.js';
import { NotificationIcon } from '../notification-icons.js';

export interface SentPanelProps {
  client: NotificationClient;
  /** Whether the viewer may recall — hides the button otherwise. The API decides again. */
  canRecall: boolean;
  onCompose: () => void;
  /** Bumped by the page after a send, so the list re-reads when it is next shown. */
  refreshKey: number;
}

/**
 * What has been sent, newest first under day headings: how loud, who sent it,
 * when, and how many of the recipients have read it — with Recall for a send
 * that should not have gone out.
 */
export function SentPanel({ client, canRecall, onCompose, refreshKey }: SentPanelProps) {
  const [mineOnly, setMineOnly] = useState(false);
  const [items, setItems] = useState<NotificationBatchView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<NotificationBatchView | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(
    async (after: string | null) => {
      try {
        const page = await client.batches({ first: 20, after, mineOnly });
        setItems((current) => (after && current ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
        setNow(new Date());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load what was sent.');
      }
    },
    [client, mineOnly],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshKey` is the signal to re-read after a send.
  useEffect(() => {
    setItems(null);
    void load(null);
  }, [load, refreshKey]);

  const loadMore = async () => {
    setLoadingMore(true);
    await load(cursor);
    setLoadingMore(false);
  };

  const recall = async () => {
    if (!confirming) return;
    setPending(true);
    try {
      const updated = await client.recall(confirming.id);
      setItems((current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
      setConfirming(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not recall it.');
    } finally {
      setPending(false);
    }
  };

  const groups = items
    ? groupByDay(
        items.map((item) => ({ ...item, occurredAt: item.createdAt })),
        now,
      )
    : [];

  return (
    <section aria-label="Sent notifications" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          <legend className="sr-only">Show</legend>
          {[
            { value: false, label: 'Everyone’s' },
            { value: true, label: 'Sent by me' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={mineOnly === option.value}
              onClick={() => setMineOnly(option.value)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mineOnly === option.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          onClick={() => void load(null)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <NotificationIcon name="refresh" className="size-4" />
          Refresh
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {items === null ? (
        <ul aria-label="Loading" className="space-y-2">
          {[0, 1, 2].map((key) => (
            <li key={key} className="h-20 animate-pulse rounded-xl border border-border bg-muted/40" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <NotificationIcon name="history" className="size-6" />
          </span>
          <h2 className="mt-4 text-base font-semibold">
            {mineOnly ? 'You have not sent anything yet' : 'Nothing sent yet'}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Notifications sent from here, and by the system, are listed with how many people have read them.
          </p>
          <button
            type="button"
            onClick={onCompose}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <NotificationIcon name="compose" className="size-4" />
            Compose a notification
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={`${group.label}-${group.items[0]?.id ?? ''}`}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h2>
              <ul className="space-y-2">
                {group.items.map((batch) => (
                  <SentRow
                    key={batch.id}
                    batch={batch}
                    now={now}
                    canRecall={canRecall}
                    onRecall={() => setConfirming(batch)}
                  />
                ))}
              </ul>
            </div>
          ))}
          {cursor ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
              >
                {loadingMore ? 'Loading…' : 'Show older'}
              </button>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title="Recall this notification?"
        description={
          confirming
            ? `“${confirming.title}” will disappear from the inbox of all ${confirming.recipientCount} ${
                confirming.recipientCount === 1 ? 'person' : 'people'
              } who got it, including from screens that are open now. Anyone who already read it has seen it.`
            : ''
        }
        confirmLabel="Recall"
        pending={pending}
        onConfirm={() => void recall()}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}

function SentRow({
  batch,
  now,
  canRecall,
  onRecall,
}: {
  batch: NotificationBatchView;
  now: Date;
  canRecall: boolean;
  onRecall: () => void;
}) {
  const look = severityLook(batch.severity);
  const share = readShare(batch.readCount, batch.recipientCount);
  const recalled = batch.recalledAt !== null;
  const sender = batch.senderName ?? (batch.senderId ? 'Someone' : 'The system');

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors sm:flex-nowrap',
        recalled ? 'opacity-70' : 'hover:border-foreground/20',
      )}
    >
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', look.chip)} title={look.label}>
        <NotificationIcon name={look.icon} className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn('truncate text-sm font-medium', recalled ? 'line-through' : null)}>{batch.title}</p>
          {recalled ? (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              Recalled
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="grid size-4 place-items-center rounded-full bg-primary/15 text-[0.5rem] font-semibold text-primary"
          >
            {initialsOf(sender)}
          </span>
          <span>{sender}</span>
          <span aria-hidden>·</span>
          <time dateTime={batch.createdAt} title={new Date(batch.createdAt).toLocaleString()}>
            {relativeTime(batch.createdAt, now)}
          </time>
          <span aria-hidden>·</span>
          <span>{batch.sourceLabel}</span>
        </p>
      </div>

      <div className="w-full sm:w-40">
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{share.label}</span>
          <span className="font-medium tabular-nums">{share.percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-label={`${batch.title}: ${share.label}`}
          aria-valuenow={share.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${share.percent}%` }} />
        </div>
      </div>

      {canRecall && !recalled && batch.recipientCount > 0 ? (
        <button
          type="button"
          onClick={onRecall}
          aria-label={`Recall “${batch.title}”`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <NotificationIcon name="recall" className="size-3.5" />
          Recall
        </button>
      ) : null}
    </li>
  );
}
