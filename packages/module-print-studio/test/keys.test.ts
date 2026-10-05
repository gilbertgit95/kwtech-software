import {
  effectiveStudioKeymap,
  normalizeStudioKey,
  STUDIO_DEFAULT_KEYMAP,
  STUDIO_KEY_ACTION_NAMES,
  STUDIO_KEY_ACTIONS,
  studioActionOf,
  studioKeyLabel,
  studioKeyOfPress,
  validateStudioKeymap,
} from '../src/domain/keymap.js';
import {
  editorKeyAction,
  editorShortcutBar,
  isTypingTarget,
  KEYMAP_GROUPS,
  type PrintKeyContext,
  printKeyAction,
  printShortcutBar,
} from '../src/react/view/keys.js';

const KEYS = STUDIO_DEFAULT_KEYMAP;
type Mods = Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>;
const press = (key: string, mods: Mods = {}) =>
  studioKeyOfPress({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('studioKeyOfPress', () => {
  it('names a press the way a keymap stores it', () => {
    expect(press('Delete')).toBe('Delete');
    expect(press('r')).toBe('R');
    expect(press('R', { shiftKey: true })).toBe('Shift+R');
    expect(press('ArrowLeft', { shiftKey: true })).toBe('Shift+ArrowLeft');
    expect(press('a', { ctrlKey: true })).toBe('Ctrl+A');
    expect(press('F2')).toBe('F2');
  });

  it('treats Backspace as Delete, = as +, and ⌘ as Ctrl', () => {
    expect(press('Backspace')).toBe('Delete');
    expect(press('=')).toBe('+');
    expect(press('a', { metaKey: true })).toBe('Ctrl+A');
  });

  it('⚠ leaves Shift out of a symbol’s name: Shift is how "+" is typed', () => {
    expect(press('+', { shiftKey: true })).toBe('+');
    expect(press('?', { shiftKey: true })).toBe('?');
  });

  it('has no name for a modifier going down by itself', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) expect(press(key)).toBeNull();
  });
});

describe('normalizeStudioKey', () => {
  it('stores one spelling of a key', () => {
    expect(normalizeStudioKey('shift+r')).toBe('Shift+R');
    expect(normalizeStudioKey('R + Shift')).toBeNull();
    expect(normalizeStudioKey('ctrl+shift+f2')).toBe('Ctrl+Shift+F2');
    expect(normalizeStudioKey('+')).toBe('+');
    expect(normalizeStudioKey('Ctrl++')).toBe('Ctrl++');
    expect(normalizeStudioKey('backspace')).toBe('Delete');
  });

  it('refuses what is not a key', () => {
    for (const raw of ['', 'Hyper+A', 'Ctrl+Ctrl+A', 'F13', 'ab']) expect(normalizeStudioKey(raw)).toBeNull();
  });
});

describe('the default keymap', () => {
  it('is valid, and binds every action', () => {
    expect(validateStudioKeymap(KEYS)).toEqual({ keymap: KEYS });
    expect(Object.keys(KEYS).sort()).toEqual([...STUDIO_KEY_ACTION_NAMES].sort());
  });

  it('uses Delete to empty the selected cells — the key the operator asked for', () => {
    expect(KEYS.emptyCells).toBe('Delete');
    expect(studioActionOf('Delete', 'print', KEYS)).toBe('emptyCells');
    expect(studioActionOf('Delete', 'editor', KEYS)).toBe('removeCell');
  });
});

describe('validateStudioKeymap', () => {
  const withKey = (action: keyof typeof KEYS, key: string) => validateStudioKeymap({ ...KEYS, [action]: key });
  const problems = (result: ReturnType<typeof validateStudioKeymap>) => ('refused' in result ? result.refused : []);

  it('accepts a rebinding and stores it in one spelling', () => {
    const result = withKey('turnPhoto', 'shift+t');
    expect('keymap' in result && result.keymap.turnPhoto).toBe('Shift+T');
  });

  it('⚠ refuses two actions on one key on the same screen, and allows it across screens', () => {
    expect(problems(withKey('turnPhoto', 'S'))[0]).toContain('S is used twice');
    // `R` is Turn on Print and Turn in the editor by default: different screens.
    expect('keymap' in withKey('copyCell', 'S')).toBe(true);
  });

  it.each([
    ['a fixed key', 'ArrowLeft', 'fixed'],
    ['Escape', 'escape', 'fixed'],
    ['the browser’s print', 'Ctrl+P', 'belongs to the browser'],
    ['the browser’s save', 'ctrl+s', 'belongs to the browser'],
    ['reload', 'F5', 'belongs to the browser'],
    ['a tab switch', 'Ctrl+1', 'switches browser tabs'],
  ])('refuses %s', (_name, key, reason) => {
    expect(problems(withKey('download', key)).join(' ')).toContain(reason);
  });

  it('refuses an action with no key, and anything that is not a keymap', () => {
    expect(problems(validateStudioKeymap({ ...KEYS, print: '' }))[0]).toContain('needs a key');
    expect(problems(validateStudioKeymap(null))).toHaveLength(1);
    expect(problems(validateStudioKeymap([]))).toHaveLength(1);
  });

  it('drops keys for actions it has never heard of', () => {
    const result = validateStudioKeymap({ ...KEYS, launchRocket: 'X' });
    expect('keymap' in result && 'launchRocket' in result.keymap).toBe(false);
  });
});

