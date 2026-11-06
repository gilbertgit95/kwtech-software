/**
 * The address phones open over HTTPS, or null — read once, here, for both ways
 * Caddy is started: pm2 (`ecosystem.config.cjs`, the built apps) and `pnpm
 * https` (scripts/https.mjs, beside the dev servers).
 *
 * It is the API's FRONTEND_URL, from the active profile's file as the apps
 * read it, so the address is set in one place rather than two that can
 * disagree.
 *
 * ⚠ CADDY IS ONLY FOR THE SHOP'S OWN NETWORK (2026-10-29, docs/HTTPS.md): a
 * PRIVATE IPv4 address (10.x, 172.16–31.x, 192.168.x), the one case with no
 * domain and so no public certificate. Null for http://, localhost, and a
 * DOMAIN — a remote server's HTTPS comes from its host (the platform,
 * Cloudflare, nginx), and a Caddy started there with the LOCAL authority
 * would clash with it on port 443 or serve a certificate nobody trusts.
 *
 * CommonJS, because pm2 loads the ecosystem file with require().
 */
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { checkLocalOrigin, isPrivateAddress, meantForLocalNetwork } = require('./origin.cjs');

const REPO = resolve(__dirname, '..', '..');

/**
 * One setting from the API's file (the active profile), or null when unset or
 * empty. An EXPORTED variable wins, as it does for the API itself
 * (`load-env.ts`: dotenv never overrides the environment).
 */
function serverSetting(key) {
  const exported = process.env[key]?.trim();
  if (exported) return exported;
  const file = resolve(REPO, 'apps/web-server/.env.local');
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\s]*)`, 'm'));
  return match?.[1] ? match[1] : null;
}

/**
 * One setting EXACTLY as the API reads it: an exported value untrimmed, and a
 * quoted value in the file with whatever is inside the quotes, spaces
 * included. Null when unset.
 *
 * ⚠ For FRONTEND_URL, not `serverSetting`, which trims and stops at the first
 * space: the whole-origin rule refuses spaces, and a launcher that trimmed
 * them away would start Caddy for a value the API (and the Local Network
 * page) refuses, or read a leading-space value as unset and say nothing at
 * all (#85 review).
 */
function rawServerSetting(key) {
  const exported = process.env[key];
  if (exported !== undefined) return exported;
  const file = resolve(REPO, 'apps/web-server/.env.local');
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(
    new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s#]*))`, 'm'),
  );
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * The address BOTH apps listen on (`LISTEN_HOST`), or null for every address.
 * One setting for the two: the API reads it itself (`config/env.ts`), the web
 * app gets it as `next -H` from `scripts/next.mjs` and pm2, because Next
 * takes the address only as a flag. docs/HTTPS.md.
 */
function listenHost() {
  return serverSetting('LISTEN_HOST');
}

/**
 * The same address, as the WEB APP must be given it: `next -H`.
 *
 * ⚠ THIS COMPUTER IS `localhost` TO NEXT, NEVER `127.0.0.1`. Next writes
 * 127.0.0.1 as "localhost" inside the middleware (`NextURL`), so with
 * `-H 127.0.0.1` the phone layout's rewrite (`proxy.ts`) pointed at another
 * host than the server's own, Next treated it as EXTERNAL and fetched
 * `https://localhost:8081/mobile` from itself — over TLS, from a plain-http
 * port: every phone page was a 500 (found 2026-10-29). `-H localhost` keeps
 * the rewrite internal, and still answers only to this computer.
 */
function webListenHost() {
  const host = listenHost();
  if (!host) return null;
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(host) ? 'localhost' : host;
}

/**
 * The host Caddy serves, or null for a profile with nothing to serve on the
 * shop's network. The whole-origin rule decides (origin.cjs), so Caddy is
 * never started for an address the Local Network page would refuse.
 *
 * ⚠ Null for a BAD local origin too. A caller that starts Caddy must call
 * `requireLocalOrigin()` first, or a typo (`https://192.168.1.68:8443`)
 * quietly starts the apps with no HTTPS in front of them — the silent branch
 * this replaced (#84).
 */
function httpsHost() {
  const check = checkLocalOrigin(rawServerSetting('FRONTEND_URL'));
  return check.ok ? check.host : null;
}

/**
 * Throws, naming the problem, when FRONTEND_URL was meant for the shop's
 * network (`https://` on a private address, or unparsable) but fails the
 * whole-origin rule. Does nothing for a domain or `http://`: those start as
 * they always have.
 */
function requireLocalOrigin() {
  const frontend = rawServerSetting('FRONTEND_URL');
  if (!meantForLocalNetwork(frontend)) return;
  const check = checkLocalOrigin(frontend);
  if (check.ok) return;
  throw new Error(
    `FRONTEND_URL is ${frontend} in apps/web-server/.env.local, and ${check.problem}. ` +
      'Phones on the shop’s network need exactly https://<address>: run pnpm https:setup.',
  );
}

/** What Caddy is started with, both ways. */
function caddyLaunch(host) {
  return {
    command: 'caddy',
    args: ['run', '--config', resolve(REPO, 'deploy/https/Caddyfile'), '--adapter', 'caddyfile'],
    env: { KWTECH_HTTPS_HOST: host, KWTECH_CADDY_STORAGE: resolve(REPO, '.caddy') },
  };
}

module.exports = {
  httpsHost,
  requireLocalOrigin,
  serverSetting,
  listenHost,
  webListenHost,
  isPrivateAddress,
  caddyLaunch,
  REPO,
};
