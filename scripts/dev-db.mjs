#!/usr/bin/env node
/**
 * Makes sure the dev database is up before `turbo run dev` starts the API.
 *
 * WHAT IT DOES, IN ORDER
 *
 *   1. DATABASE_URL (apps/web-server/.env, else the .env.example default) points
 *      somewhere other than this machine → nothing to do here.
 *   2. Something already accepts connections on that port — a native Postgres,
 *      or the container from a previous run → done.
 *   3. Docker is available → start the `kwtech-postgres` container, creating it
 *      (and its `kwtech-pgdata` volume) the first time, then wait until it
 *      accepts TCP connections.
 *   4. The volume was new → apply the committed migrations, then restore the
 *      committed data snapshot (apps/web-server/seed-data/snapshot.json, which
 *      runs the seeders too) or, without one, just seed — so a fresh checkout
 *      goes from nothing to a sign-in-able app in one `pnpm dev`.
 *
 * Anything else — no Docker, daemon down, no permission on the socket — fails
 * with the fix spelled out, rather than letting the API die later on a
 * connection error that names none of this.
 *
 * `pnpm db:down` stops the container; the volume, and so the data, stays.
 * Delete it with `docker rm -f kwtech-postgres && docker volume rm kwtech-pgdata`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = resolve(REPO_ROOT, 'apps/web-server');

const CONTAINER = 'kwtech-postgres';
const VOLUME = 'kwtech-pgdata';
const IMAGE = 'postgres:17';

/** `pnpm db:down` */
const STOP = process.argv.includes('--stop');

function readDatabaseUrl() {
  for (const file of ['.env', '.env.example']) {
    const path = resolve(SERVER_DIR, file);
    if (!existsSync(path)) continue;
    const match = readFileSync(path, 'utf8').match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\n]+)/m);
    if (match) return { url: new URL(match[1]), fromExample: file === '.env.example' };
  }
  return null;
}

function portOpen(host, port) {
  return new Promise((done) => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

/** Runs docker, returning trimmed stdout, or null on any failure. */
function docker(...args) {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function fail(lines) {
  console.error(lines.map((line) => `  ${line}`).join('\n'));
  process.exit(1);
}

function dockerProblem() {
  try {
    execFileSync('docker', ['info'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return null;
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    const stderr = String(error.stderr ?? '');
    return /permission denied/i.test(stderr) ? 'permission' : 'daemon';
  }
}

if (STOP) {
  const stopped = docker('stop', CONTAINER);
  console.log(stopped ? `  ✓ stopped ${CONTAINER} (data kept in volume ${VOLUME})` : `  ${CONTAINER} is not running`);
  process.exit(0);
}

const config = readDatabaseUrl();
if (!config) fail(['✗ no DATABASE_URL in apps/web-server/.env or .env.example']);

const { url, fromExample } = config;
const host = url.hostname;
const port = Number(url.port || 5432);

if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  // A remote database (Neon, a shared dev box) is not ours to start.
  process.exit(0);
}

if (await portOpen('127.0.0.1', port)) process.exit(0);

switch (dockerProblem()) {
  case 'missing':
    fail([
      `✗ nothing on localhost:${port} and Docker is not installed.`,
      '  Install Docker Engine in WSL (once):',
      '    sudo apt update && sudo apt install -y docker.io',
      '    sudo usermod -aG docker $USER && sudo systemctl enable --now docker',
      '  then open a new terminal (or `wsl --shutdown`) so the group applies.',
    ]);
    break;
  case 'permission':
    fail([
      '✗ Docker is installed but this user cannot reach its socket.',
      '    sudo usermod -aG docker $USER',
      '  then open a new terminal (or `wsl --shutdown`) so the group applies.',
    ]);
    break;
  case 'daemon':
    fail(['✗ Docker is installed but the daemon is not running.', '    sudo systemctl enable --now docker']);
    break;
}

const freshVolume = docker('volume', 'inspect', VOLUME) === null;
const exists = docker('container', 'inspect', CONTAINER) !== null;

if (exists) {
  console.log(`  ↻ starting ${CONTAINER}`);
  if (docker('start', CONTAINER) === null) fail([`✗ could not start ${CONTAINER}: docker logs ${CONTAINER}`]);
} else {
  console.log(`  + creating ${CONTAINER} (${IMAGE}) on :${port}`);
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      CONTAINER,
      '--restart',
      'unless-stopped',
      '-p',
      `127.0.0.1:${port}:5432`,
      '-e',
      `POSTGRES_USER=${decodeURIComponent(url.username || 'postgres')}`,
      '-e',
      `POSTGRES_PASSWORD=${decodeURIComponent(url.password || 'postgres')}`,
      '-e',
      `POSTGRES_DB=${url.pathname.slice(1) || 'kwtech'}`,
      '-v',
      `${VOLUME}:/var/lib/postgresql/data`,
      IMAGE,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (run.status !== 0) fail([`✗ docker run failed (is :${port} taken by another container?)`]);
}

// Over TCP on purpose: during first-time init the image runs a temporary server
// on the unix socket only, so a socket check would pass before the real one is up.
const deadline = Date.now() + 60_000;
while (!(await portOpen('127.0.0.1', port)) || docker('exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1') === null) {
  if (Date.now() > deadline) fail([`✗ ${CONTAINER} did not become ready in 60s: docker logs ${CONTAINER}`]);
  await new Promise((wait) => setTimeout(wait, 500));
}
console.log(`  ✓ postgres ready on localhost:${port}`);

if (freshVolume) {
  // The committed dev data when there is some (restore runs the seeders too);
  // the bare seeders otherwise.
  const fill = existsSync(resolve(SERVER_DIR, 'seed-data/snapshot.json')) ? 'db:restore' : 'db:seed';
  if (fromExample) {
    console.log('  ! new database, but apps/web-server/.env does not exist yet — create it, then run:');
    console.log(`      pnpm --filter @kwtech/web-server db:deploy && pnpm --filter @kwtech/web-server ${fill}`);
    process.exit(0);
  }
  console.log(`  + new database: applying migrations, then ${fill}`);
  for (const task of ['db:deploy', fill]) {
    const result = spawnSync('pnpm', ['--filter', '@kwtech/web-server', task], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (result.status !== 0) fail([`✗ ${task} failed on the new database`]);
  }
}
