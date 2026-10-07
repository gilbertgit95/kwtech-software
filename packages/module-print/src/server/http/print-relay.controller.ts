import type { IncomingMessage, ServerResponse } from 'node:http';
import { PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import { Controller, Get, Headers, Param, Put, Req, Res, SetMetadata } from '@nestjs/common';
import { PRINT_AGENT_SECRET_HEADER, PRINT_JOB_TICKET_HEADER } from '../../domain/jobs.js';
import { PRINT_JOB_NOT_FOUND_MESSAGE, PrintWriteError } from '../print.errors.js';
import { PrintAgentService } from '../print-agent.service.js';
import { PrintRelayService } from '../print-relay.service.js';

/**
 * The two HTTP ends of the relay: a browser sending a job's file, and the
 * computer fetching it.
 *
 * ## ⚠ WHY THIS MODULE HAS A CONTROLLER, when the rule is that new modules
 * expose no REST
 *
 * A file is not a GraphQL value. Through GraphQL it would cross as text, a
 * third larger and whole in the server's memory; here it is two streams and
 * the server holds a few kilobytes of it at a time (PLAN §13, 2026-10-07).
 * These two routes carry the file and nothing else. Everything that DECIDES —
 * who may print, on what, how it went — is GraphQL, guarded as usual.
 *
 * ## ⚠ PUBLIC, BUT NOT OPEN
 *
 * Neither caller has a session here. The browser presents the one-time
 * ticket `startPrintJob` gave it, which names one job and is spent on use.
 * The computer presents its secret, and is given only a job that is its own.
 * Both are 256 random bits, so neither route is a place a secret is guessed,
 * and neither carries the credential marker.
 *
 * ## ⚠ ONE ANSWER for everything that is not there
 *
 * A job that does not exist, a wrong ticket, a spent one, a computer that is
 * not paired, a job that is another computer's: all 404, one message.
 *
 * `@Res()` on both: the answers are written by hand, because one of them is a
 * stream and the other must wait for it.
 */
@Controller('print/jobs')
export class PrintRelayController {
  constructor(
    private readonly relay: PrintRelayService,
    private readonly agents: PrintAgentService,
  ) {}

  /** The browser's half. Answers once the computer holds the whole file, or the job has failed. */
  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'The browser that opened a job sends its file with the one-time ticket startPrintJob returned; the ticket is the authorisation',
  )
  @Put(':jobId/content')
  async send(
    @Param('jobId') jobId: string,
    @Headers(PRINT_JOB_TICKET_HEADER) ticket: string | undefined,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    try {
      const job = await this.relay.send(jobId, ticket, request);
      // 409 for a job that failed: the request was understood, and the job is in a state that cannot take it.
      answer(response, job.status === 'failed' ? 409 : 200, job);
    } catch (error) {
      if (!(error instanceof PrintWriteError)) throw error;
      answer(response, 404, { reason: 'job_not_found', message: PRINT_JOB_NOT_FOUND_MESSAGE });
    }
  }

  /** The computer's half: the file, as it arrives from the browser. */
  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'A paired computer fetches a job that is its own, presenting its secret; nobody is signed in',
  )
  @Get(':jobId/content')
  async fetch(
    @Param('jobId') jobId: string,
    @Headers(PRINT_AGENT_SECRET_HEADER) secret: string | undefined,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const admission = await this.agents.admitSecret(secret);
    const delivered = admission
      ? await this.relay.fetch(jobId, admission.agentId, response, (size) => {
          response.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': String(size),
            // A print job is nobody's to cache.
            'cache-control': 'no-store',
          });
        })
      : false;
    // Nothing was started, so there is still an answer to give. Once started, the stream is the answer.
    if (!delivered && !response.headersSent) {
      answer(response, 404, { reason: 'job_not_found', message: PRINT_JOB_NOT_FOUND_MESSAGE });
    }
  }
}

function answer(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
