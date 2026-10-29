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

function httpsHost() {
  const frontend = serverSetting('FRONTEND_URL');
  if (!frontend) return null;
  try {
    const url = new URL(frontend);
    return url.protocol === 'https:' && isPrivateAddress(url.hostname) ? url.hostname : null;
  } catch {
    return null;
  }
}

/**
 * A private IPv4 address — where phones on the shop's Wi-Fi reach the server.
 * The same ranges `pnpm https:setup` detects (scripts/https-setup.mjs).
 */
function isPrivateAddress(host) {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** What Caddy is started with, both ways. */
function caddyLaunch(host) {
  return {
    command: 'caddy',
    args: ['run', '--config', resolve(REPO, 'deploy/https/Caddyfile'), '--adapter', 'caddyfile'],
    env: { KWTECH_HTTPS_HOST: host, KWTECH_CADDY_STORAGE: resolve(REPO, '.caddy') },
  };
}

module.exports = { httpsHost, listenHost, webListenHost, isPrivateAddress, caddyLaunch, REPO };
