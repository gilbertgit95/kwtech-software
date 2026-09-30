import { Inject, Injectable } from '@nestjs/common';
import { effectiveKeymap, type PosKeymap, validateKeymap } from '../domain/keymap.js';
import { PosWriteError } from './pos.errors.js';
import { PosEventPublisher } from './pos.events.js';
import type { InScope, PosJsonInput, PosWriteClient } from './pos.repository.js';
import { POS_PRISMA_WRITE } from './pos.tokens.js';
import { PosTimeZoneService } from './pos-time-zone.service.js';

/** A store's settings, as every till reads them: defaults filled in. */
export interface PosStoreSettings {
  /** The WORKSPACE's zone, read through `PosTimeZoneService` — not a POS setting (PLAN §13, 2026-09-29). */
  timeZone: string;
  keymap: PosKeymap;
  version: number;
}

/**
 * A store's settings: its keymap (D18), and — read-only, for the till's
 * convenience — the workspace's time zone. Every member reads them; only
 * `pos:manage_settings` writes the keymap. No row means every default.
 */
@Injectable()
export class PosSettingsService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly events: PosEventPublisher,
    private readonly zones: PosTimeZoneService,
  ) {}

  async get(scope: InScope): Promise<PosStoreSettings> {
    const [row, timeZone] = await Promise.all([
      this.prisma.posSettings.findUnique({ where: { workspaceId: scope.workspaceId } }),
      this.zones.of(scope),
    ]);
    // ⚠ The workspace id is unique across tenants, and the row must also be
    // THIS organization's: a mismatch reads as "no settings", never as another
    // tenant's.
    if (!row || row.organizationId !== scope.organizationId) {
      return { timeZone, keymap: effectiveKeymap(null), version: 0 };
    }
    return { timeZone, keymap: readKeymap(row.keymap), version: row.version };
  }

  /**
   * Saves the keymap. `keymap` null resets it to the defaults. Checked by
   * `validateKeymap`, whose reasons are shown as they are — each names the key
   * and the action. (The time zone is the workspace's, edited with it.)
   */
  async save(scope: InScope, actorId: string, input: { keymap: PosKeymap | null }): Promise<PosStoreSettings> {
    const checked = validateKeymap(input.keymap ?? effectiveKeymap(null));
    if ('refused' in checked) {
      throw new PosWriteError('invalid_keymap', checked.refused.join(' '), { problems: checked.refused });
    }
    const keymap = toJson(checked.keymap);
    await this.prisma.posSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, keymap, updatedById: actorId },
      update: { keymap, updatedById: actorId, version: { increment: 1 } },
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
