import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * What this app hands module-local-network (docs/LOCAL-NETWORK-PLAN.md §5:
 * "the module knows no paths and no addresses"). Read once, at boot.
 *
 * Both paths are resolved from THIS file, whose depth is the same in `src/`
 * and `dist/` (apps/web-server/{src,dist}/config/), so the built API and the
 * test runner find the same repository root.
 */

/** The answer of the whole-origin rule: the module's `LocalNetworkOriginCheck`, copied structurally. */
export type LocalOriginCheck = { ok: true; host: string } | { ok: false; problem: string };

/*
 * ⚠ THE ONE COPY OF THE RULE is `deploy/https/origin.cjs`, plain CommonJS
 * because the pm2 launcher and `pnpm env:check` read it before anything is
 * built. This app requires the same file rather than restating it: two copies
 * of "is this address on the shop's network" is how the launcher starts Caddy
 * for an address the page refuses, or the reverse.
 */
const rule = createRequire(import.meta.url)(
  fileURLToPath(new URL('../../../../deploy/https/origin.cjs', import.meta.url)),
) as {
  checkLocalOrigin: (url: string | undefined) => LocalOriginCheck;
};

export function checkLocalOrigin(url: string | undefined): LocalOriginCheck {
  return rule.checkLocalOrigin(url);
}

/**
 * ⚠ The local authority's PUBLIC root certificate, ONE file — never the
 * folder, which holds `root.key` and `intermediate.key` beside it. Caddy keeps
 * it here because `deploy/https/host.cjs` starts Caddy with its storage at
 * `<repo>/.caddy` (`KWTECH_CADDY_STORAGE`), and `pnpm https:setup` creates it
 * there.
 */
export const LOCAL_NETWORK_CERTIFICATE_PATH = fileURLToPath(
  new URL('../../../../.caddy/pki/authorities/local/root.crt', import.meta.url),
);