describe('effectiveStudioKeymap', () => {
  it('lays a saved keymap over the defaults', () => {
    expect(effectiveStudioKeymap({ turnPhoto: 'T' })).toEqual({ ...KEYS, turnPhoto: 'T' });
    expect(effectiveStudioKeymap(null)).toBe(KEYS);
  });

  it('⚠ falls back to the defaults whole when what was stored no longer validates', () => {
    expect(effectiveStudioKeymap({ turnPhoto: 'S' })).toBe(KEYS);
    expect(effectiveStudioKeymap('nonsense')).toBe(KEYS);
  });
});

describe('studioKeyLabel', () => {
  it('reads as a key cap', () => {
    expect(studioKeyLabel('Delete')).toBe('Del');
    expect(studioKeyLabel('Ctrl+A')).toBe('Ctrl A');
    expect(studioKeyLabel('-')).toBe('−');
    expect(studioKeyLabel('+')).toBe('+');
    expect(studioKeyLabel('Ctrl++')).toBe('Ctrl +');
    expect(studioKeyLabel('PageDown')).toBe('PgDn');
  });
});

const NOTHING: PrintKeyContext = { selected: 0, filledSelected: 0, filled: 0, photos: 0, pages: 1, pageIndex: 0 };
const ONE_SELECTED: PrintKeyContext = { selected: 1, filledSelected: 1, filled: 8, photos: 2, pages: 2, pageIndex: 0 };

describe('printKeyAction', () => {
  it('empties, zooms, turns and resets the selected photos', () => {
    expect(printKeyAction('Delete', ONE_SELECTED, KEYS)).toEqual({ kind: 'empty' });
    expect(printKeyAction('+', ONE_SELECTED, KEYS)).toEqual({ kind: 'zoom', by: 0.1 });
    expect(printKeyAction('-', ONE_SELECTED, KEYS)).toEqual({ kind: 'zoom', by: -0.1 });
    expect(printKeyAction('R', ONE_SELECTED, KEYS)).toEqual({ kind: 'turn' });
    expect(printKeyAction('0', ONE_SELECTED, KEYS)).toEqual({ kind: 'reset' });
  });

  it('moves the photo with the arrows: it goes the way the arrow points, further with Shift', () => {
    expect(printKeyAction('ArrowRight', ONE_SELECTED, KEYS)).toEqual({ kind: 'move', dx: 0.02, dy: 0 });
    expect(printKeyAction('ArrowUp', ONE_SELECTED, KEYS)).toEqual({ kind: 'move', dx: 0, dy: -0.02 });
    expect(printKeyAction('Shift+ArrowLeft', ONE_SELECTED, KEYS)).toEqual({ kind: 'move', dx: -0.1, dy: 0 });
  });

  it('⚠ does nothing with nothing to act on — Delete with no photo selected is not a shortcut', () => {
    for (const key of ['Delete', '+', '-', 'R', '0', 'S', 'ArrowLeft', 'Escape', 'Ctrl+A', '1', 'D', 'P', 'PageDown']) {
      expect([key, printKeyAction(key, NOTHING, KEYS)]).toEqual([key, null]);
    }
    // A selected EMPTY cell has no photo to frame or empty; it can still be let go of.
    const emptySelected = { ...NOTHING, selected: 1 };
    expect(printKeyAction('Delete', emptySelected, KEYS)).toBeNull();
    expect(printKeyAction('Escape', emptySelected, KEYS)).toEqual({ kind: 'select', what: 'none' });
  });

  it('selects, arranges, turns pages and sends the result out', () => {
    expect(printKeyAction('S', ONE_SELECTED, KEYS)).toEqual({ kind: 'select', what: 'photo' });
    expect(printKeyAction('Ctrl+A', ONE_SELECTED, KEYS)).toEqual({ kind: 'select', what: 'all' });
    expect(printKeyAction('2', ONE_SELECTED, KEYS)).toEqual({ kind: 'arrange', mode: 'sequence' });
    expect(printKeyAction('PageDown', ONE_SELECTED, KEYS)).toEqual({ kind: 'page', by: 1 });
    expect(printKeyAction('PageUp', ONE_SELECTED, KEYS)).toBeNull();
    expect(printKeyAction('PageUp', { ...ONE_SELECTED, pageIndex: 1 }, KEYS)).toEqual({ kind: 'page', by: -1 });
    expect(printKeyAction('D', ONE_SELECTED, KEYS)).toEqual({ kind: 'output', how: 'download' });
    expect(printKeyAction('P', ONE_SELECTED, KEYS)).toEqual({ kind: 'output', how: 'print' });
  });

  it('obeys a workspace’s own keymap, and frees the key it moved from', () => {
    const custom = { ...KEYS, emptyCells: 'X' };
    expect(printKeyAction('X', ONE_SELECTED, custom)).toEqual({ kind: 'empty' });
    expect(printKeyAction('Delete', ONE_SELECTED, custom)).toBeNull();
  });

  it('⚠ keeps the arrows and Escape whatever the keymap says', () => {
    const hostile = { ...KEYS, download: 'Escape', print: 'ArrowLeft' };
    expect(printKeyAction('Escape', ONE_SELECTED, hostile)).toEqual({ kind: 'select', what: 'none' });
    expect(printKeyAction('ArrowLeft', ONE_SELECTED, hostile)).toEqual({ kind: 'move', dx: -0.02, dy: 0 });
  });
});

