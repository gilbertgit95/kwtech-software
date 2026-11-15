import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { limitReachedText } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { canSeeFile, prepareContentType, prepareFileName, prepareFileSharing } from '../domain/files.js';
import type { FileRefusal } from '../types.js';
import { FileWriteError, fileRefusalError } from './file.errors.js';
import type { FileModuleOptions } from './file.options.js';
import type { FileTicketKind, FileTicketRow, FileWriteClient, InScope } from './file.repository.js';
import { audienceOf, type FileRoom, FileService, type FileWithAudience } from './file.service.js';
import { FILE_OPTIONS, FILE_PRISMA_WRITE, FILE_STORE } from './file.tokens.js';
import { FileWriteService, replaceShares } from './file-write.service.js';
import type { FileStore } from './ports.js';

export interface StartFileUploadInput {
  name: string;
  /** What the browser says it will send. The upload must send exactly this many bytes. */
  sizeBytes: number;
  contentType?: string | null | undefined;
  visibility: string;
  sharedWith: readonly string[];
}

export interface FileDownload {
  name: string;
  sizeBytes: number;
  stream: Readable;
}

const UPLOAD_TICKET_SECONDS = 300;
const DOWNLOAD_TICKET_SECONDS = 60;
/**
 * Live tickets one person may hold at once. Past it, asking for one more is
 * refused until some expire, so nobody can fill the table by asking in a loop.
 * Generous: a person dropping 30 files at once asks for 30.
 */
export const FILE_TICKETS_PER_PERSON_MAX = 100;

/** The stored form of a ticket. See `FileTicket` in prisma/file.prisma. */
export function fileTicketHash(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex');
}

/**
 * The two halves of a transfer: the guarded mutation that DECIDES and hands
 * out a ticket, and the route that spends it, as a stream.
 *
 ## THE TICKETS ARE ROWS, so any API instance spends any ticket
 *
 * One-time, short-lived, 256 random bits each, kept as their SHA-256
 * (`FileTicket`). Behind a load balancer the mutation and the byte route land
 * on whichever instance they land on, and both read the same table. Spending
 * is one conditional delete, so two requests racing for one ticket — on one
 * instance or two — cannot both win.
 *
 * ⚠ The BYTES are still the bound store's: several instances need one store
 * they all reach (a shared folder mounted at `FILES_DIR`, or the blob server).
 *
 * ## ⚠ CHECKED TWICE
 *
 * The caps and the sharing are checked when the ticket is given, so a person
 * is refused before sending a byte; the room is checked AGAIN when the last
 * byte has arrived, because other uploads may have filled it meanwhile. That
 * second check is not in a lock: two uploads finishing in the same instant
 * can both fit and together overrun the cap by one file — the advisory cap
 * `LimitCheckInput` documents, accepted for files deleted every night.
 */
@Injectable()
export class FileTransferService {
  private readonly logger = new Logger('FileTransfer');

  constructor(
    @Inject(FILE_PRISMA_WRITE) private readonly prisma: FileWriteClient,
    private readonly files: FileService,
    private readonly writes: FileWriteService,
    @Inject(FILE_OPTIONS) private readonly options: FileModuleOptions,
    /** ⚠ Unbound: every upload and download is refused "not set up". */
    @Optional() @Inject(FILE_STORE) private readonly store?: FileStore,
  ) {}

  /** Whether files can be uploaded and downloaded at all. */
  get configured(): boolean {
    return Boolean(this.store);
  }

