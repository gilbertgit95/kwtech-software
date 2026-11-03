'use client';

import { useCallback, useState } from 'react';
import { commitUndo, redoLabel, redoStep, type StudioUndo, startUndo, undoLabel, undoStep } from '../domain/undo.js';

/** How a change joins a gesture (`StudioUndoGesture`), without the time: the hook stamps that itself. */
export interface StudioGestureKey {
  key: string;
  /** A drag, which has an end of its own: it joins however long the hand rests. */
  untimed?: boolean;
}

/** One screen's undoable work, and the ways to change it (`domain/undo.ts`). */
export interface StudioUndoable<T> {
  history: StudioUndo<T>;
  present: T;
  /**
   * A change, from the present AS IT IS when it runs. A held key or a drag
   * repeats faster than the screen redraws, and each repeat must start where
   * the last one ended. `gesture` is a string for a timed gesture (a slider, a
   * held key) or a key with `untimed` for a drag.
   */
  change: (label: string, update: (present: T) => T, gesture?: string | StudioGestureKey) => void;
  undo: () => void;
  redo: () => void;
  /** A new present with no history at all (Start over). */
  reset: (present: T) => void;
  /** What Undo would take back, or null when there is nothing. */
  undoLabel: string | null;
  redoLabel: string | null;
}

/**
 * The undo history of one screen, held for as long as the screen is open.
 *
 * ⚠ NOTHING HERE IS SAVED. The history is the component's state and goes with
 * it, when the layout changes or the page reloads. The print studio writes
 * nothing to browser storage (`test/web-module.test.ts`).
 */
export function useUndo<T>(initial: () => T): StudioUndoable<T> {
  const [history, setHistory] = useState(() => startUndo(initial()));

  const change = useCallback((label: string, update: (present: T) => T, gesture?: string | StudioGestureKey) => {
    // The time is taken once, outside the updater, so React running the updater twice cannot give two answers.
    const at = Date.now();
    const joined = typeof gesture === 'string' ? { key: gesture } : gesture;
    setHistory((current) =>
      commitUndo(current, update(current.present), {
        label,
        ...(joined ? { gesture: { ...joined, at } } : {}),
      }),
    );
  }, []);
  const undo = useCallback(() => setHistory(undoStep), []);
  const redo = useCallback(() => setHistory(redoStep), []);
  const reset = useCallback((present: T) => setHistory(startUndo(present)), []);

  return {
    history,
    present: history.present,
    change,
    undo,
    redo,
    reset,
    undoLabel: undoLabel(history),
    redoLabel: redoLabel(history),
  };
}
