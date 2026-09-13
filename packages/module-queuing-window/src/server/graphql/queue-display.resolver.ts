import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { QueueDisplayService } from '../queue-display.service.js';
import { QueueDisplayPassType } from './queue.types.js';

/**
 * The queue's PUBLIC surface: a TV exchanging a display code for a pass.
 *
 * ## Why this is its own resolver
 *
 * `QueueResolver` declares workspace scope on its class, and every operation
 * there needs a signed-in person with a key. This one is reached by a screen
 * nobody signs in to, and names its workspace by KEY rather than id. Keeping it
 * in a separate class means no public marker can ever sit on the workspace
 * class, and no workspace scope on this one — `surface-coverage.test.ts` checks
 * both. Every method here must be public, which is also what makes a method
 * added here without one fail loudly: `JwtAuthGuard` refuses it "Not signed in".
 *
 * ## Why it carries two markers
 *
 * `PUBLIC_SURFACE_METADATA` lets it through authentication, with the reason on
 * the record. `CREDENTIAL_SURFACE_METADATA` tells the app somebody is GUESSING
 * A SECRET here, so the app points its tightest rate limit at it — the same
 * bucket sign-in uses. This module may not depend on the throttler, so it
 * declares the fact and the app applies the policy.
 */
@Resolver()
export class QueueDisplayResolver {
  constructor(private readonly displays: QueueDisplayService) {}

  /**
   * ⚠ NULL IS THE ONLY REFUSAL, whatever the reason, so the page can say only
   * `DISPLAY_CODE_REFUSAL_MESSAGE`. See `QueueDisplayService.openDisplay`.
   */
  @SetMetadata(PUBLIC_SURFACE_METADATA, 'A TV in a waiting room has no session; the display code is the authorisation')
  @SetMetadata(CREDENTIAL_SURFACE_METADATA, 'Somebody typing a display code is guessing a secret')
  @Mutation(() => QueueDisplayPassType, { name: 'openQueueDisplay', nullable: true })
  async openQueueDisplay(
    @Args('organizationKey') organizationKey: string,
    @Args('workspaceKey') workspaceKey: string,
    @Args('code') code: string,
  ): Promise<QueueDisplayPassType | null> {
    const opened = await this.displays.openDisplay(organizationKey, workspaceKey, code);
    return opened ? { pass: opened.pass, workspaceName: opened.workspaceName } : null;
  }
}
