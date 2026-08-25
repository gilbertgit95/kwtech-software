#!/usr/bin/env node
/**
 * Frees this repo's dev ports before `turbo run dev` tries to bind them.
 *
 * WHY THIS IS NEEDED
 *
 * Turbo runs each persistent task in its OWN process group. That is normally a
 * feature — it can signal one task without touching the others — but it means
 * the task groups are not children of the terminal's foreground group. A clean
 * Ctrl-C works, because turbo catches SIGINT and tears its tasks down itself.
 * Anything that stops turbo WITHOUT giving it that chance does not:
 *
 *   - closing the terminal or the VS Code window
 *   - `kill -9`, or a crash inside turbo
 *   - starting it detached and killing only the top process
 *   - a task dying mid-startup while the others are still coming up
 *
 * In every one of those cases the surviving task groups are re-parented to init
 * and keep listening. The next `pnpm dev` then fails with EADDRINUSE, and the
 * error names the port rather than the thing holding it — so the usual fix is
 * hunting for a pid by hand.
 *
 * WHAT IT DOES
 *
 * Kills the PROCESS GROUP of whatever is listening, not the listening process.
 * That matters: `nest start --watch` supervises `node dist/main`, so killing
 * the leaf only makes the supervisor start a new one. The group is the whole
 * task — pnpm, its shell, the supervisor and the server — and because turbo
 * isolated it in the first place, killing the group takes down that task and
 * nothing else.
 *
 * SAFETY: a listener is only killed when the process is running from inside
 * this repository. Something else on port 8080 is somebody else's, and this
 * script reports it and leaves it alone rather than guessing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where each of these is configured, so this list has somewhere to be kept
 * honest from: 8080 is `PORT` in apps/web-server/.env, 8081 is the `-p` flag in
 * apps/web-app's dev script.
 */
const DEFAULT_PORTS = [8080, 8081];

const portArg = process.argv.find((arg) => arg.startsWith('--ports='));
const PORTS = portArg ? portArg.slice('--ports='.length).split(',').map(Number).filter(Boolean) : DEFAULT_PORTS;

/** Report only; used by `pnpm dev:ports`. */
const LIST_ONLY = process.argv.includes('--list');

/** Pids listening on `port`, via ss with an lsof fallback. */
function listenersOn(port) {
  const pids = new Set();

  const tries = [
    () => execFileSync('ss', ['-lptnH', `sport = :${port}`], { encoding: 'utf8' }),
    () => execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }),
  ];

  for (const attempt of tries) {
    try {
      const out = attempt();
      // ss prints `users:(("next-server",pid=123,fd=22))`; lsof prints bare pids.
      for (const match of out.matchAll(/pid=(\d+)/g)) pids.add(Number(match[1]));
      if (pids.size === 0) for (const line of out.split('\n')) if (/^\d+$/.test(line.trim())) pids.add(Number(line));
      if (pids.size > 0) return [...pids];
    } catch {
      // Tool missing or nothing listening — try the next one.
    }
  }
  return [...pids];
}

/**
 * The process group id of `pid`.
 *
 * Parsed from the LAST ')' rather than by splitting on spaces: field 2 of
 * /proc/pid/stat is the command name in parentheses, and it can contain both
 * spaces and parentheses — `next-server (v16.3.1)` is exactly that case, and a
 * naive split reads the version string as the pgid.
 */
function processGroupOf(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
    // after[0] = state, after[1] = ppid, after[2] = pgrp
    const pgid = Number(after[2]);
    return Number.isInteger(pgid) && pgid > 0 ? pgid : null;
  } catch {
    return null;
  }
}

/** Whether the process is running out of this repo — the guard against killing someone else's server. */
function belongsToRepo(pid) {
  try {
    if (readlinkSync(`/proc/${pid}/cwd`).startsWith(REPO_ROOT)) return true;
  } catch {
    // Unreadable (another user, or already gone).
  }
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
    return cmdline.includes(REPO_ROOT);
  } catch {
    return false;
  }
}

function describe(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim().slice(0, 70) || `pid ${pid}`;
  } catch {
    return `pid ${pid}`;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const ownGroup = processGroupOf(process.pid);
let freed = 0;
let blocked = 0;
let listed = 0;

for (const port of PORTS) {
  for (const pid of listenersOn(port)) {
    const what = describe(pid);

    if (!belongsToRepo(pid)) {
      // Not ours. Say so precisely and stop — killing it is not this script's
      // call to make, and a silent kill here would be a very unpleasant bug.
      console.error(`  ✗ :${port} held by a process outside this repo — leaving it alone: ${what}`);
      blocked++;
      continue;
    }

    const group = processGroupOf(pid);
    // Never signal our own group: that would kill this script, and the shell
    // that ran it, on the way to freeing a port.
    const target = group && group !== ownGroup ? -group : pid;

    if (LIST_ONLY) {
      console.log(`  • :${port} ${what} (pid ${pid}, group ${group ?? 'unknown'})`);
      listed++;
      continue;
    }

    try {
      // SIGTERM first so a server can close its connections and its database
      // pool; SIGKILL only for what ignores it.
      process.kill(target, 'SIGTERM');
    } catch {
      // Already gone between listing and signalling.
    }

    const deadline = Date.now() + 3000;
    while (alive(pid) && Date.now() < deadline) execFileSync('sleep', ['0.1']);

    if (alive(pid)) {
      try {
        process.kill(target, 'SIGKILL');
      } catch {
        // Gone after all.
      }
    }

    console.log(`  ✓ freed :${port} — ${what}`);
    freed++;
  }
}

if (LIST_ONLY) {
  if (listed === 0 && blocked === 0) console.log(`  nothing listening on ${PORTS.join(', ')}`);
} else if (freed > 0) {
  console.log(`  ${freed} stale dev process group(s) cleared.`);
}

// A port held by something outside the repo will still fail at bind, so fail
// here instead — with a message that names the holder.
process.exit(blocked > 0 ? 1 : 0);
