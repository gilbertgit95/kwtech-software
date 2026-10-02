import { POS_KEY_ACTIONS, type PosKeyAction, type PosKeymap, type PosKeyZone } from '../../domain/keymap.js';

/**
 * The till's keyboard (D18, D20, D21): which key was pressed, what it means
 * where the cashier is, and what the shortcut bar shows there. Pure, so the
 * whole keyboard-only sale is a test (`test/keys.test.ts`), not a hope — this
 * repo has no React render tests, and the rules live here instead.
 *
 * ⚠ THE BAR AND THE KEYS READ THE SAME MAP through the same functions, so the
 * bar can never advertise a key that does something else.
 */

/**
 * Where the cashier is, which decides what a key means:
 *
 *   search  — typing in the item search (letters type; function keys act)
 *   cart    — a line is selected (letters act on it)
 *   payment — the payment dialog
 *   receipt — a finished order is on the till
 *   dialog  — any other dialog: its own fields and buttons, nothing global
 */
export type TillZone = 'search' | 'cart' | 'payment' | 'receipt' | 'dialog';

/** The parts of a `KeyboardEvent` that matter, so the rules take a literal in tests. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey?: boolean;
}

/**
 * A key press as the keymap spells it: "F2", "Shift+F1", "Shift+D", "D", "+",
 * "?", "Delete". Null for a press the till never binds (a bare modifier, a
 * Cmd/Meta chord, Tab, the arrows, Enter, Escape — the fixed keys).
 *
 * ⚠ SHIFT IS DROPPED FROM SYMBOLS: "?" and "+" are typed with Shift on most
 * keyboards, and the key itself already says so. It is KEPT on letters and
 * function keys, where it is the difference (`D` versus `Shift+D`).
 */
export function keyOfPress(press: KeyPress): string | null {
  if (press.metaKey) return null;
  const { key } = press;
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Enter', 'Escape', 'CapsLock'].includes(key)) return null;
  if (key.startsWith('Arrow')) return null;
  const modifiers = [press.ctrlKey ? 'Ctrl' : null, press.altKey ? 'Alt' : null];
  const functionKey = /^F([1-9]|1[0-2])$/u.test(key);
  const letter = /^\p{L}$/u.test(key);
  if (functionKey || letter) modifiers.push(press.shiftKey ? 'Shift' : null);
  const base = letter ? key.toUpperCase() : key;
  if (!functionKey && [...base].length !== 1 && base !== 'Delete' && base !== 'Backspace') return null;
  return [...modifiers.filter((part): part is string => part !== null), base].join('+');
}

/**
 * Whether a key still acts while the person is typing in a text field: only a
 * function key, alone or with a modifier ("F9", "Shift+F1"), because every
 * other key is something they are typing (D18, D20). True of the item search
 * too — its global keys are function keys by `validateKeymap`.
 */
export function actsWhileTyping(key: string | null): boolean {
  return key !== null && /(^|\+)F([1-9]|1[0-2])$/u.test(key);
}

/** What a key does. */
export type KeyMeaning =
  | { kind: 'action'; action: PosKeyAction }
  | { kind: 'item'; itemId: string; variantId: string | null }
  | null;

/** The keymap zones that are live in each till zone. `global` everywhere a sale is being rung up. */
const LIVE_ZONES: Record<TillZone, readonly PosKeyZone[]> = {
  search: ['global'],
  cart: ['global', 'cart'],
  payment: ['payment'],
  receipt: ['global', 'receipt'],
  dialog: [],
};

/**
 * What `key` means in `zone` under `keymap`, or null when it means nothing
 * there (and so the browser, or the field, should have it).
 *
 * - `global` keys (function keys, by `validateKeymap`) and item keys act in
 *   search, the cart and on a receipt — never inside a dialog.
 * - `cart` keys act only with a line selected: in search, "D" types a D.
 * - `payment` keys act only in the payment dialog.
 */
export function meaningOf(key: string | null, zone: TillZone, keymap: PosKeymap): KeyMeaning {
  if (!key) return null;
  const live = LIVE_ZONES[zone];
  for (const action of Object.keys(POS_KEY_ACTIONS) as PosKeyAction[]) {
    if (keymap.actions[action] === key && live.includes(POS_KEY_ACTIONS[action].zone)) {
      return { kind: 'action', action };
    }
  }
  if (live.includes('global')) {
    const item = keymap.items[key];
    if (item) return { kind: 'item', itemId: item.itemId, variantId: item.variantId };
  }
  return null;
}

