/**
 * Shows a file in this machine's file manager: Windows Explorer from WSL (the
 * file highlighted), Finder on a Mac, the folder on a Linux desktop.
 *
 *   import { revealInFileManager } from './reveal.mjs';   // from another script
 *   node scripts/reveal.mjs <file>                       // from anything else
 *
 * The command form exists for `apps/web-server`'s `db:snapshot`, which is
 * TypeScript built into that app's dist/ and so cannot import a repo-root
 * script; it runs this instead, and the rule lives in one place.
 *
 * Always a convenience, never a step that fails its caller: the file is
 * already written when this runs, so a missing file manager is a warning and
 * exit code 0. Skipped without a terminal (a script, CI) and with `--no-open`
 * on the caller's command line: a window appearing on a machine nobody is
 * watching is noise at best.
 */
import { spawn, spawnSync } from 'node:child_process';
import { release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The command that shows `path`, or null on a platform with no file manager to ask.
 *
 * WSL first, told by its kernel (`…-microsoft-standard-WSL2`) rather than by
 * `WSL_DISTRO_NAME`, which a `sudo` or a cleared environment drops.
 * `process.platform` there is `linux`, but the desktop is Windows,
 * and `xdg-open` inside the distro does nothing or opens a Linux file manager
 * nobody has. `wslpath -w` turns the path into the `\\wsl.localhost\…` form
 * Explorer can open, and `/select,` highlights the file rather than only
 * opening its folder.
 */
function revealCommand(path) {
  if (process.platform === 'linux' && /microsoft/i.test(release())) {
    const windowsPath = spawnSync('wslpath', ['-w', path], { encoding: 'utf8' }).stdout?.trim();
    return windowsPath ? { command: 'explorer.exe', args: [`/select,${windowsPath}`] } : null;
  }
  if (process.platform === 'win32') return { command: 'explorer.exe', args: [`/select,${path}`] };
  if (process.platform === 'darwin') return { command: 'open', args: ['-R', path] };
  // A Linux desktop has no common "select this file", so its folder opens. On a
  // machine with no screen, xdg-open exits with an error nobody waits for.
  if (process.platform === 'linux') return { command: 'xdg-open', args: [dirname(path)] };
  return null;
}

/**
 * ⚠ Explorer's exit status is NOT checked. `explorer.exe` returns 1 even when
 * it opened the window, so checking it would report every success as a
 * failure. Detached and unref'd, so the caller returns at once instead of
 * waiting on a window.
 *
 * `interactive` is the CALLER's terminal: run as a child with piped output,
 * this process's own stdout is never a TTY, so the caller decides.
 */
export function revealInFileManager(path, { interactive = process.stdout.isTTY } = {}) {
  if (!interactive || process.env.CI || process.argv.includes('--no-open')) return;
  const reveal = revealCommand(resolve(path));
  if (!reveal) return;
  const child = spawn(reveal.command, reveal.args, { detached: true, stdio: 'ignore' });
  child.on('error', (error) => console.warn(`  ! could not open the file manager (${error.message})`));
  child.unref();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/reveal.mjs <file>');
    process.exit(1);
  }
  // Run as a command, the caller checked its own terminal already.
  revealInFileManager(path, { interactive: true });
}
