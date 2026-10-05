'use client';

import { cn, ListDrawer, listNeighbours } from '@kwtech/web-ui/react';
import { Activity, CirclePause, Layers, RefreshCw, Timer, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ProcessDetail } from '../components/process-detail.js';
import { ProcessList, ProcessListSkeleton } from '../components/process-list.js';
import { Alert, buttonClass, IconBadge, StatTile } from '../components/ui.js';
import type { JobsClient } from '../jobs-client.js';
import { useJobsAdmin } from '../use-jobs-admin.js';
import { groupByModule, summarizeProcesses } from '../view/jobs-view.js';

export interface JobsPageProps {
  /** Names for the module headings (`{ task: 'Tasks' }`). A module with none is headed by its key, in words. */
  moduleLabels?: Readonly<Record<string, string>>;
  /** Injectable, so the page can be driven without a server. */
  client?: JobsClient;
}

const NO_LABELS: Readonly<Record<string, string>> = {};

/**
 * `/admin/processes` — every background process the application's modules
 * declare: how each stands, and, for who holds the keys, Pause, Resume, Run
 * now and its schedule (JOBS-PLAN §7).
 *
 * ⚠ APP LEVEL. A process is one thing for the whole application: a pause here
 * stops it for every organization. Nothing on this page is per tenant, and a
 * run shows counts, never whose (D5).
 *
 * Times are in the VIEWER's own zone: this is a screen outside any workspace.
 */
export function JobsPage({ moduleLabels = NO_LABELS, client }: JobsPageProps = {}) {
  const state = useJobsAdmin(client ? { client } : {});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The Refresh button's own turn: the timer's quiet re-reads must not spin it.
  const [refreshing, setRefreshing] = useState(false);

  const processes = state.processes ?? [];
  const summary = summarizeProcesses(processes);
  // The drawer's Previous and Next walk the list AS DRAWN: grouped, then in the server's order.
  const shownKeys = groupByModule(processes, moduleLabels).flatMap((group) => group.processes.map((one) => one.key));
  const around = listNeighbours(shownKeys, selectedKey);
  const selected = processes.find((process) => process.key === selectedKey) ?? null;
  // One clock for the render, so every "in 4 minutes" on the page agrees. Refreshed by each re-read.
  const now = new Date();

  async function refresh() {
    setRefreshing(true);
    try {
      await state.reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    // A height of its own: the drawer covers the list's panel, so the panel must have one.
    <div className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[34rem] w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <IconBadge tone="info" size="lg">
            <Timer />
          </IconBadge>
          {/* `min-w-0`: beside the icon in a narrow column the text wraps instead of pushing past the edge. */}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Background processes</h1>
            <p className="text-sm text-muted-foreground">
              Work the application does on a schedule, for every organization at once.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {state.loadedAt ? (
            <span className="text-xs text-muted-foreground">
              Updated {state.loadedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          ) : null}
          <button
            type="button"
            className={buttonClass('secondary')}
            disabled={state.busy || refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" className={cn('size-4', refreshing && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </header>

      {state.processes !== null && processes.length > 0 ? (
        <section aria-label="Summary" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile label="Processes" icon={<Layers />} value={summary.total} />
          <StatTile
            label="Queued or running"
            icon={<Activity />}
            tone={summary.active > 0 ? 'info' : 'neutral'}
            value={summary.active}
          />
          <StatTile
            label="Paused"
            icon={<CirclePause />}
            tone={summary.paused > 0 ? 'warning' : 'neutral'}
            value={summary.paused}
          />
          <StatTile
            label="Failing"
            icon={<TriangleAlert />}
            tone={summary.failing > 0 ? 'danger' : 'neutral'}
            value={summary.failing}
          />
        </section>
      ) : null}

      <Alert message={state.error} onDismiss={state.dismissError} />

      <ListDrawer
        label="process"
        onClose={() => setSelectedKey(null)}
        step={{
          onPrevious: around.previous ? () => setSelectedKey(around.previous) : null,
          onNext: around.next ? () => setSelectedKey(around.next) : null,
          position: around.position,
        }}
        list={
          state.processes === null ? (
            state.error ? (
              <p role="status" className="text-sm text-muted-foreground">
                The processes could not be loaded.
              </p>
            ) : (
              <ProcessListSkeleton />
            )
          ) : processes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <IconBadge tone="neutral" size="lg">
                <Timer />
              </IconBadge>
              <p className="text-sm font-medium text-foreground">Nothing runs in the background yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                No module of this application declares a background process. When one does, it appears here.
              </p>
            </div>
          ) : (
            <ProcessList
              processes={processes}
              moduleLabels={moduleLabels}
              selectedKey={selectedKey}
              now={now}
              onSelect={setSelectedKey}
            />
          )
        }
        detail={selected ? <ProcessDetail key={selected.key} process={selected} state={state} now={now} /> : null}
      />
    </div>
  );
}