  /** Checks everything that can be checked before a byte is sent, and hands out the upload's ticket. */
  async startUpload(
    scope: InScope,
    actorId: string,
    input: StartFileUploadInput,
    now: Date,
  ): Promise<{ ticket: string; expiresAt: Date }> {
    if (!this.store) throw fileRefusalError('not_configured');
    const name = prepareFileName(input.name);
    if (typeof name !== 'string') throw fileRefusalError(name.refused);
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw fileRefusalError('invalid_size');

    const shareable = input.visibility === 'people' ? await this.writes.shareableSet(scope) : null;
    const sharing = prepareFileSharing(input, actorId, shareable);
    if ('refused' in sharing) throw fileRefusalError(sharing.refused);

    checkRoom(await this.files.room(scope, actorId), input.sizeBytes);

    const expiresAt = new Date(now.getTime() + (this.options.uploadTicketSeconds ?? UPLOAD_TICKET_SECONDS) * 1000);
    const ticket = await this.issue(scope, actorId, now, {
      kind: 'upload',
      name,
      contentType: prepareContentType(input.contentType),
      sizeBytes: input.sizeBytes,
      visibility: sharing.visibility,
      sharedWith: sharing.sharedWith,
      expiresAt,
    });
    return { ticket, expiresAt };
  }

  /**
   * Spends an upload ticket: stores the bytes, then the row. ⚠ The ticket is
   * spent BEFORE the first byte is read, so it cannot be used twice even by
   * two requests racing.
   */
  async upload(ticket: string | undefined, source: Readable, now: Date): Promise<FileWithAudience> {
    const spent = await this.spend(ticket, 'upload', now);
    if (!spent) throw fileRefusalError('ticket_invalid');
    if (!this.store) throw fileRefusalError('not_configured');
    const held = uploadOf(spent);
    if (!held) throw fileRefusalError('ticket_invalid');

    const { scope } = held;
    const storageKey = randomBytes(16).toString('hex');
    const written = await this.store.write(scope.workspaceId, storageKey, source, held.sizeBytes);
    if (written.kind === 'too_large' || written.sizeBytes !== held.sizeBytes) {
      await this.discard(scope.workspaceId, storageKey);
      throw fileRefusalError('size_mismatch');
    }

    let saved: FileWithAudience;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        checkRoom(await this.files.room(scope, held.actorId, tx), held.sizeBytes);
        const file = await tx.fileEntry.create({
          data: {
            ...scope,
            ownerId: held.actorId,
            name: held.name,
            contentType: held.contentType,
            sizeBytes: held.sizeBytes,
            storageKey,
            visibility: held.visibility,
          },
        });
        await replaceShares(tx, scope, file.id, held.sharedWith);
        return { file, sharedWith: held.sharedWith };
      });
    } catch (error) {
      // Refused, or the database failed: either way the bytes belong to no file.
      await this.discard(scope.workspaceId, storageKey);
      throw error;
    }

    await this.writes.announce(scope, held.actorId, null, saved);
    return saved;
  }

  /** A one-time ticket for a file `viewerId` can see. ⚠ `not_found` for every other file alike. */
  async issueDownload(scope: InScope, viewerId: string, fileId: string, now: Date): Promise<string> {
    if (!this.store) throw fileRefusalError('not_configured');
    const entry = await this.files.visible(scope, viewerId, fileId);
    if (!canSeeFile(audienceOf(entry), viewerId)) throw fileRefusalError('not_found');

    return this.issue(scope, viewerId, now, {
      kind: 'download',
      fileId,
      expiresAt: new Date(now.getTime() + (this.options.downloadTicketSeconds ?? DOWNLOAD_TICKET_SECONDS) * 1000),
    });
  }

  /**
   * Spends a download ticket. Null for one unknown, spent or expired, and for
   * a file deleted since it was issued — one answer for all four.
   */
  async redeem(ticket: string | undefined, now: Date): Promise<FileDownload | null> {
    const held = await this.spend(ticket, 'download', now);
    if (!held?.fileId || !this.store) return null;
    const scope = { organizationId: held.organizationId, workspaceId: held.workspaceId };

    const file = await this.prisma.fileEntry.findFirst({ where: { ...scope, id: held.fileId } });
    if (!file) return null;
    const opened = await this.store.open(scope.workspaceId, file.storageKey);
    if (!opened) {
      this.logger.warn({ event: 'file.bytes_missing', fileId: file.id });
      return null;
    }
    return { name: file.name, sizeBytes: opened.sizeBytes, stream: opened.stream };
  }

  /** Writes a ticket's row and hands out the ticket itself, which is never stored. */
  private async issue(
    scope: InScope,
    actorId: string,
    now: Date,
    data: { kind: FileTicketKind; expiresAt: Date } & Partial<
      Pick<FileTicketRow, 'fileId' | 'name' | 'contentType' | 'sizeBytes' | 'visibility' | 'sharedWith'>
    >,
  ): Promise<string> {
    // Every expired ticket, anybody's: an indexed delete, and the table stays the size of what is live.
    await this.prisma.fileTicket.deleteMany({ where: { expiresAt: { lte: now } } });
    const live = await this.prisma.fileTicket.count({ where: { actorId, expiresAt: { gt: now } } });
    if (live >= FILE_TICKETS_PER_PERSON_MAX) throw fileRefusalError('ticket_invalid');

    const ticket = randomBytes(32).toString('base64url');
    await this.prisma.fileTicket.create({ data: { ...scope, ...data, actorId, tokenHash: fileTicketHash(ticket) } });
    return ticket;
  }

  /**
   * The ticket's row, if THIS call spent it; null for one unknown, of the
   * other kind, expired, or spent by somebody else first.
   *
   * ⚠ The read gives the payload; the conditional DELETE decides. Two requests
   * reading the same row both pass the read, and only the one whose delete
   * counted a row goes on.
   */
  private async spend(ticket: string | undefined, kind: FileTicketKind, now: Date): Promise<FileTicketRow | null> {
    if (!ticket) return null;
    const tokenHash = fileTicketHash(ticket);
    const row = await this.prisma.fileTicket.findUnique({ where: { tokenHash } });
    if (!row || row.kind !== kind) return null;
    const { count } = await this.prisma.fileTicket.deleteMany({ where: { tokenHash, kind, expiresAt: { gt: now } } });
    return count === 1 ? row : null;
  }

  private async discard(workspaceId: string, storageKey: string): Promise<void> {
    try {
      await this.store?.remove(workspaceId, storageKey);
    } catch (error) {
      // The clean-up's stray sweep removes it tonight.
      this.logger.warn({ event: 'file.discard_failed', workspaceId, error: String(error) });
    }
  }
}

