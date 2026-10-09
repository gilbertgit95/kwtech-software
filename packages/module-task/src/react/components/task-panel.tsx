'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import { Archive, ArrowDown, ArrowUp, Check, ListChecks, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { isScheduledAfterDue } from '../../domain/dates.js';
import { TASK_CONFLICT_MESSAGE, TASK_PRIORITIES } from '../../domain/tasks.js';
import type { TaskCommentView, TaskView } from '../task-client.js';
import type { TasksState } from '../use-tasks.js';
import { PRIORITY_LABELS } from '../view/board.js';
import { draftChanges, onStoredTask, parseLabels, type TaskDraft } from '../view/editing.js';
import {
  Avatar,
  buttonClass,
  Checkbox,
  Field,
  INPUT_CLASS,
  Initials,
  PRIORITY_ICONS,
  TEXTAREA_CLASS,
} from './controls.js';
import { DatePicker } from './date-picker.js';
import { Select } from './select.js';

/** How long typing pauses before the text saves itself. */
const AUTOSAVE_IDLE_MS = 2000;

/**
 * One task, open beside the board (or over it when narrow).
 *
 * Whether the title and description are saved shows in the panel's header,
 * beside *Close*, so it is on screen however far down the panel is scrolled.
 *
 * The title and description save themselves — after a pause, and at once on
 * blur and when the panel closes — ONE SAVE AT A TIME, each from the version
 * the last one returned. A save based on an older version is refused by the
 * server; the panel then offers to reload theirs or overwrite with mine. It
 * never replaces what somebody is typing (`onStoredTask`).
 *
 * Everything else — column, dates, priority, labels, assignees, checklist — is
 * its own small write (TASK-PLAN decision 17), so it never conflicts.
 */
export function TaskPanel({ state, onClose }: { state: TasksState; onClose: () => void }) {
  const task = state.openTask;
  if (!task) {
    return (
      <aside aria-label="Task" className="flex h-full flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">Opening the task…</p>
      </aside>
    );
  }
  return <OpenTask key={task.id} state={state} task={task} onClose={onClose} />;
}

function OpenTask({ state, task, onClose }: { state: TasksState; task: TaskView; onClose: () => void }) {
  const { client, scope } = state;
  const editable = state.canWrite && task.archivedAt === null;
  const act = (action: () => Promise<unknown>) => void state.run(action);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleId = useId();
  const [status, setStatus] = useState<SaveStatus>('saved');

  return (
    <aside aria-labelledby={titleId} className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {task.boardName}
          {task.archivedAt ? ' · Archived' : ''}
        </p>
        {editable ? <SaveState status={status} busy={state.busy} /> : null}
        <button type="button" aria-label="Close task" className={buttonClass('secondary', 'sm')} onClick={onClose}>
          <X aria-hidden="true" className="size-3.5" />
          Close
        </button>
      </header>

      {/* `relative`: clips its `sr-only` labels too — see the board's scroller. */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <TextEditor
          state={state}
          task={task}
          editable={editable}
          titleId={titleId}
          status={status}
          setStatus={setStatus}
        />

        <DetailsSection state={state} task={task} editable={editable} />

        <Checklist state={state} task={task} editable={editable} />

        <Comments state={state} task={task} />

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            Created by {task.creatorName ?? 'a former member'} · last changed by{' '}
            {task.updatedByName ?? 'a former member'}
          </span>
          {state.canWrite ? (
            task.archivedAt ? (
              <span className="flex gap-2">
                <button
                  type="button"
                  className={buttonClass('secondary', 'sm')}
                  onClick={() => act(() => client.restoreTask(scope, task.id))}
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                  Restore
                </button>
                <button type="button" className={buttonClass('danger', 'sm')} onClick={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Delete forever
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => act(() => client.archiveTask(scope, task.id))}
              >
                <Archive aria-hidden="true" className="size-3.5" />
                Archive
              </button>
            )
          ) : null}
        </footer>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this task forever?"
        description="The task, its checklist and its comments are deleted. This cannot be undone."
        confirmLabel="Delete forever"
        pending={state.busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void state
            .run(() => client.deleteTaskForever(scope, task.id))
            .then((ok) => {
              if (ok) onClose();
            });
        }}
      />
    </aside>
  );
}

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'changed';

/**
 * Saved or not, in words. `busy` covers the small writes (column, dates,
 * assignees…), which save at once. A conflict says nothing here: the warning in
 * the panel says it, with the way out.
 */
