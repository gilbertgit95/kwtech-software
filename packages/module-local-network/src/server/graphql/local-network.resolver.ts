import { Inject } from '@nestjs/common';
import { Context, Query, Resolver } from '@nestjs/graphql';
import { LocalNetworkError } from '../local-network.errors.js';
import type { ResolvedLocalNetworkOptions } from '../local-network.options.js';
import { LocalNetworkService } from '../local-network.service.js';
import { LOCAL_NETWORK_OPTIONS } from '../local-network.tokens.js';
import { LocalNetworkType } from './local-network.types.js';

/**
 * The Local Network page's surface: one query. App level, like the Backups
 * page's: the guard checks `local_network:read` (feature-keys.ts) against
 * the caller's app-level grants, so no scope is declared.
 *
 * ⚠ Not public, although everything it returns is (Caddy serves the same
 * certificate to anyone on the Wi-Fi): the PAGE is for super admins, and
 * nothing is gained by letting anybody signed in enumerate the server's
 * setup.
 */
@Resolver()
export class LocalNetworkResolver {
  constructor(
    private readonly localNetwork: LocalNetworkService,
    @Inject(LOCAL_NETWORK_OPTIONS) private readonly options: ResolvedLocalNetworkOptions,
  ) {}

  @Query(() => LocalNetworkType, { name: 'localNetwork' })
  async view(@Context() gql: { req?: unknown }): Promise<LocalNetworkType> {
    this.actor(gql.req);
    return this.localNetwork.view();
  }

  /** The actor, proven by the app's guard. The module never resolves identity itself. */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new LocalNetworkError('not_signed_in');
    return actorId;
  }
}
