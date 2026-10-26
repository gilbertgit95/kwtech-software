/**
 * The address phones open over HTTPS, or null — read once, here, for both ways
 * Caddy is started: pm2 (`ecosystem.config.cjs`, the built apps) and `pnpm
 * https` (scripts/https.mjs, beside the dev servers).
 *
 * It is the API's FRONTEND_URL, from the active profile's file as the apps
 * read it, so the address is set in one place rather than two that can
 * disagree. Null for http:// or localhost: then there is no Caddy.
 *
 * CommonJS, because pm2 loads the ecosystem file with require().
 */
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const REPO = resolve(__dirname, '..', '..');

function httpsHost() {
  const file = resolve(REPO, 'apps/web-server/.env.local');
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(/^\s*FRONTEND_URL\s*=\s*["']?([^"'\s]+)/m);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    return url.protocol === 'https:' && url.hostname !== 'localhost' ? url.hostname : null;
  } catch {
    return null;
  }
}

/** What Caddy is started with, both ways. */
function caddyLaunch(host) {
  return {
    command: 'caddy',
    args: ['run', '--config', resolve(REPO, 'deploy/https/Caddyfile'), '--adapter', 'caddyfile'],
    env: { KWTECH_HTTPS_HOST: host, KWTECH_CADDY_STORAGE: resolve(REPO, '.caddy') },
  };
}

module.exports = { httpsHost, caddyLaunch, REPO };
