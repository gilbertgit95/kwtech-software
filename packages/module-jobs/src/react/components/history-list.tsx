'use client';

import type { JobHistoryEntryView } from '../jobs-client.js';
import type { JobHistoryState } from '../use-job-history.js';
import {
  agoText,
  controlSummary,
  runDurationText,
  runStateChip,
  runSummary,
  runTitle,
  whenText,
} from '../view/jobs-view.js';
import { ControlIcon, RunStateIcon } from './state-icons.js';
import { Alert, buttonClass, IconBadge, StatusChip } from './ui.js';

/**
 * A process's history as a timeline: its runs, and what admins did to it AMONG
 * them, newest first — so "why did reminders stop on Tuesday" reads down one
 * line (JOBS-PLAN §7).
 */
export function HistoryList({ history, now }: { history: JobHistoryState; now: Date }) {
  const empty = history.entries.length === 0 && !history.loading && !history.error;
  return (
    <div className="flex flex-col gap-3">
      <Alert message={history.error} />
      {empty ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Nothing yet: it has not run, and nobody has changed it.
        </p>
      ) : null}
      <ol className="flex flex-col">
        {history.entries.map((entry, index) => (
          <li key={`${entry.kind}:${entry.id}`} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The line down the timeline, from this marker to the next. None after the last. */}
            {index < history.entries.length - 1 ? (
              <span aria-hidden="true" className="absolute top-7 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border" />
            ) : null}
            <HistoryEntry entry={entry} now={now} />
          </li>
        ))}
      </ol>
      {history.loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      ) : null}
      {history.hasMore && !history.loading ? (
        <button type="button" className={`${buttonClass('secondary', 'sm')} self-start`} onClick={history.loadMore}>
          Show older
        </button>
      ) : null}
    </div>
  );
}

function HistoryEntry({ entry, now }: { entry: JobHistoryEntryView; now: Date }) {
  const when = (
    <p className="text-xs text-muted-foreground">
      {agoText(entry.at, now)} · {whenText(entry.at)}
    </p>
  );

  if (entry.control) {
    return (
      <>
        {/* Neutral: a decision somebody made, not something the runner did. */}
        <IconBadge tone="neutral" size="sm">
          <ControlIcon action={entry.control.action} />
        </IconBadge>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm text-foreground">{controlSummary(entry.control)}</p>
          {when}
        </div>
      </>
    );
  }
  if (!entry.run) return null;
  const run = entry.run;
  const chip = runStateChip(run.state);
  const duration = runDurationText(run);
  return (
    <>
      <IconBadge tone={chip.tone} size="sm">
        <RunStateIcon state={run.state} />
      </IconBadge>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-foreground">{runTitle(run)}</span>
          <StatusChip {...chip} live={run.state === 'queued' || run.state === 'running'} />
        </p>
        <p className={run.state === 'failed' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {runSummary(run)}
        </p>
        <p className="text-xs text-muted-foreground">
          {agoText(entry.at, now)} · {whenText(entry.at)}
          {duration ? ` · took ${duration}` : ''}
        </p>
      </div>
    </>
  );
}
