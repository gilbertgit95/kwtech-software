/**
 * Shortcut keys: what each key does on the Print screen and in the layout
 * editor, the defaults every workspace starts with, and the rules a
 * workspace's own keymap must keep (the operator, 2026-10-05).
 *
 * The point of sale's design (`module-basic-pos`, `domain/keymap.ts`), copied
 * structurally — a module never imports another:
 *
 * ⚠ ONE KEYMAP, READ BY BOTH THE KEYS AND THE SHORTCUT BAR. The bar is drawn
 * from the same map the key handler obeys, so the bar can never advertise a
 * key that does something else.
 *
 * Pure, and in the core rather than the web half, because the SERVER checks a
 * keymap before saving it with the same `validateStudioKeymap` the settings
 * screen uses.
 */

/**
 * Where a key applies. Two screens, so the same key may mean one thing on each
 * (`R` turns a photo on Print and a cell in the editor) — they are never on
 * screen together.
 */
export type StudioKeyZone = 'print' | 'editor';

/** Every action a key can be bound to. */
export const STUDIO_KEY_ACTIONS = {
  emptyCells: { zone: 'print', label: 'Empty the selected cells' },
  zoomIn: { zone: 'print', label: 'Zoom the photo in' },
  zoomOut: { zone: 'print', label: 'Zoom the photo out' },
  // ⚠ The stored name stays `turnPhoto` (a workspace's saved key is kept under it); it turns right, clockwise.
  turnPhoto: { zone: 'print', label: 'Turn the photo right' },
  turnPhotoLeft: { zone: 'print', label: 'Turn the photo left' },
  resetPhoto: { zone: 'print', label: 'Reset the photo' },
  selectSamePhoto: { zone: 'print', label: 'Select every cell with this photo' },
  selectAll: { zone: 'print', label: 'Select every photo' },
  arrangeSame: { zone: 'print', label: 'Arrange: same photo in every cell' },
  arrangeEach: { zone: 'print', label: 'Arrange: one photo per cell' },
  arrangePerPage: { zone: 'print', label: 'Arrange: one photo per page' },
  nextPage: { zone: 'print', label: 'Next page' },
  previousPage: { zone: 'print', label: 'Previous page' },
  download: { zone: 'print', label: 'Download the PDF' },
  print: { zone: 'print', label: 'Print' },
  removeCell: { zone: 'editor', label: 'Remove the selected cell' },
  copyCell: { zone: 'editor', label: 'Copy the selected cell' },
  turnCell: { zone: 'editor', label: 'Turn the selected cell' },
  viewZoomIn: { zone: 'editor', label: 'Zoom the view in' },
  viewZoomOut: { zone: 'editor', label: 'Zoom the view out' },
  viewFit: { zone: 'editor', label: 'Fit the sheet to the panel' },
} as const satisfies Record<string, { zone: StudioKeyZone; label: string }>;

export type StudioKeyAction = keyof typeof STUDIO_KEY_ACTIONS;

export const STUDIO_KEY_ACTION_NAMES = Object.keys(STUDIO_KEY_ACTIONS) as StudioKeyAction[];

/** A workspace's keymap: each action's key. */
export type StudioKeymap = Readonly<Record<StudioKeyAction, string>>;

/**
 * The defaults. Every workspace starts here; one with no saved keymap simply
 * uses them.
 *
 * ⚠ FIXED KEYS ARE NOT IN THE MAP: the arrows (move, and further with Shift),
 * `Esc` (let go of the selection), `Enter`, `Space` and `Tab`. Nobody should be
 * able to lose the way to move a photo, or out of a selection, to a rebinding.
 */
