import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * Who may open the Local Network page (docs/LOCAL-NETWORK-PLAN.md §6).
 *
 * ONE key, because the page only reads, and everything it reads is public
 * already: the local authority's PUBLIC certificate (Caddy serves the same
 * file to anyone on the Wi-Fi at `/kwtech-local-ca.crt`) and the address
 * phones open. Nothing here is worth splitting by risk. The private key is
 * never read at all (§5), so there is no privileged act to guard.
 *
 * ⚠ Snake_case, `local_network:read`, not the plan's first spelling
 * `local-network:read`: every key in this repository is snake_case
 * (`app_hub:read`), and `FEATURE_KEY_PATTERN` in module-permissions refuses a
 * hyphen, so a super admin could not even type the hyphenated key on the
 * Features page (#78).
 *
 * ⚠ APP LEVEL, and granted to nobody by this module. `super-admin` holds every
 * registered key (seed/app-roles.ts derives it from the registry), so after
 * `db:sync` it is the only role with this one, as with `backup:*`. Granting it
 * to another role is a choice made on the Roles page.
 */
export const LOCAL_NETWORK_FEATURE = {
  /** The Local Network page: the certificate, its details, and the addresses. */
  read: 'local_network:read',
} as const;

export type LocalNetworkFeatureKey = (typeof LOCAL_NETWORK_FEATURE)[keyof typeof LOCAL_NETWORK_FEATURE];

export const LOCAL_NETWORK_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: LOCAL_NETWORK_FEATURE.read,
    module: 'local_network',
    level: 'app',
    label: 'See the local network setup',
    description:
      'See the address phones and computers on the shop’s network open, and download the certificate they install to trust it.',
    tags: ['server'],
    /*
     * Empty until the guard exists: `Query.localNetwork` is bound in the same
     * change that adds its resolver (phase 3 of #66). A binding that names a
     * surface with no guard reads as coverage while guarding nothing.
     */
    bindings: [],
  },
];
