import { Inject, Injectable, Optional } from '@nestjs/common';
import { canSeeLayout } from '../domain/access.js';
import type { StudioAccessCheck, StudioMemberDirectory } from './ports.js';
import type {
  InScope,
  StudioCalibrationRow,
  StudioLayoutRow,
  StudioLogRow,
  StudioPrismaClient,
} from './studio.repository.js';
import { STUDIO_ACCESS_CHECK, STUDIO_MEMBER_DIRECTORY, STUDIO_PRISMA } from './studio.tokens.js';

/** Which workspace, always both ids — every row carries both (see the schema). */
export type StudioScope = InScope;

/**
 * How many shared layouts the studio lists. A workspace's shared layouts are a
 * few dozen by nature; this only bounds a strange one. Each person's own are
 * already bounded by `studio:layouts`, and `STUDIO_OWN_MAX` only bounds a cap
 * somebody configured absurdly high.
 */
export const STUDIO_SHARED_MAX = 300;
export const STUDIO_OWN_MAX = 1000;

/** How many calibration profiles one person may keep here. A printer and paper each; fifty is a large shop. */
export const STUDIO_CALIBRATIONS_MAX = 50;

/** A page of the history. The page size is capped whatever is asked for. */
export const STUDIO_LOG_PAGE_MAX = 100;
export const STUDIO_LOG_PAGE_DEFAULT = 50;

export interface StudioLayoutList {
  /** The viewer's own, private and shared, by name. */
  mine: readonly StudioLayoutRow[];
  /** Other people's, shared with the workspace, by name. */
  shared: readonly StudioLayoutRow[];
}

export interface StudioLogPage {
  entries: readonly StudioLogRow[];
  /** The instant the next page starts before, or null at the end. */
  next: Date | null;
  /** Whether this is everybody's history. False when it was asked for and not allowed. */
  everyone: boolean;
}

const BY_NAME = [{ name: 'asc' }, { id: 'asc' }] as const;
const NEWEST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/**
 * Reading layouts, calibration profiles and the history. Every query here
 * starts from WHO MAY SEE WHAT, in this workspace of this organization.
 */
@Injectable()
export class StudioService {
  constructor(
    @Inject(STUDIO_PRISMA) private readonly prisma: StudioPrismaClient,
    /** Unbound: you read your own history only. */
    @Optional() @Inject(STUDIO_ACCESS_CHECK) private readonly access?: StudioAccessCheck,
    @Optional() @Inject(STUDIO_MEMBER_DIRECTORY) private readonly directory?: StudioMemberDirectory,
  ) {}

  /**
   * The viewer's own layouts and the ones other people shared.
   *
   * ⚠ TWO QUERIES, each with its visibility rule IN the query: "mine" names the
   * owner, "shared" names `workspace` and excludes the owner. There is no query
   * here that reads a workspace's layouts and filters afterwards — a private
   * layout is never read by anyone but its owner.
   */
  async layouts(scope: StudioScope, viewerId: string): Promise<StudioLayoutList> {
    const [mine, shared] = await Promise.all([
      this.prisma.studioLayout.findMany({
        where: { ...scope, ownerId: viewerId },
        orderBy: [...BY_NAME],
        take: STUDIO_OWN_MAX,
      }),
      this.prisma.studioLayout.findMany({
        where: { ...scope, visibility: 'workspace', ownerId: { not: viewerId } },
        orderBy: [...BY_NAME],
        take: STUDIO_SHARED_MAX,
      }),
    ]);
    return { mine, shared };
  }

  /** One layout, or null — for one that does not exist AND for one the viewer may not see. */
  async layout(scope: StudioScope, viewerId: string, layoutId: string): Promise<StudioLayoutRow | null> {
    const layout = await this.prisma.studioLayout.findFirst({ where: { ...scope, id: layoutId } });
    if (!layout || !canSeeLayout(layout, viewerId)) return null;
    return layout;
  }

  /** The viewer's own calibration profiles here. Nobody else's are ever read. */
  async calibrations(scope: StudioScope, viewerId: string): Promise<readonly StudioCalibrationRow[]> {
    return this.prisma.studioCalibration.findMany({
      where: { ...scope, ownerId: viewerId },
      orderBy: [...BY_NAME],
      take: STUDIO_CALIBRATIONS_MAX,
    });
  }

  /**
   * The print history, newest first.
   *
   * ⚠ EVERYBODY'S ONLY WITH `studio:manage_all`, asked through the port — the
   * entries name customers' files. Asked for without it, the answer is the
   * viewer's own history and `everyone: false`, rather than a refusal: the
   * screen then shows what the person may see and hides the switch.
   *
   * Paged by time: a page starts before the last entry of the one above it.
   * Two entries in the same millisecond can straddle a page boundary and one
   * be skipped — accepted for a history nobody reconciles money against.
   */
  async log(
    scope: StudioScope,
    viewerId: string,
    input: { everyone?: boolean | null | undefined; before?: Date | undefined; limit?: number | null | undefined },
  ): Promise<StudioLogPage> {
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? STUDIO_LOG_PAGE_DEFAULT), 1), STUDIO_LOG_PAGE_MAX);
    const everyone = input.everyone === true && (await this.holdsManageAll(scope, viewerId));

    const rows = await this.prisma.studioLog.findMany({
      where: {
        ...scope,
        ...(everyone ? {} : { userId: viewerId }),
        ...(input.before ? { createdAt: { lt: input.before } } : {}),
      },
      orderBy: [...NEWEST],
      // One more than the page, to know whether another follows.
      take: limit + 1,
    });
    const entries = rows.slice(0, limit);
    const last = entries[entries.length - 1];
    return { entries, next: rows.length > limit && last ? last.createdAt : null, everyone };
  }

  /** Whether the person holds `studio:manage_all` here. Unbound port: no. */
  async holdsManageAll(scope: StudioScope, userId: string): Promise<boolean> {
    if (!this.access) return false;
    return this.access.holdsManageAll(scope.organizationId, scope.workspaceId, userId);
  }

  /**
   * Account names for the ids given. An id the directory does not know — or any
   * id at all when no directory is bound — is left out, and the app says
   * "a member".
   */
  async names(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(userIds)];
    if (!this.directory || unique.length === 0) return new Map();
    const members = await this.directory.describe(unique);
    return new Map(members.map((member) => [member.userId, member.displayName]));
  }
}