function SaveState({ status, busy }: { status: SaveStatus; busy: boolean }) {
  const text =
    status === 'saving' || busy
      ? 'Saving…'
      : status === 'unsaved'
        ? 'Not saved yet'
        : status === 'saved'
          ? 'Saved'
          : 'Not saved';
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-xs',
        status === 'conflict' || status === 'changed' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {text === 'Saved' ? <Check aria-hidden="true" className="size-3.5 text-status-success" /> : null}
      {text}
    </p>
  );
}

/** The title and description, saving themselves. */
function TextEditor({
  state,
  task,
  editable,
  titleId,
  status,
  setStatus,
}: {
  state: TasksState;
  task: TaskView;
  editable: boolean;
  titleId: string;
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
}) {
  const { client, scope } = state;
  const [draft, setDraft] = useState<TaskDraft>({ title: task.title, description: task.description });
  const [problem, setProblem] = useState<string | null>(null);
  const version = useRef(task.version);
  const stored = useRef<TaskDraft>({ title: task.title, description: task.description });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descriptionId = useId();

  // The stored task arrived again: adopt it, keep the draft, or warn (`onStoredTask`).
  useEffect(() => {
    const dirty = draftChanges(stored.current, draftRef.current) !== null;
    const decision = onStoredTask(dirty, version.current, task.version);
    stored.current = { title: task.title, description: task.description };
    if (decision === 'adopt') {
      version.current = task.version;
      setDraft({ title: task.title, description: task.description });
      setStatus('saved');
    }
    if (decision === 'warn') setStatus('changed');
  }, [task.version, task.title, task.description, setStatus]);

  const save = useCallback(
    async (overwrite = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const changes = draftChanges(stored.current, draftRef.current);
      if (!changes || saving.current || !editable) return;
      saving.current = true;
      setStatus('saving');
      try {
        const base = overwrite ? (state.openTask?.version ?? version.current) : version.current;
        const saved = await client.updateTask(scope, task.id, base, changes);
        version.current = saved.version;
        stored.current = { title: saved.title, description: saved.description };
        setStatus(draftChanges(stored.current, draftRef.current) ? 'unsaved' : 'saved');
        setProblem(null);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Could not save the task.';
        if (message === TASK_CONFLICT_MESSAGE) {
          setStatus('conflict');
          // Their version, so "Keep mine" overwrites what is there now — and only that.
          void state.reloadTask();
        } else {
          setStatus('unsaved');
          setProblem(message);
        }
      } finally {
        saving.current = false;
      }
    },
    [client, scope, task.id, editable, state.openTask?.version, state.reloadTask, setStatus],
  );

  const edit = (patch: Partial<TaskDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (status !== 'conflict' && status !== 'changed') setStatus('unsaved');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_IDLE_MS);
  };

  // The last second is never lost: save when the panel closes or the page is hidden.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      void save();
    };
  }, [save]);

  return (
    <section className="flex flex-col gap-2">
      <label htmlFor={titleId} className="sr-only">
        Title
      </label>
      <input
        id={titleId}
        className="-mx-2 w-[calc(100%+1rem)] rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold tracking-tight transition-colors hover:border-border focus-visible:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:hover:border-transparent"
        value={draft.title}
        maxLength={200}
        readOnly={!editable}
        onChange={(event) => edit({ title: event.target.value })}
        onBlur={() => void save()}
      />
      <label htmlFor={descriptionId} className="text-sm font-medium">
        Description
      </label>
      <textarea
        id={descriptionId}
        className={cn(TEXTAREA_CLASS, 'min-h-28')}
        value={draft.description}
        placeholder={editable ? 'Add some detail…' : 'No description.'}
        readOnly={!editable}
        onChange={(event) => edit({ description: event.target.value })}
        onBlur={() => void save()}
      />
      {status === 'conflict' || status === 'changed' ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg bg-status-warning p-3 text-sm text-status-warning-foreground"
        >
          <p>
            {status === 'conflict'
              ? 'Somebody else saved this task while you were editing it.'
              : `${state.openTask?.updatedByName ?? 'Somebody'} changed this task while you were typing.`}
          </p>
          <span className="flex gap-2">
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              onClick={() => {
                const current = state.openTask;
                if (!current) return;
                version.current = current.version;
                stored.current = { title: current.title, description: current.description };
                setDraft({ title: current.title, description: current.description });
                setStatus('saved');
              }}
            >
              Use theirs
            </button>
            {editable ? (
              <button type="button" className={buttonClass('primary', 'sm')} onClick={() => void save(true)}>
                Keep mine
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** Column, board, assignees, dates, priority and labels — each its own small write. */
function DetailsSection({ state, task, editable }: { state: TasksState; task: TaskView; editable: boolean }) {
  const { client, scope } = state;
  const act = (action: () => Promise<unknown>) => void state.run(action);
  const columns = state.board && state.board.board.id === task.boardId ? state.board.board.columns : [];
  const [labels, setLabels] = useState(task.labels.join(', '));
  useEffect(() => setLabels(task.labels.join(', ')), [task.labels]);
  const assigneeIds = task.assignees.map((person) => person.userId);
  const candidates = (state.assignable ?? []).filter((person) => !assigneeIds.includes(person.userId));
  const warnDates = isScheduledAfterDue(task);

  const moveTo = async (boardId: string, columnId: string | null) => {
    if (boardId === task.boardId && columnId) {
      await client.moveTask(scope, task.id, { columnId, afterTaskId: lastCardIn(state, columnId, task.id) });
      return;
    }
    const target = await client.board(scope, boardId, {});
    const first = target?.board.columns[0];
    if (!first) throw new Error('That board has no columns to move the task into.');
    await client.moveTask(scope, task.id, { boardId, columnId: first.id, afterTaskId: null });
  };

  return (
    <section
      aria-label="Details"
      className="grid grid-cols-1 gap-x-3 gap-y-4 rounded-xl border border-border bg-muted/30 p-3.5 @md:grid-cols-2"
    >
      {columns.length > 0 ? (
        <Field label="Column">
          {(id) => (
            <Select
              id={id}
              value={task.columnId}
              disabled={!editable}
              options={columns.map((column) => ({
                value: column.id,
                label: column.name,
                ...(column.done ? { icon: <Check className="size-4 text-status-success" /> } : {}),
              }))}
              onChange={(columnId) => act(() => moveTo(task.boardId, columnId))}
            />
          )}
        </Field>
      ) : null}

      <Field label="Board" hint="Moving to a private board keeps only its owner assigned.">
        {(id, describedBy) => (
          <Select
            id={id}
            value={task.boardId}
            aria-describedby={describedBy}
            disabled={!editable}
            options={[
              // The task's own board first when it is not among the listed ones (an archived board), so the trigger still names it.
              ...((state.boards ?? []).some((board) => board.id === task.boardId)
                ? []
                : [{ value: task.boardId, label: task.boardName }]),
              ...(state.boards ?? []).map((board) => ({ value: board.id, label: board.name })),
            ]}
            onChange={(boardId) => act(() => moveTo(boardId, null))}
          />
        )}
      </Field>

      <div className="flex flex-col gap-1.5 @md:col-span-2">
        <span className="text-sm font-medium">Assigned</span>
        <ul className="flex flex-wrap gap-1.5">
          {task.assignees.length === 0 ? <li className="text-sm text-muted-foreground">Nobody yet.</li> : null}
          {task.assignees.map((person) => (
            <li
              key={person.userId}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pr-1 pl-0.5 text-sm shadow-xs"
            >
              <Avatar person={person} />
              {person.displayName ?? 'A former member'}
              {editable ? (
                <button
                  type="button"
                  aria-label={`Unassign ${person.displayName ?? 'this person'}`}
                  className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() =>
                    act(() =>
                      client.setAssignees(
                        scope,
                        task.id,
                        assigneeIds.filter((id) => id !== person.userId),
                      ),
                    )
                  }
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          state.canAssign ? (
            // Never holds a value: choosing a person assigns them at once, and the list is then one shorter.
            <Select
              aria-label={task.assignees.length === 0 ? 'Assign to' : 'Assign another person'}
              className="border-dashed"
              value={null}
              placeholder={task.assignees.length === 0 ? 'Assign to…' : 'Add another…'}
              emptyText="Everyone who can be assigned already is."
              options={candidates.map((person) => ({
                value: person.userId,
                label: person.displayName ?? person.userId,
                icon: <Initials name={person.displayName} />,
              }))}
              onChange={(userId) => act(() => client.setAssignees(scope, task.id, [...assigneeIds, userId]))}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              You can assign yourself. Assigning other people is not part of your role or your organization’s plan.
            </p>
          )
        ) : null}
      </div>

      <Field label="Scheduled" hint="The day someone plans to work on it.">
        {(id, describedBy) => (
          <DatePicker
            id={id}
            aria-describedby={describedBy}
            value={task.scheduledOn}
            disabled={!editable}
            onChange={(day) => act(() => client.setDates(scope, task.id, day, task.dueOn))}
          />
        )}
      </Field>
      <Field label="Due" hint="The deadline." error={warnDates ? 'It is scheduled after it is due.' : null}>
        {(id, describedBy) => (
          <DatePicker
            id={id}
            aria-describedby={describedBy}
            value={task.dueOn}
            disabled={!editable}
            onChange={(day) => act(() => client.setDates(scope, task.id, task.scheduledOn, day))}
          />
        )}
      </Field>

      <Field label="Priority">
        {(id) => (
          <Select
            id={id}
            value={task.priority}
            disabled={!editable}
            options={TASK_PRIORITIES.map((priority) => {
              const Icon = PRIORITY_ICONS[priority];
              return {
                value: priority,
                label: PRIORITY_LABELS[priority] ?? priority,
                icon: <Icon className="size-4" />,
              };
            })}
            onChange={(priority) => act(() => client.setPriority(scope, task.id, priority))}
          />
        )}
      </Field>
      <Field label="Labels" hint="Separate them with commas.">
        {(id, describedBy) => (
          <input
            id={id}
            className={INPUT_CLASS}
            value={labels}
            aria-describedby={describedBy}
            readOnly={!editable}
            onChange={(event) => setLabels(event.target.value)}
            onBlur={() => {
              const next = parseLabels(labels);
              if (next.join(',') !== task.labels.join(',')) act(() => client.setLabels(scope, task.id, next));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        )}
      </Field>
    </section>
  );
}

function Checklist({ state, task, editable }: { state: TasksState; task: TaskView; editable: boolean }) {
  const { client, scope } = state;
  const act = (action: () => Promise<unknown>) => void state.run(action);
  const [text, setText] = useState('');
  const headingId = useId();
  const done = task.checklist.filter((item) => item.done).length;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold">
        <ListChecks aria-hidden="true" className="size-4 text-muted-foreground" />
        Checklist
        {task.checklist.length > 0 ? (
          <span className="rounded-full bg-muted px-2 py-px text-xs font-medium text-muted-foreground">
            {done}/{task.checklist.length}
          </span>
        ) : null}
      </h3>
      {task.checklist.length > 0 ? (
        // Decorative: the heading already says "2/5".
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${(done / task.checklist.length) * 100}%` }}
          />
        </div>
      ) : null}
      <ul className="flex flex-col">
        {task.checklist.map((item, index) => (
          <li
            key={item.id}
            className="group -mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm hover:bg-accent/50"
          >
            <Checkbox
              aria-label={item.text}
              checked={item.done}
              disabled={!editable}
              onChange={(event) =>
                act(() => client.updateChecklistItem(scope, task.id, item.id, { done: event.target.checked }))
              }
            />
            <span className={cn('min-w-0 flex-1 break-words', item.done && 'text-muted-foreground line-through')}>
              {item.text}
            </span>
            {editable ? (
              <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Move ${item.text} up`}
                  className={buttonClass('ghost', 'sm')}
                  disabled={index === 0}
                  onClick={() =>
                    act(() => client.moveChecklistItem(scope, task.id, item.id, task.checklist[index - 2]?.id ?? null))
                  }
                >
                  <ArrowUp aria-hidden="true" className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${item.text} down`}
                  className={buttonClass('ghost', 'sm')}
                  disabled={index === task.checklist.length - 1}
                  onClick={() =>
                    act(() => client.moveChecklistItem(scope, task.id, item.id, task.checklist[index + 1]?.id ?? null))
                  }
                >
                  <ArrowDown aria-hidden="true" className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${item.text}`}
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => act(() => client.removeChecklistItem(scope, task.id, item.id))}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim()) return;
            void state
              .run(() => client.addChecklistItem(scope, task.id, text))
              .then((ok) => {
                if (ok) setText('');
              });
          }}
        >
          <input
            aria-label="New checklist item"
            placeholder="Add an item"
            className={INPUT_CLASS}
            value={text}
            maxLength={200}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className={buttonClass('secondary')} disabled={!text.trim()}>
            Add
          </button>
        </form>
      ) : null}
    </section>
  );
}

function Comments({ state, task }: { state: TasksState; task: TaskView }) {
  const { client, scope } = state;
  const [body, setBody] = useState('');
  const headingId = useId();
  const boxId = useId();
  const canComment = state.canWrite && task.archivedAt === null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare aria-hidden="true" className="size-4 text-muted-foreground" />
        Comments
        {state.comments && state.comments.length > 0 ? (
          <span className="rounded-full bg-muted px-2 py-px text-xs font-medium text-muted-foreground">
            {state.comments.length}
          </span>
        ) : null}
      </h3>
      {state.comments === null ? null : state.comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {state.comments.map((comment) => (
            <CommentRow
              key={comment.id}
              state={state}
              comment={comment}
              boardOwned={state.board?.board.mine ?? false}
            />
          ))}
        </ol>
      )}
      {canComment ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!body.trim()) return;
            void state
              .run(() => client.addComment(scope, task.id, body))
              .then((ok) => {
                if (ok) setBody('');
              });
          }}
        >
          <label htmlFor={boxId} className="sr-only">
            Write a comment
          </label>
          <textarea
            id={boxId}
            className={cn(TEXTAREA_CLASS, 'min-h-20')}
            placeholder="Write a comment…"
            value={body}
            maxLength={4000}
            onChange={(event) => setBody(event.target.value)}
          />
          <button
            type="submit"
            className={cn(buttonClass('primary', 'sm'), 'self-end')}
            disabled={!body.trim() || state.busy}
          >
            Comment
          </button>
        </form>
      ) : null}
    </section>
  );
}

