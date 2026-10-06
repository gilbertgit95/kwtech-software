import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { canSeeLayout, checkShareLayout, isStudioVisibility, planChangeLayout } from '../domain/access.js';
import { prepareCalibration, prepareCalibrationName } from '../domain/calibration.js';
import { checkLayoutVersion, prepareLayoutName, prepareLayoutSpec, STUDIO_LAYOUT_NAME_MAX } from '../domain/layout.js';
import { prepareLogEntry } from '../domain/log.js';
import { prepareLayoutTag } from '../domain/tags.js';
import { STUDIO_LIMIT, STUDIO_LIMIT_REGISTRY } from '../feature-keys.js';
import type { StudioRefusal } from '../types.js';
import type { StudioAccessCheck } from './ports.js';
import { layoutNotFound, refusalError, StudioWriteError } from './studio.errors.js';
import type {
  StudioCalibrationRow,
  StudioLayoutRow,
  StudioLayoutUpdate,
  StudioLogRow,
  StudioWriteClient,
} from './studio.repository.js';
import { STUDIO_CALIBRATIONS_MAX, type StudioScope } from './studio.service.js';
import { STUDIO_ACCESS_CHECK, STUDIO_LIMIT_CHECKER, STUDIO_PRISMA_WRITE } from './studio.tokens.js';

/**
 * How many times an act that is not a save — share, delete — reads the layout
 * again after losing a race, before giving up. A save does NOT retry: its
 * version was chosen by the person, and landing it on cells they never saw is
 * the overwrite the version exists to prevent.
 */
export const STUDIO_ACT_ATTEMPTS = 3;

export interface CreateLayoutInput {
  name?: unknown;
  /** A string off the wire, checked by `isStudioVisibility`. */
  visibility?: string | null | undefined;
  /** Checked by `prepareLayoutTag`. Absent or empty: no tag. */
  tag?: unknown;
  /** A `StudioLayoutSpec` as the client sent it, checked by `prepareLayoutSpec`. */
  spec?: unknown;
}

/** What a save changes. An absent field is left as it is. */
export interface EditLayoutInput {
  name?: unknown;
  spec?: unknown;
  /**
   * ⚠ ABSENT (or null) LEAVES THE TAG AS IT IS; AN EMPTY STRING TAKES IT OFF.
   * GraphQL cannot tell a field left out from one sent as null, so "no tag"
   * has to be a value of its own.
   */
  tag?: unknown;
}

export interface SaveCalibrationInput {
  /** Absent: a new profile. Present: one of the person's own, changed. */
  id?: string | null | undefined;
  name?: unknown;
  scaleX?: unknown;
  scaleY?: unknown;
  offsetX?: unknown;
  offsetY?: unknown;
}

/**
 * Every write the studio makes.
 *
 * Each one on a layout: find it BY ID AND SCOPE, ask the domain whether this
 * person may, then write CONDITIONALLY on the version that decision was made
 * against.
 *
 * ⚠ NOTHING IS PUBLISHED. The studio is not live (PRINT-STUDIO-PLAN §7): a
 * shared layout somebody else changed shows on reopening.
 */