/** Actions a person without the key cannot use: the bar and the `?` list leave them out (D21). */
const NEEDS_DISCOUNT: readonly PosKeyAction[] = ['lineDiscount', 'orderDiscount'];

/** One entry of the shortcut bar or the `?` list. */
export interface ShortcutEntry {
  key: string;
  label: string;
  action: PosKeyAction | null;
  /** For an item key: what it rings up. */
  item?: { itemId: string; variantId: string | null };
}

/**
 * The shortcut bar for a zone (D21): the keys that work RIGHT NOW, in the
 * order a sale goes, plus the fixed ones that matter there, and the store's
 * item keys where they are live. Only what this person may do.
 */
export function shortcutBar(
  zone: TillZone,
  keymap: PosKeymap,
  options: { canDiscount: boolean; itemLabels?: ReadonlyMap<string, string> },
): ShortcutEntry[] {
  const entry = (action: PosKeyAction): ShortcutEntry | null => {
    if (!options.canDiscount && NEEDS_DISCOUNT.includes(action)) return null;
    return { key: keymap.actions[action], label: POS_KEY_ACTIONS[action].label, action };
  };
  const fixed = (key: string, label: string): ShortcutEntry => ({ key, label, action: null });
  const pick = (actions: readonly PosKeyAction[]) =>
    actions.map(entry).filter((one): one is ShortcutEntry => one !== null);
  const items = (): ShortcutEntry[] =>
    Object.entries(keymap.items).map(([key, target]) => ({
      key,
      label: options.itemLabels?.get(`${target.itemId}:${target.variantId ?? ''}`) ?? 'Item',
      action: null,
      item: target,
    }));

  switch (zone) {
    case 'search':
      return [
        ...pick(['search']),
        fixed('100*', 'Quantity'),
        fixed('↑', 'Cart'),
        ...pick(['customer', 'hold', 'pending', 'pay']),
        ...items(),
      ];
    case 'cart':
      return [
        fixed('↑ ↓', 'Line'),
        ...pick(['quantityUp', 'quantityDown', 'removeLine', 'lineNote', 'lineDiscount', 'orderDiscount']),
        ...pick(['backToSearch', 'pay', 'help']),
      ];
    case 'payment':
      return [
        ...pick(['payCash', 'payEwallet', 'payCard', 'keepTip', 'changeOwed', 'payLater']),
        fixed('Enter', 'Confirm'),
        fixed('Esc', 'Back'),
      ];
    case 'receipt':
      return [...pick(['print']), fixed('Enter', 'Next order')];
    case 'dialog':
      return [fixed('↑ ↓', 'Choose'), fixed('Enter', 'Select'), fixed('Esc', 'Close')];
  }
}

/** Every key, for the `?` list: each zone's bar, without repeats. */
export function allShortcuts(
  keymap: PosKeymap,
  options: { canDiscount: boolean; itemLabels?: ReadonlyMap<string, string> },
): { zone: string; entries: ShortcutEntry[] }[] {
  const zones: [TillZone, string][] = [
    ['search', 'Selling'],
    ['cart', 'A selected line'],
    ['payment', 'Payment'],
    ['receipt', 'After payment'],
  ];
  return zones.map(([zone, title]) => ({ zone: title, entries: shortcutBar(zone, keymap, options) }));
}

/**
 * The line selected after ↑ / ↓ in the cart (D20). ↑ from search enters the
 * cart at the LAST line — the one just added; ↓ past the last returns to
 * search (null).
 */
export function nextLine(lineIds: readonly string[], current: string | null, direction: 'up' | 'down'): string | null {
  if (lineIds.length === 0) return null;
  if (current === null) return direction === 'up' ? (lineIds.at(-1) ?? null) : null;
  const index = lineIds.indexOf(current);
  if (index === -1) return lineIds.at(-1) ?? null;
  if (direction === 'up') return lineIds[Math.max(0, index - 1)] ?? null;
  return index + 1 < lineIds.length ? (lineIds[index + 1] ?? null) : null;
}
