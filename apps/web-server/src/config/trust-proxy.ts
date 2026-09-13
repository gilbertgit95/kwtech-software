/**
 * Which proxies may tell this API who the client is — Express's `trust proxy`.
 *
 * ## Why it matters (PLAN §12.69)
 *
 * Every browser request reaches the API through the Next server, so without
 * this `ThrottlerGuard` sees ONE address — the Next server's — and the tight
 * `credential` bucket is shared by everybody behind it: sign-in, 2FA, password
 * reset, and a TV's display code.
 *
 * ## ⚠ Why the default is OFF, not "trust the Next server"
 *
 * Trusting a proxy means believing the `X-Forwarded-For` it passes on. Next's
 * route handlers forward whatever `X-Forwarded-For` the browser's request
 * carried. If nothing in front of Next overwrites that header, a client simply
 * sends its own, and a trusted Next server hands the forgery to the API — so
 * every rate limit can be dodged by making up an address. That is strictly
 * worse than today's shared bucket.
 *
 * So trust is a DEPLOYMENT fact, set by whoever knows the topology:
 *
 *   unset / false   trust nobody. Every request is the socket's own address.
 *   1, 2, …         trust that many hops nearest the API — e.g. `1` when the
 *                   API is only reachable from a Next server that itself sits
 *                   behind an edge proxy which REWRITES X-Forwarded-For.
 *   a list          trust these addresses or subnets, or Express's presets
 *                   (`loopback`, `linklocal`, `uniquelocal`).
 *
 * ⚠ `true` (trust every hop) is refused: it believes any client's header.
 */
export type TrustProxySetting = false | number | string[];

export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = raw?.trim();
  if (!value || ['false', 'off', 'none', '0'].includes(value.toLowerCase())) return false;
  if (value.toLowerCase() === 'true') {
    throw new Error(
      'TRUST_PROXY=true would trust every hop, so any client could forge its address and escape every rate limit. ' +
        'Set the number of proxies in front of the API, or their addresses — see src/config/trust-proxy.ts.',
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
