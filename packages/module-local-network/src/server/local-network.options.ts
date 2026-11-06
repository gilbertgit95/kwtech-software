import type { LocalNetworkOriginCheck } from '../types.js';

export interface LocalNetworkModuleOptions {
  /**
   * The switch (`localNetworkIsEnabled`): on only for `true`. The app passes
   * its `LOCAL_NETWORK="on"`, which `pnpm https:setup` writes and a remote
   * server's profile never has.
   */
  enabled?: boolean | undefined;
  /**
   * ⚠ The path of the local authority's PUBLIC root certificate, ONE file:
   * `.caddy/pki/authorities/local/root.crt`. Not the folder: the folder holds
   * `root.key` and `intermediate.key` beside it, and a module given a folder
   * is one `readdir` from serving them. The module knows no paths; the app
   * does. Required while on.
   */
  certificatePath?: string | undefined;
  /**
   * The whole-origin rule's answer for the profile's `FRONTEND_URL`, worked
   * out once at boot by the app from `deploy/https/origin.cjs`. Required
   * while on: the module never reads `FRONTEND_URL` and never guesses an
   * address from the network interfaces (under WSL, what Linux sees and what
   * phones reach differ).
   */
  origin?: LocalNetworkOriginCheck | undefined;
  /** The `FRONTEND_URL` that answer is about, named in the page's message when it is not on the shop's network. */
  publishedOrigin?: string | null | undefined;
  /** Principal → `userId`. The module never learns what a session is. */
  resolveActorId?: ((request: unknown) => string | undefined) | undefined;
  expose?: { graphql?: boolean } | undefined;
}

export interface ResolvedLocalNetworkOptions {
  certificatePath: string;
  origin: LocalNetworkOriginCheck;
  publishedOrigin: string | null;
  resolveActorId?: (request: unknown) => string | undefined;
}

/**
 * The options as the service reads them, checked HERE, at boot, so a wiring
 * mistake stops the API with the fix named rather than showing a page that
 * says "not set up" for a reason that is not true.
 *
 * Only called while the switch is on: off, nothing is checked, because off
 * is a remote server, where there is no certificate to point at.
 */
export function resolveLocalNetworkOptions(options: LocalNetworkModuleOptions): ResolvedLocalNetworkOptions {
  const certificatePath = options.certificatePath?.trim();
  if (!certificatePath) {
    throw new Error(
      'localNetworkServerModule: certificatePath is required while enabled. Pass the path of .caddy/pki/authorities/local/root.crt.',
    );
  }
  /*
   * ⚠ Fail closed on the one wiring mistake that would matter most: a path to
   * a private key. Reading it would be refused anyway (`certificate.ts` serves
   * only a parsed certificate), but a key path is never a typo worth booting on.
   */
  if (/\.key$/iu.test(certificatePath)) {
    throw new Error(
      `localNetworkServerModule: certificatePath points at a private key (${certificatePath}). Pass root.crt, the public certificate.`,
    );
  }
  if (!options.origin) {
    throw new Error(
      'localNetworkServerModule: origin is required while enabled. Pass checkLocalOrigin(FRONTEND_URL) from deploy/https/origin.cjs.',
    );
  }
  return {
    certificatePath,
    origin: options.origin,
    publishedOrigin: options.publishedOrigin ?? null,
    ...(options.resolveActorId ? { resolveActorId: options.resolveActorId } : {}),
  };
}
