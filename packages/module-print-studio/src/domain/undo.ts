/**
 * Undo and redo (issue #52): a history of one screen's work, the Print
 * screen's sheet or the layout editor's layout.
 *
 * Pure and generic. The screen keeps everything that can be undone in ONE
 * snapshot (`present`), so a step restores all of it together. A dozen
 * separate states could each be undone on its own, and they would get out of
 * step with one another.
 *
 *   past     the snapshots BEFORE each change, oldest first. Each is labelled
 *            with the change that left it ("zoom"), which is what Undo says.
 *   present  the sheet as it is now.
 *   future   the snapshots an undo stepped back from, nearest first. Each is
 *            labelled with the change a redo makes again.
 *
 * ## One gesture is one step
 *
 * A drag, a held zoom key or a slider sends a change on every pointer event
 * or repeat. Each event names its GESTURE (`{ key, at }`), and an event of
 * the gesture the last change belonged to replaces the present instead of
 * adding a step. Without this, one drag would take forty undos.
 *
 *   - A timed gesture (a slider, a held key, a run of arrow nudges) joins
 *     while its events come less than `STUDIO_UNDO_GESTURE_MS` apart, so a
 *     slider moved again a minute later is a step of its own.
 *   - An `untimed` gesture has an end of its own (a pointer drag, given a new
 *     key on every press). It joins however long the hand rests mid-drag.
 *
 * Undo, redo and any change without a gesture end the gesture, so the next
 * event always starts a new step.
 */

/** How many steps are kept. Older ones are dropped, so a long session does not keep growing. */
export const STUDIO_UNDO_LIMIT = 100;

/** Milliseconds between two events of a timed gesture (a slider, a held key) that still make them one step. */
export const STUDIO_UNDO_GESTURE_MS = 1000;

/** A snapshot in the history, and the change it is named after. */
export interface StudioUndoStep<T> {
  readonly state: T;
  /** What the change was, in a word or two: "zoom", "move photo". */
  readonly label: string;
}

export interface StudioUndo<T> {
  readonly past: readonly StudioUndoStep<T>[];
  readonly present: T;
  readonly future: readonly StudioUndoStep<T>[];
  /** The gesture the last change belonged to, while it may still be joined; null once it may not. */
  readonly gesture: { readonly key: string; readonly at: number } | null;
}

/** The gesture one event belongs to. */
export interface StudioUndoGesture {
  /** Which gesture: the same key for every event of it, and a different one for anything else. */
  key: string;
  /** When this event happened, in milliseconds (`Date.now()`). Passed in so the rule can be tested. */
  at: number;
  /** A gesture with an end of its own (a drag): it joins whatever the time between events. */
  untimed?: boolean;
}

/** One change to the present. */
export interface StudioUndoChange {
  label: string;
  /** Absent: the change is a step by itself (a click). */
  gesture?: StudioUndoGesture;
  /** How many steps to keep; `STUDIO_UNDO_LIMIT` unless a test says otherwise. */
  limit?: number;
}

/** A history with nothing to undo or redo. */
export function startUndo<T>(present: T): StudioUndo<T> {
  return { past: [], present, future: [], gesture: null };
}

/**
 * The history after a change: `next` is the present, and the redo history is
 * cleared, because what was undone no longer follows from this.
 *
 * ⚠ THE SAME PRESENT IS NO CHANGE. An update that returned its input (a nudge
 * against the edge, a zoom already at its limit) adds no step that would
 * take an Undo to do nothing.
 */
export function commitUndo<T>(history: StudioUndo<T>, next: T, change: StudioUndoChange): StudioUndo<T> {
  if (Object.is(next, history.present)) return history;
  const gesture = change.gesture;
  const last = history.gesture;
  const joins =
    gesture !== undefined &&
    last !== null &&
    last.key === gesture.key &&
    history.past.length > 0 &&
    (gesture.untimed === true || gesture.at - last.at <= STUDIO_UNDO_GESTURE_MS);
  const nextGesture = gesture ? { key: gesture.key, at: gesture.at } : null;
  if (joins) return { past: history.past, present: next, future: [], gesture: nextGesture };
  const limit = Math.max(change.limit ?? STUDIO_UNDO_LIMIT, 1);
  const past = [...history.past, { state: history.present, label: change.label }];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
    gesture: nextGesture,
  };
}

/** The history one step back, or the same history when there is nothing to undo. */
export function undoStep<T>(history: StudioUndo<T>): StudioUndo<T> {
  const last = history.past[history.past.length - 1];
  if (!last) return history;
  return {
    past: history.past.slice(0, -1),
    present: last.state,
    future: [{ state: history.present, label: last.label }, ...history.future],
    gesture: null,
  };
}

/** The history one step forward again, or the same history when there is nothing to redo. */
export function redoStep<T>(history: StudioUndo<T>): StudioUndo<T> {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, { state: history.present, label: next.label }],
    present: next.state,
    future: history.future.slice(1),
    gesture: null,
  };
}

/** What Undo would take back ("zoom"), or null when there is nothing. */
export function undoLabel(history: StudioUndo<unknown>): string | null {
  return history.past[history.past.length - 1]?.label ?? null;
}

/** What Redo would do again, or null when there is nothing. */
export function redoLabel(history: StudioUndo<unknown>): string | null {
  return history.future[0]?.label ?? null;
}

/**
 * Every snapshot the history holds, the present among them. The Print screen
 * releases a decoded photo only once none of these refers to it: a photo
 * removed from the tray can still come back with an Undo.
 */
export function undoStates<T>(history: StudioUndo<T>): T[] {
  return [...history.past.map((step) => step.state), history.present, ...history.future.map((step) => step.state)];
}
