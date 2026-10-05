'use client';

import type { ProcessSchedule } from '@kwtech/module-kit';
import { useHoldsFeature } from '@kwtech/module-kit/react';
import { ConfirmDialog } from '@kwtech/web-ui/react';
import { CalendarClock, History, Pause, Play, Timer, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { controlRefusalMessage, JOB_PAUSE_REASON_MAX, preparePauseReason } from '../../domain/controls.js';
import { describeMinutes } from '../../domain/schedule.js';
import { JOBS_FEATURE } from '../../feature-keys.js';
import type { JobProcessView } from '../jobs-client.js';
import { useJobHistory } from '../use-job-history.js';
import type { JobsAdminState } from '../use-jobs-admin.js';
import {
  actorLabel,
  agoText,
  historySignature,
  runStateChip,
  runSummary,
  scheduleNote,
  scheduleText,
  standingChip,
  standingDetail,
  untilText,
  whenText,
} from '../view/jobs-view.js';
import { HistoryList } from './history-list.js';
import { ScheduleForm } from './schedule-form.js';
import { RunStateIcon, StandingIcon } from './state-icons.js';
import { Block, buttonClass, Callout, Fact, Field, IconBadge, StatTile, StatusChip } from './ui.js';

type Dialog = 'pause' | 'resume' | 'run' | 'reset' | null;

/**
 * One process, in the drawer: how it stands, the controls, its schedule and
 * its history.
 *
 * ⚠ EACH CONTROL IS SHOWN ONLY TO WHO HOLDS ITS KEY (`useHoldsFeature`). That
 * only hides it: the API authorises every action again, by the operation's
 * binding. Somebody holding `jobs:read` alone sees everything and can change
 * nothing.
 */
export function ProcessDetail({ process, state, now }: { process: JobProcessView; state: JobsAdminState; now: Date }) {
  const canPause = useHoldsFeature(JOBS_FEATURE.pause);
  const canRun = useHoldsFeature(JOBS_FEATURE.run);
  const canSchedule = useHoldsFeature(JOBS_FEATURE.schedule);
  const history = useJobHistory(state.client, process.key, historySignature(process));

  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  // Here, not in the form: saving remounts the form on the new schedule.
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);

  const synced = process.standing !== 'unsynced';
  const paused = process.pausedAt !== null;
  const detail = standingDetail(process);
  const next = untilText(process.nextCheckAt, now);
  // Run now is refused while a run is queued or under way (JOBS-PLAN D2), and while paused. Say which.
  const runBlocked = paused
    ? 'Resume it before running it.'
    : process.activeRun
      ? 'A run is already queued or under way, so another cannot be asked for.'
      : null;

  /*
   * Focus has a home. A confirmed action can remove the very button that
   * opened its dialog (Pause becomes Resume), and the browser then drops focus
   * on the page body — where Esc no longer reaches the drawer, so it would not
   * close. When a dialog closes and focus is nowhere inside, the drawer takes
   * it back.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dialog !== null) return;
    const drawer = rootRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (drawer && !drawer.contains(document.activeElement)) drawer.focus({ preventScroll: true });
  }, [dialog]);

  /** Closes the dialog whether or not the action worked: a refusal is shown on the page, above the list. */
  async function act(action: () => Promise<unknown>) {
    await state.run(action);
    setDialog(null);
  }

  async function saveSchedule(schedule: ProcessSchedule) {
    setScheduleNotice(null);
    const saved = await state.run(() => state.client.setSchedule(process.key, schedule));
    if (saved) setScheduleNotice('Saved.');
  }

  async function resetSchedule() {
    setScheduleNotice(null);
    const reset = await state.run(() => state.client.resetSchedule(process.key));
    setDialog(null);
    if (reset) setScheduleNotice('Reset to the default.');
  }

  function openPause() {
    setReason('');
    setReasonError(null);
    setDialog('pause');
  }

  async function confirmPause() {
    const prepared = preparePauseReason(reason);
    if ('refused' in prepared) {
      setReasonError(controlRefusalMessage(prepared.refused));
      return;
    }
    await act(() => state.client.pause(process.key, prepared.reason));
  }

  const chip = standingChip(process.standing);
  const live = process.standing === 'queued' || process.standing === 'running';
  const last = process.lastRun;
  const lastChip = last ? runStateChip(last.state) : null;

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <IconBadge tone={chip.tone} size="lg">
          <StandingIcon standing={process.standing} />
        </IconBadge>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{process.label}</h2>
            <StatusChip {...chip} live={live} />
          </div>
          <p className="text-sm text-muted-foreground">{process.description}</p>
        </div>
      </header>

      {detail ? (
        <Callout
          tone={chip.tone}
          icon={<StandingIcon standing={process.standing} />}
          role={process.standing === 'failing' ? 'alert' : undefined}
        >
          {detail}
        </Callout>
      ) : null}

      {synced && (canPause || canRun) ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            {canRun ? (
              <button
                type="button"
                className={buttonClass('secondary')}
                disabled={state.busy || runBlocked !== null}
                onClick={() => setDialog('run')}
              >
                <Zap aria-hidden="true" className="size-4" />
                Run now
              </button>
            ) : null}
            {canPause && !paused ? (
              <button type="button" className={buttonClass('danger')} disabled={state.busy} onClick={openPause}>
                <Pause aria-hidden="true" className="size-4" />
                Pause
              </button>
            ) : null}
            {canPause && paused ? (
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={state.busy}
                onClick={() => setDialog('resume')}
              >
                <Play aria-hidden="true" className="size-4" />
                Resume
              </button>
            ) : null}
          </div>
          {canRun && runBlocked ? <p className="text-xs text-muted-foreground">{runBlocked}</p> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* Across both columns: a schedule is a sentence, and needs the room. */}
        <div className="sm:col-span-2">
          <StatTile
            label="Schedule"
            icon={<CalendarClock />}
            value={scheduleText(process.schedule)}
            hint={process.scheduleIsDefault ? 'The default' : 'Set by an admin'}
          />
        </div>
        <StatTile
          label="Next check"
          icon={<Timer />}
          value={next ? capitalize(next) : '—'}
          hint={next ? whenText(process.nextCheckAt) : paused ? 'Paused' : live ? 'A run exists now' : 'Not scheduled'}
        />
        <StatTile
          label="Last run"
          icon={last ? <RunStateIcon state={last.state} /> : <History />}
          tone={lastChip?.tone ?? 'neutral'}
          value={lastChip?.label ?? 'Never'}
          hint={last ? (agoText(last.finishedAt ?? last.queuedAt, now) ?? undefined) : 'It has not run yet'}
        />
      </div>

      <Block title="Details">
        <dl className="-my-2 divide-y divide-border">
          {last ? <Fact label="Last run did">{runSummary(last)}</Fact> : null}
          {process.scheduleIsDefault ? null : (
            <Fact label="Schedule set by">
              {process.scheduleOverrideIgnored
                ? 'An earlier schedule no longer fits this process’s limits, so the default runs.'
                : `${actorLabel(process.scheduleSetByName)}, ${whenText(process.scheduleSetAt)}`}
            </Fact>
          )}
          {paused ? (
            <Fact label="Paused by">
              {actorLabel(process.pausedByName)}, {whenText(process.pausedAt)}
            </Fact>
          ) : null}
          <Fact label="Reaches">
            {process.serves
              ? `Workspaces whose organization’s plan includes ${process.serves}`
              : 'No workspace: it works on the application itself'}
          </Fact>
          <Fact label="One run">
            At most {describeMinutes(Math.max(1, Math.round(process.maxRunSeconds / 60)))} and {process.maxItemsPerRun}{' '}
            items; the rest wait for the next
          </Fact>
          <Fact label="Too late after">
            {capitalize(describeMinutes(process.tooLateAfterMinutes))}: skipped, and counted
          </Fact>
          <Fact label="Timing">{scheduleNote(process.schedule, process.minEveryMinutes)}</Fact>
        </dl>
      </Block>

      {synced && canSchedule ? (
        <Block title="Schedule" hint="How often, or when, it runs — within what the module allows.">
          <ScheduleForm
            // Starts again from the database's schedule after a save or a reset.
            key={`${process.key}:${JSON.stringify(process.schedule)}:${process.scheduleIsDefault}`}
            process={process}
            busy={state.busy}
            notice={scheduleNotice}
            onEdit={() => setScheduleNotice(null)}
            onSave={(schedule: ProcessSchedule) => void saveSchedule(schedule)}
            onReset={() => setDialog('reset')}
          />
        </Block>
      ) : null}

      <Block title="History" hint="Its runs, and what admins did to it, newest first.">
        <HistoryList history={history} now={now} />
      </Block>

      <ConfirmDialog
        open={dialog === 'pause'}
        title={`Pause “${process.label}”?`}
        description={
          <div className="flex flex-col gap-3">
            <p>
              It stops for every organization until somebody resumes it. A run already under way finishes; nothing more
              is queued.
            </p>
            <Field
              label="Why"
              hint={`Shown to whoever looks next. Up to ${JOB_PAUSE_REASON_MAX} characters.`}
              error={reasonError}
            >
              {(field) => (
                <textarea
                  {...field}
                  rows={3}
                  maxLength={JOB_PAUSE_REASON_MAX}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonError(null);
                  }}
                />
              )}
            </Field>
          </div>
        }
        confirmLabel="Pause"
        pending={state.busy}
        onConfirm={() => void confirmPause()}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'resume'}
        title={`Resume “${process.label}”?`}
        description={`It is checked again on its schedule, starting now. Anything more than ${describeMinutes(process.tooLateAfterMinutes)} past its time is skipped and counted, not sent late.`}
        confirmLabel="Resume"
        danger={false}
        pending={state.busy}
        onConfirm={() => void act(() => state.client.resume(process.key))}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'run'}
        title={`Run “${process.label}” now?`}
        description="A run joins the queue and starts when a slot is free. It does what the next scheduled run would have done, sooner."
        confirmLabel="Run now"
        danger={false}
        pending={state.busy}
        onConfirm={() => void act(() => state.client.runNow(process.key))}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'reset'}
        title="Reset the schedule to its default?"
        description={`It goes back to the module’s own: ${scheduleText(process.defaultSchedule)}.`}
        confirmLabel="Reset to default"
        danger={false}
        pending={state.busy}
        onConfirm={() => void resetSchedule()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

/** "in 15 minutes" → "In 15 minutes", for a value that stands alone on a tile. */
function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
