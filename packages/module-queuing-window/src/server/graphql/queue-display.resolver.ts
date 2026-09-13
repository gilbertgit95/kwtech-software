import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import { Args, Context, Mutation, Resolver, Subscription } from '@nestjs/graphql';
import { QueueWriteError } from '../queue.errors.js';
import { QueueBoardService, type QueueDisplayEvent } from '../queue-board.service.js';
import { QueueDisplayService, readDisplayAdmission } from '../queue-display.service.js';
import { QueueDisplayEventType, QueueDisplayPassType } from './queue.types.js';

/**
 * The queue's PUBLIC surface: a TV exchanging a code for a pass, and then
 * watching the board.
 *
 * ## Why this is its own resolver
 *
 * `QueueResolver` declares workspace scope on its class, and every operation
 * there needs a signed-in person with a key. These are reached by a screen
 * nobody signs in to. Keeping them in a separate class means no public marker
 * can ever sit on the workspace class, and no workspace scope on this one —
 * `surface-coverage.test.ts` checks both. Every method here must be public,
 * which is also what makes a method added without a marker fail loudly:
 * `JwtAuthGuard` refuses it "Not signed in".
 */
@Resolver()
export class QueueDisplayResolver {
  constructor(
    private readonly displays: QueueDisplayService,
    private readonly board: QueueBoardService,
  ) {}

  /**
   * ⚠ NULL IS THE ONLY REFUSAL, whatever the reason, so the page can say only
   * `DISPLAY_CODE_REFUSAL_MESSAGE`. See `QueueDisplayService.openDisplay`.
   *
   * ⚠ A CREDENTIAL SURFACE: somebody typing a code is guessing a secret, so the
   * app points its tightest rate limit here. This module may not depend on the
   * throttler, so it declares the fact and the app applies the policy.
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

  /**
   * The board, live, for a socket admitted by a display pass.
   *
   * ⚠ PUBLIC, BUT NOT OPEN. "Public" lets it past authentication, because a TV
   * has no session. What admits a TV is the pass it presented at the HANDSHAKE,
   * which the app's `admitAnonymous` hook exchanged for an admission on the
   * socket. With no admission — a signed-in socket, or any other — this refuses
   * before streaming anything. It takes no arguments on purpose: the workspace
   * comes from the pass, so a TV cannot ask for somebody else's board.
   *
   * Not a credential surface: a 256-bit pass is not guessed, and a socket
   * operation is not throttled per request anyway.
   */
  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'A TV admitted at the socket handshake by its display pass; nobody is signed in',
  )
  @Subscription(() => QueueDisplayEventType, {
    name: 'queueDisplay',
    // ⚠ REQUIRED, or GraphQL finds no `queueDisplay` key and delivers null.
    resolve: (payload: QueueDisplayEventType) => payload,
  })
  queueDisplay(@Context() gql: { req?: unknown }): AsyncIterableIterator<QueueDisplayEvent> {
    const admission = readDisplayAdmission(gql.req);
    if (!admission) {
      throw new QueueWriteError('not_permitted', 'Only a display admitted with its pass can watch the board');
    }
    return this.board.stream(admission);
  }
}
