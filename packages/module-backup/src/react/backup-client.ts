'use client';

import { BACKUP_DOWNLOAD_PATH } from '../domain/download.js';
import { BACKUP_OPERATIONS } from '../operations.js';
import type { BackupActivity, BackupFileView } from '../types.js';

/** The app's same-origin GraphQL handler, which attaches the session (module-auth's; this module may not name it). */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface BackupStateView {
  activity: BackupActivity;
  maintenance: boolean;
  database: string;
  keep: number;
  timeZone: string;
  files: BackupFileView[];
}

/** One method per operation. */
export interface BackupClient {
  state(): Promise<BackupStateView>;
  create(): Promise<BackupFileView>;
  remove(name: string): Promise<void>;
  /** A one-time download address for `name`, valid for a minute. */
  downloadUrl(name: string): Promise<string>;
  restore(name: string, confirmation: string, password: string): Promise<void>;
}

export function createBackupClient(options: { graphqlPath?: string; downloadPath?: string } = {}): BackupClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;
  const downloadPath = options.downloadPath ?? BACKUP_DOWNLOAD_PATH;
  const ops = BACKUP_OPERATIONS;

  async function graphql<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
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

  return {
    async state() {
      return (await graphql<{ backups: BackupStateView }>(ops.backups)).backups;
    },
    async create() {
      return (await graphql<{ createBackup: BackupFileView }>(ops.createBackup)).createBackup;
    },
    async remove(name) {
      await graphql(ops.deleteBackup, { name });
    },
    async downloadUrl(name) {
      const ticket = (await graphql<{ issueBackupDownload: string }>(ops.issueBackupDownload, { name }))
        .issueBackupDownload;
      return `${downloadPath}?ticket=${encodeURIComponent(ticket)}`;
    },
    async restore(name, confirmation, password) {
      await graphql(ops.restoreBackup, { name, confirmation, password });
    },
  };
}
