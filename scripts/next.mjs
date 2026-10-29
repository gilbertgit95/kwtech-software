/**
 * `next` for the web app, on the address both apps share (`LISTEN_HOST`,
 * docs/HTTPS.md): `node ../../scripts/next.mjs dev --turbopack -p 8081`.
 *
 * Next takes its address only as a flag (`-H`), never from the environment,
 * so this adds it: unset, nothing is added and Next listens on every address
 * as always; `127.0.0.1` (the shop's network, `pnpm https:setup`), the web
 * app answers only to Caddy on this computer. The API reads the same setting
 * itself (apps/web-server/src/config/env.ts).
 *
 * Run from apps/web-app (its package scripts), and replaced by nothing: the
 * child gets the terminal, and its exit code is this process's.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { listenHost } = createRequire(import.meta.url)('../deploy/https/host.cjs');

const args = process.argv.slice(2);
const host = listenHost();
const hasHostFlag = args.some((arg) => arg === '-H' || arg === '--hostname' || arg.startsWith('--hostname='));
const next = resolve(process.cwd(), 'node_modules/next/dist/bin/next');

const child = spawn(process.execPath, [next, ...args, ...(host && !hasHostFlag ? ['-H', host] : [])], {
  stdio: 'inherit',
});
// The dev runner and pm2 stop the app with a signal: pass it on, or Next is left running on the port.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
