#!/usr/bin/env node
/**
 * `pnpm dev:print-agent` (or `pnpm --filter @kwtech/print-agent dev`): the agent,
 * rebuilt and restarted on every edit.
 *
 * WHY THIS IS A SCRIPT
 *
 * The agent is a command, not a server with a watch mode of its own, so
 * developing it takes two long-running processes: `tsc --watch` writing
 * dist/, and Node running dist/cli.js again whenever dist/ changes. A shell
 * `a & b` would do it, but not under Windows Node, which is the only place the
 * agent reads real printers.
 *
 * WHAT IT DOES
 *
 *   1. compiles once and waits, so the first run is of a dist/ that exists
 *   2. `tsc --watch`, with its own build-info file (as every package's `dev`
 *      does), so it cannot race a `build` running beside it
 *   3. `node --watch dist/cli.js start`, which restarts when any file the
 *      agent loaded changes, including `@kwtech/module-print`'s dist/
 *
 * The command after `dev` is passed on, and is `start` when there is none:
 *
 *   pnpm dev:print-agent                 print-agent start, restarting on edit
 *   pnpm dev:print-agent -- printers     print-agent printers, again on every edit
 *
 * ⚠ NOT PART OF `pnpm dev`. The root `dev` script filters this package out, so
 * that working on the web side does not pay for these two processes. Run the
 * server in one terminal and this in another.
 *
 * ⚠ A command that ends (not paired yet, revoked, `printers`) is not a crash:
 * Node waits and runs it again on the next change. Pair with
 * `pnpm --filter @kwtech/print-agent agent pair <code>`; pairing happens once
 * and is not something to repeat on every save.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Run by path under this same Node, never through a `tsc` shim: on Windows the
// shim is a .cmd file, which `spawn` cannot start without a shell. Found
// through package.json because TypeScript's `exports` does not list bin/tsc,
// so resolving that path directly is refused.
const TSC = resolve(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc');
const CLI = resolve(PACKAGE_ROOT, 'dist', 'cli.js');

const command = process.argv.slice(2);
const agentArgs = command.length > 0 ? command : ['start'];

const first = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd: PACKAGE_ROOT, stdio: 'inherit' });
// A first compile that fails still goes on to watch: the watcher prints the
// same errors and the agent starts once they are fixed. Stopping here would
// make a typo cost a restart of the whole command.
if (first.error) {
  console.error(`dev: could not run the TypeScript compiler (${first.error.message}).`);
  process.exit(1);
}

const children = [
  spawn(
    process.execPath,
    [TSC, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput', '--tsBuildInfoFile', 'dist/.tsbuildinfo.dev'],
    // GOGC as the rest of dev sets it (turbo.json, the `dev` task): the
    // compiler holds about a third less memory. Set here too, so that running
    // this package's `dev` directly gets it without turbo.
    { cwd: PACKAGE_ROOT, stdio: 'inherit', env: { GOGC: '50', ...process.env } },
  ),
  spawn(process.execPath, ['--watch', '--watch-preserve-output', CLI, ...agentArgs], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

// Either one ending on its own means dev is no longer doing its job; leaving
// the other running would look like it still was.
for (const child of children) {
  child.on('error', (error) => {
    console.error(`dev: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 1));
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
