import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { canChangeFile, newlySharedWith, prepareFileSharing } from '../domain/files.js';
import { isValidRetentionHours } from '../domain/retention.js';
import type { FileAudience } from '../types.js';
import { fileRefusalError } from './file.errors.js';
import { FileEventPublisher } from './file.events.js';
import type { FileTransaction, FileWriteClient, InScope } from './file.repository.js';
import { audienceOf, FileService, type FileSettingsView, type FileWithAudience } from './file.service.js';
import { FILE_MEMBER_DIRECTORY, FILE_NOTIFIER, FILE_PRISMA_WRITE, FILE_STORE } from './file.tokens.js';
import type { FileMemberDirectory, FileNotifier, FileStore } from './ports.js';

export interface FileSharingInput {
  visibility: string;
  sharedWith: readonly string[];
}

/**
 * Changing files: sharing, deleting, and the workspace's settings.
 *
 * ⚠ ONLY THE OWNER shares or deletes a file, and somebody who cannot see it is
 * told `not_found`, not `not_owner` — "not yours" would confirm it exists.
 */
@Injectable()
export class FileWriteService {
  private readonly logger = new Logger('FileWrite');

  constructor(
    @Inject(FILE_PRISMA_WRITE) private readonly prisma: FileWriteClient,
    private readonly files: FileService,
    private readonly events: FileEventPublisher,
    /** Unbound: the row is deleted and the bytes are left for the clean-up's stray sweep. */
    @Optional() @Inject(FILE_STORE) private readonly store?: FileStore,
    /** Unbound: nobody can be chosen by name. */
    @Optional() @Inject(FILE_MEMBER_DIRECTORY) private readonly directory?: FileMemberDirectory,
    /** Unbound: nobody is told a file was shared with them. */
    @Optional() @Inject(FILE_NOTIFIER) private readonly notifier?: FileNotifier,
  ) {}

  /** Who may be chosen, as a set — or null when nobody can be named. */
  async shareableSet(scope: InScope): Promise<ReadonlySet<string> | null> {
    if (!this.directory) return null;
    const members = await this.directory.listShareable(scope.organizationId, scope.workspaceId);
    return new Set(members.map((member) => member.userId));
  }

  async setSharing(
    scope: InScope,
    actorId: string,
    fileId: string,
    input: FileSharingInput,
  ): Promise<FileWithAudience> {
    const before = await this.files.visible(scope, actorId, fileId);
    if (!canChangeFile(before.file, actorId)) throw fileRefusalError('not_owner');

    // Only asked when people are named: the directory loads a permission context per member.
    const shareable = input.visibility === 'people' ? await this.shareableSet(scope) : null;
    const sharing = prepareFileSharing(input, actorId, shareable);
    if ('refused' in sharing) throw fileRefusalError(sharing.refused);

    const after = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.fileEntry.updateMany({
        where: { ...scope, id: fileId, ownerId: actorId },
        data: { visibility: sharing.visibility },
      });
      // Deleted between the read and now (the clean-up, or another tab).
      if (changed.count === 0) throw fileRefusalError('not_found');
      await replaceShares(tx, scope, fileId, sharing.sharedWith);
      return this.files.visible(scope, actorId, fileId, tx);
    });

    await this.announce(scope, actorId, audienceOf(before), after);
    return after;
  }

  /** Deletes the row, then the bytes. A failure removing the bytes is logged; the clean-up finds the stray. */
  async delete(scope: InScope, actorId: string, fileId: string): Promise<void> {
    const entry = await this.files.visible(scope, actorId, fileId);
    if (!canChangeFile(entry.file, actorId)) throw fileRefusalError('not_owner');

    const deleted = await this.prisma.fileEntry.deleteMany({ where: { ...scope, id: fileId, ownerId: actorId } });
    if (deleted.count === 0) throw fileRefusalError('not_found');

    await this.removeBytes(scope.workspaceId, entry.file.storageKey);
    await this.events.publish({
      ...scope,
      change: 'file',
      fileId,
      actorId,
      before: audienceOf(entry),
      after: null,
    });
  }

  async setSettings(scope: InScope, actorId: string, retentionHours: number): Promise<FileSettingsView> {
    if (!isValidRetentionHours(retentionHours)) throw fileRefusalError('invalid_retention');
    await this.prisma.fileSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, retentionHours, updatedById: actorId },
      update: { retentionHours, updatedById: actorId },
    });
    await this.events.publish({ ...scope, change: 'settings', fileId: null, actorId, before: null, after: null });
    return this.files.settings(scope, actorId);
  }

  /** Tells the newly added people, and everybody who gained or lost the file. After the commit. */
  async announce(scope: InScope, actorId: string, before: FileAudience | null, after: FileWithAudience): Promise<void> {
    const audience = audienceOf(after);
    await this.events.publish({ ...scope, change: 'file', fileId: after.file.id, actorId, before, after: audience });

    const recipientIds = newlySharedWith(before, audience).filter((userId) => userId !== actorId);
    if (recipientIds.length === 0 || !this.notifier) return;
    await this.notifier
      .shared({ ...scope, recipientIds, actorId, fileId: after.file.id, fileName: after.file.name })
      // A notice that cannot be sent never fails the share.
      .catch((error: unknown) => this.logger.warn(`Could not tell people about a shared file: ${String(error)}`));
  }

  private async removeBytes(workspaceId: string, storageKey: string): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.remove(workspaceId, storageKey);
    } catch (error) {
      this.logger.warn({ event: 'file.remove_failed', workspaceId, error: String(error) });
    }
  }
}

/** The share rows become exactly `people`. Inside the caller's transaction. */
export async function replaceShares(
  tx: FileTransaction,
  scope: InScope,
  fileId: string,
  people: readonly string[],
): Promise<void> {
  await tx.fileShare.deleteMany({ where: { ...scope, fileId } });
  if (people.length === 0) return;
  await tx.fileShare.createMany({ data: people.map((userId) => ({ ...scope, fileId, userId })) });
}