export const STUDIO_DEFAULT_KEYMAP: StudioKeymap = {
  emptyCells: 'Delete',
  zoomIn: '+',
  zoomOut: '-',
  turnPhoto: 'R',
  /*
   * Added later (issue #51): Shift with the turn's own letter. A workspace that already gave Shift+R to another
   * Print action keeps it, and Turn left gets the next free key (`effectiveStudioKeymap`).
   */
  turnPhotoLeft: 'Shift+R',
  resetPhoto: '0',
  selectSamePhoto: 'S',
  selectAll: 'Ctrl+A',
  arrangeSame: '1',
  arrangeEach: '2',
  arrangePerPage: '3',
  nextPage: 'PageDown',
  previousPage: 'PageUp',
  download: 'D',
  print: 'P',
  removeCell: 'Delete',
  copyCell: 'D',
  turnCell: 'R',
  viewZoomIn: '+',
  viewZoomOut: '-',
  viewFit: '0',
};

/** Keys that are never rebindable: the fixed ones above. */
const FIXED_KEYS = new Set(['Enter', 'Escape', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Keys the BROWSER must keep: reload, full screen, developer tools, and — with
 * Ctrl — print, save, bookmark, find, close, new tab or window, the address
 * bar. A studio that took `Ctrl+P` would leave no way to the browser's own
 * print dialog, and one that took `F5` no way to reload a stuck page.
 *
 * ⚠ `Ctrl+A` IS ALLOWED, deliberately: outside a text field it selects the
 * whole page, which nobody wants on this screen, and "select all" is what
 * people expect it to do here.
 */
const RESERVED_KEYS = new Set(['F5', 'F11', 'F12', 'Ctrl+F5', 'Shift+F5']);
const RESERVED_CTRL_LETTERS = new Set(['P', 'S', 'D', 'F', 'R', 'W', 'T', 'N', 'L', 'Q', 'H', 'J', 'U', 'O']);

const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;
const NAMED_KEYS = ['Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'] as const;

/**
 * A key as stored: modifiers in one order (`Ctrl+Alt+Shift+`), letters upper
 * case, function keys `F1`–`F12`. Null when it is not a key the studio knows.
 * "shift+r", "Shift+R" and "R+Shift" are one key.
 */
export function normalizeStudioKey(raw: string): string | null {
  const trimmed = raw.trim();
  // "+" is a key too, so "Ctrl++" is Ctrl and "+", and a bare "+" is "+".
  const plusKey = trimmed === '+' || trimmed.endsWith('++');
  const head = plusKey ? trimmed.slice(0, -1).replace(/\+$/u, '') : trimmed;
  const parts = head.length === 0 ? [] : head.split('+').map((part) => part.trim());
  const key = plusKey ? '+' : parts.pop();
  if (!key) return null;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = MODIFIERS.find((name) => name.toLowerCase() === part.toLowerCase());
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  const base = normalizeBaseKey(key);
  if (!base) return null;
  return [...MODIFIERS.filter((name) => modifiers.has(name)), base].join('+');
}

function normalizeBaseKey(key: string): string | null {
  const functionKey = /^f([1-9]|1[0-2])$/iu.exec(key);
  if (functionKey) return `F${functionKey[1]}`;
  if (key.toLowerCase() === 'backspace') return 'Delete';
  const named = [...NAMED_KEYS, ...FIXED_KEYS].find((name) => name.toLowerCase() === key.toLowerCase());
  if (named) return named;
  if ([...key].length === 1 && /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(key)) return key.toUpperCase();
  return null;
}

/** What some presses are called instead of what the keyboard reports. */
const PRESS_ALIASES: Readonly<Record<string, string>> = { '=': '+', _: '-', ' ': 'Space' };

/** A key press, as much of it as matters. A DOM `KeyboardEvent` fits. */
export interface StudioKeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * A press as the name a keymap stores: "Delete", "+", "R", "Ctrl+A",
 * "Shift+ArrowLeft". Null for a press that is only a modifier going down.
 *
 * - Backspace is Delete: a laptop has no Delete key within reach.
 * - "=" is "+" and "_" is "-": the plus is Shift and "=" on most keyboards,
 *   and nobody means "equals" here.
 * - ⌘ is Ctrl.
 * - ⚠ Shift is part of the name for a letter, a digit or a named key
 *   (`Shift+R`), and NOT for a symbol: Shift is how "+" and "?" are typed, so
 *   "Shift++" would be a key nobody could find.
 */
export function studioKeyOfPress(press: StudioKeyPress): string | null {
  const raw = PRESS_ALIASES[press.key] ?? press.key;
  if (raw === 'Control' || raw === 'Shift' || raw === 'Alt' || raw === 'Meta') return null;
  const base = normalizeBaseKey(raw);
  if (!base) return null;
  const symbol = [...base].length === 1 && !/^[\p{L}\p{N}]$/u.test(base);
  const parts: string[] = [];
  if (press.ctrlKey || press.metaKey) parts.push('Ctrl');
  if (press.altKey) parts.push('Alt');
  if (press.shiftKey && !symbol) parts.push('Shift');
  return [...parts, base].join('+');
}

/** Why one key may not be bound, or null when it may. */
function checkKey(key: string): string | null {
  const base = key.split('+').at(-1) ?? '';
  if (FIXED_KEYS.has(base)) return `${key} is fixed and cannot be rebound.`;
  if (RESERVED_KEYS.has(key)) return `${key} belongs to the browser.`;
  const ctrlOrAlt = key.startsWith('Ctrl+') || key.startsWith('Alt+');
  if (ctrlOrAlt && /^\d$/u.test(base)) return `${key} switches browser tabs.`;
  if (key.startsWith('Ctrl+') && RESERVED_CTRL_LETTERS.has(base)) return `${key} belongs to the browser.`;
  return null;
}

/**
 * A keymap as it will be stored, or the reasons it is refused:
 *
 * - every action has a key the studio knows;
 * - no key is fixed (the arrows, `Esc`, `Enter`, `Space`, `Tab`) or the
 *   browser's;
 * - ⚠ ONE ACTION PER KEY ON A SCREEN. Two actions of the same zone may not
 *   share a key; two in different zones may (`R` turns a photo on Print and a
 *   cell in the editor).
 *
 * Takes `unknown`: it is what stands between a JSON column, or a request, and
 * the key handler.
 */
export function validateStudioKeymap(value: unknown): { keymap: StudioKeymap } | { refused: readonly string[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { refused: ['Those shortcuts are not in a form the studio reads.'] };
  }
  const given = value as Record<string, unknown>;
  const problems: string[] = [];
  const keymap = {} as Record<StudioKeyAction, string>;
  const taken: { key: string; zone: StudioKeyZone; label: string }[] = [];

  for (const action of STUDIO_KEY_ACTION_NAMES) {
    const { zone, label } = STUDIO_KEY_ACTIONS[action];
    const raw = given[action];
    const key = typeof raw === 'string' ? normalizeStudioKey(raw) : null;
    if (!key) {
      problems.push(`“${label}” needs a key.`);
      continue;
    }
    const problem = checkKey(key);
    if (problem) problems.push(`“${label}”: ${problem}`);
    const clash = taken.find((other) => other.key === key && other.zone === zone);
    if (clash) problems.push(`${key} is used twice: “${clash.label}” and “${label}”.`);
    keymap[action] = key;
    taken.push({ key, zone, label });
  }

  if (problems.length > 0) return { refused: problems };
  return { keymap };
}

/**
 * A saved keymap merged over the defaults: an action added in a later version
 * gets its default key rather than none. What the screens and the bar read.
 *
 * ⚠ A NEW ACTION NEVER TAKES A SAVED KEY. When an action the saved map never
 * had (added since it was saved) has a default the workspace already gave to
 * another action on the same screen, the saved key stays where it was and the
 * new action gets the first free key of `fallbackKeys` instead. Before this,
 * one new default that clashed made the whole saved map invalid and every
 * custom key fell back to the defaults (CodeRabbit on #55: `Shift+R`, added
 * for Turn left, may already be somebody's key).
 *
 * ⚠ STILL NEVER TRUSTS WHAT WAS STORED. A saved map that does not validate on
 * its own — a row edited by hand, two of its keys on one action — falls back
 * to the defaults whole, rather than leaving a screen with two actions on one
 * key.
 */
export function effectiveStudioKeymap(saved: unknown): StudioKeymap {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return STUDIO_DEFAULT_KEYMAP;
  const given = saved as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...STUDIO_DEFAULT_KEYMAP, ...given };
  for (const action of STUDIO_KEY_ACTION_NAMES) {
    if (Object.hasOwn(given, action)) continue;
    const used = keysInZone(merged, STUDIO_KEY_ACTIONS[action].zone, action);
    const wanted = STUDIO_DEFAULT_KEYMAP[action];
    if (!used.has(wanted)) continue;
    const free = fallbackKeys(wanted).find((key) => !used.has(key));
    if (free) merged[action] = free;
  }
  const checked = validateStudioKeymap(merged);
  return 'keymap' in checked ? checked.keymap : STUDIO_DEFAULT_KEYMAP;
}

/** The keys the other actions of one screen hold in a keymap being built, as stored (`normalizeStudioKey`). */
function keysInZone(keymap: Record<string, unknown>, zone: StudioKeyZone, except: StudioKeyAction): Set<string> {
  const keys = new Set<string>();
  for (const action of STUDIO_KEY_ACTION_NAMES) {
    if (action === except || STUDIO_KEY_ACTIONS[action].zone !== zone) continue;
    const raw = keymap[action];
    const key = typeof raw === 'string' ? normalizeStudioKey(raw) : null;
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Where a new action's key goes when its default is taken, in order: its own
 * letter with Alt, then Alt and Shift; then EVERY other safe key — the
 * letters bare, with Shift, Alt, and Alt and Shift, then the function keys
 * bare, with Shift and with Alt. Fixed, so every computer gives the same
 * answer, and each one a key `checkKey` allows, so the result validates.
 *
 * ⚠ IT CANNOT RUN OUT. A screen has a few dozen actions at most and this has
 * well over a hundred keys (tested), so a free one always exists — a short
 * list could be filled by a saved map and drop it whole again (CodeRabbit on
 * #55). No Ctrl: the browser keeps many Ctrl keys `checkKey` does not know
 * (Ctrl+Shift+I opens the developer tools).
 */
export function fallbackKeys(key: string): string[] {
  const base = key.split('+').at(-1) ?? key;
  const letters = Array.from({ length: 26 }, (_none, at) => String.fromCharCode(65 + at));
  const functionKeys = Array.from({ length: 12 }, (_none, at) => `F${at + 1}`);
  const every = [
    ...['', 'Shift+', 'Alt+', 'Alt+Shift+'].flatMap((modifier) => letters.map((letter) => `${modifier}${letter}`)),
    ...['', 'Shift+', 'Alt+'].flatMap((modifier) => functionKeys.map((name) => `${modifier}${name}`)),
  ];
  const ordered = [`Alt+${base}`, `Alt+Shift+${base}`, ...every];
  return [...new Set(ordered)].filter((candidate) => checkKey(candidate) === null);
}

/** The action a key is bound to on a screen, or null. */
export function studioActionOf(key: string | null, zone: StudioKeyZone, keymap: StudioKeymap): StudioKeyAction | null {
  if (key === null) return null;
  return (
    STUDIO_KEY_ACTION_NAMES.find((action) => STUDIO_KEY_ACTIONS[action].zone === zone && keymap[action] === key) ?? null
  );
}

/** A key as a person reads it on the bar: "Del", "PgDn", "−", "Ctrl A". */
export function studioKeyLabel(key: string): string {
  const short: Record<string, string> = { Delete: 'Del', PageDown: 'PgDn', PageUp: 'PgUp', Insert: 'Ins', '-': '−' };
  const parts =
    key === '+' || key.endsWith('++') ? [...key.slice(0, -1).split('+').filter(Boolean), '+'] : key.split('+');
  return parts.map((part) => short[part] ?? part).join(' ');
}
