'use client';

import { useHoldsFeature, useRealtime } from '@kwtech/module-kit/react';
import { useDebouncedValue } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_NOTE_SETTINGS, type NoteSettings } from '../domain/appearance.js';
import { NOTE_FEATURE } from '../feature-keys.js';
import { NOTE_OPERATIONS } from '../operations.js';
import {
  createNoteClient,
  type NoteClient,
  type NoteListView,
  type NoteScopeView,
  type NoteSummaryView,
  type NoteTab,
} from './note-client.js';
import { type NoteEditorState, useNoteEditor } from './use-note-editor.js';
import { type NoteEventView, planNoteEvent } from './view/editing.js';

/** Several events in a burst — a save and the index change it implies — become one re-read. */
const REREAD_DEBOUNCE_MS = 200;

/** Typing in the search box settles for this long before it is sent. */
const SEARCH_DEBOUNCE_MS = 300;

export interface NotesState {
  scope: NoteScopeView;
  client: NoteClient;
  canWrite: boolean;
  canManageAll: boolean;

  tab: NoteTab;
  setTab: (tab: NoteTab) => void;
  search: string;
  setSearch: (search: string) => void;
  tag: string | null;
  setTag: (tag: string | null) => void;

  /** Null until the first read. */
  list: NoteListView | null;
  /** Pinned first, then the rest — the order the index shows. */
  ordered: readonly NoteSummaryView[];
  /** Load the next page; resolves the notes it added (none at the end, or on failure). */
  loadMore: () => Promise<readonly NoteSummaryView[]>;

  settings: NoteSettings;
  saveSettings: (settings: NoteSettings) => Promise<void>;

  editor: NoteEditorState;

  error: string | null;
  busy: boolean;
  live: boolean;
  dismissError: () => void;

  createNote: () => Promise<void>;
  setShared: (shared: boolean) => Promise<void>;
  trash: () => Promise<void>;
  restore: () => Promise<void>;
  deleteForever: () => Promise<void>;
  setPinned: (noteId: string, pinned: boolean) => Promise<void>;
  /**
   * A drop in one section of the list: `ids` is the section as dropped, and the
   * note now follows `afterId` (null: the top).
   */
  moveNote: (
    section: 'pinned' | 'notes',
    noteId: string,
    ids: readonly string[],
    afterId: string | null,
  ) => Promise<void>;
  restoreRevision: (revisionId: string) => Promise<void>;
}

/**
 * Everything the notes app shows: the index, the open note, the viewer's
 * appearance settings, and the socket that keeps them current.
 *
 * ⚠ AN EVENT IS "SOMETHING CHANGED", answered by re-reading through the guarded
 * query — the index always, the open note by `planNoteEvent`. The screen never
 * applies an event's facts to its own copy.
 */
