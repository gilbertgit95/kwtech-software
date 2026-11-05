/**
 * PUTTING A TAPPED ORDER ON THE TILL, SAFELY (CodeRabbit on #70): the rules
 * `useTill`'s `resume` follows, pure here so the races are tested without
 * rendering anything (there are no React render tests in this repo).
 *
 * The read is slow and the till keeps moving, so an answer is put on the till
 * only while nothing has overtaken it:
 *
 * - **not while an act runs** — its answer is about to be put on the till;
 * - **only the latest tap** — two quick taps start two reads, and the first
 *   can answer last;
 * - **not after the till moved on** — an act started, or the till was
 *   cleared, after the read began.
 *
 * Anything overtaken is dropped and reported as not opened, so the caller
 * opens no sheet for it.
 */

/** Numbers each read; a read is current only while its number is the latest. */
export interface PosResumeGuard {
  /** A ticket for a new read, or null while an act runs (no read starts). */
  begin(actRunning: boolean): number | null;
  /** True while nothing has overtaken this read. */
  isLatest(ticket: number): boolean;
  /** Retires every read under way: an act started, or the till was cleared. */
  retire(): void;
}

export function createResumeGuard(): PosResumeGuard {
  let latest = 0;
  return {
    begin(actRunning) {
      if (actRunning) return null;
      latest += 1;
      return latest;
    },
    isLatest: (ticket) => ticket === latest,
    retire() {
      latest += 1;
    },
  };
}

/** What a resume does with the read's answer; the hook supplies its state setters. */
export interface PosResumeSteps<T> {
  read: () => Promise<T | null>;
  /** Puts the order on the till. Called at most once, and only for the latest read. */
  put: (order: T) => void;
  /** The order is gone (paid, cancelled, deleted). */
  missing: () => void;
  /** The read failed. Only for the latest read: a replaced tap's failure says nothing about the open one. */
  failed: (caught: unknown) => void;
}

/** One resume: true once the order is on the till; false when refused, overtaken, gone or failed. */
export async function resumeLatest<T>(
  guard: PosResumeGuard,
  actRunning: boolean,
  steps: PosResumeSteps<T>,
): Promise<boolean> {
  const ticket = guard.begin(actRunning);
  if (ticket === null) return false;
  try {
    const found = await steps.read();
    if (!guard.isLatest(ticket)) return false;
    if (!found) {
      steps.missing();
      return false;
    }
    steps.put(found);
    return true;
  } catch (caught) {
    if (guard.isLatest(ticket)) steps.failed(caught);
    return false;
  }
}
