import { controlRefusalMessage } from '../domain/controls.js';
import type { JobControlRefusal } from '../types.js';

/**
 * One error type for every refusal the admin page's operations make.
 *
 * A REASON CODE as well as a sentence: the transport decides the wording's
 * fate, and a test asserts the reason rather than a string that will be
 * reworded.
 */
export class JobsWriteError extends Error {
  constructor(
    readonly reason: JobControlRefusal,
    message: string = controlRefusalMessage(reason),
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'JobsWriteError';
  }
}
