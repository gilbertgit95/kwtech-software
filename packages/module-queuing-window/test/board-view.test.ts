import { CALL_CHIME_MS, CALL_CHIME_PEAK, QUEUE_CALL_CHIME } from '../src/react/call-chime.js';
import {
  codeFromFragment,
  displayStorageKeys,
  filterBoard,
  isPulsing,
  isStale,
  PULSE_MS,
  parseStoredFilter,
  parseStoredPass,
  type QueueBoardCallView,
  type QueueBoardView,
  STALE_AFTER_MS,
  servingRows,
  spokenCall,
  spokenLabel,
} from '../src/react/view/board-view.js';

/**
 * The public board's rules. Every one decides what a waiting room sees or hears,
 * and the failures they prevent all look like a working TV.
 */

const call = (over: Partial<QueueBoardCallView>): QueueBoardCallView => ({
  ticketId: 't1',
  lineId: 'c',
  label: 'C-001',
  windowId: 'w1',
  windowName: 'Window 1',
  calledAt: '2026-09-13T09:00:00Z',
  recallCount: 0,
  nickname: null,
  ...over,
});

const board = (serving: QueueBoardCallView[], recent: QueueBoardCallView[] = serving): QueueBoardView => ({
  showStaffNames: false,
  lines: [
    { id: 'c', prefix: 'C', name: 'Cashier' },
    { id: 'e', prefix: 'E', name: 'Enrollment' },
  ],
  serving,
  recent,
});

const PASS = 'p'.repeat(43);

describe('what a TV keeps', () => {
  it('⚠ keeps the pass and the line filter under SEPARATE keys, so Stop can drop one and keep the other', () => {
    const keys = displayStorageKeys('acme', 'main');
    expect(keys.pass).not.toBe(keys.filter);
    expect(keys.pass).toContain('acme/main');
    expect(displayStorageKeys('acme', 'annex').pass).not.toBe(keys.pass);
  });

  it('reads back a stored pass, and treats anything else as none', () => {
    expect(parseStoredPass(JSON.stringify({ pass: PASS, workspaceName: 'Main' }))).toEqual({
      pass: PASS,
      workspaceName: 'Main',
    });
    expect(parseStoredPass(JSON.stringify({ pass: 'K7QM4XHT', workspaceName: 'Main' }))).toBeNull();
    expect(parseStoredPass('not json')).toBeNull();
    expect(parseStoredPass(null)).toBeNull();
  });

  it('reads back a filter, dropping anything that is not a line id', () => {
    expect(parseStoredFilter(JSON.stringify(['c', 4, null, 'e']))).toEqual(['c', 'e']);
    expect(parseStoredFilter('{')).toEqual([]);
  });
});

describe('codeFromFragment', () => {
  it('reads the code a QR link carried in the fragment', () => {
    expect(codeFromFragment('#code=K7QM4XHT')).toBe('K7QM4XHT');
  });

  it.each([[''], ['#'], ['#other=1'], ['#code=']])('finds nothing in %j', (hash) => {
    expect(codeFromFragment(hash)).toBeNull();
  });
});

describe('the board on screen', () => {
  it('⚠ filters by line on THIS screen only, and shows everything with no filter', () => {
    const full = board([call({ lineId: 'c' }), call({ ticketId: 't2', lineId: 'e', windowId: 'w2' })]);
    expect(filterBoard(full, []).serving).toHaveLength(2);
    expect(filterBoard(full, ['c']).serving.map((row) => row.lineId)).toEqual(['c']);
    expect(filterBoard(full, ['c']).recent.map((row) => row.lineId)).toEqual(['c']);
  });

  it('keeps rows in window order, so nobody re-finds their window on every call', () => {
    const rows = servingRows(
      board([
        call({ windowName: 'Window 10', windowId: 'w10' }),
        call({ windowName: 'Window 2', windowId: 'w2' }),
        call({ windowName: 'window 1', windowId: 'w1' }),
      ]),
    );
    expect(rows.map((row) => row.windowName)).toEqual(['window 1', 'Window 2', 'Window 10']);
  });

  it('⚠ looks stale after being disconnected for a while — and not before', () => {
    expect(isStale(null, 1_000_000)).toBe(false);
    expect(isStale(1_000_000, 1_000_000 + STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale(1_000_000, 1_000_000 + STALE_AFTER_MS)).toBe(true);
  });

  it('pulses the newest call for a while, and only that one', () => {
    const announced = { ticketId: 't1', at: 1_000_000 };
    expect(isPulsing(announced, 't1', 1_000_000 + PULSE_MS - 1)).toBe(true);
    expect(isPulsing(announced, 't1', 1_000_000 + PULSE_MS)).toBe(false);
    expect(isPulsing(announced, 't2', 1_000_000)).toBe(false);
    expect(isPulsing(null, 't1', 1_000_000)).toBe(false);
  });
});

describe('what the TV says', () => {
  it('⚠ reads a label digit by digit — "C-042" is not "C minus forty-two"', () => {
    expect(spokenLabel('C-042')).toBe('C, zero four two');
    expect(spokenLabel('AB-7')).toBe('A B, seven');
  });

  it('announces the number and the window', () => {
    expect(spokenCall({ label: 'C-042', windowName: 'Window 3' })).toBe(
      'Number C, zero four two, please proceed to Window 3.',
    );
  });
});

describe('the call chime', () => {
  it('⚠ gives every frequency a positive value, because a zero would silently throw at playback', () => {
    for (const note of QUEUE_CALL_CHIME.notes) {
      expect(note.hz).toBeGreaterThan(0);
      if (note.toHz !== undefined) expect(note.toHz).toBeGreaterThan(0);
    }
  });

  it('finishes within a second and a half, and is louder than a desk tone but under the ceiling', () => {
    expect(CALL_CHIME_MS).toBeLessThanOrEqual(1500);
    expect(CALL_CHIME_PEAK).toBeGreaterThan(0.14);
    expect(CALL_CHIME_PEAK).toBeLessThanOrEqual(0.5);
  });
});
