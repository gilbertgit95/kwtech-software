import { declareScope, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { Inject, SetMetadata } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AppHubWriteError } from '../app-hub.errors.js';
import type { AppHubModuleOptions } from '../app-hub.options.js';
import { AppHubService } from '../app-hub.service.js';
import { APP_HUB_OPTIONS } from '../app-hub.tokens.js';
import { AppHubLayoutsType } from './app-hub.types.js';

/**
 * The Apps page's GraphQL surface: read both saved layouts, save or reset your
 * own, save or reset the workspace default.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Both `app_hub:*` keys are WORKSPACE level. A resolver has no path, so without
 * this declaration `FeatureGuard` resolves app level, where no workspace key
 * participates, and every operation refuses everybody (§12.13). Declared on the
 * CLASS so an operation added later cannot forget it; `surface-coverage.test.ts`
 * fails if it goes. Every operation therefore takes `organizationId` and
 * `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `APP_HUB_FEATURE_REGISTRY`, which
 * the host composes into its feature registry.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class AppHubResolver {
  constructor(
    private readonly hub: AppHubService,
    @Inject(APP_HUB_OPTIONS) private readonly options: AppHubModuleOptions,
  ) {}

  @Query(() => AppHubLayoutsType, { name: 'appHubLayouts' })
  async layouts(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<AppHubLayoutsType> {
    const { mine, workspace } = await this.hub.layouts({ organizationId, workspaceId }, this.actor(gql.req));
    return {
      mine: mine ? JSON.stringify(mine) : null,
      workspace: workspace ? JSON.stringify(workspace) : null,
    };
  }

  @Mutation(() => Boolean, { name: 'saveMyAppHubLayout' })
  async saveMine(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('layout') layout: string,
  ): Promise<boolean> {
    await this.hub.saveMine({ organizationId, workspaceId }, this.actor(gql.req), layout);
    return true;
  }

  @Mutation(() => Boolean, { name: 'resetMyAppHubLayout' })
  async resetMine(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<boolean> {
    await this.hub.resetMine({ organizationId, workspaceId }, this.actor(gql.req));
    return true;
  }

  @Mutation(() => Boolean, { name: 'saveWorkspaceAppHubLayout' })
  async saveWorkspace(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('layout') layout: string,
  ): Promise<boolean> {
    await this.hub.saveWorkspace({ organizationId, workspaceId }, this.actor(gql.req), layout);
    return true;
  }

  @Mutation(() => Boolean, { name: 'resetWorkspaceAppHubLayout' })
  async resetWorkspace(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<boolean> {
    await this.hub.resetWorkspace({ organizationId, workspaceId });
    return true;
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new AppHubWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}
