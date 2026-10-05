import {
  STUDIO_KEY_ACTIONS,
  type StudioKeyAction,
  type StudioKeymap,
  studioActionOf,
  studioKeyLabel,
} from '../../domain/keymap.js';

/**
 * What a key DOES, right now, on the Print screen and in the layout editor —
 * and what the bar at the bottom shows.
 *
 * The keymap (`domain/keymap.ts`) says which key is bound to which action;
 * this says what each action needs before it can act. A key only acts when it
 * has something to act on: Delete with no photo selected is not a shortcut,
 * and is not shown.
 *
 * ⚠ THE BAR IS DRAWN FROM THE SAME FUNCTIONS THE KEYS ASK, so it can never
 * advertise a key that does something else, or one that does nothing now.
 */

/** One entry on the bar: the key as a person reads it, what it does, and the press that does it when clicked. */
export interface StudioShortcut {
  /** As shown: "Del", "+", "← ↑ → ↓". */
  keys: string;
  label: string;
  /** The key name a click on the entry stands for. Absent for an entry that only explains (the arrows). */
  press?: string;
}

/** What each action is called on the bar — shorter than its name in settings, because the bar is one line. */
const BAR_LABELS: Record<StudioKeyAction, string> = {
  emptyCells: 'Empty',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  turnPhoto: 'Turn',
  resetPhoto: 'Reset',
  selectSamePhoto: 'Select same photo',
  selectAll: 'Select every photo',
  arrangeSame: 'Same photo',
  arrangeEach: 'One each',
  arrangePerPage: 'Per page',
  nextPage: 'Next page',
  previousPage: 'Previous page',
  download: 'Download',
  print: 'Print',
  removeCell: 'Remove',
  copyCell: 'Copy',
  turnCell: 'Turn',
  viewZoomIn: 'Zoom in',
  viewZoomOut: 'Zoom out',
  viewFit: 'Fit',
};

// ── the Print screen ─────────────────────────────────────────────────────────

/** How far an arrow moves a photo inside its cell, as a share of the cell: a nudge, or a push with Shift. */
const PHOTO_NUDGE = 0.02;
const PHOTO_PUSH = 0.1;
/** How much the zoom keys zoom a photo. */
const PHOTO_ZOOM_STEP = 0.1;

export type PrintKeyAction =
  | { kind: 'empty' }
  | { kind: 'zoom'; by: number }
  | { kind: 'turn' }
  | { kind: 'reset' }
  /** As shares of the cell: positive `dx` moves the photo right. */
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'select'; what: 'photo' | 'all' | 'none' }
  | { kind: 'arrange'; mode: 'same' | 'sequence' | 'per_page' }
  | { kind: 'page'; by: 1 | -1 }
  | { kind: 'output'; how: 'download' | 'print' };

/** What is on the Print screen right now — all a key needs to know whether it has anything to do. */
export interface PrintKeyContext {
  /** Selected cells. */
  selected: number;
  /** Selected cells that hold a photo. */
  filledSelected: number;
  /** Cells holding a photo, on every page. */
  filled: number;
  /** Photos in the tray. */
  photos: number;
  pages: number;
  /** The page being shown, from 0. */
  pageIndex: number;
}

/** What a bound action does on the Print screen now, or null when it has nothing to act on. */
function printAction(action: StudioKeyAction, context: PrintKeyContext): PrintKeyAction | null {
  const framing = context.filledSelected > 0;
  switch (action) {
    case 'emptyCells':
      return framing ? { kind: 'empty' } : null;
    case 'zoomIn':
      return framing ? { kind: 'zoom', by: PHOTO_ZOOM_STEP } : null;
    case 'zoomOut':
      return framing ? { kind: 'zoom', by: -PHOTO_ZOOM_STEP } : null;
    case 'turnPhoto':
      return framing ? { kind: 'turn' } : null;
    case 'resetPhoto':
      return framing ? { kind: 'reset' } : null;
    case 'selectSamePhoto':
      return framing ? { kind: 'select', what: 'photo' } : null;
    case 'selectAll':
      return context.filled > 0 ? { kind: 'select', what: 'all' } : null;
    case 'arrangeSame':
      return context.photos > 0 ? { kind: 'arrange', mode: 'same' } : null;
    case 'arrangeEach':
      return context.photos > 0 ? { kind: 'arrange', mode: 'sequence' } : null;
    case 'arrangePerPage':
      return context.photos > 0 ? { kind: 'arrange', mode: 'per_page' } : null;
    case 'nextPage':
      return context.pageIndex < context.pages - 1 ? { kind: 'page', by: 1 } : null;
    case 'previousPage':
      return context.pageIndex > 0 ? { kind: 'page', by: -1 } : null;
    case 'download':
      return context.filled > 0 ? { kind: 'output', how: 'download' } : null;
    case 'print':
      return context.filled > 0 ? { kind: 'output', how: 'print' } : null;
    // The editor's actions mean nothing on this screen.
    case 'removeCell':
    case 'copyCell':
    case 'turnCell':
    case 'viewZoomIn':
    case 'viewZoomOut':
    case 'viewFit':
      return null;
  }
}

/** What a key does on the Print screen right now, or null when it has nothing to act on. */
export function printKeyAction(
  key: string | null,
  context: PrintKeyContext,
  keymap: StudioKeymap,
): PrintKeyAction | null {
  if (key === null) return null;
  // The fixed keys first: they are not in the keymap, so no rebinding can take them away.
  if (key === 'Escape') return context.selected > 0 ? { kind: 'select', what: 'none' } : null;
  const move = arrowMove(key, PHOTO_NUDGE, PHOTO_PUSH);
  if (move) return context.filledSelected > 0 ? move : null;
  const action = studioActionOf(key, 'print', keymap);
  return action ? printAction(action, context) : null;
}

