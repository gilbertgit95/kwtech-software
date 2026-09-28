'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TASK_COLUMNS_MAX } from '../../domain/boards.js';
import type { TaskBoardView, TaskColumnView } from '../task-client.js';
import type { TasksState } from '../use-tasks.js';
import { buttonClass, Field, INPUT_CLASS, Modal } from './controls.js';

/**
 * The owner's board settings: its name, private or shared, its columns, and
 * archiving or deleting it. Every change is its own small save, so two tabs
 * never overwrite each other's whole column list.
 */
export function BoardSettings({
  state,
  board,
  taskCounts,
  open,
  onClose,
}: {
  state: TasksState;
  board: TaskBoardView;
  /** Tasks per column id, live and archived as shown, for the remove dialog. */
  taskCounts: ReadonlyMap<string, number>;
  open: boolean;
  onClose: () => void;
}) {
  const { client, scope } = state;
  const [name, setName] = useState(board.name);
  const [newColumn, setNewColumn] = useState('');
  const [confirm, setConfirm] = useState<'private' | 'delete' | null>(null);
  const [removing, setRemoving] = useState<TaskColumnView | null>(null);
  useEffect(() => setName(board.name), [board.name]);

  const archived = board.archivedAt !== null;
  const act = (action: () => Promise<unknown>) => void state.run(action);

  return (
    <Modal open={open} title="Board settings" wide onClose={onClose}>
      {/*
       * Each change here is its own write, so closing loses nothing — except a
       * board name typed but not yet renamed, which is why it is named.
       */}
      <p className="-mt-2 text-xs text-muted-foreground">
        Changes save as you make them. A new board name saves when you press Rename.
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && name !== board.name) act(() => client.renameBoard(scope, board.id, name));
        }}
      >
        <div className="flex-1">
          <Field label="Name">
            {(id) => (
              <input
                id={id}
                className={INPUT_CLASS}
                value={name}
                maxLength={80}
                disabled={archived}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        </div>
        <button
          type="submit"
          className={buttonClass('secondary')}
          disabled={archived || state.busy || name === board.name}
        >
          Rename
        </button>
      </form>

      <fieldset className="flex flex-col gap-1.5" disabled={archived}>
        <legend className="mb-1 text-sm font-medium">Who can open it</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="settings-visibility"
            checked={board.visibility === 'workspace'}
            onChange={() => act(() => client.setBoardVisibility(scope, board.id, 'workspace'))}
          />
          Everyone in this workspace
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="settings-visibility"
            checked={board.visibility === 'private'}
            onChange={() => {
              if ((board.assignmentsOfOthers ?? 0) > 0) setConfirm('private');
              else act(() => client.setBoardVisibility(scope, board.id, 'private'));
            }}
          />
          Only me
        </label>
      </fieldset>

      <section className="flex flex-col gap-2" aria-labelledby="board-columns-heading">
        <h3 id="board-columns-heading" className="text-sm font-medium">
          Columns
        </h3>
        <ol className="flex flex-col gap-1.5">
          {board.columns.map((column, index) => (
            <ColumnRow
              key={column.id}
              column={column}
              first={index === 0}
              last={index === board.columns.length - 1}
              disabled={archived || state.busy}
              onRename={(next) => act(() => client.updateColumn(scope, board.id, column.id, { name: next }))}
              onDone={(done) => act(() => client.updateColumn(scope, board.id, column.id, { done }))}
              onMove={(step) => {
                // "After the column before the one above", or the start: the server places by neighbour.
                const target =
                  step === -1 ? (board.columns[index - 2]?.id ?? null) : (board.columns[index + 1]?.id ?? null);
                act(() => client.moveColumn(scope, board.id, column.id, target));
              }}
              onRemove={() => setRemoving(column)}
            />
          ))}
        </ol>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newColumn.trim()) return;
            act(async () => {
              await client.addColumn(scope, board.id, newColumn, false);
              setNewColumn('');
            });
          }}
        >
          <input
            aria-label="New column name"
            placeholder="New column"
            className={INPUT_CLASS}
            value={newColumn}
            maxLength={40}
            disabled={archived || board.columns.length >= TASK_COLUMNS_MAX}
            onChange={(event) => setNewColumn(event.target.value)}
          />
          <button
            type="submit"
            className={buttonClass('secondary')}
            disabled={archived || state.busy || !newColumn.trim()}
          >
            <Plus aria-hidden="true" className="size-4" />
            Add
          </button>
        </form>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        {archived ? (
          <>
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={() => act(() => client.restoreBoard(scope, board.id))}
            >
              Restore board
            </button>
            <button type="button" className={buttonClass('danger')} onClick={() => setConfirm('delete')}>
              Delete forever
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Archiving hides the board and keeps everything on it.</p>
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={() => act(() => client.archiveBoard(scope, board.id))}
            >
              Archive board
            </button>
          </>
        )}
      </section>

      <ConfirmDialog
        open={confirm === 'private'}
        title="Make this board private?"
        description={`Only you will be able to open it. ${board.assignmentsOfOthers ?? 0} assignment(s) of other people will be removed. Their comments stay.`}
        confirmLabel="Make private"
        pending={state.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          act(() => client.setBoardVisibility(scope, board.id, 'private'));
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this board forever?"
        description="The board, its columns, and every task, checklist and comment on it are deleted. This cannot be undone."
        confirmLabel="Delete forever"
        pending={state.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void state
            .run(() => client.deleteBoardForever(scope, board.id))
            .then((ok) => {
              if (ok) {
                state.select({ kind: 'none' });
                onClose();
              }
            });
        }}
      />
      {removing ? (
        <RemoveColumn
          board={board}
          column={removing}
          taskCount={taskCounts.get(removing.id) ?? 0}
          busy={state.busy}
          onCancel={() => setRemoving(null)}
          onRemove={(destination) => {
            setRemoving(null);
            act(() => client.removeColumn(scope, board.id, removing.id, destination));
          }}
        />
      ) : null}
    </Modal>
  );
}

