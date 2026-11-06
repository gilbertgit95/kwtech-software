/**
 * The name the certificate is downloaded as, and the path Caddy serves it at
 * over plain HTTP (`deploy/https/Caddyfile`, `handle /kwtech-local-ca.crt`).
 * ⚠ The two must stay the same string: a QR code for any other path would
 * be redirected to HTTPS, which a new phone cannot open yet.
 */
export const LOCAL_NETWORK_CERTIFICATE_FILE = 'kwtech-local-ca.crt';

/** The two addresses the page publishes, each as text and as a QR code. */
export interface LocalNetworkAddresses {
  /** `https://<host>`: the app, for a device that already trusts the certificate. */
  appUrl: string;
  /**
   * `http://<host>/kwtech-local-ca.crt`: the certificate, for a device that
   * does not trust it yet. ⚠ Plain HTTP on purpose — it is the one thing a new
   * device can open — which is also why a fingerprint read over it proves
   * nothing (docs/LOCAL-NETWORK-PLAN.md §2).
   */
  certificateUrl: string;
}

/**
 * Both addresses, from the HOST the whole-origin rule returns
 * (`checkLocalOrigin` in `deploy/https/origin.cjs`, phase 5 of #66).
 *
 * It takes the host and not the published origin, so it cannot pass a port, a
 * path or a user through to a QR code: whatever it is given, the result is
 * port 443 for the app and port 80 for the certificate, the only two Caddy
 * listens on. ⚠ It does NOT decide whether the host is on the shop's network.
 * That rule has one copy, in `origin.cjs`, read by the launcher, `pnpm
 * env:check` and the API alike (§4, "Where the rule lives"); a second copy
 * here would be the one that drifts.
 */
export function localNetworkAddresses(host: string): LocalNetworkAddresses {
  return {
    appUrl: `https://${host}`,
    certificateUrl: `http://${host}/${LOCAL_NETWORK_CERTIFICATE_FILE}`,
  };
}
