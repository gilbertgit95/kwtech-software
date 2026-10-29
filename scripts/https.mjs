/**
 * `pnpm https` — HTTPS for the dev servers, in a second terminal (as `pnpm
 * dev:print-agent` is): the same Caddy, config and certificate pm2 runs
 * in front of the built apps. Ctrl+C stops it.
 *
 *   pnpm dev:focus <package>     # terminal 1
 *   pnpm https                   # terminal 2 → https://<FRONTEND_URL's host>
 *
 * The address is the API's FRONTEND_URL (deploy/https/host.cjs). With it on
 * http:// or localhost this says so and starts nothing.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const { caddyLaunch, httpsHost } = createRequire(import.meta.url)('../deploy/https/host.cjs');

const host = httpsHost();
if (!host) {
  console.error('  ✗ FRONTEND_URL in apps/web-server/.env.local is not an https:// address on this network.');
  console.error('    Caddy is only for the shop\'s own network (a 192.168.x / 10.x / 172.16–31.x address):');
  console.error('    run pnpm https:setup. A server with a domain gets HTTPS from its host (docs/HTTPS.md).');
  process.exit(1);
}

const launch = caddyLaunch(host);
console.log(`  ▸ https://${host}  (certificate for phones: http://${host}/kwtech-local-ca.crt)`);
const caddy = spawn(launch.command, launch.args, { stdio: 'inherit', env: { ...process.env, ...launch.env } });
caddy.on('error', () => {
  console.error('  ✗ caddy is not installed. See README.md, "HTTPS on the local network".');
  process.exit(1);
});
caddy.on('close', (code) => process.exit(code ?? 0));
