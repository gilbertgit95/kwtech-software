import { Inject, Injectable } from '@nestjs/common';
import { effectiveKeymap, type PosKeymap, validateKeymap } from '../domain/keymap.js';
import { isValidTimeZone, POS_DEFAULT_TIME_ZONE } from '../domain/time-zone.js';
import { PosWriteError, refusalError } from './pos.errors.js';
import { PosEventPublisher } from './pos.events.js';
import type { InScope, PosJsonInput, PosWriteClient } from './pos.repository.js';
import { POS_PRISMA_WRITE } from './pos.tokens.js';

/** A store's settings, as every till reads them: defaults filled in. */
export interface PosStoreSettings {
  timeZone: string;
  keymap: PosKeymap;
  version: number;
}

/**
 * A store's settings: its time zone (D22) and its keymap (D18). Every member
 * reads them — the till needs both — and only `pos:manage_settings` writes.
 * No row means every default.
 */
@Injectable()
export class PosSettingsService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly events: PosEventPublisher,
  ) {}

  async get(scope: InScope): Promise<PosStoreSettings> {
    const row = await this.prisma.posSettings.findUnique({ where: { workspaceId: scope.workspaceId } });
    // ⚠ The workspace id is unique across tenants, and the row must also be
    // THIS organization's: a mismatch reads as "no settings", never as another
    // tenant's.
    if (!row || row.organizationId !== scope.organizationId) {
      return { timeZone: POS_DEFAULT_TIME_ZONE, keymap: effectiveKeymap(null), version: 0 };
    }
    return { timeZone: row.timeZone, keymap: readKeymap(row.keymap), version: row.version };
  }

  /**
   * Saves the time zone and the keymap together. `keymap` null resets it to the
   * defaults. The keymap is checked by `validateKeymap`, whose reasons are shown
   * as they are — each names the key and the action.
   */
  async save(
    scope: InScope,
    actorId: string,
    input: { timeZone: string; keymap: PosKeymap | null },
  ): Promise<PosStoreSettings> {
    if (!isValidTimeZone(input.timeZone)) throw refusalError('invalid_time_zone');
    const checked = validateKeymap(input.keymap ?? effectiveKeymap(null));
    if ('refused' in checked) {
      throw new PosWriteError('invalid_keymap', checked.refused.join(' '), { problems: checked.refused });
    }
    const keymap = toJson(checked.keymap);
    await this.prisma.posSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, timeZone: input.timeZone, keymap, updatedById: actorId },
      update: { timeZone: input.timeZone, keymap, updatedById: actorId, version: { increment: 1 } },
    });
    await this.events.changed(scope, 'settings', actorId);
    return this.get(scope);
  }
}

/**
 * A stored keymap, never trusted as typed: JSON from the database is checked
 * again, and one that no longer passes (an action renamed since) falls back to
 * the defaults rather than handing a till keys it cannot obey.
 */
function readKeymap(stored: unknown): PosKeymap {
  if (typeof stored !== 'object' || stored === null) return effectiveKeymap(null);
  const merged = effectiveKeymap(stored as Partial<PosKeymap>);
  const checked = validateKeymap(merged);
  return 'keymap' in checked ? checked.keymap : effectiveKeymap(null);
}

function toJson(keymap: PosKeymap): PosJsonInput {
  return JSON.parse(JSON.stringify(keymap)) as PosJsonInput;
}
