import { backupRefusalMessage } from '../domain/messages.js';
import type { BackupRefusal } from '../types.js';

export { backupRefusalMessage } from '../domain/messages.js';

/** The module's one error class: a refusal with its reason, and a sentence for the person. */
export class BackupWriteError extends Error {
  constructor(
    readonly reason: BackupRefusal,
    message: string = backupRefusalMessage(reason),
  ) {
    super(message);
    this.name = 'BackupWriteError';
  }
}
