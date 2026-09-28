'use client';

import { useHoldsFeature, useRealtime } from '@kwtech/module-kit/react';
import { useDebouncedValue } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TASK_FEATURE } from '../feature-keys.js';
import { TASK_OPERATIONS } from '../operations.js';
import {
  createTaskClient,
  type NewBoardInput,
  type TaskBoardSummaryView,
  type TaskBoardTasksView,
  type TaskCardView,
  type TaskClient,
  type TaskCommentView,
  type TaskEventView,
  type TaskPersonView,
  type TaskScopeView,
  type TaskView,
} from './task-client.js';
import { type ColumnLane, lanesOf } from './view/board.js';

/** How long after the last event the app reads again — several events in a burst are one read. */
const REREAD_DEBOUNCE_MS = 200;

/** How long the search box settles before it asks. */
const SEARCH_DEBOUNCE_MS = 250;

/** What the main area shows: one board, or everything assigned to the viewer. */
export type TaskSelection = { kind: 'board'; boardId: string } | { kind: 'mine' } | { kind: 'none' };

export type TaskViewMode = 'board' | 'list';

export interface TaskFilterState {
  search: string;
  label: string | null;
  priority: string | null;
  assignedToMe: boolean;
  /** The board's archive instead of its live tasks. */
  archived: boolean;
}

export interface TasksState {
  scope: TaskScopeView;
  client: TaskClient;
  /** Boards the viewer can open; the archive when `showArchivedBoards`. */
  boards: TaskBoardSummaryView[] | null;
  showArchivedBoards: boolean;
  setShowArchivedBoards: (show: boolean) => void;
  selection: TaskSelection;
  select: (selection: TaskSelection) => void;
  /** The open board, its columns and tasks. Null while loading, or when none is open. */
  board: TaskBoardTasksView | null;
  lanes: ColumnLane[];
  myTasks: TaskCardView[] | null;
  view: TaskViewMode;
  setView: (view: TaskViewMode) => void;
  filter: TaskFilterState;
  setFilter: (patch: Partial<TaskFilterState>) => void;
  /** The task open in the panel, its comments, and who may be assigned on its board. */
  openTask: TaskView | null;
  comments: TaskCommentView[] | null;
  assignable: TaskPersonView[] | null;
  openTaskId: string | null;
  open: (taskId: string | null) => void;
  /** Read the open task again (after a conflict). Events read it again on their own. */
  reloadTask: () => Promise<void>;
  canWrite: boolean;
  canCreateBoards: boolean;
  canAssign: boolean;
  canManageAll: boolean;
  live: boolean;
  error: string | null;
  dismissError: () => void;
  busy: boolean;
  /** Runs one act, then reads everything it may have changed. One at a time. */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  createBoard: (input: NewBoardInput) => Promise<boolean>;
  /** A drag or keyboard move: the lanes as dropped, and where the server should put the card. */
  moveCard: (cardId: string, lanes: ColumnLane[], columnId: string, afterId: string | null) => Promise<void>;
}

/**
 * The tasks app's one data hook: everything the screen shows, and every act.
 *
 * Re-reads after every act rather than patching what it holds (frontend
 * rules), with ONE exception — a dropped card stays where it was dropped while
 * the server answers (`moveCard`).
 */
