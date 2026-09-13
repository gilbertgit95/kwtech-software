import { checkTicketAct, nextTicketStatus, planCallNumber, type TicketTransition } from '../src/domain/tickets.js';
import { TICKET_STATUSES, type TicketStatus } from '../src/types.js';

const TRANSITIONS: TicketTransition[] = ['recall', 'done', 'no_show', 'call_again'];

describe('nextTicketStatus', () => {
  it('is the whole state machine and nothing more', () => {
    const table = Object.fromEntries(
      TICKET_STATUSES.map((status) => [
        status,
        Object.fromEntries(TRANSITIONS.map((transition) => [transition, nextTicketStatus(status, transition)])),
      ]),
    );

    expect(table).toEqual({
      called: { recall: 'called', done: 'done', no_show: 'no_show', call_again: null },
      done: { recall: null, done: null, no_show: null, call_again: null },
      no_show: { recall: null, done: null, no_show: null, call_again: 'called' },
    });
  });

  it('⚠ has no waiting, serving or cancelled — a state nothing writes is a state everybody assumes something does', () => {
    expect([...TICKET_STATUSES].sort()).toEqual(['called', 'done', 'no_show']);
  });
});

describe('checkTicketAct', () => {
  const ticket = (status: TicketStatus, windowId = 'w3') => ({ status, windowId });

  it('refuses somebody with no seat — "You are not assigned a window"', () => {
    expect(checkTicketAct(ticket('called'), 'done', null)).toBe('no_window');
  });

  it('⚠ keeps recall, done and no-show at the window the ticket was called to', () => {
    for (const transition of ['recall', 'done', 'no_show'] as const) {
      expect(checkTicketAct(ticket('called'), transition, 'w5')).toBe('not_your_window');
      expect(checkTicketAct(ticket('called'), transition, 'w3')).toBeNull();
    }
  });

  it('lets ANY window call a no-show again', () => {
    expect(checkTicketAct(ticket('no_show'), 'call_again', 'w5')).toBeNull();
  });

  it('refuses a move the state machine does not have', () => {
    expect(checkTicketAct(ticket('done'), 'done', 'w3')).toBe('not_available');
    expect(checkTicketAct(ticket('called'), 'call_again', 'w3')).toBe('not_available');
  });
});

describe('planCallNumber', () => {
  it('creates a ticket for a number nobody has called in this cycle', () => {
    expect(planCallNumber(null, 'w3')).toEqual({ kind: 'create' });
  });

  it('⚠ calls a no-show AGAIN, on the same row, from any window', () => {
    expect(planCallNumber({ id: 't1', status: 'no_show', windowId: 'w1' }, 'w3')).toEqual({
      kind: 'call_again',
      ticketId: 't1',
    });
  });

  it('treats a number still called at this window as a recall', () => {
    expect(planCallNumber({ id: 't1', status: 'called', windowId: 'w3' }, 'w3')).toEqual({
      kind: 'recall',
      ticketId: 't1',
    });
  });

  it('⚠ refuses a number called at another window — one customer, two windows', () => {
    expect(planCallNumber({ id: 't1', status: 'called', windowId: 'w1' }, 'w3')).toEqual({
      kind: 'refused',
      reason: 'called_elsewhere',
    });
  });

  it('refuses a number already served', () => {
    expect(planCallNumber({ id: 't1', status: 'done', windowId: 'w3' }, 'w3')).toEqual({
      kind: 'refused',
      reason: 'already_served',
    });
  });
});
