import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { workspaceBooksDay } from '../domain/days.js';
import type { BooksDay } from '../types.js';
import type { InScope } from './books.repository.js';
import { BOOKS_WORKSPACE_TIME_ZONE } from './books.tokens.js';
import type { BooksWorkspaceTimeZone } from './ports.js';

/**
 * Which day "today" is follows the WORKSPACE's time zone
 * (`perm_workspace.timeZone`), which the books cannot read themselves — it
 * belongs to module-permissions, so the app answers through
 * `BooksWorkspaceTimeZone`.
 *
 * ⚠ UNBOUND, UNKNOWN OR NOT A REAL ZONE MEANS `DEFAULT_TIME_ZONE` — never the
 * server's UTC, which would refuse an evening's expense in Manila as dated
 * "tomorrow".
 */
@Injectable()
export class BooksTimeZoneService {
  private readonly logger = new Logger('BooksTimeZone');

  constructor(@Optional() @Inject(BOOKS_WORKSPACE_TIME_ZONE) private readonly zones?: BooksWorkspaceTimeZone) {}

  async of(scope: InScope): Promise<string> {
    if (!this.zones) return DEFAULT_TIME_ZONE;
    try {
      const zone = await this.zones.timeZoneOf(scope.organizationId, scope.workspaceId);
      return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
    } catch (error) {
      this.logger.warn(
        `The workspace's time zone could not be read; using ${DEFAULT_TIME_ZONE}: ${(error as Error).message}`,
      );
      return DEFAULT_TIME_ZONE;
    }
  }

  /** The workspace's today, at `now`. */
  async today(scope: InScope, now: Date): Promise<{ today: BooksDay; timeZone: string }> {
    const timeZone = await this.of(scope);
    return { today: workspaceBooksDay(now, timeZone), timeZone };
  }
}
