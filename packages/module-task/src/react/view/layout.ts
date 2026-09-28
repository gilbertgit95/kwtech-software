/**
 * Where the open task's panel goes, in a box of any size.
 *
 * The panel collapses to a thin labelled bar and expands again at every width,
 * as the notes list does (the operator's request, 2026-09-28: in a narrow box
 * the panel used to REPLACE the board, so it was unclear how to get back, or
 * that anything was behind it).
 *
 *   beside  — a column next to the board (a wide box)
 *   overlay — slid out OVER the board from the right, the board still showing
 *             on its left (a narrow box: beside it, both would be too cramped)
 *   hidden  — collapsed to the bar; the task stays open behind it
 *   none    — no task is open, so no panel and no bar
 */
export type TaskPanelLayout = 'beside' | 'overlay' | 'hidden' | 'none';

/**
 * Narrower than this, the panel does not fit beside the board. In rem, so it
 * follows the viewer's text size.
 */
export const TASK_PANEL_BESIDE_REM = 64;

export function taskPanelLayout(input: { taskOpen: boolean; beside: boolean; collapsed: boolean }): TaskPanelLayout {
  if (!input.taskOpen) return 'none';
  if (input.collapsed) return 'hidden';
  return input.beside ? 'beside' : 'overlay';
}
