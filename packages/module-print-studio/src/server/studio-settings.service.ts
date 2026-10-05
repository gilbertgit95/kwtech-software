import { Inject, Injectable } from '@nestjs/common';
import { effectiveStudioKeymap, type StudioKeymap, validateStudioKeymap } from '../domain/keymap.js';
import { StudioWriteError } from './studio.errors.js';
import type { StudioWriteClient } from './studio.repository.js';
import type { StudioScope } from './studio.service.js';
import { STUDIO_PRISMA_WRITE } from './studio.tokens.js';

export interface StudioWorkspaceSettings {
  keymap: StudioKeymap;
  /** 0 when nothing was ever saved. */
  version: number;
}

/**
 * A workspace's studio settings: its shortcut keys (the operator, 2026-10-05).
 *
 * Everybody holding `studio:read` reads them — the keymap drives each person's
 * keys and shortcut bar. `studio:manage_settings` writes them, for everybody.
 * No row means every default.
 *
 * The point of sale's `PosSettingsService`, copied structurally.
 */
@Injectable()
export class StudioSettingsService {
  constructor(@Inject(STUDIO_PRISMA_WRITE) private readonly prisma: StudioWriteClient) {}

  /**
   * ⚠ THE STORED KEYMAP IS NEVER TRUSTED AS TYPED. It is JSON from a column:
   * `effectiveStudioKeymap` lays it over the defaults and falls back to them
   * whole when it no longer validates, so a screen never gets two actions on
   * one key. The row is also checked to be this ORGANIZATION's, since it is
   * found by workspace id alone.
   */
  async get(scope: StudioScope): Promise<StudioWorkspaceSettings> {
    const row = await this.prisma.studioSettings.findUnique({ where: { workspaceId: scope.workspaceId } });
    if (!row || row.organizationId !== scope.organizationId) return { keymap: effectiveStudioKeymap(null), version: 0 };
    return { keymap: effectiveStudioKeymap(row.keymap), version: row.version };
  }

  /**
   * Saves the keymap. `keymap` null resets every key to its default. Checked
   * by the same `validateStudioKeymap` the settings screen runs, and refused
   * with every reason at once — a person fixing a keymap wants the whole list.
   */
  async save(scope: StudioScope, actorId: string, keymap: unknown): Promise<StudioWorkspaceSettings> {
    const checked = validateStudioKeymap(keymap ?? effectiveStudioKeymap(null));
    if ('refused' in checked) {
      throw new StudioWriteError('invalid_keymap', checked.refused.join(' '), { problems: checked.refused });
    }
    const stored = { ...checked.keymap };
    const row = await this.prisma.studioSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, keymap: stored, updatedById: actorId },
      update: { keymap: stored, updatedById: actorId, version: { increment: 1 } },
    });
    return { keymap: effectiveStudioKeymap(row.keymap), version: row.version };
  }
}
