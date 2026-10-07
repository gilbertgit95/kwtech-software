import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  PRINT_AGENT_SECRET_HEADER,
  PRINT_AGENT_SECRET_PARAM,
  PRINT_OPERATIONS,
  type PrintAgentJob,
  type PrintReportedPrinter,
  printJobContentPath,
} from '@kwtech/module-print';
import { type Client, createClient } from 'graphql-ws';

/**
 * Everything the agent says to the server, and nothing else. The documents
 * come from `@kwtech/module-print`, where the server's own test validates them
 * against the schema, so this file holds no GraphQL of its own.
 */

/** What the socket's end means for the agent. */
export type SessionEnd =
  /** The server declined the secret (4403): this computer was revoked. Final. */
  | 'refused'
  /** Anything else: the network, a restart, the twelve-hour limit. Try again. */
  | 'lost';

/** The server's "declined this connection" close code (`WS_CLOSE.forbidden` in the web server). */
const CLOSE_FORBIDDEN = 4403;

export interface PairedAnswer {
  secret: string;
  agentId: string;
  name: string;
}

/**
 * Exchange a typed code for this computer's secret, over HTTP.
 *
 * Null when the server refuses the code — it says the same for wrong, used,
 * expired and "that workspace is full", on purpose. Throws when the server
 * cannot be reached, which is a different thing to tell the person typing.
 */
