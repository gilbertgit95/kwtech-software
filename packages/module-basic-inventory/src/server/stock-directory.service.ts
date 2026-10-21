import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { StockMemberDirectory } from './ports.js';
import { STOCK_MEMBER_DIRECTORY } from './stock.tokens.js';
import type { StockNames } from './stock.views.js';

/**
 * Names for the history: who received, adjusted, wasted or counted.
 *
 * ⚠ A NAME IS A COURTESY, NEVER A REASON TO FAIL. Unbound or failing, everybody
 * is "a team member" and the history still reads.
 */
@Injectable()
export class StockDirectoryService {
  private readonly logger = new Logger('StockDirectory');

  constructor(@Optional() @Inject(STOCK_MEMBER_DIRECTORY) private readonly directory?: StockMemberDirectory) {}

  async names(userIds: Iterable<string | null>): Promise<StockNames> {
    const ids = [...new Set([...userIds].filter((id): id is string => id !== null))];
    if (!this.directory || ids.length === 0) return new Map();
    try {
      const members = await this.directory.describe(ids);
      return new Map(members.map((member) => [member.userId, member.displayName]));
    } catch (error) {
      this.logger.warn(`Names could not be read for the stock history: ${(error as Error).message}`);
      return new Map();
    }
  }
}
