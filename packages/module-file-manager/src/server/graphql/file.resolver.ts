import { declareScope, REQUIRED_SCOPE_METADATA, withCatchUp } from '@kwtech/module-kit';
import { Inject, Optional, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { fileEventReaches } from '../../domain/events.js';
import { FileWriteError } from '../file.errors.js';
import type { FileModuleOptions } from '../file.options.js';
import { FILE_EVENT, type FileEvent, type FilePubSub, NULL_FILE_PUBSUB } from '../file.pubsub.js';
import { FileService, type FileSettingsView, type FileWithAudience } from '../file.service.js';
import { FILE_OPTIONS, FILE_PUBSUB } from '../file.tokens.js';
import { FileTransferService } from '../file-transfer.service.js';
import { FileWriteService } from '../file-write.service.js';
import {
  FileEntryType,
  FileEventType,
  FilePersonType,
  FileSettingsType,
  FileUploadTicketType,
  StartFileUploadInputType,
} from './file.types.js';

type Names = ReadonlyMap<string, string>;

/**
 * The files GraphQL surface.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS
 *
 * Every `file:*` key is WORKSPACE level. Without the declaration `FeatureGuard`
 * resolves app level, where no workspace key participates, and every key grants
 * nothing to everybody, silently (§12.13). `surface-coverage.test.ts` fails if
 * it goes. Every operation therefore takes `organizationId` and `workspaceId`.
 *
 * ## The guard is only half
 *
 * Every operation is guarded by its BINDING in `FILE_FEATURE_REGISTRY`. The
 * services then decide whether THIS file is one the person may see
 * (`canSeeFile`) or change (only its owner), with one answer for "no such
 * file" and "not yours to see".
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class FileResolver {
  constructor(
    private readonly files: FileService,
    private readonly writes: FileWriteService,
    private readonly transfers: FileTransferService,
    @Inject(FILE_OPTIONS) private readonly options: FileModuleOptions,
    /** Absent means not live: `fileEvents` sends `sync` and ends. */
    @Optional() @Inject(FILE_PUBSUB) private readonly pubsub?: FilePubSub,
  ) {}

  @Query(() => [FileEntryType], { name: 'files' })
  async listFiles(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<FileEntryType[]> {
    const viewerId = this.actor(gql.req);
    const entries = await this.files.list({ organizationId, workspaceId }, viewerId);
    return this.render(entries, viewerId);
  }

  @Query(() => FileSettingsType, { name: 'fileSettings' })
  async fileSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<FileSettingsType> {
    return renderSettings(await this.files.settings({ organizationId, workspaceId }, this.actor(gql.req)));
  }

  @Query(() => [FilePersonType], { name: 'fileShareableMembers' })
  async fileShareableMembers(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<FilePersonType[]> {
    const members = await this.files.shareableMembers({ organizationId, workspaceId }, this.actor(gql.req));
    return members.map((member) => ({ userId: member.userId, displayName: member.displayName }));
  }

  @Subscription(() => FileEventType, {
    name: 'fileEvents',
    // ⚠ REQUIRED: without it GraphQL looks for a `fileEvents` key on the payload and delivers `data: null`.
    resolve: (payload: FileEventType) => payload,
  })
  fileEvents(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): AsyncIterableIterator<FileEventType> {
    const viewer = { userId: this.actor(gql.req), organizationId, workspaceId };
    return withCatchUp<FileEvent, FileEventType>({
      live: (this.pubsub ?? NULL_FILE_PUBSUB).asyncIterableIterator<FileEvent>(FILE_EVENT.changed),
      catchUp: async () => [{ kind: 'sync', fileId: null, actorId: null }],
      // ⚠ The audiences stop here: a subscriber is told only that something it can see changed.
      transform: (event) =>
        fileEventReaches(event, viewer) ? { kind: 'changed', fileId: event.fileId, actorId: event.actorId } : null,
      keyOf: () => null,
    });
  }

  @Mutation(() => FileUploadTicketType, { name: 'startFileUpload' })
  async startFileUpload(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => StartFileUploadInputType }) input: StartFileUploadInputType,
  ): Promise<FileUploadTicketType> {
    const started = await this.transfers.startUpload(
      { organizationId, workspaceId },
      this.actor(gql.req),
      { ...input, sharedWith: input.sharedWith ?? [] },
      new Date(),
    );
    return { ticket: started.ticket, expiresAt: started.expiresAt.toISOString() };
  }

  @Mutation(() => FileEntryType, { name: 'setFileSharing' })
  async setFileSharing(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('fileId') fileId: string,
    @Args('visibility') visibility: string,
    @Args('sharedWith', { type: () => [String] }) sharedWith: string[],
  ): Promise<FileEntryType> {
    const actorId = this.actor(gql.req);
    const saved = await this.writes.setSharing({ organizationId, workspaceId }, actorId, fileId, {
      visibility,
      sharedWith,
    });
    const [rendered] = await this.render([saved], actorId);
    if (!rendered) throw new Error('A saved file could not be rendered.');
    return rendered;
  }

  @Mutation(() => Boolean, { name: 'deleteFile' })
  async deleteFile(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('fileId') fileId: string,
  ): Promise<boolean> {
    await this.writes.delete({ organizationId, workspaceId }, this.actor(gql.req), fileId);
    return true;
  }

  /** A one-time ticket; the browser then goes to `fileDownloadHref(ticket)`. */
  @Mutation(() => String, { name: 'issueFileDownload' })
  async issueFileDownload(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('fileId') fileId: string,
  ): Promise<string> {
    return this.transfers.issueDownload({ organizationId, workspaceId }, this.actor(gql.req), fileId, new Date());
  }

  @Mutation(() => FileSettingsType, { name: 'setFileSettings' })
  async setFileSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('retentionHours', { type: () => Int }) retentionHours: number,
  ): Promise<FileSettingsType> {
    const scope = { organizationId, workspaceId };
    return renderSettings(await this.writes.setSettings(scope, this.actor(gql.req), retentionHours));
  }

  private async render(entries: readonly FileWithAudience[], viewerId: string): Promise<FileEntryType[]> {
    const ids = entries.flatMap((entry) => [
      entry.file.ownerId,
      ...(entry.file.ownerId === viewerId ? entry.sharedWith : []),
    ]);
    const names = await this.files.names(ids);
    return entries.map((entry) => renderFile(entry, viewerId, names));
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new FileWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

function renderFile(entry: FileWithAudience, viewerId: string, names: Names): FileEntryType {
  const { file } = entry;
  const mine = file.ownerId === viewerId;
  return {
    id: file.id,
    name: file.name,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    ownerId: file.ownerId,
    ownerName: names.get(file.ownerId) ?? null,
    mine,
    visibility: file.visibility,
    // ⚠ The owner's to know. Somebody a file is shared with sees that it is, not who else it is shared with.
    sharedWith: mine
      ? entry.sharedWith.map((userId) => ({ userId, displayName: names.get(userId) ?? 'A former member' }))
      : [],
    createdAt: file.createdAt.toISOString(),
  };
}

function renderSettings(view: FileSettingsView): FileSettingsType {
  return {
    retentionHours: view.retentionHours,
    cleanupTime: view.cleanupTime,
    maxFileBytes: view.room.maxFileBytes,
    storageBytes: view.room.storageBytes,
    usedBytes: view.room.usedBytes,
  };
}