export async function pairWithServer(
  apiUrl: string,
  input: { code: string; hostName: string; agentVersion: string },
  request: typeof fetch = fetch,
): Promise<PairedAnswer | null> {
  let response: Response;
  try {
    response = await request(`${apiUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: PRINT_OPERATIONS.pairPrintAgent, variables: input }),
    });
  } catch (error) {
    throw new Error(`The server at ${apiUrl} could not be reached — ${error instanceof Error ? error.message : error}`);
  }
  if (response.status === 429) throw new Error('Too many tries from this address. Wait a minute, then try again.');
  if (!response.ok) throw new Error(`The server at ${apiUrl} answered ${response.status}.`);

  const body = (await response.json()) as {
    data?: { pairPrintAgent?: PairedAnswer | null };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The server refused the request.');
  return body.data?.pairPrintAgent ?? null;
}

/**
 * Fetch one job's file into `destination`, over HTTP, as it arrives from the
 * browser that is sending it.
 *
 * `taken` when the server has no such job for this computer — another socket
 * of this same computer fetched it first, or it ended while this one was
 * busy. ⚠ That is not a failure and must not be reported as one: the job is
 * somebody else's to answer for. Throws when the file did not arrive whole.
 *
 * ⚠ THE LENGTH IS CHECKED AGAINST THE JOB'S. A file cut short by a dropped
 * connection would otherwise be handed to a printer as it is.
 */
export async function fetchJobFile(
  apiUrl: string,
  secret: string,
  job: Pick<PrintAgentJob, 'jobId' | 'size'>,
  destination: string,
  request: typeof fetch = fetch,
): Promise<'fetched' | 'taken'> {
  const response = await request(`${apiUrl}${printJobContentPath(job.jobId)}`, {
    headers: { [PRINT_AGENT_SECRET_HEADER]: secret },
  });
  if (response.status === 404) return 'taken';
  if (!response.ok || !response.body) throw new Error(`The server answered ${response.status} for the file.`);

  // Mode 0600 where the system honours one: the file is somebody's document for the moment it is here.
  await pipeline(
    Readable.fromWeb(response.body as unknown as WebReadableStream),
    createWriteStream(destination, { mode: 0o600 }),
  );
  const { size } = await stat(destination);
  if (size !== job.size) throw new Error(`The file arrived as ${size} bytes, and the job said ${job.size}.`);
  return 'fetched';
}

export interface AgentSession {
  /** "Still here." False: revoked, and final. */
  heartbeat(): Promise<boolean>;
  reportPrinters(printers: readonly PrintReportedPrinter[]): Promise<void>;
  /** Hear of each job for this computer, for as long as the session lasts. Those already waiting come first. */
  watchJobs(onJob: (job: PrintAgentJob) => void): void;
  /** How the printing of one job went. */
  reportJob(jobId: string, printed: boolean, message: string | null): Promise<void>;
  close(): void;
}

/**
 * One socket to the server, opened with the secret.
 *
 * ⚠ NO RETRY IN HERE (`retryAttempts: 0`). `graphql-ws` would retry a 4403,
 * which the server means as final, and would treat a 4500 as fatal, which the
 * server means as "try again". So the library is told to do neither and the
 * agent's own loop (`run.ts`) decides, from `onEnd`.
 *
 * `onOpen` fires once the server has acknowledged the secret; `onEnd` once,
 * however the socket ends, including never having opened.
 */
export function openSession(
  wsUrl: string,
  secret: string,
  handlers: { onOpen: (session: AgentSession) => void; onEnd: (end: SessionEnd) => void },
): AgentSession {
  let ended = false;
  const end = (reason: SessionEnd) => {
    if (ended) return;
    ended = true;
    handlers.onEnd(reason);
  };

  const client: Client = createClient({
    url: wsUrl,
    // Node 22's own WebSocket: no `ws` dependency to carry onto a shop's computer.
    webSocketImpl: WebSocket,
    connectionParams: { [PRINT_AGENT_SECRET_PARAM]: secret },
    lazy: false,
    retryAttempts: 0,
    // Required with `lazy: false`, or a failed connection is an unhandled rejection. `closed` below reports it.
    onNonLazyError: () => {},
    on: {
      connected: () => handlers.onOpen(session),
      closed: (event) => {
        const code = (event as { code?: unknown } | undefined)?.code;
        end(code === CLOSE_FORBIDDEN ? 'refused' : 'lost');
      },
      error: () => end('lost'),
    },
  });

  /** One operation over the socket, as a promise of its `data`. */
  function execute<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      let data: T | undefined;
      let failure: Error | undefined;
      client.subscribe<T>(
        { query, variables },
        {
          next: (result) => {
            if (result.errors?.length) failure = new Error(result.errors[0]?.message ?? 'The server refused.');
            if (result.data) data = result.data;
          },
          error: (error) => reject(error instanceof Error ? error : new Error('The connection was lost.')),
          complete: () => {
            if (failure) reject(failure);
            else if (data === undefined) reject(new Error('The server returned no data.'));
            else resolve(data);
          },
        },
      );
    });
  }

  const session: AgentSession = {
    async heartbeat() {
      const data = await execute<{ printAgentHeartbeat: boolean }>(PRINT_OPERATIONS.printAgentHeartbeat);
      return data.printAgentHeartbeat === true;
    },
    async reportPrinters(printers) {
      await execute(PRINT_OPERATIONS.reportPrintAgentPrinters, { printers });
    },
    watchJobs(onJob) {
      client.subscribe<{ printAgentJobs: PrintAgentJob }>(
        { query: PRINT_OPERATIONS.printAgentJobs },
        {
          next: (result) => {
            if (result.data?.printAgentJobs) onJob(result.data.printAgentJobs);
          },
          // Both mean the socket is going, and its `closed` event ends the session and brings a new one.
          error: () => {},
          complete: () => {},
        },
      );
    },
    async reportJob(jobId, printed, message) {
      await execute(PRINT_OPERATIONS.reportPrintAgentJob, { jobId, printed, message });
    },
    close() {
      /*
       * ⚠ `dispose()` REJECTS when the socket never opened: it awaits the
       * connection, and a refused handshake rejects that with the close event.
       * Left alone, that is an unhandled rejection that kills the process with
       * a stack trace — on the one path, "revoked", where the agent has a
       * plain sentence to say instead. `onEnd` has already reported the end.
       */
      Promise.resolve(client.dispose()).catch(() => {});
    },
  };
  return session;
}
