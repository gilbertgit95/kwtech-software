import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { POS_FEATURE, type PosFeatureKey } from '../feature-keys.js';
import type { PosAccessCheck } from './ports.js';
import type { InScope } from './pos.repository.js';
import { POS_ACCESS_CHECK } from './pos.tokens.js';

/**
 * The questions where a key changes WHAT an operation returns or keeps, rather
 * than whether it runs — the binding already decided that (see `ports.ts`).
 *
 * ⚠ FAIL CLOSED: with the port unbound, or when it throws, the answer is no.
 * A cost shown by mistake cannot be unshown; a cost hidden by mistake is a
 * reload away.
 */
@Injectable()
export class PosAccessService {
  private readonly logger = new Logger('PosAccess');

  constructor(@Optional() @Inject(POS_ACCESS_CHECK) private readonly access?: PosAccessCheck) {}

  async holds(scope: InScope, userId: string, key: PosFeatureKey): Promise<boolean> {
    if (!this.access) return false;
    try {
      return await this.access.holds(scope.organizationId, scope.workspaceId, userId, key);
    } catch (error) {
      this.logger.warn(`A POS access check failed and was answered no: ${(error as Error).message}`);
      return false;
    }
  }

  /** Whether costs, profit and margin may be in an answer to this person (guard rules). */
  async seesCosts(scope: InScope, userId: string): Promise<boolean> {
    const [items, reports] = await Promise.all([
      this.holds(scope, userId, POS_FEATURE.manageItems),
      this.holds(scope, userId, POS_FEATURE.reports),
    ]);
    return items || reports;
  }
}