/** The order the Print screen's actions take on the bar: what acts on the selection first. */
const PRINT_BAR_ORDER: readonly StudioKeyAction[] = [
  'emptyCells',
  'zoomIn',
  'zoomOut',
  'turnPhoto',
  'resetPhoto',
  'selectSamePhoto',
  'selectAll',
  'arrangeSame',
  'arrangeEach',
  'arrangePerPage',
  'nextPage',
  'previousPage',
  'download',
  'print',
];

/** The bar on the Print screen: the keys that do something RIGHT NOW, the most useful first. */
export function printShortcutBar(context: PrintKeyContext, keymap: StudioKeymap): StudioShortcut[] {
  const bar: StudioShortcut[] = [];
  for (const action of PRINT_BAR_ORDER) {
    if (printAction(action, context) === null) continue;
    bar.push({ keys: studioKeyLabel(keymap[action]), label: BAR_LABELS[action], press: keymap[action] });
    // The arrows are four keys with one meaning: one entry, after the framing keys, that only explains.
    if (action === 'resetPhoto') bar.push({ keys: '← ↑ → ↓', label: 'Move photo' });
  }
  if (context.selected > 0) bar.push({ keys: 'Esc', label: 'Deselect', press: 'Escape' });
  return bar;
}

// ── the layout editor ────────────────────────────────────────────────────────

export type EditorKeyAction =
  /** In whole steps: the editor decides how long a step is (1 mm, or 5 with Shift). */
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'remove' }
  | { kind: 'copy' }
  | { kind: 'turn' }
  | { kind: 'deselect' }
  | { kind: 'view'; zoom: 'in' | 'out' | 'fit' };

function editorAction(action: StudioKeyAction, selected: boolean): EditorKeyAction | null {
  switch (action) {
    case 'viewZoomIn':
      return { kind: 'view', zoom: 'in' };
    case 'viewZoomOut':
      return { kind: 'view', zoom: 'out' };
    case 'viewFit':
      return { kind: 'view', zoom: 'fit' };
    case 'removeCell':
      return selected ? { kind: 'remove' } : null;
    case 'copyCell':
      return selected ? { kind: 'copy' } : null;
    case 'turnCell':
      return selected ? { kind: 'turn' } : null;
    default:
      // The Print screen's actions mean nothing here.
      return null;
  }
}

/** What a key does in the layout editor right now. `selected`: whether a cell is. */
export function editorKeyAction(key: string | null, selected: boolean, keymap: StudioKeymap): EditorKeyAction | null {
  if (key === null) return null;
  if (key === 'Escape') return selected ? { kind: 'deselect' } : null;
  // One step, or five with Shift: the editor turns steps into millimetres.
  const move = arrowMove(key, 1, 5);
  if (move) return selected ? move : null;
  const action = studioActionOf(key, 'editor', keymap);
  return action ? editorAction(action, selected) : null;
}

const EDITOR_CELL_ORDER: readonly StudioKeyAction[] = ['removeCell', 'copyCell', 'turnCell'];
const EDITOR_VIEW_ORDER: readonly StudioKeyAction[] = ['viewZoomIn', 'viewZoomOut', 'viewFit'];

/** The bar in the layout editor. */
export function editorShortcutBar(selected: boolean, keymap: StudioKeymap): StudioShortcut[] {
  const entry = (action: StudioKeyAction): StudioShortcut => ({
    keys: studioKeyLabel(keymap[action]),
    label: BAR_LABELS[action],
    press: keymap[action],
  });
  const view = EDITOR_VIEW_ORDER.map(entry);
  if (!selected) return view;
  return [
    { keys: '← ↑ → ↓', label: 'Move 1 mm' },
    { keys: 'Shift ← →', label: 'Move 5 mm' },
    ...EDITOR_CELL_ORDER.map(entry),
    { keys: 'Esc', label: 'Deselect', press: 'Escape' },
    ...view,
  ];
}

/** An arrow key as a move: `small` a step, `large` with Shift. Null for any other key. */
function arrowMove(key: string, small: number, large: number): { kind: 'move'; dx: number; dy: number } | null {
  const far = key.startsWith('Shift+');
  const step = far ? large : small;
  switch (far ? key.slice('Shift+'.length) : key) {
    case 'ArrowLeft':
      return { kind: 'move', dx: -step, dy: 0 };
    case 'ArrowRight':
      return { kind: 'move', dx: step, dy: 0 };
    case 'ArrowUp':
      return { kind: 'move', dx: 0, dy: -step };
    case 'ArrowDown':
      return { kind: 'move', dx: 0, dy: step };
    default:
      return null;
  }
}

/**
 * Whether a press should be left alone because somebody is typing or choosing
 * in a field: a "D" in the copies box is a letter, and an arrow on a slider
 * moves the slider. Escape is the exception — it means "let go" everywhere.
 */
export function isTypingTarget(tagName: string, key: string | null): boolean {
  if (key === 'Escape') return false;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

/** The settings screen's groups: each screen's actions, in the order its bar shows them. */
export const KEYMAP_GROUPS: readonly { zone: string; title: string; actions: readonly StudioKeyAction[] }[] = [
  { zone: 'print', title: 'Printing photos', actions: PRINT_BAR_ORDER },
  { zone: 'editor', title: 'Making a layout', actions: [...EDITOR_CELL_ORDER, ...EDITOR_VIEW_ORDER] },
];

/** An action's full name, as the settings screen lists it. */
export function actionLabel(action: StudioKeyAction): string {
  return STUDIO_KEY_ACTIONS[action].label;
}
