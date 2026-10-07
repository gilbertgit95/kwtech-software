#!/usr/bin/env node
/**
 * `pnpm dev:focus <package>…` — the apps, and a watcher for ONLY the named
 * packages.
 *
 * WHY THIS IS NEEDED
 *
 * `pnpm dev` starts one `tsc --watch` per package. Each holds its whole program
 * in memory for as long as dev runs, and there are a dozen of them, while the
 * work is nearly always in one module. On a machine with little memory (a WSL
 * VM at its default size) that is what pushes dev into swap.
 *
 * WHAT IT DOES
 *
 * Runs `turbo run dev` filtered to the apps plus the packages named. Nothing is
 * left unbuilt: the `dev` task depends on `^build`, so every OTHER package is
 * still compiled once (from turbo's cache when unchanged) before the apps
 * start. They just do not rebuild on edit.
 *
 * So an edit to a package that is NOT named does not show up in the running
 * apps. Name it too, or run `pnpm dev`. This script prints which packages are
 * watched for exactly that reason: "my change did nothing" should be answered
 * by the first lines of the output.
 *
 *   pnpm dev:focus module-task            both apps + module-task
 *   pnpm dev:focus task web-ui            the `module-` prefix is optional
 *   pnpm dev:focus module-task --api      API only (and the database)
 *   pnpm dev:focus module-task --web      web app only
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = resolve(REPO_ROOT, 'scripts');

/** Read from disk, not listed: a new module is focusable the day it exists. */
const PACKAGES = readdirSync(resolve(REPO_ROOT, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(REPO_ROOT, 'packages', entry.name, 'package.json')))
  .map((entry) => entry.name)
  .sort();

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const names = args.filter((arg) => !arg.startsWith('--'));

function fail(message) {
  console.error(`dev:focus: ${message}\n`);
  console.error('Usage: pnpm dev:focus <package>… [--api | --web]');
  console.error(`Packages: ${PACKAGES.join(', ')}`);
  process.exit(1);
}

/** `module-task`, `task` and `@kwtech/module-task` all name the same directory. */
function resolvePackage(name) {
  const bare = name.replace(/^@kwtech\//, '');
  if (PACKAGES.includes(bare)) return bare;
  if (PACKAGES.includes(`module-${bare}`)) return `module-${bare}`;
  return fail(`no package named "${name}".`);
}

for (const flag of flags) if (flag !== '--api' && flag !== '--web') fail(`unknown option "${flag}".`);
if (flags.has('--api') && flags.has('--web')) fail('--api and --web together is the default: pass neither.');
// Naming nothing is not "watch everything": that is `pnpm dev`, and guessing it
// here would silently bring back the load this script exists to avoid.
if (names.length === 0) fail('name at least one package to watch.');

const focused = [...new Set(names.map(resolvePackage))];
const withApi = !flags.has('--web');
const withWeb = !flags.has('--api');

function runScript(script, ...scriptArgs) {
  execFileSync(process.execPath, [resolve(SCRIPTS, script), ...scriptArgs], { cwd: REPO_ROOT, stdio: 'inherit' });
}

// The same steps, in the same order, as the `dev`, `dev:api` and `dev:web`
// scripts in package.json. Only the API needs the database.
const ports = [withApi && 8080, withWeb && 8081].filter(Boolean);
try {
  runScript('env.mjs', 'ensure');
  runScript('dev-ports.mjs', `--ports=${ports.join(',')}`);
  if (withApi) runScript('dev-db.mjs');
} catch (error) {
  // The step already printed why; repeat only its status.
  process.exit(typeof error.status === 'number' ? error.status : 1);
}

const unwatched = PACKAGES.filter((name) => !focused.includes(name));
console.log(`\ndev:focus: watching ${focused.join(', ')}`);
console.log(`dev:focus: built once, NOT watched: ${unwatched.join(', ') || '(none)'}\n`);

const filters = [
  ...(withApi ? ['@kwtech/web-server'] : []),
  ...(withWeb ? ['@kwtech/web-app'] : []),
  ...focused.map((name) => `@kwtech/${name}`),
].map((name) => `--filter=${name}`);

// Run through pnpm, so `turbo` is on PATH from node_modules/.bin.
// GOGC=50 as the `dev` scripts in package.json set it: each watcher holds about
// a third less memory (turbo.json, the `dev` task, has the numbers). A value
// already in the environment wins, so it can still be tuned from the shell.
//
// --concurrency: turbo.json keeps the default low, for the sake of `pnpm test`
// and `pnpm typecheck`, and turbo refuses to start unless the concurrency is
// above the number of watchers, which never finish. So ask for exactly what
// this run needs: the persistent tasks (one per filter) and two more for the
// one-off builds before them.
const concurrency = Math.max(4, filters.length + 2);
const turbo = spawn('turbo', ['run', 'dev', `--concurrency=${concurrency}`, ...filters], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: { GOGC: '50', ...process.env },
});

// Ctrl-C reaches turbo directly (same foreground group) and it tears its tasks
// down itself. Dying here first would orphan them — the case dev-ports.mjs
// exists to clean up — so wait for turbo instead.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => turbo.kill('SIGTERM'));

turbo.on('error', (error) => {
  console.error(`dev:focus: could not start turbo (${error.message}). Run it as \`pnpm dev:focus\`.`);
  process.exit(1);
});
turbo.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
