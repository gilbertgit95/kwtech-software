import { declareScope, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { Inject, Logger, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { prepareLayoutSpec } from '../../domain/layout.js';
import { StudioWriteError } from '../studio.errors.js';
import type { StudioModuleOptions } from '../studio.options.js';
import type { StudioCalibrationRow, StudioLayoutRow, StudioLogRow } from '../studio.repository.js';
import { StudioService } from '../studio.service.js';
import { STUDIO_OPTIONS } from '../studio.tokens.js';
import { StudioSettingsService, type StudioWorkspaceSettings } from '../studio-settings.service.js';
import { StudioWriteService } from '../studio-write.service.js';
import {
  CreateStudioLayoutInputType,
  StudioCalibrationInputType,
  StudioCalibrationType,
  type StudioLayoutSpecInputType,
  StudioLayoutType,
  type StudioLogEntryType,
  StudioLogPageType,
  StudioPrintInputType,
  StudioSettingsType,
  UpdateStudioLayoutInputType,
} from './studio.types.js';

/**
 * The print studio's GraphQL surface.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `studio:*` key is WORKSPACE level. A resolver has no path, so without a
 * declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key grants nothing to everybody, silently (§12.13).
 * Declared on the CLASS so an operation added later cannot forget it;
 * `surface-coverage.test.ts` fails if it goes. Every operation therefore takes
 * `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `STUDIO_FEATURE_REGISTRY`. None
 * is unbound: even your own calibration profile and your own log entry write a
 * row into the workspace named in the request, and the key is what proves you
 * belong there.
 *
 * ## And the guard is only half
 *
 * The key says you may use the studio or keep layouts in this workspace. The
 * services say whether THIS layout is yours to see, change, share or delete —
 * by id AND scope, and with one answer for "no such layout" and "not yours to
 * see".
 *
 * ## No file ever arrives here
 *
 * There is no upload on this surface and no operation that could carry one.
 * Photos and results stay in the browser (PRINT-STUDIO-PLAN decision 8).
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class StudioResolver {
  private readonly logger = new Logger('StudioResolver');

  constructor(
    private readonly studio: StudioService,
    private readonly writes: StudioWriteService,
    private readonly settings: StudioSettingsService,
    @Inject(STUDIO_OPTIONS) private readonly options: StudioModuleOptions,
  ) {}

  // ── queries ───────────────────────────────────────────────────────────────

  /** The viewer's own layouts first, then the ones other people shared. Each by name. */
  @Query(() => [StudioLayoutType], { name: 'studioLayouts' })
  async layouts(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<StudioLayoutType[]> {
    const viewerId = this.actor(gql.req);
    const { mine, shared } = await this.studio.layouts({ organizationId, workspaceId }, viewerId);
    const rows = [...mine, ...shared];
    const names = await this.studio.names(rows.map((row) => row.ownerId));
    return rows.flatMap((row) => this.renderLayout(row, viewerId, names) ?? []);
  }

  /** Null for a layout that does not exist AND for one the viewer may not see — the same answer. */
  @Query(() => StudioLayoutType, { name: 'studioLayout', nullable: true })
  async layout(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('layoutId') layoutId: string,
  ): Promise<StudioLayoutType | null> {
    const viewerId = this.actor(gql.req);
    const row = await this.studio.layout({ organizationId, workspaceId }, viewerId, layoutId);
    if (!row) return null;
    return this.renderLayout(row, viewerId, await this.studio.names([row.ownerId]));
  }

  @Query(() => [StudioCalibrationType], { name: 'studioCalibrations' })
  async calibrations(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<StudioCalibrationType[]> {
    const rows = await this.studio.calibrations({ organizationId, workspaceId }, this.actor(gql.req));
    return rows.map(renderCalibration);
  }

  /**
   * The print history. `everyone: true` is honoured only for a holder of
   * `studio:manage_all`; for anybody else it quietly becomes their own history,
   * and the answer's `everyone` says which they got.
   */
  @Query(() => StudioLogPageType, { name: 'studioLog' })
  async log(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('everyone', { type: () => Boolean, nullable: true }) everyone?: boolean | null,
    @Args('cursor', { type: () => String, nullable: true }) cursor?: string | null,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number | null,
  ): Promise<StudioLogPageType> {
    const viewerId = this.actor(gql.req);
    const page = await this.studio.log({ organizationId, workspaceId }, viewerId, {
      everyone,
      before: decodeCursor(cursor),
      limit,
    });
    const names = await this.studio.names(page.entries.map((entry) => entry.userId));
    return {
      entries: page.entries.map((entry) => renderLog(entry, viewerId, names)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
      everyone: page.everyone,
    };
  }

  // ── settings ──────────────────────────────────────────────────────────────

  /** Every screen reads these: the keymap drives its keys and its shortcut bar. */
  @Query(() => StudioSettingsType, { name: 'studioSettings' })
  async readSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<StudioSettingsType> {
    this.actor(gql.req);
    return renderSettings(await this.settings.get({ organizationId, workspaceId }));
  }

  /** `keymap` is a `StudioKeymap` as JSON text; omit it to put every key back to its default. */
  @Mutation(() => StudioSettingsType, { name: 'saveStudioSettings' })
  async saveSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('keymap', { type: () => String, nullable: true }) keymap?: string | null,
  ): Promise<StudioSettingsType> {
    const actorId = this.actor(gql.req);
    const saved = await this.settings.save(
      { organizationId, workspaceId },
      actorId,
      keymap ? parseKeymap(keymap) : null,
    );
    return renderSettings(saved);
  }

  // ── layouts ───────────────────────────────────────────────────────────────

  @Mutation(() => StudioLayoutType, { name: 'createStudioLayout' })
  async createLayout(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => CreateStudioLayoutInputType }) input: CreateStudioLayoutInputType,
  ): Promise<StudioLayoutType> {
    const actorId = this.actor(gql.req);
    const row = await this.writes.createLayout({ organizationId, workspaceId }, actorId, {
      name: input.name,
      visibility: input.visibility,
      spec: specInput(input.spec),
    });
    return this.rendered(row, actorId);
  }

  /** ⚠ From `expectedVersion`. A stale save is refused with `STUDIO_CONFLICT_MESSAGE`. */
  @Mutation(() => StudioLayoutType, { name: 'updateStudioLayout' })
  async updateLayout(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('layoutId') layoutId: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('input', { type: () => UpdateStudioLayoutInputType }) input: UpdateStudioLayoutInputType,
  ): Promise<StudioLayoutType> {
    const actorId = this.actor(gql.req);
    const row = await this.writes.updateLayout({ organizationId, workspaceId }, actorId, layoutId, expectedVersion, {
      name: input.name,
      spec: input.spec ? specInput(input.spec) : null,
    });
    return this.rendered(row, actorId);
  }

  @Mutation(() => StudioLayoutType, { name: 'setStudioLayoutVisibility' })
  async setVisibility(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('layoutId') layoutId: string,
    @Args('visibility') visibility: string,
  ): Promise<StudioLayoutType> {
    const actorId = this.actor(gql.req);
    return this.rendered(
      await this.writes.setVisibility({ organizationId, workspaceId }, actorId, layoutId, visibility),
      actorId,
    );
  }

  @Mutation(() => StudioLayoutType, { name: 'duplicateStudioLayout' })
  async duplicateLayout(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('layoutId') layoutId: string,
    @Args('name', { type: () => String, nullable: true }) name?: string | null,
  ): Promise<StudioLayoutType> {
    const actorId = this.actor(gql.req);
    return this.rendered(
      await this.writes.duplicateLayout({ organizationId, workspaceId }, actorId, layoutId, name),
      actorId,
    );
  }

  @Mutation(() => Boolean, { name: 'deleteStudioLayout' })
  async deleteLayout(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('layoutId') layoutId: string,
  ): Promise<boolean> {
    await this.writes.deleteLayout({ organizationId, workspaceId }, this.actor(gql.req), layoutId);
    return true;
  }

  // ── calibration and the log ───────────────────────────────────────────────

  @Mutation(() => StudioCalibrationType, { name: 'saveStudioCalibration' })
  async saveCalibration(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => StudioCalibrationInputType }) input: StudioCalibrationInputType,
  ): Promise<StudioCalibrationType> {
    const row = await this.writes.saveCalibration({ organizationId, workspaceId }, this.actor(gql.req), { ...input });
    return renderCalibration(row);
  }

  @Mutation(() => Boolean, { name: 'deleteStudioCalibration' })
  async deleteCalibration(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('calibrationId') calibrationId: string,
  ): Promise<boolean> {
    await this.writes.deleteCalibration({ organizationId, workspaceId }, this.actor(gql.req), calibrationId);
    return true;
  }

  /** Fire and forget: the studio does not wait on the log to hand over a result. */
  @Mutation(() => Boolean, { name: 'recordStudioPrint' })
  async recordPrint(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => StudioPrintInputType }) input: StudioPrintInputType,
  ): Promise<boolean> {
    await this.writes.recordPrint({ organizationId, workspaceId }, this.actor(gql.req), { ...input });
    return true;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** A written layout as the writer sees it, with its owner's name. */
  private async rendered(row: StudioLayoutRow, actorId: string): Promise<StudioLayoutType> {
    const layout = this.renderLayout(row, actorId, await this.studio.names([row.ownerId]));
    // Just written through `prepareLayoutSpec`, so this cannot happen — and must not be silent if it does.
    if (!layout) throw new StudioWriteError('invalid_spec', 'That layout was saved but could not be read back');
    return layout;
  }

  /**
   * A row as the app sees it, or null when its stored spec is not one this
   * code can read.
   *
   * ⚠ READ BACK THROUGH `prepareLayoutSpec`, never cast. The column is `Json`:
   * a row written by a later version, or edited by hand, must not reach the
   * editor as a spec with a `NaN` in it. Such a row is left out of the list
   * and logged, rather than failing every other layout with it.
   */
  private renderLayout(
    row: StudioLayoutRow,
    viewerId: string,
    names: ReadonlyMap<string, string>,
  ): StudioLayoutType | null {
    const prepared = prepareLayoutSpec(row.spec);
    if ('refused' in prepared) {
      this.logger.warn(
        `Layout ${row.id} holds a spec this version cannot read (${prepared.refused}); it is not listed.`,
      );
      return null;
    }
    const { spec } = prepared;
    return {
      id: row.id,
      name: row.name,
      visibility: row.visibility,
      version: row.version,
      mine: row.ownerId === viewerId,
      ownerId: row.ownerId,
      ownerName: names.get(row.ownerId) ?? null,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      spec: {
        ...spec,
        cells: spec.cells.map((cell) => ({ ...cell, label: cell.label ?? null })),
        border: spec.border ?? null,
      },
    };
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new StudioWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

/**
 * A spec input as the plain value `prepareLayoutSpec` reads. GraphQL leaves an
 * omitted nullable field `undefined`; the domain's spec says `null` for "no
 * key" and omits an absent label.
 */
function specInput(input: StudioLayoutSpecInputType): unknown {
  return {
    version: input.version,
    paper: {
      key: input.paper.key ?? null,
      label: input.paper.label,
      width: input.paper.width,
      height: input.paper.height,
    },
    orientation: input.orientation,
    margins: { ...input.margins },
    cells: input.cells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      label: cell.label ?? null,
    })),
    guides: input.guides,
    border: input.border ? { style: input.border.style, width: input.border.width, color: input.border.color } : null,
  };
}

