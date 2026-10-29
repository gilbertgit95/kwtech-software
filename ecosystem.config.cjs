/**
 * pm2 process file: the API and the web app as background services, from
 * their BUILT output (`pnpm pm2:start` builds first). Not a dev server: nothing
 * here watches or rebuilds, so an edit needs another `pnpm pm2:start`.
 *
 * Each app runs its node process directly rather than through `pnpm start` or
 * turbo. pm2 supervises the process it spawned; behind a pnpm or turbo wrapper
 * a crash of the real server leaves the wrapper alive, or a restart leaves the
 * old server holding the port.
 *
 * `cwd` matters: both apps read `.env.local` from their own directory
 * (apps/web-server/src/config/load-env.ts, and Next itself), which
 * `pnpm env:use` links to the active profile.
 *
 * CommonJS (.cjs) because pm2 loads this file with require().
 */
const { resolve } = require('node:path');
const { caddyLaunch, httpsHost, listenHost } = require('./deploy/https/host.cjs');

/** The address phones open over HTTPS, or null: the API's FRONTEND_URL (deploy/https/host.cjs). */
const HTTPS_HOST = httpsHost();
/*
 * The address both apps listen on (`LISTEN_HOST`, docs/HTTPS.md): the API
 * reads it itself; the web app takes it only as `-H`. Unset: every address.
 */
const LISTEN_HOST = listenHost();

module.exports = {
  apps: [
    {
      name: 'kwtech-web-server',
      cwd: resolve(__dirname, 'apps/web-server'),
      script: 'dist/main.js',
      // Matches `node dist/main.js` in the app's `start` script. The port is
      // PORT in .env.local (8080).
      interpreter: 'node',
      // A boot failure (a missing secret, a GraphQL schema error) exits at
      // once. Without a cap pm2 restarts it forever and the log fills with the
      // same stack trace; after 10 fast failures it stops and shows `errored`.
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      // No NODE_ENV here. The API's production checks (SMTP_URL and the rest
      // in src/config/env.ts) follow the env profile, as `pnpm start` does, so
      // the local profile boots and a production profile is still held to
      // them. `next start` sets NODE_ENV=production on its own.
    },
    {
      name: 'kwtech-web-app',
      cwd: resolve(__dirname, 'apps/web-app'),
      // Next's own CLI, the same `next start -p 8081` as the app's `start`
      // script, resolved from the app's node_modules so it is the app's Next.
      script: 'node_modules/next/dist/bin/next',
      args: LISTEN_HOST ? `start -p 8081 -H ${LISTEN_HOST}` : 'start -p 8081',
      interpreter: 'node',
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
    },
    /*
     * HTTPS in front of both, on 443 (deploy/https/Caddyfile), only when
     * FRONTEND_URL is https:// on a PRIVATE address (the shop's own network;
     * `httpsHost`). A domain runs no Caddy: a remote server's HTTPS is its
     * host's. ⚠ `caddy` must be installed on the machine (docs/HTTPS.md);
     * without it this one service shows `errored` and the other
     * two run as before. On Linux it needs leave to bind 443 without root:
     * `sudo setcap cap_net_bind_service=+ep "$(command -v caddy)"`.
     */
    ...(HTTPS_HOST
      ? [
          {
            name: 'kwtech-https',
            cwd: __dirname,
            script: caddyLaunch(HTTPS_HOST).command,
            args: caddyLaunch(HTTPS_HOST).args,
            interpreter: 'none',
            env: caddyLaunch(HTTPS_HOST).env,
            max_restarts: 10,
            min_uptime: '10s',
            restart_delay: 2000,
          },
        ]
      : []),
  ],
};
