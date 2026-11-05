import { Inject, Injectable } from '@nestjs/common';
import { type PosAlertTones, readAlertTones, validateAlertTones } from '../domain/alert-tones.js';
import { effectiveKeymap, type PosKeymap, validateKeymap } from '../domain/keymap.js';
import { readDefaultReference, readReferenceOptions, validateReferenceOptions } from '../domain/references.js';
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
  /** The order reference options the till offers (issue #30), in the store's order; empty for none. */
  referenceOptions: readonly string[];
  /** The reference a new order starts with: one of `referenceOptions`, or null. */
  defaultReference: string | null;
  /** The store's order sounds (issue #68), defaults filled in. A person's own win over them (`mySounds`). */
  alertTones: PosAlertTones;
  version: number;
}

/** One person's order sounds in one store: the store's, and their own when they kept one (issue #68). */
export interface PosMyAlertTones {
  store: PosAlertTones;
  /** Null: they follow the store's. */
  mine: PosAlertTones | null;
}

/**
 * A store's settings: its keymap (D18), its order reference options (issue
 * #30), its order sounds and each person's own (issue #68), and — read-only, for the till's convenience — the workspace's time
 * zone. Every member reads them; only `pos:manage_settings` writes them. No
 * row means every default.
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
      return {
        timeZone,
        keymap: effectiveKeymap(null),
        referenceOptions: [],
        defaultReference: null,
        alertTones: readAlertTones(null),
        version: 0,
      };
    }
    const referenceOptions = readReferenceOptions(row.referenceOptions);
    return {
      timeZone,
      keymap: readKeymap(row.keymap),
      referenceOptions,
      defaultReference: readDefaultReference(referenceOptions, row.defaultReference),
      alertTones: readAlertTones(row.alertTones),
      version: row.version,
    };
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

  /**
   * Saves the order reference options, the whole list in its new order (an
   * empty list removes them all). Checked by `validateReferenceOptions`, whose
   * problems are shown as they are.
   *
   * ⚠ A SAVE OF ITS OWN, not a field of `save`: that one writes the keymap it
   * is given, or the defaults when given none, so a reference list sent
   * through it would reset every hot key.
   */
  async saveReferenceOptions(
    scope: InScope,
    actorId: string,
    raw: readonly string[],
    rawDefault: string | null = null,
  ): Promise<PosStoreSettings> {
    const checked = validateReferenceOptions(raw);
    if ('refused' in checked) {
      throw new PosWriteError('invalid_reference_options', checked.refused.join(' '), { problems: checked.refused });
    }
    const referenceOptions = [...checked.options];
    // The default is one of the options, or none: a default nobody can pick from the list is refused, not stored.
    const defaultReference = readDefaultReference(referenceOptions, rawDefault);
    if (rawDefault && rawDefault.trim() !== '' && defaultReference === null) {
      const problem = `The default reference “${rawDefault.trim()}” is not one of the options.`;
      throw new PosWriteError('invalid_reference_options', problem, { problems: [problem] });
    }
    await this.prisma.posSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, referenceOptions, defaultReference, updatedById: actorId },
      update: { referenceOptions, defaultReference, updatedById: actorId, version: { increment: 1 } },
    });
    await this.events.changed(scope, 'settings', actorId);
    return this.get(scope);
  }

  /**
   * Saves the store's order sounds (issue #68), both moments whole. Checked by
   * `validateAlertTones`, whose problems are shown as they are. A save of its
   * own, like the reference options, so it never touches the keymap.
   */
  async saveAlertTones(scope: InScope, actorId: string, raw: unknown): Promise<PosStoreSettings> {
    const alertTones = toJson(checkedTones(raw));
    await this.prisma.posSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, alertTones, updatedById: actorId },
      update: { alertTones, updatedById: actorId, version: { increment: 1 } },
    });
    // Every Cashier screen re-reads its settings, so a changed default is heard at once.
    await this.events.changed(scope, 'settings', actorId);
    return this.get(scope);
  }

  /**
   * The actor's own order sounds and the store's (issue #68).
   *
   * ⚠ ALWAYS THE ACTOR'S OWN ROW: the user id comes from the request, never an
   * argument, so nobody reads or changes another person's choice.
   */
  async mySounds(scope: InScope, actorId: string): Promise<PosMyAlertTones> {
    const [settings, row] = await Promise.all([
      this.get(scope),
      this.prisma.posUserSettings.findUnique({
        where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actorId } },
      }),
    ]);
    // As `get`: the row must also be THIS organization's, or it reads as none.
    const mine = row && row.organizationId === scope.organizationId && row.alertTones !== null ? row : null;
    return { store: settings.alertTones, mine: mine ? readAlertTones(mine.alertTones) : null };
  }

  /**
   * Saves the actor's own order sounds, or, with `raw` null, goes back to the
   * store's (the row is deleted). No event: nobody else's screen changes.
   */
  async saveMySounds(scope: InScope, actorId: string, raw: unknown | null): Promise<PosMyAlertTones> {
    if (raw === null) {
      await this.prisma.posUserSettings.deleteMany({ where: { workspaceId: scope.workspaceId, userId: actorId } });
      return this.mySounds(scope, actorId);
    }
    const alertTones = toJson(checkedTones(raw));
    await this.prisma.posUserSettings.upsert({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actorId } },
      create: { ...scope, userId: actorId, alertTones },
      update: { alertTones, version: { increment: 1 } },
    });
    return this.mySounds(scope, actorId);
  }
}

/** Order sounds as asked, checked, or the refusal that names each problem. */
function checkedTones(raw: unknown): PosAlertTones {
  const checked = validateAlertTones(raw);
  if ('refused' in checked) {
    throw new PosWriteError('invalid_alert_tones', checked.refused.join(' '), { problems: checked.refused });
  }
  return checked.tones;
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

function toJson(value: PosKeymap | PosAlertTones): PosJsonInput {
  return JSON.parse(JSON.stringify(value)) as PosJsonInput;
}
