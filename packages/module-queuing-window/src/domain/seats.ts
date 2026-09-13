import type { SeatView, WindowView } from '../types.js';

/**
 * Who sits at which window.
 *
 * Windows are ASSIGNED through a role (§12.63), by a holder of
 * `queue:assign_windows` — yourself included. A role meant to let staff seat
 * themselves carries both that and `queue:serve`; no setting decides it.
 *
 * ⚠ Seats PERSIST across sessions. Stop queuing never releases one; only an
 * assigner, or the holder, ends a seat.
 */

export type AssignmentRefusal = 'window_archived' | 'only_yourself' | 'cannot_serve' | 'occupied';

export type AssignmentPlan =
  | { kind: 'refused'; reason: Exclude<AssignmentRefusal, 'occupied'> }
  | { kind: 'refused'; reason: 'occupied'; occupantId: string }
  | { kind: 'unchanged' }
  | {
      kind: 'assign';
      windowId: string;
      userId: string;
      replacedUserId: string | null;
      movedFromWindowId: string | null;
    };

export interface AssignmentInput {
  actorId: string;
  assigneeId: string;
  window: Pick<WindowView, 'id' | 'archivedAt'>;
  /** Every seat in the workspace. */
  seats: readonly SeatView[];
  /**
   * Whether the assignee is a workspace member holding `queue:serve` there,
   * from the app's `QueueStaffCheck` — or NULL when the app bound none.
   *
   * ⚠ The module cannot answer this itself: membership and grants live in
   * `module-permissions`' tables. Unbound, you may assign only YOURSELF — the
   * guard has proven you, and anybody else is someone the module cannot vouch
   * for. Fail closed.
   */
  assigneeCanServe: boolean | null;
  /** The assigner confirmed "Move X off Window 3?". */
  confirmReplace: boolean;
}

/**
 * What an assignment does, or why it is refused.
 *
 * ⚠ ASSIGNING AN OCCUPIED WINDOW REPLACES THE OCCUPANT, after a confirmation.
 * The assigner has that authority, and refusing would only force a second step
 * to free the window first. Without confirmation the answer names the occupant,
 * so the console can ask the question.
 *
 * ⚠ ASSIGNING SOMEBODY WHO SITS ELSEWHERE MOVES THEM. Both constraints stand —
 * one person per window, one window per person — so their old seat is vacated
 * in the same write.
 *
 * ⚠ Checked when made, never re-checked. Somebody who later loses `queue:serve`
 * keeps the seat, and the guard refuses their Call next (§12.62).
 */
export function planAssignment(input: AssignmentInput): AssignmentPlan {
  const { actorId, assigneeId, window, seats, assigneeCanServe, confirmReplace } = input;

  if (window.archivedAt) return { kind: 'refused', reason: 'window_archived' };
  if (assigneeCanServe === null && assigneeId !== actorId) return { kind: 'refused', reason: 'only_yourself' };
  // Bound, the check applies to everybody — a seat you cannot serve from is a
  // window that looks staffed and is not.
  if (assigneeCanServe === false) return { kind: 'refused', reason: 'cannot_serve' };

  const occupant = seats.find((seat) => seat.windowId === window.id);
  if (occupant?.userId === assigneeId) return { kind: 'unchanged' };
  if (occupant && !confirmReplace) return { kind: 'refused', reason: 'occupied', occupantId: occupant.userId };

  const current = seats.find((seat) => seat.userId === assigneeId);
  return {
    kind: 'assign',
    windowId: window.id,
    userId: assigneeId,
    replacedUserId: occupant?.userId ?? null,
    movedFromWindowId: current?.windowId ?? null,
  };
}

/**
 * May this person free this seat?
 *
 * Your own, always, with no key: ending a shift is not a permission, and
 * withholding it would be a lockout dressed as one. Anybody else's needs
 * `queue:assign_windows`.
 */
export function canReleaseSeat(actorId: string, seat: SeatView, holdsAssignWindows: boolean): boolean {
  return seat.userId === actorId || holdsAssignWindows;
}

/** The window this person is assigned, or null — "You are not assigned a window". */
export function seatWindowOf(userId: string, seats: readonly SeatView[]): string | null {
  return seats.find((seat) => seat.userId === userId)?.windowId ?? null;
}
