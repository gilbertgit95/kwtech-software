import { fileRefusalMessage } from '../domain/messages.js';
import type { FileRefusal } from '../types.js';

/**
 * One error type for every refusal a file operation makes, carrying a reason
 * code. The app sees only the MESSAGE (`formatError` strips `extensions` in
 * production), and the messages are the domain's (`fileRefusalMessage`).
 */
export class FileWriteError extends Error {
  constructor(
    readonly reason: FileRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'FileWriteError';
  }
}

/** The domain's sentence for `reason`. A cap's refusal passes its own, from `limitReachedText`. */
export function fileRefusalError(reason: FileRefusal, message: string = fileRefusalMessage(reason)): FileWriteError {
  return new FileWriteError(reason, message);
}

/** Prisma's `P2002`, detected structurally: this package does not import `@prisma/client`. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
