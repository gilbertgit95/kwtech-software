'use client';

import { PRINT_JOB_TICKET_HEADER } from '../domain/jobs.js';
import { PRINT_OPERATIONS } from '../operations.js';
import type { PrintJobFailure, PrintJobStatus, PrintPaper, PrintSettingOption } from '../types.js';

/**
 * How the Printers page reaches the API — through the app's same-origin route
 * handler, which attaches the session. The path is a parameter because that
 * handler belongs to `module-auth`, and this module may not name its URL
 * (PLAN §9). The default is where this app mounts it.
 *
 * ⚠ ONLY A PERSON'S OPERATIONS. What a computer sends (`pairPrintAgent` and
 * the rest) is the print agent's to send, from `apps/print-agent`.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

/**
 * Where a job's file is sent: the app's same-origin handler from
 * `@kwtech/module-print/next`, which passes it to the API as a stream. A
 * parameter for the reason the GraphQL path is; the default is where this app
 * mounts it. The job's id and `/content` are appended.
 */
export const DEFAULT_RELAY_PATH = '/api/print/jobs';

export interface PrintScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface PrintPrinterView {
  id: string;
  name: string;
  driver: string;
  isDefault: boolean;
  /** `ready` | `offline` | `error` | `unknown`. */
  status: string;
  gone: boolean;
  papers: PrintPaper[];
  /** The kinds of paper its driver knows, and the one it is set to. Empty: the driver did not say. */
  mediaTypes: PrintSettingOption[];
  mediaType: string | null;
  qualities: PrintSettingOption[];
  quality: string | null;
}

export interface PrintAgentView {
  id: string;
  name: string;
  hostName: string | null;
  agentVersion: string | null;
  online: boolean;
  lastSeenAt: string | null;
  pairedAt: string;
  printers: PrintPrinterView[];
}

export interface PrintPairingCodeView {
  /** `ABCDE-FGHJK`. Shown once; the server keeps only its hash. */
  code: string;
  expiresAt: string;
}

/** What a person asks for when they print. */
export interface PrintJobRequest {
  printerId: string;
  /** One of that printer's papers, by name. Null: whatever the printer is set to. */
  paperName: string | null;
  copies: number;
  /** One of that printer's paper types and qualities, by id. Left out or null: as the printer is set. */
  mediaType?: string | null;
  quality?: string | null;
}

export interface PrintJobStartView {
  jobId: string;
  /** ⚠ Sends this job's file, once. Held in memory for the moment between the two calls, and nowhere else. */
  ticket: string;
}

export interface PrintJobView {
  id: string;
  status: PrintJobStatus;
  failure: PrintJobFailure | null;
  message: string | null;
}

export interface PrintClient {
  agents(scope: PrintScopeView): Promise<PrintAgentView[]>;
  createPairingCode(scope: PrintScopeView, name: string): Promise<PrintPairingCodeView>;
  revokeAgent(scope: PrintScopeView, agentId: string): Promise<void>;
  /** Open a job. `size` is the file's length in bytes, which the server holds the transfer to. */
  startJob(scope: PrintScopeView, request: PrintJobRequest, size: number): Promise<PrintJobStartView>;
  /**
   * Send the file of a job just opened. Resolves once the computer holds all
   * of it or the job has failed; ⚠ it never throws for a failed job, because
   * the job's status (`job`) is what says how it went.
   */
  sendJob(start: PrintJobStartView, pdf: Uint8Array): Promise<void>;
  /** How a job stands, or null once the server has forgotten it. */
  job(scope: PrintScopeView, jobId: string): Promise<PrintJobView | null>;
}

export function createPrintClient(options: { graphqlPath?: string; relayPath?: string } = {}): PrintClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;
  const relayPath = options.relayPath ?? DEFAULT_RELAY_PATH;

  /** One request shape for every call. Throws the API's FIRST error message: the refusals are written for a reader. */
  async function graphql<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ query: document, variables }),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  const scoped = (scope: PrintScopeView, extra: Record<string, unknown> = {}) => ({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...extra,
  });
  const ops = PRINT_OPERATIONS;

  return {
    async agents(scope) {
      return (await graphql<{ printAgents: PrintAgentView[] }>(ops.printAgents, scoped(scope))).printAgents;
    },
    async createPairingCode(scope, name) {
      const data = await graphql<{ createPrintPairingCode: PrintPairingCodeView }>(
        ops.createPrintPairingCode,
        scoped(scope, { name }),
      );
      return data.createPrintPairingCode;
    },
    async revokeAgent(scope, agentId) {
      await graphql(ops.revokePrintAgent, scoped(scope, { agentId }));
    },
    async startJob(scope, request, size) {
      const data = await graphql<{ startPrintJob: PrintJobStartView }>(
        ops.startPrintJob,
        scoped(scope, { ...request, size }),
      );
      return data.startPrintJob;
    },
    async sendJob(start, pdf) {
      try {
        await fetch(`${relayPath}/${encodeURIComponent(start.jobId)}/content`, {
          method: 'PUT',
          headers: { 'content-type': 'application/pdf', [PRINT_JOB_TICKET_HEADER]: start.ticket },
          // A Blob, so the browser sends it with its length and without copying it into a string.
          body: new Blob([pdf as BlobPart], { type: 'application/pdf' }),
          credentials: 'omit',
          cache: 'no-store',
        });
      } catch {
        // A dropped connection is one of the ways a job fails, and the job says so itself.
      }
    },
    async job(scope, jobId) {
      return (await graphql<{ printJob: PrintJobView | null }>(ops.printJob, scoped(scope, { jobId }))).printJob;
    },
  };
}
