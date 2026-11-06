import type { LocalNetworkState } from '../types.js';

/**
 * What the page says when it shows no certificate and no address. Here, in
 * the root, so the API's `problem` and the page's own fallback are the same
 * sentence (docs/LOCAL-NETWORK-PLAN.md §4: "in the same words").
 *
 * `publishedOrigin` is the profile's `FRONTEND_URL` as the app read it, named
 * in the `origin_invalid` sentence so the person sees what is wrong. It is
 * already public: it is the address the web app is served at. Null when the
 * profile has none. `problem` is the whole-origin rule's own words for what
 * is wrong with it (`deploy/https/origin.cjs`: "it has a port", …), the same
 * words `pnpm env:check` and the launcher print, added when given.
 */
export function localNetworkStateMessage(
  state: Exclude<LocalNetworkState, 'ready'>,
  detail: { publishedOrigin: string | null; problem?: string | null | undefined },
): string {
  switch (state) {
    /*
     * Seen only when the WEB app's switch is on and the API's is off: a
     * profile changed without a rebuild, or edited by hand. On a remote
     * server both are off and nobody sees the page at all.
     */
    case 'off':
      return 'Local Network is off on this server’s API: it was started without LOCAL_NETWORK="on". Run `pnpm https:setup` (or `--off`), then `pnpm build` and restart.';
    case 'certificate_missing':
      return 'Local HTTPS is on in this profile, but its certificate is not on this computer: run `pnpm https:setup` (docs/HTTPS.md §4).';
    case 'origin_invalid': {
      const because = detail.problem ? ` (${detail.problem})` : '';
      return detail.publishedOrigin
        ? `Local Network is on, but this profile publishes ${detail.publishedOrigin}${because}, not an address on the shop’s network: run \`pnpm https:setup\`.`
        : 'Local Network is on, but this profile publishes no address: run `pnpm https:setup`.';
    }
  }
}
