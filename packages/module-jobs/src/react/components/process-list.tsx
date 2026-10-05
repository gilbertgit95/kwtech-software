'use client';

import { cn, LIST_ITEM, LIST_KEYS } from '@kwtech/web-ui/react';
import { CalendarClock, ChevronRight, History, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import type { JobProcessView } from '../jobs-client.js';
import {
  agoText,
  groupByModule,
  runStateChip,
  runSummary,
  scheduleText,
  standingChip,
  standingDetail,
  untilText,
} from '../view/jobs-view.js';
import { StandingIcon } from './state-icons.js';
import { IconBadge, StatusChip, TONE_SOFT } from './ui.js';

/**
 * Every process as a card, under its module's heading. A card opens that
 * process in the drawer; ↑ ↓ move between cards across the headings, and Enter
 * opens.
 */
export function ProcessList({
  processes,
  moduleLabels,
  selectedKey,
  now,
  onSelect,
}: {
  processes: readonly JobProcessView[];
  moduleLabels: Readonly<Record<string, string>>;
  selectedKey: string | null;
  /** The page's clock, for "in 4 minutes". Passed in so every card agrees. */
  now: Date;
  onSelect: (processKey: string) => void;
}) {
  return (
    // One list for the keys, though it is drawn as several: the arrows cross the headings.
    // The padding keeps a card's shadow and focus ring inside the scrolling box.
    <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 pb-1" {...LIST_KEYS}>
      {groupByModule(processes, moduleLabels).map((group) => (
        <section key={group.module} aria-label={group.label} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {group.processes.length}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {group.processes.map((process) => (
              <li key={process.key}>
                <ProcessCard
                  process={process}
                  selected={process.key === selectedKey}
                  now={now}
                  onClick={() => onSelect(process.key)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ProcessCard({
  process,
  selected,
  now,
  onClick,
}: {
  process: JobProcessView;
  selected: boolean;
  now: Date;
  onClick: () => void;
}) {
  const chip = standingChip(process.standing);
  const detail = standingDetail(process);
  const next = untilText(process.nextCheckAt, now);
  const last = process.lastRun;
  const lastAgo = last ? agoText(last.finishedAt ?? last.queuedAt, now) : null;
  const live = process.standing === 'queued' || process.standing === 'running';

  return (
    // Spans throughout: everything inside a <button> is phrasing content.
    <button
      type="button"
      {...LIST_ITEM}
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left text-card-foreground shadow-sm transition',
        'hover:border-primary/40 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary' : 'border-border',
      )}
    >
      <IconBadge tone={chip.tone}>
        <StandingIcon standing={process.standing} />
      </IconBadge>

      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-semibold leading-tight text-foreground">{process.label}</span>
            <StatusChip {...chip} live={live} />
          </span>
          <span className="text-sm text-muted-foreground">{process.description}</span>
        </span>

        {detail ? (
          <span className={cn('self-start rounded-lg px-2.5 py-1 text-xs font-medium', TONE_SOFT[chip.tone])}>
            {detail}
          </span>
        ) : null}

        <span className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <Meta icon={<CalendarClock />}>{scheduleText(process.schedule)}</Meta>
          <Meta icon={<History />}>
            {last
              ? `Last run ${lastAgo ?? ''}: ${runStateChip(last.state).label.toLowerCase()} — ${runSummary(last)}`
              : 'Has not run yet'}
          </Meta>
          {next ? <Meta icon={<Timer />}>Next check {next}</Meta> : null}
        </span>
      </span>

      <ChevronRight
        aria-hidden="true"
        className="mt-2.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </button>
  );
}

/** One fact on a card's bottom line, behind its small icon. */
function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className="shrink-0 [&>svg]:size-3.5">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** The list before its first read lands: the shape of what is coming, so the page does not jump. */
export function ProcessListSkeleton() {
  return (
    <div role="status" aria-label="Loading the background processes" className="flex flex-col gap-2">
      {['first', 'second', 'third'].map((slot) => (
        <div key={slot} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <div className="size-10 shrink-0 animate-pulse rounded-xl bg-muted" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-4 w-48 max-w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-full max-w-md animate-pulse rounded bg-muted" />
            <div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
