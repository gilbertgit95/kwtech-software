import { POS_DEFAULT_KEYMAP, type PosKeymap } from '../src/domain/keymap.js';
import { parseQuantityPrefix } from '../src/domain/search.js';
import {
  actsWhileTyping,
  allShortcuts,
  type KeyPress,
  keyOfPress,
  meaningOf,
  nextLine,
  shortcutBar,
  type TillZone,
} from '../src/react/view/keys.js';

const press = (key: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('keyOfPress', () => {
  it('spells a press as the keymap does', () => {
    expect(keyOfPress(press('F2'))).toBe('F2');
    expect(keyOfPress(press('F1', { shiftKey: true }))).toBe('Shift+F1');
    expect(keyOfPress(press('d'))).toBe('D');
    expect(keyOfPress(press('D', { shiftKey: true }))).toBe('Shift+D');
    expect(keyOfPress(press('Delete'))).toBe('Delete');
  });

  it('⚠ drops Shift from symbols — "?" and "+" are typed with it', () => {
    expect(keyOfPress(press('?', { shiftKey: true }))).toBe('?');
    expect(keyOfPress(press('+', { shiftKey: true }))).toBe('+');
  });

  it('leaves the fixed keys, bare modifiers and Cmd chords alone', () => {
    for (const key of ['Enter', 'Escape', 'Tab', 'ArrowUp', 'Shift']) expect(keyOfPress(press(key))).toBeNull();
    expect(keyOfPress(press('p', { metaKey: true }))).toBeNull();
  });
});

describe('typing in a field', () => {
  it('⚠ lets only function keys act — a letter typed in search is a letter, never "Print"', () => {
    for (const key of ['F2', 'F9', 'F12', 'Shift+F1', 'Ctrl+F3']) expect(actsWhileTyping(key)).toBe(true);
    for (const key of ['P', 'D', 'Shift+D', '+', '-', '/', '?', '1', 'Delete', 'Backspace']) {
      expect(actsWhileTyping(key)).toBe(false);
    }
    expect(actsWhileTyping(null)).toBe(false);
  });
});

describe('meaningOf', () => {
  const at = (key: string, zone: TillZone, keymap: PosKeymap = POS_DEFAULT_KEYMAP) => meaningOf(key, zone, keymap);

  it('⚠ lets a letter TYPE in search, and act on the selected line in the cart', () => {
    expect(at('D', 'search')).toBeNull();
    expect(at('D', 'cart')).toEqual({ kind: 'action', action: 'lineDiscount' });
  });

  it('acts on function keys in search and the cart, never inside a dialog', () => {
    expect(at('F9', 'search')).toEqual({ kind: 'action', action: 'pay' });
    expect(at('F9', 'cart')).toEqual({ kind: 'action', action: 'pay' });
    expect(at('F9', 'dialog')).toBeNull();
  });

  it('keeps payment keys to the payment dialog', () => {
    expect(at('1', 'payment')).toEqual({ kind: 'action', action: 'payCash' });
    expect(at('1', 'cart')).toBeNull();
  });

  it('follows a store’s own keymap, and rings up its item keys', () => {
    const keymap: PosKeymap = {
      actions: { ...POS_DEFAULT_KEYMAP.actions, pay: 'F10' },
      items: { 'Shift+F1': { itemId: 'bag', variantId: null } },
    };
    expect(at('F10', 'search', keymap)).toEqual({ kind: 'action', action: 'pay' });
    expect(at('F9', 'search', keymap)).toBeNull();
    expect(at('Shift+F1', 'search', keymap)).toEqual({ kind: 'item', itemId: 'bag', variantId: null });
    expect(at('Shift+F1', 'payment', keymap)).toBeNull();
  });
});

describe('the shortcut bar', () => {
  it('shows what works where the cashier is', () => {
    const keys = (zone: TillZone) => shortcutBar(zone, POS_DEFAULT_KEYMAP, { canDiscount: true }).map((e) => e.key);
    expect(keys('search')).toEqual(['F2', '100*', '↑', 'F6', 'F4', 'F8', 'F9']);
    expect(keys('receipt')).toEqual(['P', 'Enter']);
  });

  it('⚠ leaves out discounts for somebody who may not give them (D21)', () => {
    const labels = shortcutBar('cart', POS_DEFAULT_KEYMAP, { canDiscount: false }).map((entry) => entry.label);
    expect(labels).not.toContain('Line discount');
    expect(labels).not.toContain('Order discount');
  });

  it('⚠ shows a rebound key as rebound — the bar and the keys read one map', () => {
    const keymap = { ...POS_DEFAULT_KEYMAP, actions: { ...POS_DEFAULT_KEYMAP.actions, pay: 'F10' } };
    const pay = shortcutBar('search', keymap, { canDiscount: true }).find((entry) => entry.action === 'pay');
    expect(pay?.key).toBe('F10');
    expect(meaningOf(pay?.key ?? null, 'search', keymap)).toEqual({ kind: 'action', action: 'pay' });
  });

  it('lists every zone for the ? list', () => {
    expect(allShortcuts(POS_DEFAULT_KEYMAP, { canDiscount: true }).map((group) => group.zone)).toEqual([
      'Selling',
      'A selected line',
      'Payment',
      'After payment',
    ]);
  });
});

describe('moving through the cart', () => {
  it('enters at the last line, moves, and leaves past the end', () => {
    expect(nextLine(['a', 'b', 'c'], null, 'up')).toBe('c');
    expect(nextLine(['a', 'b', 'c'], 'c', 'up')).toBe('b');
    expect(nextLine(['a', 'b', 'c'], 'a', 'up')).toBe('a');
    expect(nextLine(['a', 'b', 'c'], 'c', 'down')).toBeNull();
    expect(nextLine([], null, 'up')).toBeNull();
  });
});

/**
 * ⚠ D20, as a test: a whole sale with the keyboard alone — 100 magnets with ₱100
 * off, 2 laminations, the customer, cash, the receipt, the next order. Each
 * step is a press, where the cashier is, and what it must mean.
 */
describe('a sale without a mouse', () => {
  it('reaches every step of the sale from the keyboard', () => {
    const steps: [string, TillZone, unknown][] = [
      ['F2', 'search', { kind: 'action', action: 'search' }],
      // "100*ref" + Enter in search: the quantity prefix, then Enter (a fixed key) adds.
      ['F6', 'search', { kind: 'action', action: 'customer' }],
      ['D', 'cart', { kind: 'action', action: 'lineDiscount' }],
      ['+', 'cart', { kind: 'action', action: 'quantityUp' }],
      ['N', 'cart', { kind: 'action', action: 'lineNote' }],
      ['Shift+D', 'cart', { kind: 'action', action: 'orderDiscount' }],
      ['/', 'cart', { kind: 'action', action: 'backToSearch' }],
      ['F4', 'search', { kind: 'action', action: 'hold' }],
      ['F8', 'search', { kind: 'action', action: 'pending' }],
      ['F9', 'search', { kind: 'action', action: 'pay' }],
      ['1', 'payment', { kind: 'action', action: 'payCash' }],
      ['T', 'payment', { kind: 'action', action: 'keepTip' }],
      ['O', 'payment', { kind: 'action', action: 'changeOwed' }],
      ['L', 'payment', { kind: 'action', action: 'payLater' }],
      ['P', 'receipt', { kind: 'action', action: 'print' }],
    ];
    for (const [key, zone, meaning] of steps) {
      expect([key, zone, meaningOf(key, zone, POS_DEFAULT_KEYMAP)]).toEqual([key, zone, meaning]);
    }
    expect(parseQuantityPrefix('100*ref')).toEqual({ quantity: 100, text: 'ref' });
  });
});
