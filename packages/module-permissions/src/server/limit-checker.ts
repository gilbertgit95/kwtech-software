import type { LimitChecker, LimitCheckInput, LimitDecision } from '@kwtech/module-kit';
import { Injectable } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';

/**
 * This module's answer to `@kwtech/module-kit`'s `LimitChecker` — the adapter
 * that lets ANY module cap something without knowing this module exists.
 *
 * ## The direction of the dependency, which is the whole design
 *
 * `module-chat` declares `chat:group_chats` as a `LimitContribution`, counts its
 * own rows, and injects a `LimitChecker`. It never imports this package; it
 * cannot, because §9 forbids a module importing a module. The APP binds this
 * class to chat's port, exactly as it already binds `resolvePrincipal` and a
 * Prisma client — one line, in the layer whose job is composition.
 *
 * ⚠ And where no such binding exists, chat still runs: `NULL_LIMIT_CHECKER`
 * allows everything, so a host with no permission model gets an unguarded but
 * working chat rather than a crash at first send. That is a stated design goal
 * (PLAN, 2026-09-10) rather than an accident, and the cost — an app that MEANT
 * to enforce a cap and forgot the binding gets silence — is the reason the
 * binding is one explicit line rather than a default.
 *
 * ## What it does not do
 *
 * It does not count. `LimitCheckInput.current` arrives from the caller, because
 * this module can only count `perm_*` tables and the rows being capped are never
 * in them. See `PermissionsService.checkCapacity`, which refuses rather than
 * returning zero for a key it cannot count.
 */
@Injectable()
export class PermissionsLimitChecker implements LimitChecker {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * One context load per check.
   *
   * Not cached, deliberately: a cap is asked about at a WRITE, which is rare
   * next to reads, and a stale cached context is a cap enforced from a role the
   * holder no longer has. Callers that check several caps in one operation
   * should load the context once and call
   * `PermissionsService.checkDeclaredLimit` directly.
   */
  check(input: LimitCheckInput): Promise<LimitDecision> {
    return this.permissions.checkLimitForActor({
      actorId: input.actorId,
      key: input.key,
      current: input.current,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    });
  }
}
