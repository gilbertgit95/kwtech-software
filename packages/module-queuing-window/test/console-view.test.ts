import type { QueueLineView, QueueTicketView } from '../src/react/queue-client.js';
import {
  displayLink,
  isTypingTarget,
  linesServedBy,
  servingAt,
  sessionAge,
  spaceLine,
} from '../src/react/view/console-view.js';

/**
 * The console's view rules. None of them is the check — the API refuses on its
 * own — but each decides what somebody at a counter sees and presses.
 */

const line = (id: string, prefix: string, archived = false): QueueLineView => ({
  id,
  name: prefix,
  prefix,
  startNumber: 1,
  endNumber: 999,
  padTo: 3,
  sortOrder: 0,
  archived,
});

const ticket = (windowId: string, lineId: string): QueueTicketView => ({
  id: `t-${windowId}`,
  lineId,
  label: 'C-001',
  number: 1,
  cycle: 0,
  status: 'called',
  windowId,
  windowName: 'Window 3',
  calledAt: '2026-09-13T09:00:00Z',
  recallCount: 0,
});

const C = line('c', 'C');
const E = line('e', 'E');
const OLD = line('o', 'O', true);

describe('linesServedBy', () => {
  it('serves every live line when a window names none', () => {
    expect(linesServedBy({ lineIds: [] }, [C, E, OLD]).map((one) => one.prefix)).toEqual(['C', 'E']);
  });

  it('serves only the named lines, and never an archived one', () => {
    expect(linesServedBy({ lineIds: ['e', 'o'] }, [C, E, OLD]).map((one) => one.prefix)).toEqual(['E']);
  });
});

describe('servingAt', () => {
  it("finds a window's current ticket, or null", () => {
    const view = { serving: [ticket('w3', 'c')] };
    expect(servingAt(view, 'w3')?.id).toBe('t-w3');
    expect(servingAt(view, 'w4')).toBeNull();
  });
});

describe('spaceLine — which line Space calls from', () => {
  it('uses the only line a window serves', () => {
    expect(spaceLine([C], null)?.prefix).toBe('C');
  });

  it("uses the current ticket's line when the window serves several", () => {
    expect(spaceLine([C, E], ticket('w3', 'e'))?.prefix).toBe('E');
  });

  it('⚠ picks nothing rather than guessing between two lines', () => {
    expect(spaceLine([C, E], null)).toBeNull();
  });

  it('ignores a current ticket from a line the window no longer serves', () => {
    expect(spaceLine([C, E], ticket('w3', 'gone'))).toBeNull();
  });
});

describe('sessionAge — §12.68, a session nobody stopped', () => {
  const at = (day: number, hour: number) => new Date(2026, 8, day, hour, 0).toISOString();
  const now = new Date(2026, 8, 13, 9, 30);

  it.each([
    ['this morning', at(13, 7), 'today'],
    ['late last night', at(12, 23), 'yesterday'],
    ['the day before', at(11, 8), 'older'],
  ])('reads a start %s as %s', (_label, startedAt, expected) => {
    expect(sessionAge(startedAt, now)).toBe(expected);
  });
});

describe('displayLink', () => {
  it('⚠ puts the code in the FRAGMENT, undashed, so it never reaches a server log', () => {
    expect(displayLink('https://app.example.com/', '/queue-display/acme/main', 'K7QM-4XHT')).toBe(
      'https://app.example.com/queue-display/acme/main#code=K7QM4XHT',
    );
  });
});

describe('isTypingTarget — when Space is not Call next', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'])('stands aside for %s', (tagName) => {
    expect(isTypingTarget({ tagName } as unknown as EventTarget)).toBe(true);
  });

  it('stands aside for anything editable', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('takes Space everywhere else', () => {
    expect(isTypingTarget({ tagName: 'BODY', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
