'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareNoteBody, prepareNoteTitle } from '../domain/notes.js';
import { prepareNoteTags } from '../domain/tags.js';
import type { NoteClient, NoteScopeView, NoteView } from './note-client.js';
import {
  autosaveDelay,
  copyTitle,
  editPatch,
  type NoteDraft,
  type NoteEventView,
  planNoteEvent,
  saveFailure,
} from './view/editing.js';

/**
 * Something the person must decide about, shown above the page.
 *
 *   conflict — somebody else saved while this person had unsaved text. Offers
 *              keep-mine-as-a-copy, use theirs, or overwrite theirs.
 *   gone     — the note was deleted or unshared. Offers keep-mine-as-a-copy
 *              when there is unsaved text; otherwise it only says so.
 *   invalid  — the text breaks a rule the server would refuse (too long, an
 *              invisible character). Nothing is sent until it is fixed.
 *   error    — anything else, in the API's own words.
 */
export type EditorProblem =
  | { kind: 'conflict'; theirs: NoteView }
  | { kind: 'gone' }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

export type SaveStatus = 'saved' | 'unsaved' | 'saving';

export interface NoteEditorState {
  note: NoteView | null;
  draft: NoteDraft | null;
  status: SaveStatus;
  problem: EditorProblem | null;
  /** Open a note, saving the one on screen first. Null closes. */
  open: (noteId: string | null) => Promise<void>;
  /** Show a note the caller already has (a note just created, or just changed by an act). */
  show: (note: NoteView) => void;
  edit: (patch: Partial<NoteDraft>) => void;
  /**
   * Save now, if anything is unsaved. Called on blur, before switching, and when
   * the page hides. Resolves whether the screen is now fully saved — ⚠ an act
   * that would replace the screen (share, bin, switch) must stop on `false`, or
   * it throws away the text a failed save left behind.
   */
  flush: (options?: { keepalive?: boolean }) => Promise<boolean>;
  /** Hand a live event to the editor; see `planNoteEvent`. */
  onEvent: (event: NoteEventView) => void;
  keepMineAsCopy: () => Promise<void>;
  takeTheirs: () => void;
  overwriteTheirs: () => Promise<void>;
  dismissProblem: () => void;
}

function draftOf(note: NoteView): NoteDraft {
  return { title: note.title, body: note.body, tags: note.tags, color: note.color };
}

/** The first rule the draft breaks, in the server's own words, or null. */
function draftRefusal(draft: NoteDraft): string | null {
  if ('refused' in prepareNoteTitle(draft.title)) return 'The title is too long, or has invisible formatting in it.';
  if ('refused' in prepareNoteBody(draft.body)) return 'This note is too long to save.';
  if ('refused' in prepareNoteTags(draft.tags)) return 'A note can have at most 10 tags of at most 32 characters.';
  return null;
}

/**
 * The note on screen and its autosave (NOTE-PLAN §6, and the review's
 * data-loss holes in §9).
 *
 * ⚠ ONE SAVE IN FLIGHT. A second save started before the first returns would
 * be based on the same version and conflict with our own save. An edit during
 * a save is saved after it, from the version it returned.
 *
 * ⚠ THE SCREEN'S TEXT IS NEVER REPLACED WHILE IT HAS UNSAVED CHANGES — not by
 * a save coming back (it only moves the version), and not by somebody else's
 * change (that becomes a `conflict` the person decides).
 */
