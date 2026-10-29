'use client';

import { cn } from '@kwtech/web-ui/react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { POS_REFERENCE_OPTIONS_MAX, validateReferenceOptions } from '../../domain/references.js';
import { POS_LABEL_MAX } from '../../domain/text.js';
import { usePosData } from '../use-pos-data.js';
import type { TillState } from '../use-till.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { Alert, Empty } from './layout.js';

/** One option in the editor, with an id of its own: the text is what is being renamed, so it cannot be the key. */
interface ReferenceRow {
  id: string;
  text: string;
}

function referenceRows(options: readonly string[]): ReferenceRow[] {
  return options.map((text) => ({ id: crypto.randomUUID(), text }));
}

/**
 * The order reference options (issue #30): the shortcuts the Reference and
 * Hold dialogs offer at the till. Added one by one, renamed in place, moved
 * up and down, removed — then saved as a whole list, checked by the same
 * `validateReferenceOptions` the server runs.
 *
 * On the Items tab since 2026-10-29, under `pos:manage_items`, beside
 * categories and order types. One option can be the DEFAULT, the reference a
 * new order starts with; it is saved with the list, and removing the option
 * removes the default.
 *
 * Saved apart from the hot keys, with a mutation of its own: saving one
 * never resets the other.
 */
export function ReferenceOptionsPanel({ state }: { state: TillState }) {
  const { client, scope } = state;
  const loadSettings = useCallback(() => client.settings(scope), [client, scope]);
  const settings = usePosData(scope, loadSettings, ['settings'], 'Could not load the settings.');
  const [rows, setRows] = useState<ReferenceRow[] | null>(null);
  /** The default option's row id, or null for none: by row, so renaming the default keeps it the default. */
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // The saved list becomes the draft once, and again after each save. Compared as text, so a
  // re-read that changed nothing does not throw away what is being edited.
  const savedText = settings.data
    ? JSON.stringify([settings.data.referenceOptions, settings.data.defaultReference])
    : null;
  useEffect(() => {
    if (savedText === null) return;
    const [options, stored] = JSON.parse(savedText) as [string[], string | null];
    const next = referenceRows(options);
    setRows(next);
    setDefaultId(next.find((row) => row.text === stored)?.id ?? null);
  }, [savedText]);

  if (!rows) {
    return settings.error ? <Alert message={settings.error} /> : <Empty>Loading…</Empty>;
  }

  const change = (next: ReferenceRow[]) => {
    setRows(next);
    setProblems([]);
    setSaved(false);
  };
  const rename = (id: string, text: string) => change(rows.map((row) => (row.id === id ? { ...row, text } : row)));
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    const moving = rows[index];
    const other = rows[target];
    if (!moving || !other) return;
    const next = [...rows];
    next[index] = other;
    next[target] = moving;
    change(next);
  };
  const add = () => {
    if (adding.trim() === '') return;
    change([...rows, { id: crypto.randomUUID(), text: adding }]);
    setAdding('');
  };

  const save = async () => {
    const checked = validateReferenceOptions(rows.map((row) => row.text));
    if ('refused' in checked) {
      setProblems(checked.refused);
      return;
    }
    setSaving(true);
    try {
      // The default is sent as its row's text, tidied the way the list is (the server matches it case-blind).
      const chosen = rows.find((row) => row.id === defaultId)?.text.trim() || null;
      await client.saveReferenceOptions(scope, checked.options, chosen);
      setError(null);
      setProblems([]);
      setSaved(true);
      await settings.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the reference options.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Order references" className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        The references a cashier can pick when giving an order a reference or holding it: “Table 1”, “Take-out”,
        “Pickup”. Anything else can still be typed. With none, the till shows a plain text box. The default, if you set
        one, is the reference every new order starts with.
      </p>
      {rows.length === 0 ? <Empty>No reference options yet.</Empty> : null}
      <ol className="flex flex-col gap-1.5">
        {rows.map((row, index) => (
          <li key={row.id} className="flex items-center gap-1.5 text-sm">
            <label htmlFor={`reference-${row.id}`} className="sr-only">
              Option {index + 1}
            </label>
            <input
              id={`reference-${row.id}`}
              className={cn(INPUT_CLASS, 'min-w-0 flex-1')}
              value={row.text}
              maxLength={POS_LABEL_MAX}
              onChange={(event) => rename(row.id, event.target.value)}
            />
            <button
              type="button"
              aria-pressed={row.id === defaultId}
              title="The reference a new order starts with"
              className={buttonClass(row.id === defaultId ? 'primary' : 'ghost', 'sm')}
              onClick={() => {
                setDefaultId(row.id === defaultId ? null : row.id);
                setProblems([]);
                setSaved(false);
              }}
            >
              {row.id === defaultId ? 'Default' : 'Set default'}
            </button>
            <button
              type="button"
              aria-label={`Move ${row.text || `option ${index + 1}`} up`}
              disabled={index === 0}
              className={buttonClass('ghost', 'sm')}
              onClick={() => move(index, -1)}
            >
              <ArrowUp aria-hidden="true" className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move ${row.text || `option ${index + 1}`} down`}
              disabled={index === rows.length - 1}
              className={buttonClass('ghost', 'sm')}
              onClick={() => move(index, 1)}
            >
              <ArrowDown aria-hidden="true" className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Remove ${row.text || `option ${index + 1}`}`}
              className={buttonClass('ghost', 'sm')}
              onClick={() => change(rows.filter((other) => other.id !== row.id))}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-1.5">
        <label htmlFor="reference-new" className="sr-only">
          New reference option
        </label>
        <input
          id="reference-new"
          className={cn(INPUT_CLASS, 'min-w-0 flex-1')}
          placeholder="Table 1, Take-out, Pickup…"
          value={adding}
          maxLength={POS_LABEL_MAX}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <button
          type="button"
          disabled={adding.trim() === '' || rows.length >= POS_REFERENCE_OPTIONS_MAX}
          className={buttonClass('secondary', 'sm')}
          onClick={add}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Up to {POS_REFERENCE_OPTIONS_MAX} options, each up to {POS_LABEL_MAX} characters. Every till in the store offers
        them, in this order.
      </p>

      {problems.length > 0 ? (
        <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">These options cannot be saved:</p>
          <ul className="list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Alert message={error} onDismiss={() => setError(null)} />
      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved. Open tills pick up the new options on their own.
        </p>
      ) : null}
      <div className="flex justify-end">
        <button type="button" disabled={saving} className={buttonClass('primary')} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save reference options'}
        </button>
      </div>
    </section>
  );
}
