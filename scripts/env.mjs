#!/usr/bin/env node
/**
 * Named environment profiles, switched with one command.
 *
 *   pnpm env:show             which profile is active, and what it points at
 *                             (not `pnpm env`: that is pnpm's own Node-version command)
 *   pnpm env:use <name>       activate a profile for BOTH apps
 *   pnpm env:new <name>       create envs/<name>/ from the .env.example files,
 *                             with fresh secrets
 *   pnpm env:check            .env.example files hold no secrets; every
 *                             profile has every variable the examples declare
 *
 * LAYOUT
 *
 *   envs/<name>/web-server.env   ← apps/web-server/.env.local   (a symlink)
 *   envs/<name>/web-app.env      ← apps/web-app/.env.local      (a symlink)
 *
 * Both apps read `.env.local`: Next by its own convention, the API through
 * apps/web-server/src/config/load-env.ts. So Nest, Next, Prisma, the seeders
 * and scripts/dev-db.mjs all follow a switch without knowing profiles exist. A
 * symlink rather than a copy so an edit to apps/web-server/.env.local IS an
 * edit to the profile: a copy would
 * drift from its source the first time somebody changed a value in the IDE.
 *
 * `envs/` is gitignored except its README. A deployed staging or production
 * host reads real environment variables and never sees these files; the
 * profile is what THIS machine uses to reach that environment (migrations, a
 * sync, studio) and the reference for what the host must be given.
 *
 * APP_ENV (`local` | `staging` | `production`) in the web-server profile is
 * what the guards read — `pnpm db:migrate` and `db:snapshot` refuse anything
 * but local, `db:restore` refuses production — so a profile's NAME is free,
 * but its APP_ENV must be honest.
 */
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENVS = resolve(ROOT, 'envs');
/** Written on every switch; the only record when a symlink was not possible. */
const ACTIVE_MARKER = resolve(ENVS, '.active');

const APPS = [
  // `.env` is where the API's file lived before it matched the web app's name.
  { key: 'web-server', dir: 'apps/web-server', target: '.env.local', legacy: '.env' },
  { key: 'web-app', dir: 'apps/web-app', target: '.env.local' },
];

const KINDS = ['local', 'staging', 'production'];

/** Filled with fresh random bytes by `env:new`, base64. Never copied between profiles. */
const GENERATED = { AUTH_JWT_SECRET: 48, AUTH_MFA_SECRET_KEY: 32 };

/**
 * Keys whose value in a COMMITTED .env.example must be empty or a `change-me`
 * placeholder. The repository is public: a real value here is a published one.
 */
const SECRET_KEY = /(PASSWORD|SECRET|_KEY|_EMAIL)$/;

const colour = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const red = colour('1;31');
const yellow = colour('33');
const green = colour('32');
const dim = colour('2');

function fail(message) {
  console.error(red(`✗ ${message}`));
  process.exit(1);
}

const targetPath = (app) => resolve(ROOT, app.dir, app.target);
const examplePath = (app) => resolve(ROOT, app.dir, '.env.example');
const profilePath = (name, app) => resolve(ENVS, name, `${app.key}.env`);

