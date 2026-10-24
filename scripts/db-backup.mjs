/**
 * `pnpm db:backup` — a FULL copy of the local dev database, to carry to another
 * computer, then shown in the file manager so it can be copied straight away.
 *
 *   pnpm db:backup              → backups/kwtech-YYYY-MM-DD-HHMMSS.dump
 *   pnpm db:backup --no-open    the same, without opening the file manager
 *
 * Restore it on the other machine (docs/SETUP.md §7, "Moving a database to
 * another computer"):
 *
 *   docker exec -i kwtech-postgres pg_restore -U postgres -d kwtech --clean --if-exists --no-owner < backups/<file>.dump
 *
 * ── not `db:snapshot` ───────────────────────────────────────────────────────
 *
 * The snapshot leaves out every credential, so on another machine only the
 * SEED_USER_* accounts can sign in. This is `pg_dump`: every table, password
 * hashes, MFA factors and sessions included. That is why it is written to
 * `backups/` (gitignored, as is `*.dump`) and why the package script runs it
 * only on the `local` profile: a staging or production copy on a laptop is
 * real people's data in the wrong place.
 *
 * ⚠ The other machine's profile needs the same `AUTH_MFA_SECRET_KEY`: it
 * encrypts the stored 2FA secrets, and with a different key every account with
 * 2FA on is locked out.
 *
 * Runs `pg_dump` INSIDE the `kwtech-postgres` container (scripts/dev-db.mjs),
 * so the client always matches the server's major version and nothing has to
 * be installed on the machine itself.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { revealInFileManager } from './reveal.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = resolve(REPO_ROOT, 'apps/web-server');
const BACKUP_DIR = resolve(REPO_ROOT, 'backups');
const CONTAINER = 'kwtech-postgres';

function fail(message) {
  console.error(`  ✗ ${message}`);
  process.exit(1);
}

/** The active profile's database, as scripts/dev-db.mjs reads it. */
function readDatabaseUrl() {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(SERVER_DIR, file);
    if (!existsSync(path)) continue;
    const match = readFileSync(path, 'utf8').match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\n]+)/m);
    if (match) return new URL(match[1]);
  }
  return null;
}

const url = readDatabaseUrl();
if (!url) fail('no DATABASE_URL in apps/web-server/.env.local — run `pnpm env:use local`');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
  fail(`DATABASE_URL points at ${url.hostname}, not this machine's container; use pg_dump against it directly`);
}

let running = '';
try {
  running = execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // No Docker, or no such container: the same answer below.
}
if (running !== 'true') fail(`the ${CONTAINER} container is not running — start it with \`pnpm db:up\``);

const user = decodeURIComponent(url.username || 'postgres');
const database = url.pathname.slice(1) || 'kwtech';

// Local time, to the second: two backups on one day must not overwrite each other.
const now = new Date();
const pad = (value) => String(value).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const target = resolve(BACKUP_DIR, `${database}-${stamp}.dump`);

/*
 * Written under a `.partial` name and renamed only once pg_dump exits 0.
 * A dump that died halfway is a file that LOOKS like a backup and restores a
 * fraction of the database; it must never sit in the folder under the name
 * somebody would copy.
 */
const partial = `${target}.partial`;
mkdirSync(BACKUP_DIR, { recursive: true });
console.log(`  ▸ pg_dump ${database} (${CONTAINER})`);

const out = createWriteStream(partial);
// `-Fc`: Postgres's compressed custom format, the one pg_restore reads selectively.
const dump = spawn('docker', ['exec', CONTAINER, 'pg_dump', '-U', user, '-d', database, '-Fc'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
dump.stdout.pipe(out);

const code = await new Promise((done) => {
  dump.on('error', () => done(1));
  dump.on('close', (status) => out.end(() => done(status ?? 1)));
});
if (code !== 0) {
  rmSync(partial, { force: true });
  fail(`pg_dump exited with ${code}; no backup was written`);
}

renameSync(partial, target);
const megabytes = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`  ✓ ${relative(REPO_ROOT, target)} (${megabytes} MB) — gitignored; carry it privately`);
console.log('    it holds password hashes and every row. On the other machine, see docs/SETUP.md §7.');

revealInFileManager(target);
