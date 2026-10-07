import { PRINT_AGENT_NAME_MAX } from '../domain/agents.js';
import { PRINT_JOB_COPIES_MAX, PRINT_JOB_MAX_BYTES } from '../domain/jobs.js';
import type { PrintRefusal } from '../types.js';

/**
 * ⚠ ONE MESSAGE for a computer that does not exist and for one in another
 * workspace. Any difference — even in wording — tells a prober which it hit.
 */
export const PRINT_NOT_FOUND_MESSAGE = 'That computer is not paired here — it may have been revoked';

/**
 * What a computer is told when it is not admitted, or no longer is.
 *
 * ⚠ ONE MESSAGE for "this socket presented no secret" and "this computer was
 * revoked". The reader is a program holding a credential; why it failed is not
 * its business, and the person who revoked it already knows.
 */
export const PRINT_AGENT_REFUSED_MESSAGE = 'This computer is not paired, or its pairing was revoked';

/**
 * ⚠ ONE MESSAGE for a job that does not exist, a wrong or spent ticket, and a
 * job that belongs to another computer.
 */
export const PRINT_JOB_NOT_FOUND_MESSAGE = 'That print job is not here — it may have ended already';

/**
 * One error type for every refusal a printing operation makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence gets it wrong on the first rewording.
 */
export class PrintWriteError extends Error {
  constructor(
    readonly reason: PrintRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PrintWriteError';
  }
}

/** The sentence for each refusal. */
export function refusalError(reason: PrintRefusal): PrintWriteError {
  return new PrintWriteError(reason, REFUSAL_MESSAGES[reason]);
}

const REFUSAL_MESSAGES: Record<PrintRefusal, string> = {
  not_found: PRINT_NOT_FOUND_MESSAGE,
  not_permitted: 'You cannot do that here',
  limit_reached: 'This workspace has as many paired computers as it can have — revoke one first',
  invalid_name: `A name is needed for the computer, of at most ${PRINT_AGENT_NAME_MAX} characters`,
  invalid_printers: 'That list of printers could not be read',
  agent_revoked: PRINT_AGENT_REFUSED_MESSAGE,
  printer_gone: 'That printer is no longer on that computer',
  agent_offline: 'That computer is offline — start the print agent on it, then try again',
  invalid_job: `Choose one of the printer’s own papers and settings, and between 1 and ${PRINT_JOB_COPIES_MAX} copies`,
  job_too_large: `That file is larger than ${Math.round(PRINT_JOB_MAX_BYTES / (1024 * 1024))} MB, the most one print can carry`,
  agent_busy: 'That computer is still working on earlier prints — wait for one to finish',
  job_not_found: PRINT_JOB_NOT_FOUND_MESSAGE,
};