/** KEY → value for every uncommented assignment. Quotes are stripped. */
function parse(text) {
  const values = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    values.set(match[1], match[2].replace(/^(["'])(.*)\1$/, '$2'));
  }
  return values;
}

const read = (path) => (existsSync(path) ? parse(readFileSync(path, 'utf8')) : new Map());

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The active profile's name, or null when none has been chosen yet. */
function activeProfile() {
  const target = targetPath(APPS[0]);
  if (isSymlink(target)) return basename(dirname(resolve(dirname(target), readlinkSync(target))));
  return existsSync(ACTIVE_MARKER) ? readFileSync(ACTIVE_MARKER, 'utf8').trim() || null : null;
}

/**
 * `apps/web-server/.env` → `.env.local`, whichever form it takes: a profile
 * link from before the rename is re-pointed under the new name, and a plain
 * file is renamed, so the step below adopts it into envs/local/. When both
 * exist the new name wins and the old one is left for a person to delete.
 */
function migrateLegacyNames() {
  for (const app of APPS) {
    if (!app.legacy) continue;
    const old = resolve(ROOT, app.dir, app.legacy);
    const target = targetPath(app);
    const oldExists = isSymlink(old) || existsSync(old);
    if (!oldExists) continue;
    const targetExists = isSymlink(target) || existsSync(target);

    if (isSymlink(old)) {
      if (!targetExists) link(resolve(dirname(old), readlinkSync(old)), target);
      rmSync(old);
      console.log(`  ${relative(ROOT, old)} is now ${relative(ROOT, target)}`);
    } else if (!targetExists) {
      renameSync(old, target);
      console.log(`  renamed ${relative(ROOT, old)} → ${relative(ROOT, target)}`);
    } else {
      console.warn(
        yellow(`  ! ${relative(ROOT, old)} is no longer read (${app.target} is). Delete it once you have checked it.`),
      );
    }
  }
}

/**
 * A checkout from before profiles has plain files where the symlinks go. They
 * become the `local` profile — moved, not copied, so nothing is lost and there
 * is one source afterwards. Refuses rather than guesses when `local` already
 * holds something different.
 */
function adoptPlainFiles() {
  migrateLegacyNames();
  for (const app of APPS) {
    const target = targetPath(app);
    if (!existsSync(target) || isSymlink(target)) continue;

    const destination = profilePath('local', app);
    if (existsSync(destination)) {
      if (readFileSync(destination, 'utf8') === readFileSync(target, 'utf8')) {
        link(destination, target);
        continue;
      }
      fail(
        `${relative(ROOT, target)} is a plain file and envs/local/${app.key}.env already exists with different ` +
          'content. Keep the one you want, delete the other, and run this again.',
      );
    }
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(target, destination);
    link(destination, target);
    console.log(`  moved ${relative(ROOT, target)} → envs/local/${app.key}.env`);
    if (!existsSync(ACTIVE_MARKER)) writeFileSync(ACTIVE_MARKER, 'local\n');
  }
}

/** A relative symlink, so the checkout can move. Falls back to a copy where links are refused. */
function link(source, target) {
  rmSync(target, { force: true });
  try {
    symlinkSync(relative(dirname(target), source), target);
  } catch {
    copyFileSync(source, target);
    console.warn(
      yellow(`  ! symlinks unavailable: copied ${relative(ROOT, target)}. Edit the profile, then re-run env:use.`),
    );
  }
}

/** What a profile points at, without printing a single secret. */
function describe(name) {
  const server = read(profilePath(name, APPS[0]));
  const web = read(profilePath(name, APPS[1]));
  const kind = server.get('APP_ENV') || 'local';
  let database = '(no DATABASE_URL)';
  try {
    const url = new URL(server.get('DATABASE_URL') ?? '');
    database = `${url.hostname}:${url.port || 5432}${url.pathname}`;
  } catch {}
  return { kind, database, api: web.get('API_URL') ?? '(default)' };
}

function banner() {
  const name = activeProfile();
  if (!name) {
    console.log(yellow('  env: none active — run `pnpm env:new local` (first time) or `pnpm env:use <name>`'));
    return;
  }
  const { kind, database, api } = describe(name);
  const line = `env: ${name} (${kind})  db ${database}  api ${api}`;
  if (kind === 'production') console.log(red(`  ⚠ ${line}  — THIS IS PRODUCTION DATA`));
  else if (kind === 'staging') console.log(yellow(`  ⚠ ${line}`));
  else console.log(dim(`  ${line}`));
}

/** Every directory under envs/ holding at least one app's file. */
function profiles() {
  if (!existsSync(ENVS)) return [];
  return readdirSync(ENVS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && APPS.some((app) => existsSync(profilePath(entry.name, app))))
    .map((entry) => entry.name)
    .sort();
}

/**
 * What `pnpm dev` runs first: development defaults to `local` without anybody
 * choosing it. Adopts pre-profile files, else creates `local`, else activates
 * it. A profile somebody DID choose is left alone — switching to staging and
 * running `pnpm dev` against it is legitimate, and the banner says so loudly.
 */
function ensureActive() {
  adoptPlainFiles();
  if (activeProfile()) return banner();
  if (APPS.every((app) => existsSync(profilePath('local', app)))) use('local');
  else create('local');
}

function use(name) {
  if (!name) fail('Usage: pnpm env:use <name>');
  const missing = APPS.filter((app) => !existsSync(profilePath(name, app)));
  if (missing.length > 0) {
    fail(
      `envs/${name}/ is missing ${missing.map((app) => `${app.key}.env`).join(' and ')}. ` +
        `Create it with \`pnpm env:new ${name}\`.`,
    );
  }
  for (const app of APPS) link(profilePath(name, app), targetPath(app));
  writeFileSync(ACTIVE_MARKER, `${name}\n`);
  console.log(green(`  ✓ active: ${name}`));
  banner();
}

/** The example's text with APP_ENV set and the generated secrets filled in. */
function fromExample(app, kind) {
  let text = readFileSync(examplePath(app), 'utf8');
  const set = (key, value) => {
    const line = new RegExp(`^#?\\s*${key}\\s*=.*$`, 'm');
    text = line.test(text) ? text.replace(line, `${key}="${value}"`) : `${text.trimEnd()}\n${key}="${value}"\n`;
  };
  set('APP_ENV', kind);
  for (const [key, bytes] of Object.entries(GENERATED)) {
    if (new RegExp(`^#?\\s*${key}\\s*=`, 'm').test(text)) set(key, randomBytes(bytes).toString('base64'));
  }
  return text;
}

function create(name) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name))
    fail('Usage: pnpm env:new <name>   (lowercase letters, digits, dashes)');
  adoptPlainFiles();
  const kind = KINDS.includes(name) ? name : 'local';
  const written = [];
  for (const app of APPS) {
    const path = profilePath(name, app);
    if (existsSync(path)) {
      console.log(dim(`  kept envs/${name}/${app.key}.env (already exists)`));
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, fromExample(app, kind), { mode: 0o600 });
    written.push(path);
    console.log(green(`  + envs/${name}/${app.key}.env`));
  }

  // What still needs a human: empty required values, and — off local — every
  // value still aimed at this machine.
  for (const path of written) {
    const todo = [...parse(readFileSync(path, 'utf8'))]
      .filter(
        ([key, value]) =>
          (key.startsWith('SEED_USER_') && !value) || (kind !== 'local' && /localhost|127\.0\.0\.1/.test(value)),
      )
      .map(([key]) => key);
    if (todo.length > 0) console.log(yellow(`  fill in (${relative(ROOT, path)}): ${todo.join(', ')}`));
  }

  if (!activeProfile()) use(name);
  else console.log(`  activate it with: pnpm env:use ${name}`);
}

