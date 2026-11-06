/**
 * ⚠ THE ONE COPY OF THE WHOLE-ORIGIN RULE: is the profile's FRONTEND_URL an
 * address phones on the shop's network can open through Caddy?
 * (docs/LOCAL-NETWORK-PLAN.md §4, "Where the rule lives").
 *
 * Its three readers run at different times, two of them before anything is
 * built, which is why it is a plain CommonJS file with no dependencies rather
 * than something in a package's `src/` (that exists only as `dist/` after a
 * build):
 *
 *   - the pm2 launcher (`ecosystem.config.cjs`, through host.cjs), which
 *     ⚠ `pnpm pm2:start` loads WITHOUT building;
 *   - `pnpm env:check` (scripts/env.mjs), on any profile;
 *   - the API, once at boot (apps/web-server/src/config/env.ts), which hands
 *     the answer to module-local-network. The module holds no copy.
 *
 * ⚠ The WHOLE origin, not only its host. Caddy serves `https://<host>` on 443
 * (deploy/https/Caddyfile) and the Local Network page publishes FRONTEND_URL
 * itself, as text and as a QR code. `https://192.168.1.68:8443` passes on its
 * host and sends every phone to a port nothing listens on. So the address
 * must be EXACTLY `https://<private IPv4>`: no port, no user or password, no
 * path, no query, no fragment, written as the URL parser writes it back.
 *
 * CommonJS, because pm2 loads the ecosystem file with require().
 */

const { isIPv4 } = require('node:net');

const PRIVATE_RANGES = '10.x, 172.16–31.x or 192.168.x';

/**
 * A private IPv4 address — where phones on the shop's Wi-Fi reach the server.
 * The same ranges `pnpm https:setup` detects (scripts/https-setup.mjs).
 */
function isPrivateAddress(host) {
  // Node's own IPv4 check rather than a hand-written one. A URL's host is already normalised by the parser.
  if (!isIPv4(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * `{ ok: true, host }` when `url` is exactly `https://<private IPv4>`, else
 * `{ ok: false, problem }`, the problem in words a person can act on. The
 * launcher, `pnpm env:check` and the page print the same words.
 */
function checkLocalOrigin(url) {
  const text = typeof url === 'string' ? url : '';
  if (!text.trim()) return { ok: false, problem: 'it is empty' };
  /*
   * ⚠ Refused, not trimmed: "exactly https://<address>" means the profile says
   * what phones will be shown, and a value with spaces around it (inside the
   * quotes of an env file) is not that, however the URL parser reads it.
   */
  if (text.trim() !== text) return { ok: false, problem: 'it has spaces around it' };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, problem: 'it is not a valid address' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, problem: 'it is not https://' };
  if (!isPrivateAddress(parsed.hostname)) {
    return { ok: false, problem: `its host is not a private IPv4 address (${PRIVATE_RANGES})` };
  }
  if (parsed.username || parsed.password) return { ok: false, problem: 'it has a user name or password' };
  if (parsed.port) return { ok: false, problem: 'it has a port; Caddy listens on 443 only' };
  if (parsed.pathname !== '/') return { ok: false, problem: 'it has a path' };
  if (parsed.search) return { ok: false, problem: 'it has a query' };
  if (parsed.hash) return { ok: false, problem: 'it has a fragment' };
  /*
   * Last, for whatever the parser rewrote: a trailing slash, an upper-case
   * scheme, an octal or hex address (`https://0300.0250.1.68` becomes
   * 192.168.1.68). The profile must say what phones will be shown.
   */
  if (parsed.origin !== text) return { ok: false, problem: `write it exactly as ${parsed.origin}` };
  return { ok: true, host: parsed.hostname };
}

/**
 * Whether a FRONTEND_URL MEANT to be served on the shop's network, so a
 * failure of the rule is a mistake to stop on rather than a profile with
 * nothing to serve there: `https://`, and a private host or no parsable host
 * at all (`https://:443`). A domain (a remote server) and `http://` (one
 * computer) are outside it, and start as they always have.
 */
function meantForLocalNetwork(url) {
  const text = typeof url === 'string' ? url.trim() : '';
  if (!/^https:\/\//iu.test(text)) return false;
  try {
    return isPrivateAddress(new URL(text).hostname);
  } catch {
    return true;
  }
}

module.exports = { checkLocalOrigin, isPrivateAddress, meantForLocalNetwork };