describe('printShortcutBar', () => {
  it('⚠ shows only keys that do something right now, and every one it shows does', () => {
    expect(printShortcutBar(NOTHING, KEYS)).toEqual([]);
    for (const context of [ONE_SELECTED, { ...NOTHING, photos: 3 }, { ...NOTHING, filled: 4, photos: 1 }]) {
      for (const entry of printShortcutBar(context, KEYS)) {
        if (!entry.press) continue;
        expect([entry.keys, printKeyAction(entry.press, context, KEYS) !== null]).toEqual([entry.keys, true]);
      }
    }
  });

  it('leads with the selection’s keys and explains the arrows once', () => {
    const bar = printShortcutBar(ONE_SELECTED, KEYS);
    expect(bar.slice(0, 6).map((entry) => entry.keys)).toEqual(['Del', '+', '−', 'R', '0', '← ↑ → ↓']);
    expect(bar.filter((entry) => entry.label === 'Move photo')).toHaveLength(1);
  });

  it('offers the arrange keys once there are photos, with nothing selected', () => {
    expect(printShortcutBar({ ...NOTHING, photos: 2 }, KEYS).map((entry) => entry.keys)).toEqual(['1', '2', '3']);
  });

  it('shows the workspace’s own key for an action', () => {
    const bar = printShortcutBar(ONE_SELECTED, { ...KEYS, emptyCells: 'Shift+X' });
    expect(bar[0]).toEqual({ keys: 'Shift X', label: 'Empty', press: 'Shift+X' });
  });
});

describe('the layout editor’s keys', () => {
  it('moves, removes, copies and turns the selected cell', () => {
    expect(editorKeyAction('ArrowDown', true, KEYS)).toEqual({ kind: 'move', dx: 0, dy: 1 });
    expect(editorKeyAction('Shift+ArrowRight', true, KEYS)).toEqual({ kind: 'move', dx: 5, dy: 0 });
    expect(editorKeyAction('Delete', true, KEYS)).toEqual({ kind: 'remove' });
    expect(editorKeyAction('D', true, KEYS)).toEqual({ kind: 'copy' });
    expect(editorKeyAction('R', true, KEYS)).toEqual({ kind: 'turn' });
    expect(editorKeyAction('Escape', true, KEYS)).toEqual({ kind: 'deselect' });
  });

  it('zooms the view with or without a selection, and nothing else without one', () => {
    expect(editorKeyAction('+', false, KEYS)).toEqual({ kind: 'view', zoom: 'in' });
    expect(editorKeyAction('0', false, KEYS)).toEqual({ kind: 'view', zoom: 'fit' });
    for (const key of ['Delete', 'D', 'R', 'ArrowLeft', 'Escape']) expect(editorKeyAction(key, false, KEYS)).toBeNull();
  });

  it('shows on its bar only what works now', () => {
    expect(editorShortcutBar(false, KEYS).map((entry) => entry.keys)).toEqual(['+', '−', '0']);
    for (const entry of editorShortcutBar(true, KEYS)) {
      if (entry.press) expect(editorKeyAction(entry.press, true, KEYS)).not.toBeNull();
    }
  });
});

describe('the settings screen’s groups', () => {
  it('list every action exactly once, under its own screen', () => {
    const listed = KEYMAP_GROUPS.flatMap((group) => group.actions);
    expect([...listed].sort()).toEqual([...STUDIO_KEY_ACTION_NAMES].sort());
    for (const group of KEYMAP_GROUPS) {
      for (const action of group.actions) expect(STUDIO_KEY_ACTIONS[action].zone).toBe(group.zone);
    }
  });
});

describe('isTypingTarget', () => {
  it('leaves keys to a field somebody is typing in, except Escape', () => {
    expect(isTypingTarget('INPUT', 'D')).toBe(true);
    expect(isTypingTarget('SELECT', 'ArrowDown')).toBe(true);
    expect(isTypingTarget('INPUT', 'Escape')).toBe(false);
    expect(isTypingTarget('BUTTON', 'D')).toBe(false);
  });
});
