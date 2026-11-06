import type { LocalNetworkState } from '../types.js';

/**
 * What the page says when it shows no certificate and no address. Here, in
 * the root, so the API's `problem` and the page's own fallback are the same
 * sentence (docs/LOCAL-NETWORK-PLAN.md §4: "in the same words").
 *
 * `publishedOrigin` is the profile's `FRONTEND_URL` as the app read it, named
 * in the `origin_invalid` sentence so the person sees what is wrong. It is
 * already public: it is the address the web app is served at. Null when the
 * profile has none.
 */
export function localNetworkStateMessage(
  state: Exclude<LocalNetworkState, 'ready'>,
  publishedOrigin: string | null,
): string {
  switch (state) {
    case 'certificate_missing':
      return 'Local HTTPS is on in this profile, but its certificate is not on this computer: run `pnpm https:setup` (docs/HTTPS.md §4).';
    case 'origin_invalid':
      return publishedOrigin
        ? `Local Network is on, but this profile publishes ${publishedOrigin}, not an address on the shop’s network: run \`pnpm https:setup\`.`
        : 'Local Network is on, but this profile publishes no address: run `pnpm https:setup`.';
  }
}

/**
 * What the page says when ITS switch is on but the API's is off: the web app
 * was built with `NEXT_PUBLIC_LOCAL_NETWORK="on"`, and the API started without
 * `LOCAL_NETWORK="on"` (a profile changed without a rebuild, or edited by
 * hand). The API has no query to answer with, so this sentence lives here for
 * the page alone (§4, "When the two disagree"). Never an error screen, and
 * never a stale address.
 */
export const LOCAL_NETWORK_API_OFF_MESSAGE =
  'Local Network is off on this server’s API. Run `pnpm https:setup` (or `--off`), then `pnpm build`.';
