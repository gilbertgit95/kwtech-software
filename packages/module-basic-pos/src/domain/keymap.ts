/**
 * Hot keys (D18, D20, D21): what each key does at the till, the defaults every
 * store starts with, and the rules a store's own keymap must keep.
 *
 * ⚠ ONE KEYMAP, READ BY BOTH THE KEYS AND THE SHORTCUT BAR. The bar is drawn
 * from the same map the key handler obeys, so the bar can never advertise a
 * key that does something else.
 */

/**
 * Where a key applies. The till has zones because the same key must mean
 * different things in different places — and must type a letter in search.
 *
 *   global  — anywhere in the till, even while typing in search. So only keys
 *             that never type text: function keys, alone or with Shift.
 *   cart    — a line is selected; letters act on it.
 *   payment — the payment dialog.
 *   receipt — after payment.
 */
export type PosKeyZone = 'global' | 'cart' | 'payment' | 'receipt';

/** Every action a key can be bound to. Item keys are separate: they ring up an item. */
export const POS_KEY_ACTIONS = {
  search: { zone: 'global', label: 'Search' },
  hold: { zone: 'global', label: 'Hold' },
  customer: { zone: 'global', label: 'Customer' },
  pending: { zone: 'global', label: 'Pending orders' },
  pay: { zone: 'global', label: 'Pay' },
  quantityUp: { zone: 'cart', label: 'Quantity +1' },
  quantityDown: { zone: 'cart', label: 'Quantity −1' },
  removeLine: { zone: 'cart', label: 'Remove line' },
  lineDiscount: { zone: 'cart', label: 'Line discount' },
  lineNote: { zone: 'cart', label: 'Line note' },
  orderDiscount: { zone: 'cart', label: 'Order discount' },
  backToSearch: { zone: 'cart', label: 'Back to search' },
  help: { zone: 'cart', label: 'All keys' },
  payCash: { zone: 'payment', label: 'Cash' },
  payEwallet: { zone: 'payment', label: 'E-wallet' },
  payCard: { zone: 'payment', label: 'Card' },
  keepTip: { zone: 'payment', label: 'Keep as tip' },
  changeOwed: { zone: 'payment', label: 'Change owed' },
  payLater: { zone: 'payment', label: 'Pay later' },
  print: { zone: 'receipt', label: 'Print' },
} as const satisfies Record<string, { zone: PosKeyZone; label: string }>;

export type PosKeyAction = keyof typeof POS_KEY_ACTIONS;

/** A store's keymap: an action's key, and the item keys (key → item or variant). */
export interface PosKeymap {
  actions: Readonly<Record<PosKeyAction, string>>;
  /** Key → `{ itemId, variantId }`. Global zone, so function keys only. */
  items: Readonly<Record<string, { itemId: string; variantId: string | null }>>;
}

/**
 * The defaults (D18, D20). Every store starts here; a store with no saved
 * keymap simply uses them.
 *
 * ⚠ FIXED KEYS ARE NOT IN THE MAP: `Enter` (add, confirm), `Esc` (close; never
 * cancels an order), `↑` `↓` (move), `Tab`. A cashier must never be able to
 * lose the way out of a dialog to a rebinding.
 */
export const POS_DEFAULT_KEYMAP: PosKeymap = {
  actions: {
    search: 'F2',
    hold: 'F4',
    customer: 'F6',
    pending: 'F8',
    pay: 'F9',
    quantityUp: '+',
    quantityDown: '-',
    removeLine: 'Delete',
    lineDiscount: 'D',
    lineNote: 'N',
    orderDiscount: 'Shift+D',
    backToSearch: '/',
    help: '?',
    payCash: '1',
    payEwallet: '2',
    payCard: '3',
    keepTip: 'T',
    changeOwed: 'O',
    payLater: 'L',
    print: 'P',
  },
  items: {},
};

/** Keys that are never rebindable: the fixed ones above. */
const FIXED_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/**
 * Keys the BROWSER must keep (D18): reload, full screen, developer tools,
 * print, close, new tab or window, the address bar, and switching tabs. A till
 * that took `F5` would stop a cashier reloading a stuck page.
 */
const RESERVED_KEYS = new Set(['F5', 'F11', 'F12', 'Ctrl+F5', 'Shift+F5']);
const RESERVED_CTRL_LETTERS = new Set(['P', 'R', 'W', 'T', 'N', 'L', 'Q', 'F']);

