'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { Archive, ArrowDown, ArrowUp, Lock, Plus, RotateCcw, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TASK_COLUMNS_MAX } from '../../domain/boards.js';
import type { TaskBoardView, TaskColumnView } from '../task-client.js';
import type { TasksState } from '../use-tasks.js';
import { buttonClass, Checkbox, type Choice, ChoiceCards, Field, INPUT_CLASS, Modal } from './controls.js';
import { Select } from './select.js';

/** Who can open a board, each with what it means. Shared with the new-board form, so the two never word it differently. */
export const BOARD_VISIBILITY_CHOICES: readonly Choice<'workspace' | 'private'>[] = [
  {
    value: 'workspace',
    label: 'Everyone in this workspace',
    description: 'Anyone who uses tasks here can see and work on it.',
    icon: Users,
  },
  {
    value: 'private',
    label: 'Only me',
    description: 'A private board. Nobody else can see it, admins included.',
    icon: Lock,
  },
];

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
    <Modal
      open={open}
      title="Board settings"
      // Each change here is its own write, so closing loses nothing — except a
      // board name typed but not yet renamed, which is why it is named.
      description="Changes save as you make them. A new board name saves when you press Rename."
      wide
      onClose={onClose}
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && name !== board.name) act(() => client.renameBoard(scope, board.id, name));
        }}
      >
        <div className="min-w-0 flex-1">
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

      <ChoiceCards
        legend="Who can open it"
        value={board.visibility === 'private' ? 'private' : 'workspace'}
        options={BOARD_VISIBILITY_CHOICES}
        disabled={archived}
        onChange={(visibility) => {
          if (visibility === board.visibility) return;
          // Other people's assignments go with it, so that is asked first.
          if (visibility === 'private' && (board.assignmentsOfOthers ?? 0) > 0) setConfirm('private');
          else act(() => client.setBoardVisibility(scope, board.id, visibility));
        }}
      />

      <section className="flex flex-col gap-2" aria-labelledby="board-columns-heading">
        <h3 id="board-columns-heading" className="text-sm font-medium">
          Columns
        </h3>
        <p className="-mt-1 text-xs text-muted-foreground">A task in a Done column counts as finished.</p>
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

      <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3">
        {archived ? (
          <>
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={() => act(() => client.restoreBoard(scope, board.id))}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Restore board
            </button>
            <button type="button" className={buttonClass('danger')} onClick={() => setConfirm('delete')}>
              <Trash2 aria-hidden="true" className="size-4" />
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
              <Archive aria-hidden="true" className="size-4" />
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

/** A column's name inside its row: the row is the box, so the input draws none until it is in use. */
export const ROW_INPUT_CLASS =
  'h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm transition-colors placeholder:text-muted-foreground hover:border-border focus-visible:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

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
    <li className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
      <input
        aria-label={`Name of the ${column.name} column`}
        className={ROW_INPUT_CLASS}
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
      <Checkbox
        className="px-1.5"
        checked={column.done}
        disabled={disabled}
        onChange={(event) => onDone(event.target.checked)}
      >
        Done
      </Checkbox>
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
    <Modal
      open
      title={`Remove the ${column.name} column?`}
      onClose={onCancel}
      footer={
        <>
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
        </>
      }
    >
      {taskCount > 0 ? (
        <Field label={`Move its ${taskCount} task(s) to`}>
          {(id) => (
            <Select
              id={id}
              value={destination}
              options={others.map((other) => ({ value: other.id, label: other.name }))}
              onChange={setDestination}
            />
          )}
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">It has no tasks.</p>
      )}
    </Modal>
  );
}
