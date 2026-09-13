import {
  advance,
  checkNumberInLine,
  freshPosition,
  nextToCall,
  positionForNextNumber,
  startingPosition,
} from '../src/domain/numbering.js';
import type { SequencePosition } from '../src/types.js';

const line = { startNumber: 1, endNumber: 999 };

/** `isCalled` over a literal: cycle → numbers called in it. */
const called =
  (byCycle: Record<number, number[]>) =>
  (cycle: number, number: number): boolean =>
    byCycle[cycle]?.includes(number) ?? false;

const nothingCalled = called({});

describe('advance', () => {
  it('starts a fresh line at its first number', () => {
    expect(freshPosition(line)).toEqual({ lastNumber: 0, cycle: 0 });
    expect(advance(freshPosition(line), line)).toEqual({ lastNumber: 1, cycle: 0 });
  });

  it('steps one number at a time', () => {
    expect(advance({ lastNumber: 41, cycle: 0 }, line)).toEqual({ lastNumber: 42, cycle: 0 });
  });

  it('wraps after the last number into a new cycle, so two 7s are two tickets', () => {
    expect(advance({ lastNumber: 999, cycle: 0 }, line)).toEqual({ lastNumber: 1, cycle: 1 });
  });

  it('jumps up to a raised start in the SAME cycle, because nothing wrapped', () => {
    expect(advance({ lastNumber: 3, cycle: 2 }, { startNumber: 100, endNumber: 999 })).toEqual({
      lastNumber: 100,
      cycle: 2,
    });
  });
});

describe('nextToCall', () => {
  it('calls the next number when nothing got ahead of it', () => {
    expect(nextToCall({ lastNumber: 56, cycle: 0 }, line, nothingCalled)).toEqual({ lastNumber: 57, cycle: 0 });
  });

  /**
   * ⚠ The operator's rule. Calling 57 twice sends a second person looking for a
   * turn that has already happened.
   */
  it('⚠ SKIPS a number already called out of order in this cycle', () => {
    expect(nextToCall({ lastNumber: 56, cycle: 0 }, line, called({ 0: [57] }))).toEqual({ lastNumber: 58, cycle: 0 });
  });

  it('skips a run of called numbers', () => {
    expect(nextToCall({ lastNumber: 56, cycle: 0 }, line, called({ 0: [57, 58, 59] }))).toEqual({
      lastNumber: 60,
      cycle: 0,
    });
  });

  it('skips into the wrap when the end of the range was already called', () => {
    expect(nextToCall({ lastNumber: 998, cycle: 0 }, line, called({ 0: [999] }))).toEqual({ lastNumber: 1, cycle: 1 });
  });

  it('does NOT skip a number called in an earlier cycle', () => {
    expect(nextToCall({ lastNumber: 999, cycle: 0 }, line, called({ 0: [1, 2] }))).toEqual({ lastNumber: 1, cycle: 1 });
  });

  it('answers null rather than inventing a number when isCalled claims everything', () => {
    expect(nextToCall({ lastNumber: 0, cycle: 0 }, { startNumber: 1, endNumber: 3 }, () => true)).toBeNull();
  });
});

describe('checkNumberInLine', () => {
  it.each([
    [0, 'out_of_range'],
    [1000, 'out_of_range'],
    [4.5, 'not_a_whole_number'],
    [Number.NaN, 'not_a_whole_number'],
    [1, null],
    [999, null],
  ])('%s → %s', (number, expected) => {
    expect(checkNumberInLine(number, line)).toBe(expected);
  });
});

describe('positionForNextNumber — "set a line\'s next number"', () => {
  const current: SequencePosition = { lastNumber: 87, cycle: 2 };

  it('makes Call next call exactly that number', () => {
    const result = positionForNextNumber(150, line, current);
    if (!('position' in result)) throw new Error('expected a position');

    expect(result.position).toEqual({ lastNumber: 149, cycle: 2 });
    expect(nextToCall(result.position, line, nothingCalled)).toEqual({ lastNumber: 150, cycle: 2 });
  });

  it("can set the next number to the line's first", () => {
    const result = positionForNextNumber(1, line, current);
    if (!('position' in result)) throw new Error('expected a position');
    expect(nextToCall(result.position, line, nothingCalled)).toEqual({ lastNumber: 1, cycle: 2 });
  });

  it('refuses a number the line does not have', () => {
    expect(positionForNextNumber(1000, line, current)).toEqual({ refused: 'out_of_range' });
    expect(positionForNextNumber(2.5, line, current)).toEqual({ refused: 'not_a_whole_number' });
  });

  it('⚠ keeps the cycle, so setting it back onto called numbers still skips them', () => {
    const result = positionForNextNumber(10, line, current);
    if (!('position' in result)) throw new Error('expected a position');
    expect(nextToCall(result.position, line, called({ 2: [10, 11] }))).toEqual({ lastNumber: 12, cycle: 2 });
  });
});

describe('startingPosition — a new session', () => {
  const previous: SequencePosition = { lastNumber: 87, cycle: 3 };

  it('starts every line fresh by default', () => {
    expect(startingPosition(line, previous, false)).toEqual({ lastNumber: 0, cycle: 0 });
  });

  it('carries the last number on when Continue numbering is ticked, restarting the cycle', () => {
    expect(startingPosition(line, previous, true)).toEqual({ lastNumber: 87, cycle: 0 });
  });

  it('starts fresh when there is nothing to continue from', () => {
    expect(startingPosition(line, null, true)).toEqual({ lastNumber: 0, cycle: 0 });
  });

  it('starts fresh when the line was edited so the old number is no longer in it', () => {
    expect(startingPosition({ startNumber: 1, endNumber: 50 }, previous, true)).toEqual({ lastNumber: 0, cycle: 0 });
    expect(startingPosition({ startNumber: 100, endNumber: 999 }, previous, true)).toEqual({
      lastNumber: 99,
      cycle: 0,
    });
  });
});