function ColumnRow({
  column,
  first,
  last,
  disabled,
  onRename,
  onDone,
  onMove,
  onRemove,
}: {
  column: TaskColumnView;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onRename: (name: string) => void;
  onDone: (done: boolean) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(column.name);
  useEffect(() => setName(column.name), [column.name]);
  const commit = () => {
    if (name.trim() && name !== column.name) onRename(name);
    else setName(column.name);
  };
  return (
    <li className="flex items-center gap-1.5">
      <input
        aria-label={`Name of the ${column.name} column`}
        className={INPUT_CLASS}
        value={name}
        maxLength={40}
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setName(column.name);
        }}
      />
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={column.done}
          disabled={disabled}
          onChange={(event) => onDone(event.target.checked)}
        />
        Done
      </label>
      <button
        type="button"
        aria-label={`Move ${column.name} earlier`}
        className={buttonClass('ghost', 'sm')}
        disabled={disabled || first}
        onClick={() => onMove(-1)}
      >
        <ArrowUp aria-hidden="true" className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={`Move ${column.name} later`}
        className={buttonClass('ghost', 'sm')}
        disabled={disabled || last}
        onClick={() => onMove(1)}
      >
        <ArrowDown aria-hidden="true" className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={`Remove the ${column.name} column`}
        className={buttonClass('ghost', 'sm')}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </button>
    </li>
  );
}

/** Removing a column: where its tasks go, asked only when it has any (decision 7). */
export function RemoveColumn({
  board,
  column,
  taskCount,
  busy,
  onCancel,
  onRemove,
}: {
  board: TaskBoardView;
  column: TaskColumnView;
  taskCount: number;
  busy: boolean;
  onCancel: () => void;
  onRemove: (destination: string | null) => void;
}) {
  const others = board.columns.filter((other) => other.id !== column.id);
  const [destination, setDestination] = useState(others[0]?.id ?? '');
  return (
    <Modal open title={`Remove the ${column.name} column?`} onClose={onCancel}>
      {taskCount > 0 ? (
        <Field label={`Move its ${taskCount} task(s) to`}>
          {(id) => (
            <select
              id={id}
              className={INPUT_CLASS}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            >
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">It has no tasks.</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass('secondary')} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={buttonClass('danger')}
          disabled={busy}
          onClick={() => onRemove(taskCount > 0 ? destination : null)}
        >
          Remove column
        </button>
      </div>
    </Modal>
  );
}