function CommentRow({
  state,
  comment,
  boardOwned,
}: {
  state: TasksState;
  comment: TaskCommentView;
  boardOwned: boolean;
}) {
  const { client, scope } = state;
  // Times print in the workspace's zone, so everyone here reads the same clock.
  const timeZone = useWorkspaceTimeZone();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const canRemove = comment.mine || boardOwned || state.canManageAll;
  return (
    <li className="flex gap-2">
      <Avatar person={{ userId: comment.authorId, displayName: comment.authorName }} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-xs text-muted-foreground">
          <span className="text-sm font-medium text-foreground">{comment.authorName ?? 'A former member'}</span>{' '}
          {new Date(comment.createdAt).toLocaleString(undefined, { timeZone })}
          {comment.editedAt ? ' · edited' : ''}
        </p>
        {editing ? (
          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void state
                .run(() => client.updateComment(scope, comment.id, body))
                .then((ok) => {
                  if (ok) setEditing(false);
                });
            }}
          >
            <textarea
              aria-label="Edit your comment"
              className={cn(TEXTAREA_CLASS, 'min-h-16')}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <span className="flex justify-end gap-1">
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="submit" className={buttonClass('primary', 'sm')} disabled={!body.trim()}>
                Save
              </button>
            </span>
          </form>
        ) : (
          <CommentText body={comment.body} />
        )}
        {!editing ? (
          <span className="flex gap-1">
            {comment.mine ? (
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : null}
            {canRemove ? (
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                onClick={() => void state.run(() => client.removeComment(scope, comment.id))}
              >
                Remove
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}

const URL_PATTERN = /(https?:\/\/[^\s<]+)/gu;

/**
 * A comment as PLAIN TEXT with its links made clickable — nothing else is
 * interpreted, so a comment can never inject markup (decision 18).
 */
function CommentText({ body }: { body: string }) {
  // Each piece keyed by where it starts in the comment: stable, and unique.
  const pieces: { at: number; text: string; link: boolean }[] = [];
  let at = 0;
  for (const [index, text] of body.split(URL_PATTERN).entries()) {
    pieces.push({ at, text, link: index % 2 === 1 });
    at += text.length;
  }
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {pieces.map((piece) =>
        piece.link ? (
          <a
            key={piece.at}
            href={piece.text}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline"
          >
            {piece.text}
          </a>
        ) : (
          <span key={piece.at}>{piece.text}</span>
        ),
      )}
    </p>
  );
}

/** The card a task lands after at the END of a column on the open board, or null for the top. */
function lastCardIn(state: TasksState, columnId: string, movingId: string): string | null {
  const lane = state.lanes.find((candidate) => candidate.column.id === columnId);
  const others = (lane?.cards ?? []).filter((card) => card.id !== movingId);
  return others[others.length - 1]?.id ?? null;
}