function check() {
  let problems = 0;
  for (const app of APPS) {
    for (const [key, value] of read(examplePath(app))) {
      if (SECRET_KEY.test(key) && value && !value.startsWith('change-me')) {
        console.error(
          red(`  ✗ ${app.dir}/.env.example sets ${key}. It is committed to a public repo: leave it empty.`),
        );
        problems += 1;
      }
    }
  }
  if (process.argv.includes('--examples-only')) process.exit(problems ? 1 : 0);

  for (const name of profiles()) {
    for (const app of APPS) {
      const profile = read(profilePath(name, app));
      const missing = [...read(examplePath(app)).keys()].filter((key) => !profile.has(key));
      if (missing.length > 0) console.warn(yellow(`  ! envs/${name}/${app.key}.env has no ${missing.join(', ')}`));
    }
  }
  if (problems === 0) console.log(green('  ✓ .env.example files hold no secrets'));
  process.exit(problems ? 1 : 0);
}

/**
 * `--require=local` / `--refuse=production`: a guard for package scripts.
 * A real APP_ENV in the environment (a deployed host, CI) wins over the file.
 */
function guard(flag, value) {
  const kind = process.env.APP_ENV || read(targetPath(APPS[0])).get('APP_ENV') || 'local';
  if (flag === 'require' && kind !== value)
    fail(`This command runs only against a ${value} environment; the active one is ${kind}.`);
  if (flag === 'refuse' && kind === value) fail(`This command is refused against ${kind}.`);
}

const [command, argument] = process.argv.slice(2);
const guardFlag = process.argv.slice(2).find((arg) => /^--(require|refuse)=/.test(arg));

if (guardFlag) {
  const [, flag, value] = guardFlag.match(/^--(require|refuse)=(.+)$/);
  guard(flag, value);
} else if (command === '--banner') {
  banner();
} else if (command === 'ensure') {
  ensureActive();
} else if (command === 'use') {
  adoptPlainFiles();
  use(argument);
} else if (command === 'new') {
  create(argument);
} else if (command === 'check') {
  check();
} else {
  adoptPlainFiles();
  banner();
  const list = profiles();
  console.log(list.length ? `  profiles: ${list.join(', ')}` : '  no profiles yet: pnpm env:new local');
}
