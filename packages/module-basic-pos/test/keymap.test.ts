import {
  effectiveKeymap,
  normalizeKey,
  POS_DEFAULT_KEYMAP,
  type PosKeymap,
  validateKeymap,
} from '../src/domain/keymap.js';

function withActions(actions: Partial<PosKeymap['actions']>, items: PosKeymap['items'] = {}): PosKeymap {
  return { actions: { ...POS_DEFAULT_KEYMAP.actions, ...actions }, items };
}

function refusal(keymap: PosKeymap): string {
  const result = validateKeymap(keymap);
  return 'refused' in result ? result.refused.join(' ') : '';
}

describe('normalizeKey', () => {
  it('stores one spelling per key', () => {
    expect(normalizeKey('shift+f1')).toBe('Shift+F1');
    expect(normalizeKey('F1+Shift')).toBeNull();
    expect(normalizeKey('alt+ctrl+k')).toBe('Ctrl+Alt+K');
    expect(normalizeKey('d')).toBe('D');
    expect(normalizeKey('delete')).toBe('Delete');
  });

  it('handles the "+" key itself', () => {
    expect(normalizeKey('+')).toBe('+');
    expect(normalizeKey('Shift++')).toBe('Shift++');
  });

  it('refuses what is not a key', () => {
    expect(normalizeKey('')).toBeNull();
    expect(normalizeKey('F13')).toBeNull();
    expect(normalizeKey('Hyper+A')).toBeNull();
  });
});

describe('validateKeymap', () => {
  it('⚠ accepts the defaults — a store that changes nothing must have a valid till', () => {
    expect(validateKeymap(POS_DEFAULT_KEYMAP)).toEqual({ keymap: POS_DEFAULT_KEYMAP });
  });

  it('⚠ refuses the browser’s keys: reload, full screen, developer tools, print, switching tabs', () => {
    expect(refusal(withActions({ pay: 'F5' }))).toContain('belongs to the browser');
    expect(refusal(withActions({ pay: 'F12' }))).toContain('belongs to the browser');
    expect(refusal(withActions({ lineNote: 'Ctrl+P' }))).toContain('belongs to the browser');
    expect(refusal(withActions({ lineNote: 'Alt+1' }))).toContain('switches browser tabs');
  });

  it('refuses rebinding a fixed key — the way out of a dialog is never lost', () => {
    expect(refusal(withActions({ lineNote: 'Escape' }))).toContain('fixed');
  });

  it('⚠ refuses a letter on a global action — it would type into search', () => {
    expect(refusal(withActions({ pay: 'P' }))).toContain('would type into search');
  });

  it('refuses one key for two actions where they meet, allows it in separate zones', () => {
    expect(refusal(withActions({ hold: 'F9' }))).toContain('F9 is used twice');
    // `P` prints in the receipt and is free in the cart: separate zones.
    expect(validateKeymap(withActions({ lineNote: 'P' }))).toHaveProperty('keymap');
  });

  it('takes item keys on function keys only, never clashing with an action', () => {
    const bag = { itemId: 'bag', variantId: null };
    expect(validateKeymap(withActions({}, { 'shift+f1': bag }))).toEqual({
      keymap: withActions({}, { 'Shift+F1': bag }),
    });
    expect(refusal(withActions({}, { B: bag }))).toContain('use a function key');
    expect(refusal(withActions({}, { F9: bag }))).toContain('F9 is used twice');
  });

  it('needs a key for every action', () => {
    expect(refusal(withActions({ hold: '' }))).toContain('“Hold” needs a key');
  });
});

describe('effectiveKeymap', () => {
  it('fills actions a saved keymap does not name with their defaults', () => {
    const saved = { actions: { ...POS_DEFAULT_KEYMAP.actions, pay: 'F10' }, items: {} };
    expect(effectiveKeymap(saved).actions.pay).toBe('F10');
    expect(effectiveKeymap(null)).toBe(POS_DEFAULT_KEYMAP);
  });
});
