'use client';

import { cn } from '@kwtech/web-ui/react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import {
  columnNameKey,
  prepareBoardName,
  prepareColumnName,
  TASK_COLUMNS_MAX,
  TASK_DEFAULT_COLUMNS,
} from '../../domain/boards.js';
import type { NewBoardInput } from '../task-client.js';
import { BOARD_VISIBILITY_CHOICES, ROW_INPUT_CLASS } from './board-settings.js';
import { buttonClass, Checkbox, ChoiceCards, Field, INPUT_CLASS, Modal } from './controls.js';

interface DraftColumn {
  /** Local only, for React keys: a column has no id before the board is saved. */
  key: string;
  name: string;
  done: boolean;
}

const startColumns = (): DraftColumn[] =>
  TASK_DEFAULT_COLUMNS.map((column) => ({ key: crypto.randomUUID(), name: column.name, done: column.done }));

/**
 * A new board: its name, private or shared, and ITS OWN COLUMNS (TASK-PLAN
 * decision 6) — To do · Doing · Done filled in to start from, every one
 * renamable and removable, or *Start blank* for one empty column.
 *
 * Validated with the same domain rules the server runs, so a refusal is shown
 * beside the field before anything is sent.
 */
export function BoardForm({
  open,
  busy,
  onCancel,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: NewBoardInput) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'workspace' | 'private'>('workspace');
  const [columns, setColumns] = useState<DraftColumn[]>(startColumns);
  const [errors, setErrors] = useState<{ name?: string; columns?: string }>({});

  const reset = () => {
    setName('');
    setVisibility('workspace');
    setColumns(startColumns());
    setErrors({});
  };

  const update = (key: string, patch: Partial<DraftColumn>) =>
    setColumns((current) => current.map((column) => (column.key === key ? { ...column, ...patch } : column)));
  const shift = (key: string, step: -1 | 1) =>
    setColumns((current) => {
      const at = current.findIndex((column) => column.key === key);
      const to = at + step;
      const moving = current[at];
      if (!moving || to < 0 || to >= current.length) return current;
      const next = current.filter((column) => column.key !== key);
      next.splice(to, 0, moving);
      return next;
    });

  const submit = async () => {
    const next: { name?: string; columns?: string } = {};
    if ('refused' in prepareBoardName(name)) next.name = 'Give the board a name, up to 80 characters.';
    if (columns.length === 0) next.columns = 'A board needs at least one column.';
    else if (columns.some((column) => 'refused' in prepareColumnName(column.name))) {
      next.columns = 'Every column needs a name, up to 40 characters.';
    } else if (new Set(columns.map((column) => columnNameKey(column.name))).size !== columns.length) {
      next.columns = 'Two columns have the same name.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const created = await onCreate({
      name,
      visibility,
      columns: columns.map((column) => ({ name: column.name, done: column.done })),
    });
    if (created) reset();
  };

  const cancel = () => {
    reset();
    onCancel();
  };

  return (
    <Modal
      open={open}
      title="New board"
      description="Name it, choose who can open it, and set up its columns."
      wide
      onClose={cancel}
      footer={
        <>
          <button type="button" className={buttonClass('secondary')} onClick={cancel}>
            Cancel
          </button>
          <button type="button" className={buttonClass('primary')} disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create board'}
          </button>
        </>
      }
    >
      <Field label="Name" error={errors.name ?? null}>
        {(id, describedBy) => (
          <input
            id={id}
            className={INPUT_CLASS}
            // Where a new board starts: the dialog opens with the caret here (`Modal`).
            data-autofocus=""
            placeholder="For example, Shop opening"
            value={name}
            maxLength={80}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>

      <ChoiceCards
        legend="Who can open it"
        value={visibility}
        options={BOARD_VISIBILITY_CHOICES}
        onChange={setVisibility}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
          Columns
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            onClick={() => setColumns([{ key: crypto.randomUUID(), name: 'To do', done: false }])}
          >
            Start blank
          </button>
        </legend>
        <ol className="flex flex-col gap-1.5">
          {columns.map((column, index) => (
            <li key={column.key} className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
              <input
                aria-label={`Column ${index + 1} name`}
                placeholder="Column name"
                className={ROW_INPUT_CLASS}
                value={column.name}
                maxLength={40}
                onChange={(event) => update(column.key, { name: event.target.value })}
              />
              <Checkbox
                className="px-1.5"
                checked={column.done}
                onChange={(event) => update(column.key, { done: event.target.checked })}
              >
                Done
              </Checkbox>
              <button
                type="button"
                aria-label={`Move ${column.name || 'column'} up`}
                className={buttonClass('ghost', 'sm')}
                disabled={index === 0}
                onClick={() => shift(column.key, -1)}
              >
                <ArrowUp aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${column.name || 'column'} down`}
                className={buttonClass('ghost', 'sm')}
                disabled={index === columns.length - 1}
                onClick={() => shift(column.key, 1)}
              >
                <ArrowDown aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${column.name || 'column'}`}
                className={buttonClass('ghost', 'sm')}
                disabled={columns.length === 1}
                onClick={() => setColumns((current) => current.filter((other) => other.key !== column.key))}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ol>
        {errors.columns ? (
          <p role="alert" className="text-xs text-destructive">
            {errors.columns}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            A task in a Done column counts as finished. You can change all of this later.
          </p>
        )}
        <button
          type="button"
          className={cn(buttonClass('ghost', 'sm'), 'self-start border border-dashed border-border')}
          disabled={columns.length >= TASK_COLUMNS_MAX}
          onClick={() => setColumns((current) => [...current, { key: crypto.randomUUID(), name: '', done: false }])}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add column
        </button>
      </fieldset>
    </Modal>
  );
}
