import type { TaskRefusal } from '../types.js';

/**
 * Labels: text on ONE task, never rows in a shared vocabulary (TASK-PLAN
 * decision 15). The filter lists the distinct labels on the tasks the viewer
 * can see, so a label on a private board never reaches anybody else.
 *
 * The same rules as note tags — copied, not imported: modules do not import
 * each other (principle 10), and the two may yet part ways.
 */

/** How many labels one task may carry. */
export const TASK_LABELS_MAX = 20;

/** In code points, after normalising. */
export const TASK_LABEL_MAX = 32;

const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * One label as it is stored and compared: NFC, a leading `#` dropped, lower
 * case, whitespace runs as one hyphen. Null for one that normalises to nothing.
 */
export function normalizeTaskLabel(raw: string): string | null {
  const label = raw.normalize('NFC').trim().replace(/^#+/u, '').trim().toLowerCase().replace(/\s+/gu, '-');
  return label.length === 0 ? null : label;
}

/** Each normalised, empties and duplicates dropped, order kept. */
export function normalizeTaskLabels(raw: readonly string[]): string[] {
  const labels: string[] = [];
  for (const entry of raw) {
    const label = normalizeTaskLabel(entry);
    if (label !== null && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/**
 * A task's labels as they will be stored, or why they are refused. Anything
 * wrong refuses the whole list, so a save never stores a list different from
 * the one on screen without saying so.
 */
export function prepareTaskLabels(raw: readonly string[]): { labels: readonly string[] } | { refused: TaskRefusal } {
  const labels = normalizeTaskLabels(raw);
  if (labels.length > TASK_LABELS_MAX) return { refused: 'invalid_labels' };
  if (labels.some((label) => CONTROL_OR_INVISIBLE.test(label) || [...label].length > TASK_LABEL_MAX)) {
    return { refused: 'invalid_labels' };
  }
  return { labels };
}