/** An upload ticket's payload, or null for a row missing any of it (which only a hand-edited row could be). */
function uploadOf(row: FileTicketRow) {
  const { name, contentType, sizeBytes, visibility } = row;
  if (name === null || contentType === null || sizeBytes === null || visibility === null) return null;
  return {
    scope: { organizationId: row.organizationId, workspaceId: row.workspaceId },
    actorId: row.actorId,
    name,
    contentType,
    sizeBytes,
    visibility,
    sharedWith: row.sharedWith,
  };
}

/**
 * ⚠ BYTES AGAINST THE CAPS, worded by module-kit's `limitReachedText` so the
 * refusal names the plan that raises it (#101).
 */
export function checkRoom(room: FileRoom, sizeBytes: number): void {
  if (sizeBytes > room.maxFileBytes) {
    throw capError('file_too_large', limitReachedText(room.maxFile, { one: 'MB per file', many: 'MB per file' }));
  }
  if (room.storageBytes !== null && room.usedBytes + sizeBytes > room.storageBytes) {
    throw capError('storage_full', limitReachedText(room.storage, { one: 'MB of files', many: 'MB of files' }));
  }
}

function capError(reason: FileRefusal, capSentence: string): FileWriteError {
  const tail =
    reason === 'storage_full' ? ' Delete a file, or wait for tonight’s clean-up.' : ' Choose a smaller file.';
  return new FileWriteError(reason, `${capSentence}${tail}`);
}
