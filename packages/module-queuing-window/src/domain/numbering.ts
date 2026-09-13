import type { LineView, SequencePosition } from '../types.js';

/**
 * Where a line's numbering stands, and what Call next calls.
 *
 * A POSITION is `(lastNumber, cycle)`: the number Call next allocated most
 * recently, and the pass through the line's range it belongs to.
 *
 * ## How the server uses this (step 4)
 *
 * ⚠ A NUMBER IS ALLOCATED BY A CONDITIONAL UPDATE, never read-then-write. The
 * server reads the position, asks `nextToCall` for the next one, and moves
 * `QueueSequence` from the position it read to the one it got in a single
 * statement. Matching zero rows means somebody else called first, so it reads
 * again. The ticket's unique `(lineId, sessionId, cycle, number)` is the
 * backstop: a violation there (a Call number… landing on the same number at the
 * same moment) is also a retry. Two staff pressing Call next in the same
 * millisecond is the normal case at opening time, not an edge case.
 */

type Bounds = Pick<LineView, 'startNumber' | 'endNumber'>;

/** Nothing called yet: the next number is the line's first. */
export function freshPosition(line: Bounds): SequencePosition {
  return { lastNumber: line.startNumber - 1, cycle: 0 };
}

/**
 * One step forward, wrapping.
 *
 * Past `endNumber` it returns to `startNumber` in the next cycle, so the
 * morning's 7 and the afternoon's 7 are different tickets. Below `startNumber`
 * — the line's start was raised after numbering began — it jumps to the start
 * in the SAME cycle, because nothing wrapped.
 */
export function advance(position: SequencePosition, line: Bounds): SequencePosition {
  const next = position.lastNumber + 1;
  if (next > line.endNumber) return { lastNumber: line.startNumber, cycle: position.cycle + 1 };
  if (next < line.startNumber) return { lastNumber: line.startNumber, cycle: position.cycle };
  return { lastNumber: next, cycle: position.cycle };
}

/**
 * The number Call next calls: the next one not already called in its cycle.
 *
 * ⚠ SKIPS NUMBERS ALREADY CALLED. If 57 was called out of order with Call
 * number…, the sequence steps from 56 straight to 58. Calling 57 twice sends a
 * second person looking for a turn that has already happened.
 *
 * `isCalled` answers for one cycle, so a number called before the wrap is not
 * skipped after it.
 *
 * Null only when `isCalled` claims every number in the rest of this cycle AND
 * all of the next. A cycle starts empty, so that means the caller's answer is
 * wrong, and inventing a number would hide it.
 */
export function nextToCall(
  position: SequencePosition,
  line: Bounds,
  isCalled: (cycle: number, number: number) => boolean,
): SequencePosition | null {
  const size = line.endNumber - line.startNumber + 1;
  let candidate = advance(position, line);
  for (let step = 0; step < size * 2; step += 1) {
    if (!isCalled(candidate.cycle, candidate.lastNumber)) return candidate;
    candidate = advance(candidate, line);
  }
  return null;
}

export type NumberRefusal = 'not_a_whole_number' | 'out_of_range';

/** Whether a number belongs to this line at all — for Call number… and setting the next number. */
export function checkNumberInLine(number: number, line: Bounds): NumberRefusal | null {
  if (!Number.isInteger(number)) return 'not_a_whole_number';
  if (number < line.startNumber || number > line.endNumber) return 'out_of_range';
  return null;
}

/**
 * The position that makes Call next call `next` — "set a line's next number".
 *
 * The paper and the system drift: the guard starts a fresh roll at 150, or
 * throws away a torn slip. Without this, the only way to realign the board with
 * the slips in people's hands is to press Call next again and again, marking
 * each a no-show.
 *
 * ⚠ THE CYCLE IS KEPT. Setting the next number back onto numbers already called
 * in this cycle does not re-call them: Call next still skips them. Reusing them
 * takes a wrap or a new session.
 */
export function positionForNextNumber(
  next: number,
  line: Bounds,
  current: SequencePosition,
): { position: SequencePosition } | { refused: NumberRefusal } {
  const refused = checkNumberInLine(next, line);
  if (refused) return { refused };
  return { position: { lastNumber: next - 1, cycle: current.cycle } };
}

/**
 * Where a line starts in a new session.
 *
 * Numbering belongs to the session, so by default every Start begins each line
 * at its `startNumber`. ⚠ The cost is a mistaken restart: a supervisor who
 * stops and starts at 11am would send the board back to 1 while the slips are
 * at 87. Continue numbering, off by default, carries the last session's
 * position on.
 *
 * The cycle restarts either way: tickets are unique per session, so the new
 * session's cycle 0 cannot collide with the old one's.
 *
 * A previous position outside the line's CURRENT range — the line was edited
 * between sessions — starts fresh rather than calling a number the line no
 * longer has.
 */
export function startingPosition(
  line: Bounds,
  previous: SequencePosition | null | undefined,
  continueNumbering: boolean,
): SequencePosition {
  if (!continueNumbering || !previous) return freshPosition(line);
  if (previous.lastNumber < line.startNumber - 1 || previous.lastNumber > line.endNumber) {
    return freshPosition(line);
  }
  return { lastNumber: previous.lastNumber, cycle: 0 };
}
