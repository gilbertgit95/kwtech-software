import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import { Controller, Get, Headers, Logger, Put, Req, Res, SetMetadata } from '@nestjs/common';
import { fileRefusalMessage } from '../../domain/messages.js';
import {
  FILE_DOWNLOAD_TICKET_HEADER,
  FILE_UPLOAD_TICKET_HEADER,
  fileContentDisposition,
} from '../../domain/transfer.js';
import type { FileRefusal } from '../../types.js';
import { FileWriteError } from '../file.errors.js';
import { FileTransferService } from '../file-transfer.service.js';

/**
 * The two HTTP ends of a transfer: the bytes of an upload coming in, and of a
 * download going out.
 *
 * ## ⚠ WHY THIS MODULE HAS A CONTROLLER, when the rule is that new modules
 * expose no REST
 *
 * A file is not a GraphQL value — module-print's relay and module-backup's
 * download have the same two routes for the same reason. These carry bytes
 * and nothing else. Everything that DECIDES (who may upload what, download
 * which file) is a guarded GraphQL mutation, which hands out the ticket these
 * spend.
 *
 * ## ⚠ PUBLIC, BUT NOT OPEN
 *
 * No session reaches here: the web app's route handler forwards the ticket
 * and nothing else. A ticket names one upload or one file, is spent on use,
 * expires within minutes, and is 256 random bits — not a place a secret is
 * guessed, so neither route carries the credential marker.
 *
 * ⚠ ONE ANSWER for a ticket unknown, spent or expired: 404, one message.
 */
@Controller('files')
export class FileTransferController {
  private readonly log = new Logger('FileTransfer');

  constructor(private readonly transfers: FileTransferService) {}

  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'The browser sends the file startFileUpload admitted, with the one-time ticket it returned; the ticket is the authorisation',
  )
  @Put('upload')
  async upload(
    @Headers(FILE_UPLOAD_TICKET_HEADER) ticket: string | undefined,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    try {
      const saved = await this.transfers.upload(ticket, request, new Date());
      answer(response, 200, { id: saved.file.id, name: saved.file.name, sizeBytes: saved.file.sizeBytes });
    } catch (error) {
      if (!(error instanceof FileWriteError)) {
        this.log.error({ event: 'file.upload_failed', error: String(error) });
        answer(response, 500, { reason: 'failed', message: 'The file could not be saved. Try again.' });
        return;
      }
      answer(response, statusOf(error.reason), { reason: error.reason, message: error.message });
    }
    // An upload refused part-way leaves the rest of its body unread: drain it, so the connection can close cleanly.
    if (!request.readableEnded) request.resume();
  }

  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'The browser fetches the file a one-time ticket from issueFileDownload names; the ticket is the authorisation',
  )
  @Get('download')
  async download(
    @Headers(FILE_DOWNLOAD_TICKET_HEADER) ticket: string | undefined,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const file = await this.transfers.redeem(ticket, new Date());
    if (!file) {
      answer(response, 404, { reason: 'ticket_invalid', message: fileRefusalMessage('ticket_invalid') });
      return;
    }
    response.writeHead(200, {
      // ⚠ NEVER the type the uploader declared: an HTML file served as HTML would run in this origin.
      'content-type': 'application/octet-stream',
      'content-length': String(file.sizeBytes),
      'content-disposition': fileContentDisposition(file.name),
      'x-content-type-options': 'nosniff',
      // Somebody's file: nobody's to cache.
      'cache-control': 'no-store',
    });
    try {
      await pipeline(file.stream, response);
    } catch (error) {
      // The browser went away mid-download. The file is untouched.
      this.log.warn({ event: 'file.download_interrupted', error: String(error) });
    }
  }
}

function statusOf(reason: FileRefusal): number {
  switch (reason) {
    case 'ticket_invalid':
    case 'not_found':
      return 404;
    case 'file_too_large':
    case 'storage_full':
      return 413;
    case 'not_configured':
      return 503;
    case 'not_owner':
    case 'not_permitted':
      return 403;
    case 'size_mismatch':
    case 'invalid_name':
    case 'invalid_size':
    case 'invalid_visibility':
    case 'invalid_people':
    case 'too_many_people':
    case 'not_shareable':
    case 'invalid_retention':
      return 400;
  }
}

function answer(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
