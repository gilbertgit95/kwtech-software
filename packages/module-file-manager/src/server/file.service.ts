import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  canSeeFile,
  FILE_BYTES_PER_MB,
  FILE_LIST_MAX,
  FILE_SHARE_PEOPLE_MAX,
  FILE_SIZE_CEILING_MB,
} from '../domain/files.js';
import { FILE_CLEANUP_TIME, FILE_RETENTION_HOURS_DEFAULT } from '../domain/retention.js';
import { FILE_LIMIT, FILE_LIMIT_REGISTRY } from '../feature-keys.js';
import type { FileAudience } from '../types.js';
import { fileRefusalError } from './file.errors.js';
import type { FileEntryRow, FilePrismaClient, FileTransaction, InScope } from './file.repository.js';
import { FILE_LIMIT_CHECKER, FILE_MEMBER_DIRECTORY, FILE_PRISMA } from './file.tokens.js';
import type { FileMember, FileMemberDirectory } from './ports.js';

/** A file together with the people it is shared with: everything `canSeeFile` reads. */
export interface FileWithAudience {
  file: FileEntryRow;
  sharedWith: string[];
}

export interface FileRoom {
  /** The cap on one file, in bytes — never above `FILE_SIZE_CEILING_MB`. */
  maxFileBytes: number;
  maxFile: LimitDecision;
  /** The cap on the workspace's files together, in bytes. Null: no cap. */
  storageBytes: number | null;
  storage: LimitDecision;
  /** What the workspace's files take now. */
  usedBytes: number;
}

export interface FileSettingsView {
  retentionHours: number;
  /** `HH:MM` in the workspace's zone: the clean-up's declared time. */
  cleanupTime: string;
  room: FileRoom;
}

export function audienceOf(entry: FileWithAudience): FileAudience {
  return { ownerId: entry.file.ownerId, visibility: entry.file.visibility, sharedWith: entry.sharedWith };
}

/**
 * Reading files: the list, one file, the settings and the room left.
 *
 * ⚠ EVERY READ GOES THROUGH `canSeeFile`, with ONE answer — `not_found` — for
 * a file that does not exist, is another workspace's, or is not yours to see.
 */
