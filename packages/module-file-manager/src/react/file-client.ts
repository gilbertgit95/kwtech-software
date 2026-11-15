'use client';

import { FILE_UPLOAD_PATH, FILE_UPLOAD_TICKET_HEADER, fileDownloadHref } from '../domain/transfer.js';
import { FILE_OPERATIONS } from '../operations.js';

/**
 * How the files app reaches the API: GraphQL through the app's same-origin
 * route handler (which attaches the session), and the bytes through this
 * module's own two routes (`/next`), which spend a one-time ticket.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface FileScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface FilePersonView {
  userId: string;
  displayName: string;
}

export interface FileEntryView {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  ownerId: string;
  ownerName: string | null;
  mine: boolean;
  /** `private`, `workspace` or `people`. */
  visibility: string;
  /** Only for your own files: who a `people` file is shared with. */
  sharedWith: FilePersonView[];
  createdAt: string;
}

export interface FileSettingsView {
  retentionHours: number;
  cleanupTime: string;
  maxFileBytes: number;
  storageBytes: number | null;
  usedBytes: number;
}

export interface FileEventView {
  kind: string;
  fileId: string | null;
  actorId: string | null;
}

export interface FileSharingInputView {
  visibility: string;
  sharedWith: readonly string[];
}

export interface FileUploadInputView extends FileSharingInputView {
  file: Blob & { name: string; type: string };
  /** Called as bytes leave the browser, with the fraction sent (0…1). */
  onProgress?: (fraction: number) => void;
}

export interface FileClient {
  list(scope: FileScopeView): Promise<FileEntryView[]>;
  settings(scope: FileScopeView): Promise<FileSettingsView>;
  shareableMembers(scope: FileScopeView): Promise<FilePersonView[]>;
  /** Asks for a ticket, then sends the bytes. Resolves once the server holds the whole file. */
  upload(scope: FileScopeView, input: FileUploadInputView): Promise<void>;
  setSharing(scope: FileScopeView, fileId: string, input: FileSharingInputView): Promise<FileEntryView>;
  delete(scope: FileScopeView, fileId: string): Promise<void>;
  /** A one-time download address, valid for a minute. Ask at the click, never ahead. */
  downloadUrl(scope: FileScopeView, fileId: string): Promise<string>;
  setSettings(scope: FileScopeView, retentionHours: number): Promise<FileSettingsView>;
}

export function createFileClient(options: { graphqlPath?: string; uploadPath?: string } = {}): FileClient {
  const graphqlPath = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;
  const uploadPath = options.uploadPath ?? FILE_UPLOAD_PATH;

  async function graphql<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(graphqlPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: document, variables }),
        cache: 'no-store',
      });
    } catch {
      throw new Error('Cannot reach the server.');
    }
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  const scoped = (scope: FileScopeView, extra: Record<string, unknown> = {}) => ({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...extra,
  });
  const ops = FILE_OPERATIONS;

  return {
    async list(scope) {
      return (await graphql<{ files: FileEntryView[] }>(ops.files, scoped(scope))).files;
    },
    async settings(scope) {
      return (await graphql<{ fileSettings: FileSettingsView }>(ops.fileSettings, scoped(scope))).fileSettings;
    },
    async shareableMembers(scope) {
      return (await graphql<{ fileShareableMembers: FilePersonView[] }>(ops.fileShareableMembers, scoped(scope)))
        .fileShareableMembers;
    },
    async upload(scope, input) {
      const { file } = input;
      const started = await graphql<{ startFileUpload: { ticket: string } }>(
        ops.startFileUpload,
        scoped(scope, {
          input: {
            name: file.name,
            sizeBytes: file.size,
            contentType: file.type || null,
            visibility: input.visibility,
            sharedWith: [...input.sharedWith],
          },
        }),
      );
      await sendBytes(uploadPath, started.startFileUpload.ticket, file, input.onProgress);
    },
    async setSharing(scope, fileId, input) {
      const variables = scoped(scope, { fileId, visibility: input.visibility, sharedWith: [...input.sharedWith] });
      return (await graphql<{ setFileSharing: FileEntryView }>(ops.setFileSharing, variables)).setFileSharing;
    },
    async delete(scope, fileId) {
      await graphql<{ deleteFile: boolean }>(ops.deleteFile, scoped(scope, { fileId }));
    },
    async downloadUrl(scope, fileId) {
      const ticket = (await graphql<{ issueFileDownload: string }>(ops.issueFileDownload, scoped(scope, { fileId })))
        .issueFileDownload;
      return fileDownloadHref(ticket);
    },
    async setSettings(scope, retentionHours) {
      return (
        await graphql<{ setFileSettings: FileSettingsView }>(ops.setFileSettings, scoped(scope, { retentionHours }))
      ).setFileSettings;
    },
  };
}

/**
 * The bytes, with their progress. ⚠ XMLHttpRequest, not `fetch`: `fetch` has
 * no upload progress, and a large file with no progress looks like a hang.
 */
function sendBytes(path: string, ticket: string, file: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', path);
    request.setRequestHeader(FILE_UPLOAD_TICKET_HEADER, ticket);
    request.setRequestHeader('content-type', 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    request.onerror = () => reject(new Error('The upload was interrupted. Check the connection and try again.'));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(new Error(messageOf(request.responseText) ?? 'The file could not be saved. Try again.'));
    };
    request.send(file);
  });
}

function messageOf(text: string): string | null {
  try {
    const body = JSON.parse(text) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}
