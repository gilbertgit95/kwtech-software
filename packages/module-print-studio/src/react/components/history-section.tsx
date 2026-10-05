'use client';

import { cn } from '@kwtech/web-ui/react';
import { Download, History, Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { StudioLogEntryView } from '../studio-client.js';
import type { StudioAppState } from '../studio-state.js';
import { actionLabel, clockTime, entrySummary, groupByDay } from '../view/history.js';
import { plural } from '../view/summary.js';
import { buttonClass } from './controls.js';
import { Alert, Empty, EmptyState } from './layout.js';

/**
 * The print history: who made a result, when, on what paper, and the names of
 * the files in it (PRINT-STUDIO-PLAN decision 10).
 *
 * - A person sees their own. A holder of `studio:manage_all` may switch to
 *   everybody's; the API decides, and says which it answered with.
 * - ⚠ Days and times are the WORKSPACE's (`state.timeZone`).
 * - It records that a result was downloaded or sent to the print dialog —
 *   never that paper came out, which a browser cannot know.
 * - Entries are deleted after the time the app keeps them (90 days unless set
 *   otherwise): they name files, and file names are often customers' names.
 */
export function HistorySection({ state }: { state: StudioAppState }) {
  const [everyone, setEveryone] = useState(false);
  const [entries, setEntries] = useState<StudioLogEntryView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      try {
        const page = await state.client.log(state.scope, { everyone, cursor: after });
        setEntries((current) => (after ? [...current, ...page.entries] : page.entries));
        setCursor(page.nextCursor);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load the history.');
      } finally {
        setLoading(false);
      }
    },
    [state.client, state.scope, everyone],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const days = groupByDay(entries, state.timeZone);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Files are never kept — only their names. “Sent to print” means the print window was opened, not that paper
          came out.
        </p>
        {state.can.manageAll ? (
          <fieldset className="inline-flex rounded-lg border border-border bg-background p-0.5">
            <legend className="sr-only">Whose history</legend>
            {[
              { value: false, label: 'Mine' },
              { value: true, label: 'Everyone’s' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={everyone === option.value}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  everyone === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent',
                )}
                onClick={() => setEveryone(option.value)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        ) : null}
      </div>

      <Alert message={error} />
      {loading && entries.length === 0 ? <Empty>Loading…</Empty> : null}
      {!loading && !error && entries.length === 0 ? (
        <EmptyState icon={History} title="Nothing printed yet">
          Each result you download or print is listed here.
        </EmptyState>
      ) : null}

      {days.map((day) => (
        <section key={day.day} className="flex flex-col gap-1.5">
          <h2 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
            {day.label}
            <span className="text-xs font-normal text-muted-foreground">{plural(day.sheets, 'sheet')}</span>
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {day.entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {entry.action === 'downloaded' ? (
                    <Download aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Printer aria-hidden="true" className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{actionLabel(entry.action)}</span>
                    {' · '}
                    {entry.layoutName ?? (entry.kind === 'pages' ? 'A document' : 'A layout')}
                    {' · '}
                    <span className="text-muted-foreground">{entrySummary(entry)}</span>
                  </p>
                  {entry.fileNames.length > 0 ? (
                    <p className="truncate text-xs text-muted-foreground" title={entry.fileNames.join(', ')}>
                      {entry.fileNames.join(', ')}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <p className="tabular-nums">{clockTime(entry.createdAt, state.timeZone)}</p>
                  {everyone ? <p>{entry.mine ? 'You' : (entry.userName ?? 'A member')}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {cursor ? (
        <button
          type="button"
          className={cn(buttonClass('secondary', 'sm'), 'self-center')}
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          {loading ? 'Loading…' : 'Show earlier'}
        </button>
      ) : null}
    </div>
  );
}
