/**
 * Every GraphQL document the Local Network page sends. Validated against the
 * app's schema by `apps/web-server/test/module-operations.test.ts` once the
 * app composes the module (phase 5 of #66).
 *
 * One query, no mutation: the page reads and changes nothing (decision L10).
 * The certificate comes back as text inside it rather than through a ticket
 * and a REST route, because it is public and a few hundred bytes (L8).
 */
const CERTIFICATE = 'pem sha256 sha1 subject expiresAt';

export const LOCAL_NETWORK_OPERATIONS = {
  localNetwork: `query LocalNetwork { localNetwork { state problem appUrl certificateUrl certificate { ${CERTIFICATE} } } }`,
} as const;
