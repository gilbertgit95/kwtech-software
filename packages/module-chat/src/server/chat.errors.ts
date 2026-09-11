/**
 * One error type for every refusal a write can make.
 *
 * A REASON CODE, not a message, for the same argument `PermissionWriteError`
 * makes: the transport decides the status and the wording, and a caller that
 * has to regex a sentence to tell "you are not in this conversation" from "that
 * message is already deleted" will get it wrong on the first rewording.
 */
export type ChatRefusal =
  | 'not_found'
  | 'not_a_participant'
  | 'not_permitted'
  | 'already_deleted'
  | 'blocked'
  | 'cap_reached'
  | 'invalid';

export class ChatWriteError extends Error {
  constructor(
    readonly reason: ChatRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ChatWriteError';
  }
}
