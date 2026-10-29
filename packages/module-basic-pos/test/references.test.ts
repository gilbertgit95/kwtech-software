import {
  heldReferenceKeys,
  matchReferenceOptions,
  POS_REFERENCE_OPTIONS_MAX,
  posReferenceKey,
  readReferenceOptions,
  snapToReferenceOption,
  validateReferenceOptions,
} from '../src/domain/references.js';
import { POS_LABEL_MAX } from '../src/domain/text.js';

const OPTIONS = ['Table 1', 'Table 2', 'Table 12', 'Take-out', 'Pickup'];

function refusal(raw: readonly string[]): string {
  const result = validateReferenceOptions(raw);
  return 'refused' in result ? result.refused.join(' ') : '';
}

describe('validateReferenceOptions', () => {
  it('stores each option as a label is stored, in the order given', () => {
    expect(validateReferenceOptions(['  Table \n 1 ', 'Take-out'])).toEqual({ options: ['Table 1', 'Take-out'] });
    expect(validateReferenceOptions([])).toEqual({ options: [] });
  });

  it('⚠ refuses two options that differ only in case or spacing', () => {
    expect(refusal(['Table 3', 'table  3'])).toBe('“table 3” is in the list twice.');
  });

  it('refuses an empty option, an over-long one and a hidden character — every problem at once', () => {
    const problems = refusal([' ', 'x'.repeat(POS_LABEL_MAX + 1), 'T​3']);
    expect(problems).toContain('Option 1 is empty.');
    expect(problems).toContain(`at most ${POS_LABEL_MAX} characters`);
    expect(problems.match(/at most/g)).toHaveLength(2);
  });

  it('caps how many a store keeps', () => {
    const many = Array.from({ length: POS_REFERENCE_OPTIONS_MAX + 1 }, (_, n) => `Table ${n + 1}`);
    expect(refusal(many)).toBe(`At most ${POS_REFERENCE_OPTIONS_MAX} options.`);
    expect(validateReferenceOptions(many.slice(1))).toHaveProperty('options');
  });
});

describe('readReferenceOptions', () => {
  it('⚠ keeps what still passes rather than dropping the whole list', () => {
    expect(readReferenceOptions(['Table 1', 7, '', 'table 1', 'Pickup'])).toEqual(['Table 1', 'Pickup']);
  });

  it('reads anything but a list as none', () => {
    expect(readReferenceOptions(null)).toEqual([]);
    expect(readReferenceOptions({ 0: 'Table 1' })).toEqual([]);
  });

  it('keeps no more than the cap', () => {
    const many = Array.from({ length: POS_REFERENCE_OPTIONS_MAX + 5 }, (_, n) => `T${n}`);
    expect(readReferenceOptions(many)).toHaveLength(POS_REFERENCE_OPTIONS_MAX);
  });
});

describe('matching and snapping', () => {
  it('matches what holds the typed text, ignoring case and spacing, in the store’s order', () => {
    expect(matchReferenceOptions(OPTIONS, 'table 1')).toEqual(['Table 1', 'Table 12']);
    expect(matchReferenceOptions(OPTIONS, 'OUT')).toEqual(['Take-out']);
    expect(matchReferenceOptions(OPTIONS, '  ')).toEqual(OPTIONS);
    expect(matchReferenceOptions(OPTIONS, 'red cap')).toEqual([]);
  });

  it('⚠ saves an option’s own spelling for text that is the option — one spelling per table', () => {
    expect(snapToReferenceOption(OPTIONS, ' table  12 ')).toBe('Table 12');
    expect(snapToReferenceOption(OPTIONS, 'table 1x')).toBe('table 1x');
    expect(snapToReferenceOption([], 'table 1')).toBe('table 1');
    expect(snapToReferenceOption(OPTIONS, '')).toBe('');
  });
});

describe('heldReferenceKeys', () => {
  const held = [
    { id: 'a', label: 'table 3' },
    { id: 'b', label: null },
    { id: 'c', label: 'Pickup' },
  ];

  it('collects the references of orders on hold', () => {
    expect([...heldReferenceKeys(held, null)]).toEqual(['table 3', 'pickup']);
    expect(heldReferenceKeys(held, null).has(posReferenceKey('Table 3'))).toBe(true);
  });

  it('⚠ leaves out the order on the till, even a resumed held one', () => {
    expect(heldReferenceKeys(held, 'a').has('table 3')).toBe(false);
  });
});