export function useNotes(
  organizationId: string,
  workspaceId: string,
  options: { client?: NoteClient } = {},
): NotesState {
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const client = useMemo(() => options.client ?? createNoteClient(), [options.client]);
  const realtime = useRealtime();
  const canWrite = useHoldsFeature(NOTE_FEATURE.write);
  const canManageAll = useHoldsFeature(NOTE_FEATURE.manageAll);

  const [tab, setTab] = useState<NoteTab>('all');
  const [search, setSearch] = useState('');
  const settledSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [tag, setTag] = useState<string | null>(null);
  const [list, setList] = useState<NoteListView | null>(null);
  const [settings, setSettings] = useState<NoteSettings>(DEFAULT_NOTE_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filter = useMemo(() => ({ view: tab, search: settledSearch || null, tag }), [tab, settledSearch, tag]);

  const reloadIndex = useCallback(async () => {
    try {
      setList(await client.list(scope, filter));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your notes.');
    }
  }, [client, scope, filter]);

  const scheduleReload = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      void reloadIndex();
    }, REREAD_DEBOUNCE_MS);
  }, [reloadIndex]);

  const editor = useNoteEditor(scope, client, { canWrite, onChanged: scheduleReload });

  useEffect(() => {
    let cancelled = false;
    client
      .list(scope, filter)
      .then((next) => {
        if (!cancelled) setList(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load your notes.');
      });
    return () => {
      cancelled = true;
    };
  }, [client, scope, filter]);

  useEffect(() => {
    let cancelled = false;
    client
      .settings(scope)
      .then((next) => {
        if (!cancelled) setSettings(next);
      })
      // Settings are cosmetic: without them the defaults show, and the error is not worth a banner.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, scope]);

  // The socket. The editor decides what an event means for the open note.
  const onEvent = editor.onEvent;
  useEffect(() => {
    if (!realtime) return;
    const unsubscribe = realtime.subscribe<{ noteEvents: NoteEventView }>(
      NOTE_OPERATIONS.noteEvents,
      (data) => {
        const event = data.noteEvents;
        if (planNoteEvent(event, { noteId: null, version: 0, dirty: false, saving: false }).index) scheduleReload();
        onEvent(event);
      },
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    );
    return () => {
      unsubscribe();
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [realtime, scope, scheduleReload, onEvent]);

  const loadMore = useCallback(async (): Promise<readonly NoteSummaryView[]> => {
    if (!list?.nextCursor) return [];
    try {
      const next = await client.list(scope, { ...filter, cursor: list.nextCursor });
      setList((current) =>
        current ? { ...current, notes: [...current.notes, ...next.notes], nextCursor: next.nextCursor } : next,
      );
      return next.notes;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load more notes.');
      return [];
    }
  }, [client, scope, filter, list]);

  /**
   * Runs one act, then re-reads the index.
   *
   * ⚠ ONE AT A TIME: a double click on Move to trash is two requests, and the
   * second answers "already in the trash".
   */
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        await action();
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'That did not work.');
      } finally {
        inFlight.current = false;
        setBusy(false);
        await reloadIndex();
      }
    },
    [reloadIndex],
  );

  const openId = editor.note?.id ?? null;

  const createNote = useCallback(
    () =>
      run(async () => {
        if (!(await editor.flush())) return;
        const created = await client.create(scope, {});
        editor.show(created);
        // A new note is live: leave the trash so it can be seen in the index.
        if (tab === 'trash') setTab('all');
      }),
    [run, editor, client, scope, tab],
  );

  const act = useCallback(
    (fn: (noteId: string) => Promise<unknown>) =>
      run(async () => {
        if (!openId) return;
        // Save first: an act moves the version, and the next autosave would otherwise
        // conflict with it. ⚠ If the save failed, stop — showing the fresh note
        // would replace the text that failed to save.
        if (!(await editor.flush())) return;
        await fn(openId);
        const fresh = await client.get(scope, openId);
        if (fresh) editor.show(fresh);
        else await editor.open(null);
      }),
    [run, openId, editor, client, scope],
  );

  const saveSettings = useCallback(
    async (next: NoteSettings) => {
      try {
        setSettings(await client.setSettings(scope, next));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not save your appearance settings.');
      }
    },
    [client, scope],
  );

  const ordered = useMemo(() => (list ? [...list.pinned, ...list.notes] : []), [list]);

  return {
    scope,
    client,
    canWrite,
    canManageAll,
    tab,
    setTab,
    search,
    setSearch,
    tag,
    setTag,
    list,
    ordered,
    loadMore,
    settings,
    saveSettings,
    editor,
    error,
    busy,
    live: realtime !== null,
    dismissError: () => setError(null),
    createNote,
    setShared: (shared) => act((noteId) => client.setVisibility(scope, noteId, shared ? 'workspace' : 'private')),
    trash: () => act((noteId) => client.trash(scope, noteId)),
    restore: () => act((noteId) => client.restore(scope, noteId)),
    deleteForever: () =>
      run(async () => {
        if (!openId) return;
        await client.deleteForever(scope, openId);
        await editor.open(null);
      }),
    setPinned: (noteId, pinned) =>
      run(async () => {
        await client.setPinned(scope, noteId, pinned);
        if (noteId === openId) {
          const fresh = await client.get(scope, noteId);
          if (fresh) editor.show(fresh);
        }
      }),
    moveNote: async (section, noteId, ids, afterId) => {
      /*
       * ⚠ THE ONE PLACE THE LIST CHANGES BEFORE THE SERVER ANSWERS. Every other
       * act re-reads and shows the result; a dragged note must stay where it
       * was dropped, or it snaps back for a round trip and then jumps. The
       * re-read after `run` replaces this with the server's order either way.
       */
      setList((current) => {
        if (!current) return current;
        const byId = new Map([...current.pinned, ...current.notes].map((note) => [note.id, note]));
        const reordered = ids.flatMap((id) => {
          const note = byId.get(id);
          return note ? [note] : [];
        });
        return section === 'pinned' ? { ...current, pinned: reordered } : { ...current, notes: reordered };
      });
      await run(() => client.move(scope, noteId, afterId));
    },
    restoreRevision: (revisionId) =>
      act(async (noteId) => {
        const current = editor.note;
        if (current) await client.restoreRevision(scope, noteId, revisionId, current.version);
      }),
  };
}
