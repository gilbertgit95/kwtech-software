import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { BooksFeatureKey } from '../feature-keys.js';
import type { InScope } from './books.repository.js';
import { BOOKS_ACCESS_CHECK } from './books.tokens.js';
import type { BooksAccessCheck } from './ports.js';

/**
 * The one question where a key changes what an operation may touch rather than
 * whether it runs — the binding already decided that (see `ports.ts`).
 *
 * ⚠ FAIL CLOSED: with the port unbound, or when it throws, the answer is no.
 * An investor's payout voided by mistake changes what they are owed; refusing
 * by mistake costs a second person a click.
 */
@Injectable()
export class BooksAccessService {
  private readonly logger = new Logger('BooksAccess');

  constructor(@Optional() @Inject(BOOKS_ACCESS_CHECK) private readonly access?: BooksAccessCheck) {}

  async holds(scope: InScope, userId: string, key: BooksFeatureKey): Promise<boolean> {
    if (!this.access) return false;
    try {
      return await this.access.holds(scope.organizationId, scope.workspaceId, userId, key);
    } catch (error) {
      this.logger.warn(`A books access check failed and was answered no: ${(error as Error).message}`);
      return false;
    }
  }
}