@Injectable()
export class StudioWriteService {
  constructor(
    @Inject(STUDIO_PRISMA_WRITE) private readonly prisma: StudioWriteClient,
    /** Unbound: the declared default cap — see `STUDIO_LIMIT_CHECKER`. */
    @Optional() @Inject(STUDIO_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    /** Unbound: you change your own layouts only. */
    @Optional() @Inject(STUDIO_ACCESS_CHECK) private readonly access?: StudioAccessCheck,
  ) {}

  // ── layouts ───────────────────────────────────────────────────────────────

  /** A new layout, private unless asked otherwise. */
  async createLayout(scope: StudioScope, actorId: string, input: CreateLayoutInput): Promise<StudioLayoutRow> {
    const { name } = unwrap(prepareLayoutName(input.name));
    const { spec } = unwrap(prepareLayoutSpec(input.spec));
    const visibility = input.visibility ?? 'private';
    if (!isStudioVisibility(visibility)) throw refusalError('invalid_visibility');
    const { tag } = unwrap(prepareLayoutTag(input.tag));
    return this.insertLayout(scope, actorId, { name, spec, visibility, tag });
  }

  /**
   * A private copy of a layout the person can see, owned by them — how anybody
   * but the owner changes a shared layout (decision 15).
   *
   * The copy is read back through `prepareLayoutSpec`, like any spec: a row
   * written by an older version of this code is cleaned on its way out, not
   * copied forward as it was. The copy keeps the tag: it is the same kind of
   * work.
   */
  async duplicateLayout(
    scope: StudioScope,
    actorId: string,
    layoutId: string,
    name?: unknown,
  ): Promise<StudioLayoutRow> {
    const source = await this.findLayout(scope, layoutId);
    if (!canSeeLayout(source, actorId)) throw layoutNotFound();

    const { spec } = unwrap(prepareLayoutSpec(source.spec));
    const wanted = name == null || name === '' ? copyName(source.name) : name;
    const prepared = unwrap(prepareLayoutName(wanted));
    return this.insertLayout(scope, actorId, {
      name: prepared.name,
      spec,
      visibility: 'private',
      tag: source.tag,
    });
  }

  /**
   * Save changes made from `expectedVersion`.
   *
   * ⚠ A STALE SAVE IS REFUSED with `STUDIO_CONFLICT_MESSAGE`. It is never
   * retried here and never merged: two people's cells are not a thing that
   * merges.
   */
  async updateLayout(
    scope: StudioScope,
    actorId: string,
    layoutId: string,
    expectedVersion: number,
    input: EditLayoutInput,
  ): Promise<StudioLayoutRow> {
    const layout = await this.findLayout(scope, layoutId);
    await this.requireChange(scope, actorId, layout);
    const stale = checkLayoutVersion(expectedVersion, layout.version);
    if (stale) throw refusalError(stale);

    const data: StudioLayoutUpdate = { updatedById: actorId, version: { increment: 1 } };
    if (input.name != null) data.name = unwrap(prepareLayoutName(input.name)).name;
    if (input.spec != null) data.spec = unwrap(prepareLayoutSpec(input.spec)).spec;
    // Nothing to change: the version must not move, or it would conflict with a real edit.
    if (input.tag != null) data.tag = unwrap(prepareLayoutTag(input.tag)).tag;
    if (data.name === undefined && data.spec === undefined && data.tag === undefined) return layout;

    const moved = await this.prisma.studioLayout.updateMany({
      where: { ...scope, id: layout.id, version: layout.version },
      data,
    });
    if (moved.count === 0) throw refusalError('conflict');
    return this.findLayout(scope, layout.id);
  }

  /** Share with the workspace, or take back to private. The owner's alone. */
  async setVisibility(
    scope: StudioScope,
    actorId: string,
    layoutId: string,
    visibility: string,
  ): Promise<StudioLayoutRow> {
    if (!isStudioVisibility(visibility)) throw refusalError('invalid_visibility');
    return this.act(scope, layoutId, async (layout) => {
      const refusal = checkShareLayout(layout, actorId);
      if (refusal) throw refusalError(refusal);
      if (layout.visibility === visibility) return { done: layout };

      const moved = await this.prisma.studioLayout.updateMany({
        where: { ...scope, id: layout.id, version: layout.version },
        data: { visibility, updatedById: actorId, version: { increment: 1 } },
      });
      if (moved.count === 0) return { lost: true };
      return { done: await this.findLayout(scope, layout.id) };
    });
  }

  /** Delete a layout: your own, or somebody else's shared one with `studio:manage_all`. */
  async deleteLayout(scope: StudioScope, actorId: string, layoutId: string): Promise<void> {
    await this.act(scope, layoutId, async (layout) => {
      await this.requireChange(scope, actorId, layout);
      const gone = await this.prisma.studioLayout.deleteMany({
        where: { ...scope, id: layout.id, version: layout.version },
      });
      if (gone.count === 0) return { lost: true };
      return { done: layout };
    });
  }

  // ── calibration ───────────────────────────────────────────────────────────

  /**
   * Create a profile, or change one of the person's own.
   *
   * ⚠ ALWAYS THE ACTOR'S OWN: every query names `ownerId`, so an id that is
   * somebody else's profile simply is not found.
   */
  async saveCalibration(
    scope: StudioScope,
    actorId: string,
    input: SaveCalibrationInput,
  ): Promise<StudioCalibrationRow> {
    const { name } = unwrap(prepareCalibrationName(input.name));
    const { calibration } = unwrap(prepareCalibration(input));
    const values = { name, ...calibration };

    try {
      if (input.id) {
        const where = { ...scope, id: input.id, ownerId: actorId };
        const moved = await this.prisma.studioCalibration.updateMany({ where, data: values });
        const saved = moved.count === 0 ? null : await this.prisma.studioCalibration.findFirst({ where });
        if (!saved) throw new StudioWriteError('not_found', 'That calibration profile is no longer here');
        return saved;
      }
      const current = await this.prisma.studioCalibration.count({ where: { ...scope, ownerId: actorId } });
      if (current >= STUDIO_CALIBRATIONS_MAX) {
        throw new StudioWriteError(
          'limit_reached',
          `You can keep ${STUDIO_CALIBRATIONS_MAX} calibration profiles here`,
        );
      }
      return await this.prisma.studioCalibration.create({ data: { ...scope, ownerId: actorId, ...values } });
    } catch (error) {
      // The `@@unique` on (workspace, owner, name) is what decides a duplicate, not a read before the write.
      if (isUniqueViolation(error)) throw refusalError('duplicate_name');
      throw error;
    }
  }

  async deleteCalibration(scope: StudioScope, actorId: string, calibrationId: string): Promise<void> {
    const gone = await this.prisma.studioCalibration.deleteMany({
      where: { ...scope, id: calibrationId, ownerId: actorId },
    });
    if (gone.count === 0) throw new StudioWriteError('not_found', 'That calibration profile is no longer here');
  }

  // ── the print log ─────────────────────────────────────────────────────────

  /**
   * Record that a result was downloaded or sent to the browser's print dialog.
   *
   * ⚠ WHAT THE CLIENT SAYS HAPPENED, cleaned and capped (`prepareLogEntry`).
   * The result is made in the browser, so the server cannot check it; this is
   * a record of activity, never proof that paper came out.
   *
   * The layout's NAME is taken from the row when the id is one the person can
   * see, so the log cannot be made to name a layout that is not theirs to know.
   */
  async recordPrint(scope: StudioScope, actorId: string, input: unknown): Promise<StudioLogRow> {
    const { entry } = unwrap(prepareLogEntry(input));

    let layoutId: string | null = null;
    let layoutName = entry.layoutName;
    if (entry.layoutId) {
      const layout = await this.prisma.studioLayout.findFirst({ where: { ...scope, id: entry.layoutId } });
      if (layout && canSeeLayout(layout, actorId)) {
        layoutId = layout.id;
        layoutName = layout.name;
      }
    }
    return this.prisma.studioLog.create({
      data: { ...scope, userId: actorId, ...entry, layoutId, layoutName },
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * ⚠ THE CAP IS COUNTED IN THE TRANSACTION THAT INSERTS, per person. Two tabs
   * creating at once can still both pass the count — the cap is a limit on
   * hoarding, not a security boundary, and one layout over is not worth a lock.
   */
  private async insertLayout(
    scope: StudioScope,
    actorId: string,
    values: { name: string; spec: object; visibility: 'private' | 'workspace'; tag: string | null },
  ): Promise<StudioLayoutRow> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.studioLayout.count({ where: { ...scope, ownerId: actorId } });
      const decision = await this.checkCap(scope, actorId, current);
      if (!decision.allowed) {
        throw new StudioWriteError('limit_reached', `You can keep ${decision.limit} layouts here`, {
          limit: decision.limit,
        });
      }
      return tx.studioLayout.create({ data: { ...scope, ownerId: actorId, updatedById: actorId, ...values } });
    });
  }

  /** ⚠ By id AND scope, and one answer — `not_found` — when it is not there. */
  private async findLayout(scope: StudioScope, layoutId: string): Promise<StudioLayoutRow> {
    const layout = await this.prisma.studioLayout.findFirst({ where: { ...scope, id: layoutId } });
    if (!layout) throw layoutNotFound();
    return layout;
  }

  /**
   * Throws unless this person may change or delete the layout. The port is
   * asked only when the answer depends on `studio:manage_all`.
   */
  private async requireChange(scope: StudioScope, actorId: string, layout: StudioLayoutRow): Promise<void> {
    const plan = planChangeLayout(layout, actorId);
    switch (plan.kind) {
      case 'allowed':
        return;
      case 'refused':
        throw refusalError(plan.reason);
      case 'needs_manage_all': {
        const holds = this.access
          ? await this.access.holdsManageAll(scope.organizationId, scope.workspaceId, actorId)
          : false;
        if (!holds)
          throw new StudioWriteError(
            'not_permitted',
            'Only the person who made this layout can change it — duplicate it to make your own',
          );
        return;
      }
    }
  }

  /**
   * Run an act against the layout as it is now, reading it again when the
   * compare-and-set lost to somebody else's write.
   */
  private async act(
    scope: StudioScope,
    layoutId: string,
    attempt: (layout: StudioLayoutRow) => Promise<{ done: StudioLayoutRow } | { lost: true }>,
  ): Promise<StudioLayoutRow> {
    // Sequential on purpose: each attempt is decided against the row the last one lost to.
    for (let tries = 0; tries < STUDIO_ACT_ATTEMPTS; tries += 1) {
      const result = await attempt(await this.findLayout(scope, layoutId));
      if ('done' in result) return result.done;
    }
    throw new StudioWriteError('conflict', 'That layout kept changing — try again in a moment');
  }

  /**
   * ⚠ UNBOUND IS THE DECLARED DEFAULT, not module-kit's `NULL_LIMIT_CHECKER`,
   * which allows everything. An unset cap is a floor, never unlimited.
   */
  private async checkCap(scope: StudioScope, actorId: string, current: number): Promise<LimitDecision> {
    if (this.limits) {
      return this.limits.check({ actorId, key: STUDIO_LIMIT.layouts, current, ...scope });
    }
    const cap = STUDIO_LIMIT_REGISTRY.find((spec) => spec.key === STUDIO_LIMIT.layouts)?.defaultValue ?? 0;
    return { allowed: current < cap, limit: cap, current, remaining: Math.max(cap - current, 0) };
  }
}

/** "ID package" → "ID package (copy)", kept inside the name's length. */
function copyName(name: string): string {
  const suffix = ' (copy)';
  return `${[...name].slice(0, STUDIO_LAYOUT_NAME_MAX - suffix.length).join('')}${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

function isRefused(result: object): result is { refused: StudioRefusal } {
  return 'refused' in result;
}

/** A `prepare*` result as its value, or its refusal thrown with that refusal's message. */
function unwrap<T extends object>(result: T | { refused: StudioRefusal }): T {
  if (isRefused(result)) throw refusalError(result.refused);
  return result;
}