/** A keymap off the wire: JSON text, shaped by `validateStudioKeymap` in the service. */
function parseKeymap(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new StudioWriteError('invalid_keymap', 'Those shortcut keys are not in a form this server reads');
  }
}

function renderSettings(settings: StudioWorkspaceSettings): StudioSettingsType {
  return { keymap: JSON.stringify(settings.keymap), version: settings.version };
}

function renderCalibration(row: StudioCalibrationRow): StudioCalibrationType {
  return {
    id: row.id,
    name: row.name,
    scaleX: row.scaleX,
    scaleY: row.scaleY,
    offsetX: row.offsetX,
    offsetY: row.offsetY,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function renderLog(row: StudioLogRow, viewerId: string, names: ReadonlyMap<string, string>): StudioLogEntryType {
  return {
    id: row.id,
    action: row.action,
    kind: row.kind,
    userId: row.userId,
    userName: names.get(row.userId) ?? null,
    mine: row.userId === viewerId,
    layoutId: row.layoutId,
    layoutName: row.layoutName,
    paperLabel: row.paperLabel,
    paperWidth: row.paperWidth,
    paperHeight: row.paperHeight,
    pages: row.pages,
    copies: row.copies,
    fileNames: [...row.fileNames],
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Opaque so a client cannot build one — a hand-made cursor is a client that has
 * learned how paging works, and the next change to it breaks that silently.
 * Base64 rather than a signature: it encodes nothing secret (an instant), and
 * the history it pages is still filtered to what the viewer may see.
 */
function encodeCursor(before: Date): string {
  return Buffer.from(before.toISOString()).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): Date | undefined {
  if (!cursor) return undefined;
  // A malformed cursor pages from the START rather than throwing: a stale
  // cursor is not worth an error on the screen.
  const before = new Date(Buffer.from(cursor, 'base64url').toString('utf8'));
  return Number.isNaN(before.getTime()) ? undefined : before;
}
