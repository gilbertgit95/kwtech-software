import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PosWorkspaceTimeZone } from './ports.js';
import type { InScope } from './pos.repository.js';
import { POS_WORKSPACE_TIME_ZONE } from './pos.tokens.js';

/**
 * Which day a sale belongs to follows the WORKSPACE's time zone
 * (`perm_workspace.timeZone`), which the POS cannot read itself — it belongs to
 * module-permissions, so the app answers through `PosWorkspaceTimeZone`.
 *
 * ⚠ UNBOUND, UNKNOWN OR NOT A REAL ZONE MEANS `DEFAULT_TIME_ZONE` — the zone
 * every workspace starts with — never the server's UTC, which would move every
 * evening sale to the next day.
 */
@Injectable()
export class PosTimeZoneService {
  private readonly logger = new Logger('PosTimeZone');

  constructor(@Optional() @Inject(POS_WORKSPACE_TIME_ZONE) private readonly zones?: PosWorkspaceTimeZone) {}

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
}
