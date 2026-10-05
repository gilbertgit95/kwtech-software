'use client';

import { cn } from '@kwtech/web-ui/react';
import { RotateCcw } from 'lucide-react';
import { type KeyboardEvent, useEffect, useState } from 'react';
import {
  STUDIO_DEFAULT_KEYMAP,
  type StudioKeyAction,
  type StudioKeymap,
  studioKeyLabel,
  studioKeyOfPress,
  validateStudioKeymap,
} from '../../domain/keymap.js';
import type { StudioAppState } from '../studio-state.js';
import { useStudioAction } from '../use-studio-data.js';
import { actionLabel, KEYMAP_GROUPS } from '../view/keys.js';
import { buttonClass } from './controls.js';
import { Alert } from './layout.js';

/**
 * The workspace's shortcut keys: which key does what, on the Print screen and
 * in the layout editor (the operator, 2026-10-05: "configurable like in the
 * pos").
 *
 * - Everybody sees the list — it is also the reference for what the keys are.
 * - Somebody holding `studio:manage_settings` may change them, FOR EVERYBODY
 *   in the workspace. Hiding the controls is cosmetic; the API refuses too.
 * - Checked as it is edited by the same `validateStudioKeymap` the server
 *   runs, so Save is never pressed on something that will be refused.
 *
 * To set a key: press its button, then press the key. Escape leaves it as it was.
 */
export function ShortcutsSection({ state, onSaved }: { state: StudioAppState; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<StudioKeymap>(state.keymap);
  const [capturing, setCapturing] = useState<StudioKeyAction | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const save = useStudioAction('Could not save the shortcut keys.');
  const canEdit = state.can.manageSettings;

  // The saved keymap becomes the draft when it arrives, and again after each save.
  useEffect(() => setDraft(state.keymap), [state.keymap]);

  const checked = validateStudioKeymap(draft);
  const problems = 'refused' in checked ? checked.refused : [];
  const changed = JSON.stringify(draft) !== JSON.stringify(state.keymap);
  const isDefault = JSON.stringify(draft) === JSON.stringify(STUDIO_DEFAULT_KEYMAP);

  function capture(event: KeyboardEvent<HTMLButtonElement>, action: StudioKeyAction) {
    if (capturing !== action) return;
    // Tab moves on, as it always does: a key-setting box must not be a trap for the keyboard.
    if (event.key === 'Tab') return setCapturing(null);
    event.preventDefault();
    event.stopPropagation();
    const key = studioKeyOfPress(event);
    // A modifier going down by itself: keep waiting for the key it is held for.
    if (key === null) return;
    setCapturing(null);
    if (key === 'Escape') return;
    setDraft((current) => ({ ...current, [action]: key }));
    setSavedNote(false);
  }

  async function submit() {
    if (!('keymap' in checked)) return;
    const done = await save.run(() => state.client.saveSettings(state.scope, JSON.stringify(checked.keymap)));
    if (!done) return;
    await onSaved();
    setSavedNote(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Shortcut keys</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {canEdit
              ? 'Press a key’s button, then the key you want. These keys are for everybody in this workspace.'
              : 'The keys that work in the print studio. Somebody who manages the studio’s settings can change them.'}
          </p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            {savedNote && !changed ? (
              <span role="status" className="text-sm text-muted-foreground">
                Saved.
              </span>
            ) : null}
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={save.busy || isDefault}
              onClick={() => {
                setDraft(STUDIO_DEFAULT_KEYMAP);
                setSavedNote(false);
              }}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Use the defaults
            </button>
            <button
              type="button"
              className={buttonClass('primary')}
              disabled={save.busy || !changed || problems.length > 0}
              onClick={() => void submit()}
            >
              {save.busy ? 'Saving…' : 'Save keys'}
            </button>
          </div>
        ) : null}
      </div>

      <Alert message={save.error} onDismiss={save.dismissError} />
      {problems.length > 0 ? (
        <ul
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 @3xl:grid-cols-2">
        {KEYMAP_GROUPS.map((group) => (
          <section key={group.zone} className="flex flex-col rounded-xl border border-border bg-card">
            <h3 className="border-b border-border px-3 py-2 text-sm font-semibold">{group.title}</h3>
            <ul className="divide-y divide-border">
              {group.actions.map((action) => (
                <li key={action} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 text-sm">{actionLabel(action)}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`${actionLabel(action)}: ${studioKeyLabel(draft[action])}. Press to change.`}
                      className={cn(
                        'min-w-20 shrink-0 rounded-md border px-2 py-1 text-center font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        capturing === action
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:border-primary hover:bg-accent',
                        draft[action] !== state.keymap[action] && capturing !== action ? 'border-primary' : null,
                      )}
                      onClick={() => setCapturing(capturing === action ? null : action)}
                      onKeyDown={(event) => capture(event, action)}
                      onBlur={() => setCapturing((current) => (current === action ? null : current))}
                    >
                      {capturing === action ? 'Press a key…' : studioKeyLabel(draft[action])}
                    </button>
                  ) : (
                    <kbd className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs">
                      {studioKeyLabel(draft[action])}
                    </kbd>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-card px-3 py-2.5">
        <h3 className="text-sm font-semibold">Always the same</h3>
        <p className="text-sm text-muted-foreground">
          The arrow keys move the selected photo or cell — further with Shift — and Esc lets go of the selection. These
          cannot be changed, so there is always a way to move something and a way out.
        </p>
      </section>
    </div>
  );
}