export function useNoteEditor(
  scope: NoteScopeView,
  client: NoteClient,
  options: { onChanged?: () => void; canWrite: boolean },
): NoteEditorState {
  const [note, setNote] = useState<NoteView | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<EditorProblem | null>(null);

  // Refs for what timers and event handlers read: they must see the latest,
  // not the values captured when they were scheduled.
  const noteRef = useRef<NoteView | null>(null);
  const draftRef = useRef<NoteDraft | null>(null);
  const savingRef = useRef(false);
  const againRef = useRef(false);
  const lastEditAt = useRef(0);
  const firstUnsavedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  /** The latest `save`, for timers and the unmount — never one captured renders ago. */
  const saveRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => undefined);
  const onChanged = options.onChanged;

  const setBoth = useCallback((next: NoteView | null, nextDraft: NoteDraft | null) => {
    noteRef.current = next;
    draftRef.current = nextDraft;
    setNote(next);
    setDraft(nextDraft);
  }, []);

  const unsaved = useCallback(() => {
    const current = noteRef.current;
    const text = draftRef.current;
    return current !== null && text !== null ? editPatch(draftOf(current), text) : null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /**
   * Arm the autosave for the current edit times. Reads only refs — and calls
   * the LATEST `save` through `saveRef` — so it is stable across renders.
   */
  const schedule = useCallback(() => {
    clearTimer();
    const now = Date.now();
    firstUnsavedAt.current ??= now;
    const delay = autosaveDelay(now, lastEditAt.current, firstUnsavedAt.current);
    timer.current = setTimeout(() => void saveRef.current(), delay);
  }, [clearTimer]);

  const save = useCallback(
    async (keepalive = false): Promise<void> => {
      clearTimer();
      if (!options.canWrite) return;
      if (savingRef.current) {
        againRef.current = true;
        return;
      }
      const current = noteRef.current;
      const text = draftRef.current;
      const patch = unsaved();
      if (!current || !text || !patch || current.trashedAt) {
        firstUnsavedAt.current = null;
        return;
      }
      const refusal = draftRefusal(text);
      if (refusal) {
        if (mounted.current) setProblem({ kind: 'invalid', message: refusal });
        return;
      }

      savingRef.current = true;
      if (mounted.current) setSaving(true);
      // Anything typed from here on is newer than this save.
      firstUnsavedAt.current = null;
      try {
        const saved = await client.update(scope, current.id, current.version, patch, { keepalive });
        noteRef.current = saved;
        if (!mounted.current) return;
        // ⚠ Only the server copy moves. The draft is what the person typed,
        // including anything typed while this save was on its way.
        setNote(saved);
        setProblem((existing) => (existing?.kind === 'invalid' || existing?.kind === 'error' ? null : existing));
        onChanged?.();
      } catch (caught) {
        if (!mounted.current) return;
        const failure = saveFailure(caught);
        if (failure === 'conflict') {
          const theirs = await client.get(scope, current.id).catch(() => null);
          setProblem(theirs ? { kind: 'conflict', theirs } : { kind: 'gone' });
        } else if (failure === 'gone') {
          setProblem({ kind: 'gone' });
        } else {
          setProblem({ kind: 'error', message: caught instanceof Error ? caught.message : 'Could not save the note.' });
        }
        againRef.current = false;
      } finally {
        savingRef.current = false;
        if (mounted.current) setSaving(false);
      }

      if (againRef.current) {
        againRef.current = false;
        await save(keepalive);
        return;
      }
      // Typing continued during the save: keep to the autosave rhythm.
      if (unsaved()) schedule();
    },
    [client, scope, options.canWrite, onChanged, unsaved, clearTimer, schedule],
  );
  saveRef.current = save;

  const flush = useCallback(
    async (flushOptions: { keepalive?: boolean } = {}) => {
      if (unsaved() || savingRef.current) await save(flushOptions.keepalive ?? false);
      return unsaved() === null;
    },
    [save, unsaved],
  );

  const open = useCallback(
    async (noteId: string | null) => {
      // ⚠ Unsaved text that could not be saved stays on screen, with its problem shown.
      if (!(await flush())) return;
      setProblem(null);
      if (!noteId) {
        setBoth(null, null);
        return;
      }
      try {
        const next = await client.get(scope, noteId);
        if (!mounted.current) return;
        if (!next) {
          setBoth(null, null);
          setProblem({ kind: 'error', message: 'That note is no longer here.' });
          return;
        }
        setBoth(next, draftOf(next));
      } catch (caught) {
        setProblem({ kind: 'error', message: caught instanceof Error ? caught.message : 'Could not open the note.' });
      }
    },
    [client, scope, flush, setBoth],
  );

  const show = useCallback((next: NoteView) => setBoth(next, draftOf(next)), [setBoth]);

  const edit = useCallback(
    (patch: Partial<NoteDraft>) => {
      const text = draftRef.current;
      if (!text || !options.canWrite) return;
      const next = { ...text, ...patch };
      draftRef.current = next;
      setDraft(next);
      lastEditAt.current = Date.now();
      setProblem((existing) => (existing?.kind === 'invalid' ? null : existing));
      schedule();
    },
    [options.canWrite, schedule],
  );

  /** Read the open note again and decide what that means for the screen. */
  const recheck = useCallback(
    async (mode: 'reload' | 'check' | 'stale') => {
      const current = noteRef.current;
      if (!current) return;
      const fresh = await client.get(scope, current.id).catch(() => undefined);
      if (!mounted.current || fresh === undefined) return;
      if (fresh === null) {
        setProblem({ kind: 'gone' });
        return;
      }
      if (fresh.version <= current.version && mode === 'check') return;
      if (unsaved()) {
        setProblem({ kind: 'conflict', theirs: fresh });
        return;
      }
      setBoth(fresh, draftOf(fresh));
    },
    [client, scope, unsaved, setBoth],
  );

  const onEvent = useCallback(
    (event: NoteEventView) => {
      const current = noteRef.current;
      const plan = planNoteEvent(event, {
        noteId: current?.id ?? null,
        version: current?.version ?? 0,
        dirty: unsaved() !== null,
        saving: savingRef.current,
      });
      switch (plan.open) {
        case 'none':
          return;
        case 'gone':
          setProblem({ kind: 'gone' });
          return;
        case 'reload':
        case 'check':
        case 'stale':
          void recheck(plan.open);
          return;
      }
    },
    [recheck, unsaved],
  );

  /** The rescue for a conflict or a vanished note: what is on screen becomes a new PRIVATE note. */
  const keepMineAsCopy = useCallback(async () => {
    const text = draftRef.current;
    if (!text) return;
    try {
      const copy = await client.create(scope, {
        title: copyTitle(text.title),
        body: text.body,
        tags: text.tags,
        color: text.color,
        visibility: 'private',
      });
      setProblem(null);
      setBoth(copy, draftOf(copy));
      onChanged?.();
    } catch (caught) {
      setProblem({ kind: 'error', message: caught instanceof Error ? caught.message : 'Could not save a copy.' });
    }
  }, [client, scope, setBoth, onChanged]);

  const takeTheirs = useCallback(() => {
    if (problem?.kind === 'conflict') setBoth(problem.theirs, draftOf(problem.theirs));
    else if (problem?.kind === 'gone') setBoth(null, null);
    setProblem(null);
  }, [problem, setBoth]);

  /** Keep what is on screen, saved over their version — the one choice that discards somebody's work. */
  const overwriteTheirs = useCallback(async () => {
    if (problem?.kind !== 'conflict') return;
    noteRef.current = problem.theirs;
    setNote(problem.theirs);
    setProblem(null);
    await save();
  }, [problem, save]);

  const dismissProblem = useCallback(() => setProblem(null), []);

  // Unmount (the app closed on the Apps page, or the cell moved): save what is
  // left. Runs once — through the ref, so it saves with the latest `save`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs only, on purpose.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      if (unsaved()) void saveRef.current(true);
    };
  }, []);

  // The tab hides or closes: save now, and warn before losing a pending save.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush({ keepalive: true });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsaved() && !savingRef.current) return;
      void flush({ keepalive: true });
      event.preventDefault();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flush, unsaved]);

  const status: SaveStatus = saving ? 'saving' : note && draft && editPatch(draftOf(note), draft) ? 'unsaved' : 'saved';

  return {
    note,
    draft,
    status,
    problem,
    open,
    show,
    edit,
    flush,
    onEvent,
    keepMineAsCopy,
    takeTheirs,
    overwriteTheirs,
    dismissProblem,
  };
}
