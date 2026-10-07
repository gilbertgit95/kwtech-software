import type { PrintRefusal } from '../types.js';

/**
 * A paired computer: its name, and whether it is there right now.
 */

export const PRINT_AGENT_NAME_MAX = 60;

/** A host name or a version string, as a computer reports it. Longer is cut, not refused. */
export const PRINT_AGENT_REPORTED_TEXT_MAX = 120;

/** How often a connected agent says it is still there. Seconds. */
export const PRINT_AGENT_HEARTBEAT_SECONDS = 30;

/**
 * How long after its last heartbeat a computer still counts as online. Seconds.
 *
 * ⚠ THREE HEARTBEATS, not one: a single late beat (a slow network, a busy
 * spooler) must not flip a computer to "offline" under somebody about to print.
 * The price is that a computer switched off shows online for up to this long.
 */
export const PRINT_AGENT_ONLINE_SECONDS = PRINT_AGENT_HEARTBEAT_SECONDS * 3;

/** The facts "is it there" needs. */
export interface PrintAgentFacts {
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Whether a computer is connected, as far as the server can tell.
 *
 * Worked out from a timestamp when read rather than kept as a flag, so it is
 * the same answer on every replica and needs nothing to clear it when a
 * computer loses power without saying goodbye.
 */
export function isAgentOnline(agent: PrintAgentFacts, now: Date): boolean {
  if (agent.revokedAt !== null || agent.lastSeenAt === null) return false;
  return now.getTime() - agent.lastSeenAt.getTime() <= PRINT_AGENT_ONLINE_SECONDS * 1000;
}

/** One clean line: control characters out, runs of white space to one space, ends trimmed. */
export function cleanLine(value: string): string {
  return value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A name a person typed for a computer, checked. The only way one reaches the database. */
export function prepareAgentName(value: unknown): { name: string } | { refused: PrintRefusal } {
  if (typeof value !== 'string') return { refused: 'invalid_name' };
  const name = cleanLine(value);
  if (name.length === 0 || [...name].length > PRINT_AGENT_NAME_MAX) return { refused: 'invalid_name' };
  return { name };
}

/**
 * Text a COMPUTER sent about itself (its host name, the agent's version), made
 * safe to store and show. Never refused: a strange host name must not stop a
 * computer pairing, so it is cleaned, cut, and null when nothing is left.
 */
export function cleanReportedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = [...cleanLine(value)].slice(0, PRINT_AGENT_REPORTED_TEXT_MAX).join('');
  return text.length > 0 ? text : null;
}
