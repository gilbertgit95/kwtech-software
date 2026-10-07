#!/usr/bin/env node
import { hostname } from 'node:os';
import { normalisePairingCode } from '@kwtech/module-print';
import { type AgentEnv, loadEnv } from './config/env.js';
import type { PrinterDriver } from './printers/driver.js';
import { createFakeDriver } from './printers/fake.js';
import { createWindowsDriver } from './printers/windows.js';
import { runAgent } from './run.js';
import { pairWithServer } from './server-api.js';
import { clearState, readState, stateMatchesServer, statePath, writeState } from './state.js';

/**
 * The print agent's command line.
 *
 *   print-agent pair <code>   pair this computer, with the code from the web app
 *   print-agent start         connect, stay connected, and print what is sent
 *   print-agent printers      list what this computer would report (asks no server)
 *   print-agent status        say whether this computer is paired, and to what
 *   print-agent unpair        forget the pairing on this computer
 *
 * ⚠ THE SECRET IS NEVER PRINTED, by any command. `status` says a pairing
 * exists and where its file is; that is all anybody at the keyboard needs.
 */

/** Sent to the server at pairing, for the web app to show. Not a secret. */
const AGENT_VERSION = '0.0.0';

const USAGE = `Usage:
  print-agent pair <code>   pair this computer, with the code from the web app
  print-agent start         connect, stay connected, and print what is sent
  print-agent printers      list the printers this computer would report
  print-agent status        say whether this computer is paired
  print-agent unpair        forget the pairing on this computer`;

const log = (message: string) => console.log(`${new Date().toISOString()}  ${message}`);

function driverFor(env: AgentEnv): PrinterDriver {
  if (env.driver === 'fake') return createFakeDriver(env.excludedPrinters, { onPrinted: log });
  return createWindowsDriver(env.excludedPrinters, {
    ...(env.sumatraPath ? { sumatraPath: env.sumatraPath } : {}),
    onSkipped: (names) =>
      log(`Left out, because Windows described them in a way that cannot be reported: ${names.join(', ')}.`),
    onNote: log,
  });
}

async function pair(env: AgentEnv, typed: string | undefined): Promise<number> {
  // Checked here with the server's own rule, so a mistyped code costs no try against the rate limit.
  if (!typed || !normalisePairingCode(typed)) {
    console.error('That is not a pairing code. It is ten letters and digits, shown in the web app as ABCDE-FGHJK.');
    return 1;
  }
  if (readState(env.stateDir)) {
    console.error('This computer is already paired. Run "print-agent unpair" first, and revoke it in the web app.');
    return 1;
  }

  const answer = await pairWithServer(env.apiUrl, { code: typed, hostName: hostname(), agentVersion: AGENT_VERSION });
  if (!answer) {
    console.error(
      'The server did not accept that code. It may be mistyped, already used or older than ten minutes — or the workspace already has all the computers it may. Make a new one in the web app.',
    );
    return 1;
  }
  try {
    writeState(env.stateDir, {
      version: 1,
      apiUrl: env.apiUrl,
      agentId: answer.agentId,
      name: answer.name,
      secret: answer.secret,
      pairedAt: new Date().toISOString(),
    });
  } catch (error) {
    // ⚠ The code is spent and the server now lists a computer whose secret nobody holds. Say what to do about it.
    console.error(
      `The server paired this computer as "${answer.name}", but the pairing could not be saved in ${statePath(env.stateDir)} — ${error instanceof Error ? error.message : error}. Revoke "${answer.name}" in the web app, fix the folder, and pair again with a new code.`,
    );
    return 1;
  }
  console.log(`Paired as "${answer.name}". Now run: print-agent start`);
  return 0;
}

async function start(env: AgentEnv): Promise<number> {
  const state = readState(env.stateDir);
  if (!state) {
    console.error('This computer is not paired. Make a code in the web app, then run: print-agent pair <code>');
    return 1;
  }
  if (!stateMatchesServer(state, env.apiUrl)) {
    console.error(
      `This computer was paired with ${state.apiUrl}, and the settings now say ${env.apiUrl}. Its secret is not sent to another server. Put API_URL back, or unpair and pair again.`,
    );
    return 1;
  }

  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

  log(`Starting as "${state.name}" (${env.driver} printers), connecting to ${env.wsUrl}.`);
  const end = await runAgent({
    wsUrl: env.wsUrl,
    apiUrl: env.apiUrl,
    secret: state.secret,
    driver: driverFor(env),
    log,
    signal: stop.signal,
  });
  if (end === 'revoked') {
    console.error(
      'The server no longer accepts this computer: it was revoked in the web app. Run "print-agent unpair", then pair it again with a new code.',
    );
    return 2;
  }
  log('Stopped.');
  return 0;
}

async function printers(env: AgentEnv): Promise<number> {
  const list = await driverFor(env).list();
  if (list.length === 0) console.log('No printers to report.');
  for (const printer of list) {
    console.log(`${printer.name}${printer.isDefault ? '  (default)' : ''}`);
    console.log(
      `  driver: ${printer.driver || 'unknown'}   status: ${printer.status}   papers: ${printer.papers.length}`,
    );
    const { mediaTypes, mediaType, qualities, quality } = printer.settings;
    const named = (options: readonly { id: string; label: string }[], current: string | null) =>
      options.map((option) => (option.id === current ? `[${option.label}]` : option.label)).join(', ');
    // The one in brackets is what the printer is set to now.
    if (mediaTypes.length > 0) console.log(`  paper types: ${named(mediaTypes, mediaType)}`);
    if (qualities.length > 0) console.log(`  qualities: ${named(qualities, quality)}`);
  }
  return 0;
}

function status(env: AgentEnv): number {
  const state = readState(env.stateDir);
  if (!state) {
    console.log(`Not paired. (Looked in ${statePath(env.stateDir)}.)`);
    return 0;
  }
  console.log(`Paired as "${state.name}" with ${state.apiUrl}, on ${state.pairedAt}.`);
  console.log(`The pairing is kept in ${statePath(env.stateDir)}.`);
  return 0;
}

function unpair(env: AgentEnv): number {
  clearState(env.stateDir);
  console.log('Forgotten on this computer. If it is still listed in the web app, revoke it there too.');
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  // A code read off the screen as "ABCDE FGHJK" arrives as two words; it is one argument to the person typing.
  const argument = rest.length > 0 ? rest.join(' ') : undefined;
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  const env = loadEnv();
  switch (command) {
    case 'pair':
      return pair(env, argument);
    case 'start':
      return start(env);
    case 'printers':
      return printers(env);
    case 'status':
      return status(env);
    case 'unpair':
      return unpair(env);
    default:
      console.error(`Unknown command "${command}".\n${USAGE}`);
      return 1;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
