'use client';

import { useId, useState } from 'react';
import { FILE_RETENTION_HOURS_MAX, FILE_RETENTION_HOURS_MIN, isValidRetentionHours } from '../../domain/retention.js';
import type { FileSettingsView } from '../file-client.js';
import type { FilesState } from '../use-files.js';
import { cleanupTimeLabel } from '../view/files-view.js';
import { buttonClass } from './controls.js';

/** How long this workspace's files are kept. For holders of `file:manage`; the API checks again. */
export function SettingsPanel({
  state,
  settings,
  onDone,
}: {
  state: FilesState;
  settings: FileSettingsView;
  onDone: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [hours, setHours] = useState(String(settings.retentionHours));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const value = Number(hours);
    if (!isValidRetentionHours(value)) {
      setProblem(`Choose a whole number of hours from ${FILE_RETENTION_HOURS_MIN} to ${FILE_RETENTION_HOURS_MAX}.`);
      return;
    }
    setProblem(null);
    const ok = await state.run(async (api) => {
      await api.setSettings(state.scope, value);
    });
    setSaved(ok);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">File settings</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          Keep files for (hours)
        </label>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={FILE_RETENTION_HOURS_MIN}
          max={FILE_RETENTION_HOURS_MAX}
          step={1}
          value={hours}
          aria-invalid={problem ? true : undefined}
          aria-describedby={hintId}
          onChange={(event) => {
            setHours(event.target.value);
            setSaved(false);
          }}
          className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p
          id={hintId}
          className={problem ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}
          role={problem ? 'alert' : undefined}
        >
          {problem ??
            `Every night at ${cleanupTimeLabel(settings.cleanupTime)}, files older than this are deleted. A change applies to every file here, from tonight.`}
        </p>
      </div>
      {saved ? (
        <p role="status" className="text-sm text-status-success">
          Saved.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass('ghost')} onClick={onDone}>
          Close
        </button>
        <button type="submit" className={buttonClass('primary')} disabled={state.busy}>
          {state.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
