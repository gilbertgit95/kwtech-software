import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { InScope } from './booking.repository.js';
import { BOOKING_WORKSPACE_TIME_ZONE } from './booking.tokens.js';
import type { BookingWorkspaceTimeZone } from './ports.js';

/**
 * What 9:00 means, and which day a booking belongs to, follow the WORKSPACE's
 * time zone (`perm_workspace.timeZone`), which booking cannot read itself — it
 * belongs to module-permissions, so the app answers through
 * `BookingWorkspaceTimeZone`. The point of sale's service, copied structurally.
 *
 * ⚠ UNBOUND, UNKNOWN OR NOT A REAL ZONE MEANS `DEFAULT_TIME_ZONE` — the zone
 * every workspace starts with — never the server's UTC, which would open every
 * shop eight hours late.
 */
@Injectable()
export class BookingTimeZoneService {
  private readonly logger = new Logger('BookingTimeZone');

  constructor(@Optional() @Inject(BOOKING_WORKSPACE_TIME_ZONE) private readonly zones?: BookingWorkspaceTimeZone) {}

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