@Injectable()
export class FileService {
  constructor(
    @Inject(FILE_PRISMA) private readonly prisma: FilePrismaClient,
    /** Unbound: the DECLARED DEFAULT caps, never unlimited. */
    @Optional() @Inject(FILE_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    /** Unbound: nobody has a name, and nobody can be chosen by name. */
    @Optional() @Inject(FILE_MEMBER_DIRECTORY) private readonly directory?: FileMemberDirectory,
  ) {}

  /** Every file `viewerId` can see here, newest first, at most `FILE_LIST_MAX`. */
  async list(scope: InScope, viewerId: string): Promise<FileWithAudience[]> {
    const sharedWithMe = await this.prisma.fileShare.findMany({
      where: { ...scope, userId: viewerId },
      take: FILE_LIST_MAX,
    });
    const files = await this.prisma.fileEntry.findMany({
      where: {
        ...scope,
        OR: [{ ownerId: viewerId }, { visibility: 'workspace' }, { id: { in: sharedWithMe.map((s) => s.fileId) } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FILE_LIST_MAX,
    });
    const audiences = await this.withAudience(scope, files);
    // ⚠ Filtered AGAIN by the one rule: the query is an optimisation, `canSeeFile` is the decision.
    return audiences.filter((entry) => canSeeFile(audienceOf(entry), viewerId));
  }

  /** One file `viewerId` can see. ⚠ Throws `not_found` for every other case alike. */
  async visible(scope: InScope, viewerId: string, fileId: string, tx?: FileTransaction): Promise<FileWithAudience> {
    const client = tx ?? this.prisma;
    const file = await client.fileEntry.findFirst({ where: { ...scope, id: fileId } });
    if (!file) throw fileRefusalError('not_found');
    const [entry] = await this.withAudience(scope, [file], client);
    if (!entry || !canSeeFile(audienceOf(entry), viewerId)) throw fileRefusalError('not_found');
    return entry;
  }

  async settings(scope: InScope, actorId: string): Promise<FileSettingsView> {
    const [retentionHours, room] = await Promise.all([this.retentionHours(scope), this.room(scope, actorId)]);
    return { retentionHours, cleanupTime: FILE_CLEANUP_TIME, room };
  }

  /** The workspace's choice, or the default. A row of another organization's is not this workspace's. */
  async retentionHours(scope: InScope, client: FileTransaction = this.prisma): Promise<number> {
    const row = await client.fileSettings.findUnique({ where: { workspaceId: scope.workspaceId } });
    return row && row.organizationId === scope.organizationId ? row.retentionHours : FILE_RETENTION_HOURS_DEFAULT;
  }

  /** The caps, resolved for this person here, and what the workspace's files take now. */
  async room(scope: InScope, actorId: string, client: FileTransaction = this.prisma): Promise<FileRoom> {
    const [maxFile, storage, used] = await Promise.all([
      this.cap(scope, actorId, FILE_LIMIT.fileSize),
      this.cap(scope, actorId, FILE_LIMIT.storage),
      client.fileEntry.aggregate({ where: scope, _sum: { sizeBytes: true } }),
    ]);
    const fileMb = Math.min(maxFile.limit ?? FILE_SIZE_CEILING_MB, FILE_SIZE_CEILING_MB);
    return {
      maxFileBytes: fileMb * FILE_BYTES_PER_MB,
      maxFile: { ...maxFile, limit: fileMb },
      storageBytes: storage.limit === null ? null : storage.limit * FILE_BYTES_PER_MB,
      storage,
      usedBytes: used._sum.sizeBytes ?? 0,
    };
  }

  /** The people a file can be shared with here. Empty without a directory. */
  async shareableMembers(scope: InScope, actorId: string): Promise<readonly FileMember[]> {
    if (!this.directory) return [];
    const members = await this.directory.listShareable(scope.organizationId, scope.workspaceId);
    return members.filter((member) => member.userId !== actorId);
  }

  /** Names for these people. Unknown ids are left out, and the page says "a former member". */
  async names(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (!this.directory || userIds.length === 0) return new Map();
    const people = await this.directory.describe([...new Set(userIds)]);
    return new Map(people.map((person) => [person.userId, person.displayName]));
  }

  private async withAudience(
    scope: InScope,
    files: readonly FileEntryRow[],
    client: FileTransaction = this.prisma,
  ): Promise<FileWithAudience[]> {
    const shared = files.filter((file) => file.visibility === 'people').map((file) => file.id);
    const shares =
      shared.length === 0
        ? []
        : await client.fileShare.findMany({
            where: { ...scope, fileId: { in: shared } },
            // Every file's whole list: at most FILE_SHARE_PEOPLE_MAX each.
            take: shared.length * FILE_SHARE_PEOPLE_MAX,
          });
    const byFile = new Map<string, string[]>();
    for (const share of shares) byFile.set(share.fileId, [...(byFile.get(share.fileId) ?? []), share.userId]);
    return files.map((file) => ({ file, sharedWith: (byFile.get(file.id) ?? []).sort() }));
  }

  /**
   * ⚠ ASKED FOR THE CAP ONLY (`current: 0`): the question is bytes, not "one
   * more", so the caller compares. Unbound is the declared default.
   */
  private async cap(scope: InScope, actorId: string, key: string): Promise<LimitDecision> {
    if (this.limits) return this.limits.check({ actorId, key, current: 0, ...scope });
    const cap = FILE_LIMIT_REGISTRY.find((spec) => spec.key === key)?.defaultValue ?? 0;
    return { allowed: true, limit: cap, current: 0, remaining: cap };
  }
}
