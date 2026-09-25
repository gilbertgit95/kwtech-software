import type { NotificationRefusal } from '../types.js';

/**
 * One error type for every refusal a notification write makes. A REASON CODE
 * the caller switches on, and a sentence for the screen.
 */
export class NotificationWriteError extends Error {
  constructor(
    readonly reason: NotificationRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'NotificationWriteError';
  }
}

/**
 * Prisma's unique-constraint violation, recognised STRUCTURALLY — this package
 * has no `@prisma/client` to import the error class from.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
