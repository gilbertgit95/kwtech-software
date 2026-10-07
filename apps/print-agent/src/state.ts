import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAgentSecretShaped } from '@kwtech/module-print';

/**
 * What pairing gave this computer, kept between runs: one small file in the
 * agent's state folder.
 *
 * ⚠ IT HOLDS THE SECRET, in the clear. It is the computer's own credential and
 * has to be readable by the agent with nobody there to type anything, so it
 * is protected by where it is (the user's own profile folder) and by its file
 * mode where the system honours one. That is a known cost (PLAN §12.113): anybody
 * who can read that user's files can print as this computer until it is
 * revoked in the web app.
 */
export interface AgentState {
  version: 1;
  /** The server this secret belongs to. ⚠ It is never presented to any other. */
  apiUrl: string;
  agentId: string;
  /** The name a person gave this computer in the web app. */
  name: string;
  secret: string;
  pairedAt: string;
}

const FILE_NAME = 'agent.json';

export function statePath(stateDir: string): string {
  return join(stateDir, FILE_NAME);
}

/** The saved pairing, or null when there is none or the file is not one. Never throws: a damaged file reads as "not paired". */
export function readState(stateDir: string): AgentState | null {
  const file = statePath(stateDir);
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentState>;
    const { apiUrl, agentId, name, secret, pairedAt } = value;
    if (value.version !== 1 || typeof apiUrl !== 'string' || typeof agentId !== 'string') return null;
    if (typeof name !== 'string' || typeof pairedAt !== 'string' || !isAgentSecretShaped(secret)) return null;
    return { version: 1, apiUrl, agentId, name, secret, pairedAt };
  } catch {
    return null;
  }
}

export function writeState(stateDir: string, state: AgentState): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = statePath(stateDir);
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  // `mode` on write is ignored when the file already existed; Windows ignores both and relies on the profile folder.
  chmodSync(file, 0o600);
}

export function clearState(stateDir: string): void {
  rmSync(statePath(stateDir), { force: true });
}

/**
 * Whether a saved pairing may be used with the server in the settings.
 *
 * ⚠ A SECRET IS NEVER SENT TO A SERVER IT WAS NOT ISSUED BY. Changing
 * `API_URL` after pairing — a typo, a different environment — must not hand
 * this computer's credential to whatever answers there. The socket it is
 * presented on is held to the same server by `isSameServer` (`config/env.ts`).
 */
export function stateMatchesServer(state: AgentState, apiUrl: string): boolean {
  return state.apiUrl === apiUrl;
}
