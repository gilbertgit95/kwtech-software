/**
 * One error type for every refusal a queue write makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence to tell "not assigned a window" from
 * "queuing has not started" gets it wrong on the first rewording.
 */
export type QueueRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'not_started'
  | 'already_running'
  | 'no_window'
  | 'line_not_served'
  | 'occupied'
  | 'name_taken'
  | 'prefix_taken'
  | 'cap_reached'
  | 'conflict'
  | 'invalid';

export class QueueWriteError extends Error {
  constructor(
    readonly reason: QueueRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'QueueWriteError';
  }
}

export const NOT_STARTED_MESSAGE = 'Queuing has not started';
export const NO_WINDOW_MESSAGE = 'You are not assigned a window';

/**
 * Prisma's unique-constraint violation, recognised STRUCTURALLY — this package
 * has no `@prisma/client` to import the error class from.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