export function useTasks(
  organizationId: string,
  workspaceId: string,
  options: { client?: TaskClient } = {},
): TasksState {
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const client = useMemo(() => options.client ?? createTaskClient(), [options.client]);
  const realtime = useRealtime();
  const canWrite = useHoldsFeature(TASK_FEATURE.write);
  const canCreateBoards = useHoldsFeature(TASK_FEATURE.createBoards);
  const canAssign = useHoldsFeature(TASK_FEATURE.assign);
  const canManageAll = useHoldsFeature(TASK_FEATURE.manageAll);

  const [boards, setBoards] = useState<TaskBoardSummaryView[] | null>(null);
  const [showArchivedBoards, setShowArchivedBoards] = useState(false);
  const [selection, setSelection] = useState<TaskSelection>({ kind: 'none' });
  const [board, setBoard] = useState<TaskBoardTasksView | null>(null);
  const [lanes, setLanes] = useState<ColumnLane[]>([]);
  const [myTasks, setMyTasks] = useState<TaskCardView[] | null>(null);
  const [view, setViewState] = useState<TaskViewMode>('board');
  const [filter, setFilterState] = useState<TaskFilterState>({
    search: '',
    label: null,
    priority: null,
    assignedToMe: false,
    archived: false,
  });
  const settledSearch = useDebouncedValue(filter.search, SEARCH_DEBOUNCE_MS);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<TaskView | null>(null);
  const [comments, setComments] = useState<TaskCommentView[] | null>(null);
  const [assignable, setAssignable] = useState<TaskPersonView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsLoaded = useRef(false);

  const boardId = selection.kind === 'board' ? selection.boardId : null;
  const apiFilter = useMemo(
    () => ({
      search: settledSearch || null,
      label: filter.label,
      priority: filter.priority,
      assignedToMe: filter.assignedToMe || null,
      archived: filter.archived || null,
    }),
    [settledSearch, filter.label, filter.priority, filter.assignedToMe, filter.archived],
  );

  const fail = useCallback((caught: unknown, fallback: string) => {
    setError(caught instanceof Error ? caught.message : fallback);
  }, []);

  // ── reading ───────────────────────────────────────────────────────────────

  const loadBoards = useCallback(async () => {
    try {
      setBoards(await client.boards(scope, showArchivedBoards));
    } catch (caught) {
      fail(caught, 'Could not load your boards.');
    }
  }, [client, scope, showArchivedBoards, fail]);

  /*
   * My tasks is read whatever is on screen: the header's chip counts what is
   * overdue, today and soon from it (`taskAttention`), and the chip is always there.
   */
  const loadMyTasks = useCallback(async () => {
    try {
      setMyTasks(await client.myTasks(scope));
    } catch (caught) {
      fail(caught, 'Could not gather your tasks.');
    }
  }, [client, scope, fail]);

  const loadMain = useCallback(async () => {
    try {
      if (!boardId) return;
      const read = await client.board(scope, boardId, apiFilter);
      setBoard(read);
      setLanes(read ? lanesOf(read.board.columns, read.tasks) : []);
      if (!read) {
        // Deleted, made private, or never ours: say so rather than showing an empty board.
        setSelection({ kind: 'none' });
        setError('That board is no longer shared with you.');
      }
    } catch (caught) {
      fail(caught, 'Could not load this board.');
    }
  }, [client, scope, boardId, apiFilter, fail]);

  const loadTask = useCallback(
    async (taskId: string) => {
      try {
        const [task, thread] = await Promise.all([client.task(scope, taskId), client.comments(scope, taskId)]);
        setOpenTask(task);
        setComments(thread);
        if (!task) setOpenTaskId(null);
        if (task && canAssign) setAssignable(await client.assignable(scope, task.boardId));
      } catch (caught) {
        fail(caught, 'Could not open that task.');
      }
    },
    [client, scope, canAssign, fail],
  );

  const reloadTask = useCallback(async () => {
    if (openTaskId) await loadTask(openTaskId);
  }, [openTaskId, loadTask]);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    void loadMyTasks();
  }, [loadMyTasks]);

  // The last board and view this person had, once; then the first board they can open.
  useEffect(() => {
    let cancelled = false;
    client
      .settings(scope)
      .then((settings) => {
        if (cancelled) return;
        settingsLoaded.current = true;
        setViewState(settings.view === 'list' ? 'list' : 'board');
        if (settings.lastBoardId) setSelection({ kind: 'board', boardId: settings.lastBoardId });
      })
      // Settings are a convenience: without them the defaults show.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, scope]);

  useEffect(() => {
    if (selection.kind !== 'none' || !boards || showArchivedBoards) return;
    const first = boards[0];
    if (first) setSelection({ kind: 'board', boardId: first.id });
  }, [selection.kind, boards, showArchivedBoards]);

  useEffect(() => {
    let cancelled = false;
    setBoard((current) => (current && current.board.id === boardId ? current : null));
    void (async () => {
      if (!cancelled) await loadMain();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMain, boardId]);

  useEffect(() => {
    if (!openTaskId) {
      setOpenTask(null);
      setComments(null);
      return;
    }
    void loadTask(openTaskId);
  }, [openTaskId, loadTask]);

  // ── live ──────────────────────────────────────────────────────────────────

  const scheduleReload = useCallback(
    (event: TaskEventView) => {
      if (event.kind === 'removed' && event.boardId === boardId) {
        setSelection({ kind: 'none' });
        setOpenTaskId(null);
        setError('That board was deleted, or it is no longer shared with you.');
      }
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        void loadBoards();
        void loadMain();
        void loadMyTasks();
        /*
         * The open task too, whoever changed it. The panel never loses typing
         * to this: it keeps its draft, and says so when the version moved under
         * it (`TaskPanel`).
         */
        if (openTaskId) void loadTask(openTaskId);
      }, REREAD_DEBOUNCE_MS);
    },
    [boardId, openTaskId, loadBoards, loadMain, loadMyTasks, loadTask],
  );

  useEffect(() => {
    if (!realtime) return;
    const unsubscribe = realtime.subscribe<{ taskEvents: TaskEventView }>(
      TASK_OPERATIONS.taskEvents,
      (data) => scheduleReload(data.taskEvents),
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    );
    return () => {
      unsubscribe();
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [realtime, scope, scheduleReload]);

  // ── acts ──────────────────────────────────────────────────────────────────

  /**
   * ⚠ ONE AT A TIME: a double click on Archive is two requests, and the second
   * answers "already archived". Reads everything an act may have changed.
   */
  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      try {
        await action();
        return true;
      } catch (caught) {
        fail(caught, 'That did not work. Try again.');
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
        await Promise.all([
          loadBoards(),
          loadMain(),
          loadMyTasks(),
          openTaskId ? loadTask(openTaskId) : Promise.resolve(),
        ]);
      }
    },
    [fail, loadBoards, loadMain, loadMyTasks, loadTask, openTaskId],
  );

  const select = useCallback(
    (next: TaskSelection) => {
      setSelection(next);
      setOpenTaskId(null);
      setFilterState((current) => ({ ...current, label: null, archived: false }));
      if (next.kind === 'board' && settingsLoaded.current) {
        void client.setSettings(scope, { view, lastBoardId: next.boardId }).catch(() => undefined);
      }
    },
    [client, scope, view],
  );

  const setView = useCallback(
    (next: TaskViewMode) => {
      setViewState(next);
      void client.setSettings(scope, { view: next, lastBoardId: boardId }).catch(() => undefined);
    },
    [client, scope, boardId],
  );

  const createBoard = useCallback(
    async (input: NewBoardInput) => {
      let created: string | null = null;
      const ok = await run(async () => {
        created = (await client.createBoard(scope, input)).id;
      });
      if (ok && created) select({ kind: 'board', boardId: created });
      return ok;
    },
    [client, scope, run, select],
  );

  const moveCard = useCallback(
    async (cardId: string, dropped: ColumnLane[], columnId: string, afterId: string | null) => {
      /*
       * ⚠ THE ONE PLACE THE BOARD CHANGES BEFORE THE SERVER ANSWERS. Every other
       * act re-reads and shows the result; a dropped card must stay where it was
       * dropped, or it snaps back for a round trip and then jumps. The re-read
       * after `run` replaces this with the server's order either way.
       */
      setLanes(dropped);
      await run(() => client.moveTask(scope, cardId, { columnId, afterTaskId: afterId }));
    },
    [client, scope, run],
  );

  const setFilter = useCallback((patch: Partial<TaskFilterState>) => {
    setFilterState((current) => ({ ...current, ...patch }));
  }, []);

  return {
    scope,
    client,
    boards,
    showArchivedBoards,
    setShowArchivedBoards,
    selection,
    select,
    board,
    lanes,
    myTasks,
    view,
    setView,
    filter,
    setFilter,
    openTask,
    comments,
    assignable,
    openTaskId,
    open: setOpenTaskId,
    reloadTask,
    canWrite,
    canCreateBoards,
    canAssign,
    canManageAll,
    live: realtime !== null,
    error,
    dismissError: () => setError(null),
    busy,
    run,
    createBoard,
    moveCard,
  };
}
