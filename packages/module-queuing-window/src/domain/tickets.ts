import type { TicketStatus, TicketView } from '../types.js';

/**
 * What happens to a number once it is called.
 *
 * The WHOLE state machine is `called → done | no_show`, and `no_show → called`
 * for a re-call. There is no `waiting`, `serving` or `cancelled`: numbers are
 * handed out outside the system (§12.58), so a ticket is born called, and a
 * state nothing writes is a state everybody assumes something does.
 */

export type TicketTransition = 'recall' | 'done' | 'no_show' | 'call_again';

/**
 * The next status, or null when the move is not available from here — which a
 * caller turns into a refusal, because "that ticket is already done" and
 * "nothing changed" are different answers.
 */
export function nextTicketStatus(current: TicketStatus, transition: TicketTransition): TicketStatus | null {
  switch (transition) {
    case 'recall':
      // Announce the same ticket again, at the same window. Counted, not a new call.
      return current === 'called' ? 'called' : null;
    case 'done':
      return current === 'called' ? 'done' : null;
    case 'no_show':
      return current === 'called' ? 'no_show' : null;
    case 'call_again':
      // The person who stepped out comes back. The same row, not a second one.
      return current === 'no_show' ? 'called' : null;
  }
}

export type TicketActRefusal = 'no_window' | 'not_your_window' | 'not_available';

/**
 * May the person at `seatWindowId` do `transition` to this ticket?
 *
 * The KEY — `queue:serve` — is the guard's question. This is the other half:
 * holding the key without a seat is "You are not assigned a window".
 *
 * ⚠ RECALL, DONE AND NO-SHOW BELONG TO THE WINDOW THE TICKET WAS CALLED TO.
 * Window 5 marking Window 3's customer a no-show while they walk up to Window 3
 * is exactly the confusion a queue exists to prevent. A no-show is the
 * exception: once nobody came, any window may call the number again, and the
 * ticket moves to that window.
 */
export function checkTicketAct(
  ticket: Pick<TicketView, 'status' | 'windowId'>,
  transition: TicketTransition,
  seatWindowId: string | null | undefined,
): TicketActRefusal | null {
  if (!seatWindowId) return 'no_window';
  if (transition !== 'call_again' && ticket.windowId !== seatWindowId) return 'not_your_window';
  if (nextTicketStatus(ticket.status, transition) === null) return 'not_available';
  return null;
}

export type CallNumberPlan =
  | { kind: 'create' }
  | { kind: 'recall'; ticketId: string }
  | { kind: 'call_again'; ticketId: string }
  | { kind: 'refused'; reason: 'already_served' | 'called_elsewhere' };

/**
 * What Call number… does with a number, given the ticket that already holds it
 * in the current cycle, if any.
 *
 * It calls any number, ahead or behind: the person who stepped out, or someone
 * arriving with a number already passed.
 *
 * ⚠ A NUMBER ALREADY CALLED IS NEVER A SECOND ROW. A no-show is called again; a
 * ticket still called at this window is a recall; one called at ANOTHER window
 * is refused, because two windows calling one customer sends them to both. A
 * done ticket is refused: that person was served.
 */
export function planCallNumber(
  existing: Pick<TicketView, 'id' | 'status' | 'windowId'> | null | undefined,
  windowId: string,
): CallNumberPlan {
  if (!existing) return { kind: 'create' };
  switch (existing.status) {
    case 'no_show':
      return { kind: 'call_again', ticketId: existing.id };
    case 'done':
      return { kind: 'refused', reason: 'already_served' };
    case 'called':
      return existing.windowId === windowId
        ? { kind: 'recall', ticketId: existing.id }
        : { kind: 'refused', reason: 'called_elsewhere' };
  }
}