const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;
const NAMED_KEYS = new Set(['Delete', 'Backspace', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * A key as stored: modifiers in one order (`Ctrl+Alt+Shift+`), letters upper
 * case, function keys `F1`–`F12`. Null when it is not a key this till knows.
 * "shift+f1", "Shift+F1" and "F1+Shift" are one key.
 */
export function normalizeKey(raw: string): string | null {
  const trimmed = raw.trim();
  // "+" is a key too, so "Shift++" is Shift and "+", and a bare "+" is "+".
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
  const named = [...NAMED_KEYS, ...FIXED_KEYS].find((name) => name.toLowerCase() === key.toLowerCase());
  if (named) return named;
  if ([...key].length === 1 && /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(key)) return key.toUpperCase();
  return null;
}

function isFunctionKey(key: string): boolean {
  return /(^|\+)F([1-9]|1[0-2])$/u.test(key);
}

/** Why one key may not take one zone, or null when it may. */
function checkKeyForZone(key: string, zone: PosKeyZone): string | null {
  if (FIXED_KEYS.has(key.split('+').at(-1) ?? '')) return `${key} is fixed and cannot be rebound.`;
  if (RESERVED_KEYS.has(key)) return `${key} belongs to the browser.`;
  const ctrlOrAlt = key.startsWith('Ctrl+') || key.startsWith('Alt+');
  const base = key.split('+').at(-1) ?? '';
  if (ctrlOrAlt && /^\d$/u.test(base)) return `${key} switches browser tabs.`;
  if (key.startsWith('Ctrl+') && RESERVED_CTRL_LETTERS.has(base)) return `${key} belongs to the browser.`;
  // ⚠ Anything that types a character would be swallowed from the search box.
  if (zone === 'global' && !isFunctionKey(key)) return `${key} would type into search; use a function key.`;
  return null;
}

/**
 * A keymap as it will be stored, or the reasons it is refused (D18):
 *
 * - every action has a key this till knows;
 * - no key is fixed (`Enter`, `Esc`, arrows, `Tab`) or the browser's;
 * - a GLOBAL key is a function key, because anything else types into search;
 * - ⚠ ONE ACTION PER KEY where they could meet: a global key (or item key) is
 *   live in every zone, so it may not repeat anywhere; two keys in different
 *   zones may share (`1` is cash in payment and nothing in the cart).
 *
 * Item keys pointing at archived items are NOT refused here: the item can be
 * archived after the key is set. Settings shows them as broken and the till
 * ignores them.
 */
export function validateKeymap(keymap: PosKeymap): { keymap: PosKeymap } | { refused: readonly string[] } {
  const problems: string[] = [];
  const actions = {} as Record<PosKeyAction, string>;
  const taken: { key: string; zone: PosKeyZone; what: string }[] = [];

  for (const action of Object.keys(POS_KEY_ACTIONS) as PosKeyAction[]) {
    const { zone, label } = POS_KEY_ACTIONS[action];
    const raw = keymap.actions[action];
    const key = typeof raw === 'string' ? normalizeKey(raw) : null;
    if (!key) {
      problems.push(`“${label}” needs a key.`);
      continue;
    }
    const problem = checkKeyForZone(key, zone);
    if (problem) problems.push(`“${label}”: ${problem}`);
    actions[action] = key;
    taken.push({ key, zone, what: `“${label}”` });
  }

  const items: Record<string, { itemId: string; variantId: string | null }> = {};
  for (const [raw, target] of Object.entries(keymap.items)) {
    const key = normalizeKey(raw);
    if (!key || !isFunctionKey(key)) {
      problems.push(`Item key ${raw}: use a function key, such as Shift+F1.`);
      continue;
    }
    const problem = checkKeyForZone(key, 'global');
    if (problem) problems.push(`Item key ${key}: ${problem}`);
    items[key] = { itemId: target.itemId, variantId: target.variantId };
    taken.push({ key, zone: 'global', what: `item key ${key}` });
  }

  for (let i = 0; i < taken.length; i += 1) {
    for (let j = i + 1; j < taken.length; j += 1) {
      const a = taken[i];
      const b = taken[j];
      if (!a || !b || a.key !== b.key) continue;
      if (a.zone === b.zone || a.zone === 'global' || b.zone === 'global') {
        problems.push(`${a.key} is used twice: ${a.what} and ${b.what}.`);
      }
    }
  }

  if (problems.length > 0) return { refused: problems };
  return { keymap: { actions, items } };
}

/**
 * A saved keymap merged over the defaults: an action added in a later version
 * gets its default key rather than none. What the till and the bar read.
 */
export function effectiveKeymap(saved: Partial<PosKeymap> | null): PosKeymap {
  if (!saved) return POS_DEFAULT_KEYMAP;
  return {
    actions: { ...POS_DEFAULT_KEYMAP.actions, ...saved.actions },
    items: { ...saved.items },
  };
}
