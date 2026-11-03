'use client';

import { cn } from '@kwtech/web-ui/react';
import { Redo2, Undo2 } from 'lucide-react';
import { studioKeyLabel } from '../../domain/keymap.js';
import { undoButtonLabel } from '../view/undo-steps.js';
import { buttonClass } from './controls.js';

/**
 * Undo and Redo, for the floating bar at the foot of the sheet (issue #52). Each
 * says what it would take back or do again ("Undo: zoom"), on hover and to a
 * screen reader, and is disabled when there is nothing.
 *
 * ⚠ THE FOCUS STAYS WHERE IT WAS on a press, as on the shortcut bar: the next
 * key still goes to the sheet, and a press never takes the focus out of a
 * field somebody is typing in.
 */
export function UndoButtons({
  undoLabel,
  redoLabel,
  undoKey,
  redoKey,
  onUndo,
  onRedo,
}: {
  /** What Undo would take back, or null when there is nothing. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** The keys that do the same, from the workspace's keymap: shown in the hint. */
  undoKey: string;
  redoKey: string;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const button = cn(buttonClass('ghost', 'sm'), 'px-2');
  const undo = undoButtonLabel('undo', undoLabel);
  const redo = undoButtonLabel('redo', redoLabel);
  return (
    <>
      <button
        type="button"
        aria-label={undo}
        title={undoLabel === null ? undo : `${undo} (${studioKeyLabel(undoKey)})`}
        className={button}
        disabled={undoLabel === null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onUndo}
      >
        <Undo2 aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        aria-label={redo}
        title={redoLabel === null ? redo : `${redo} (${studioKeyLabel(redoKey)})`}
        className={button}
        disabled={redoLabel === null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRedo}
      >
        <Redo2 aria-hidden="true" className="size-4" />
      </button>
    </>
  );
}
