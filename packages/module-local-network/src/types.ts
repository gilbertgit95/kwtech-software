/**
 * What the page can be told, and why it may show nothing.
 *
 * - `off`: the API's switch is off (`LOCAL_NETWORK` unset, as on every remote
 *   server). ⚠ The query EXISTS while off and says so, rather than being left
 *   out of the schema (operator, 2026-11-06, #84): the committed
 *   `schema.graphql` is rewritten at every boot, and a field that came and went
 *   with a profile setting would make that file differ from machine to
 *   machine. Nothing is read while off.
 * - `ready`: the certificate is on this computer and the profile publishes an
 *   address on the shop's network. Everything is shown.
 * - `certificate_missing`: the switch is on, but `.caddy/` has no root
 *   certificate (deleted, or never set up on this computer).
 * - `origin_invalid`: the switch is on, but the profile's `FRONTEND_URL` is
 *   not exactly `https://<private IPv4>` (a port, a path, `http://`, a
 *   domain…). ⚠ Neither the address nor the certificate is shown: on any other
 *   origin they would lead phones somewhere Caddy does not answer.
 */
export type LocalNetworkState = 'ready' | 'off' | 'certificate_missing' | 'origin_invalid';

/** The local authority's PUBLIC root certificate, and what to compare on a device before trusting it. */
export interface LocalNetworkCertificateView {
  /** The certificate itself, PEM: a few hundred bytes the browser saves as `kwtech-local-ca.crt`. */
  pem: string;
  /** SHA-256 fingerprint, colon-separated upper-case hex, as iPhones, Macs, Android and Firefox show it. */
  sha256: string;
  /** SHA-1 fingerprint, the same form: Windows' certificate window shows only this, as "Thumbprint". */
  sha1: string;
  /** Who it names, as the device shows it ("CN=Caddy Local Authority - 2026 ECC Root"). */
  subject: string;
  /** ISO-8601: when it stops being valid. */
  expiresAt: string;
}

/**
 * The page's whole answer. Flat with nullable parts rather than a GraphQL
 * union, as module-backup's state is, so the client reads one shape: when
 * `state` is not `ready`, every address and the certificate are null and
 * `problem` says what to do.
 */
export interface LocalNetworkView {
  state: LocalNetworkState;
  /** The sentence to show when `state` is not `ready` (`localNetworkStateMessage`); null when ready. */
  problem: string | null;
  /** `https://<address>`: what a device opens, and the first QR code. */
  appUrl: string | null;
  /** `http://<address>/kwtech-local-ca.crt`: where a new device downloads the certificate, the second QR code. */
  certificateUrl: string | null;
  certificate: LocalNetworkCertificateView | null;
}

/**
 * The whole-origin rule's answer, as the app hands it over: `checkLocalOrigin`
 * in `deploy/https/origin.cjs` (phase 5 of #66) returns exactly this shape.
 * ⚠ The module holds no copy of the rule: it believes this answer and only
 * builds addresses from `host`.
 */
export type LocalNetworkOriginCheck = { ok: true; host: string } | { ok: false; problem: string };

/** Every reason the query is refused. Each has one sentence in `local-network.errors.ts`. */
export type LocalNetworkRefusal = 'not_signed_in';
