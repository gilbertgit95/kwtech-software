import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { type Readable, Transform, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  cleanJobMessage,
  isJobEnded,
  isJobTicketShaped,
  PRINT_JOB_CONNECT_SECONDS,
  PRINT_JOB_KEPT_SECONDS,
  PRINT_JOB_PRINT_SECONDS,
  PRINT_JOB_TICKET_BYTES,
  PRINT_JOBS_PER_AGENT_MAX,
  type PrintJobOptions,
  startsLikePdf,
} from '../domain/jobs.js';
import type { PrintAgentJob, PrintJobFailure, PrintJobStatus } from '../types.js';
import { refusalError } from './print.errors.js';
import type { InScope } from './print.repository.js';

/** A job as a person reads it back. */
export interface PrintJobView {
  id: string;
  status: PrintJobStatus;
  failure: PrintJobFailure | null;
  /** What the computer said went wrong, cleaned. Null unless it said something. */
  message: string | null;
}

export interface OpenedJob {
  jobId: string;
  /** The raw ticket. Returned once, to the browser that will send the file, and kept only as a hash. */
  ticket: string;
}

interface RelayJob extends InScope {
  id: string;
  agentId: string;
  actorId: string;
  /** Null once it has been presented: a ticket sends one file, once. */
  ticketHash: Buffer | null;
  job: PrintAgentJob;
  status: PrintJobStatus;
  failure: PrintJobFailure | null;
  message: string | null;
  endedAt: number | null;
  sender: { stream: Readable; settle: (view: PrintJobView) => void } | null;
  fetcher: { stream: Writable; begin: (size: number) => void; settle: (delivered: boolean) => void } | null;
  timer: NodeJS.Timeout | null;
}

/** A transfer stopped by the relay itself, with the reason a person is told. */
class RelayStop extends Error {
  constructor(readonly failure: PrintJobFailure) {
    super(failure);
  }
}

const hashTicket = (ticket: string) => createHash('sha256').update(ticket).digest();

/**
 * The in-memory relay: where a browser's file meets the computer that prints
 * it (PLAN §13, 2026-10-07).
 *
 * A job is opened by a person (`open`). The computer is told (`watch`), and
 * two requests then arrive — the browser's, carrying the file (`send`), and
 * the computer's, asking for it (`fetch`). When both are here the one is
 * piped into the other, with the stream's own backpressure, so the server
 * holds a few kilobytes at a time and never the file.
 *
 * ⚠ NOTHING IS WRITTEN ANYWHERE. No table, no disk, no cache: the studio's
 * rule is that a file never rests on the server (PRINT-STUDIO-PLAN decision
 * 8). What is remembered is what a job IS and how it ended, for
 * `PRINT_JOB_KEPT_SECONDS`, so the page that sent it can say.
 *
 * ⚠ ONE SERVER INSTANCE (PLAN §12.114). The two requests must reach the
 * process that opened the job, and the computer is told over a socket this
 * process holds. Behind a balancer with several instances a job would wait
 * for a computer connected somewhere else and fail `agent_did_not_fetch`.
 * Deliberately not built on the app's pub/sub: publishing the news of a job
 * across instances would not move the two requests to one of them.
 *
 * ⚠ THE TIMERS HERE ARE A REQUEST'S OWN TIME LIMIT, not scheduled work: each
 * belongs to one open job and dies with it. Work on a schedule is a declared
 * process (`module-jobs`); this is not that.
 */
@Injectable()
export class PrintRelayService implements OnModuleDestroy {
  private readonly jobs = new Map<string, RelayJob>();
  private readonly watchers = new Map<string, Set<(job: PrintAgentJob) => void>>();
  /** Scales every wait, so a test runs in milliseconds. */
  secondsToMs = 1000;

  onModuleDestroy(): void {
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer);
    }
    this.jobs.clear();
  }

  /**
   * A new job for one computer, and the ticket that sends its file.
   *
   * Throws `agent_busy` when that computer already has
   * `PRINT_JOBS_PER_AGENT_MAX` under way — which also bounds this map: it can
   * hold no more than that many live jobs per paired computer.
   */
  open(
    input: InScope & { agentId: string; actorId: string; printerName: string; options: PrintJobOptions },
  ): OpenedJob {
    this.forget(Date.now());
    const under = [...this.jobs.values()].filter((job) => job.agentId === input.agentId && !isJobEnded(job.status));
    if (under.length >= PRINT_JOBS_PER_AGENT_MAX) throw refusalError('agent_busy');

    const ticket = randomBytes(PRINT_JOB_TICKET_BYTES).toString('base64url');
    const job: RelayJob = {
      id: randomUUID(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      actorId: input.actorId,
      ticketHash: hashTicket(ticket),
      job: {
        jobId: '',
        printerName: input.printerName,
        paper: input.options.paper,
        copies: input.options.copies,
        size: input.options.size,
        mediaType: input.options.mediaType,
        quality: input.options.quality,
      },
      status: 'waiting',
      failure: null,
      message: null,
      endedAt: null,
      sender: null,
      fetcher: null,
      timer: null,
    };
    job.job.jobId = job.id;
    this.jobs.set(job.id, job);
    this.arm(job, PRINT_JOB_CONNECT_SECONDS, () => {
      // Whoever did not come is the reason: a computer that never asked, or a browser that never sent.
      this.fail(job, job.fetcher ? 'nothing_sent' : 'agent_did_not_fetch');
    });
    for (const tell of this.watchers.get(job.agentId) ?? []) tell(job.job);
    return { jobId: job.id, ticket };
  }

  /**
   * The browser's half: the file, as a stream. Resolves when the job has
   * stopped moving — the computer holds all of it, or it failed — with how it
   * stands.
   *
   * ⚠ ONE REFUSAL, `job_not_found`, for a job that does not exist, a wrong
   * ticket and a ticket already used. The ticket is compared in constant time
   * and spent on its first use, right or wrong file.
   */
  send(jobId: string, ticket: unknown, stream: Readable): Promise<PrintJobView> {
    const job = this.jobs.get(jobId);
    if (!job?.ticketHash || !isJobTicketShaped(ticket) || !timingSafeEqual(job.ticketHash, hashTicket(ticket))) {
      throw refusalError('job_not_found');
    }
    job.ticketHash = null;
    if (job.status !== 'waiting') return Promise.resolve(view(job));

    return new Promise((resolve) => {
      job.sender = { stream, settle: resolve };
      this.join(job);
    });
  }

  /**
   * The computer's half: somewhere to write the file. `begin` is called with
   * the file's length just before its first byte, and never if there is
   * nothing to send — so the caller can still answer with a refusal.
   *
   * False for a job that is not this computer's, is not waiting, or already
   * has a fetcher: ⚠ ONE COMPUTER, ONE FETCH. A second socket of the same
   * computer is told of the job too, and must find it taken.
   */
  fetch(jobId: string, agentId: string, stream: Writable, begin: (size: number) => void): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.agentId !== agentId || job.status !== 'waiting' || job.fetcher) return Promise.resolve(false);
    return new Promise((resolve) => {
      job.fetcher = { stream, begin, settle: resolve };
      this.join(job);
    });
  }

  /**
   * How the printing went, from the computer that did it. False for a job
   * that is not this computer's or is not waiting to hear.
   */
  report(jobId: string, agentId: string, printed: boolean, message: unknown): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.agentId !== agentId || job.status !== 'printing') return false;
    if (printed) {
      this.end(job, 'printed');
    } else {
      job.message = cleanJobMessage(message);
      this.fail(job, 'printer_refused');
    }
    return true;
  }

  /**
   * A job, for the person who opened it. ⚠ Null for anybody else's, in this
   * workspace or another: how a colleague's print went is not shown, and an
   * id from elsewhere must read exactly as one that never existed.
   */
  view(scope: InScope, actorId: string, jobId: string): PrintJobView | null {
    const job = this.jobs.get(jobId);
    if (!job || job.actorId !== actorId) return null;
    if (job.organizationId !== scope.organizationId || job.workspaceId !== scope.workspaceId) return null;
    return view(job);
  }

  /**
   * The jobs for one computer: those already waiting for it, then each as it
   * is opened. Never ends by itself; the socket closing ends it.
   *
   * ⚠ A HAND-WRITTEN ITERATOR, NOT AN ASYNC GENERATOR. A generator parked on
   * "the next job" cannot be told to return — `return()` queues behind an
   * await that may never settle — so a closed socket would leave its watcher
   * registered for ever.
   */
  watch(agentId: string): AsyncIterableIterator<PrintAgentJob> {
    const queue: PrintAgentJob[] = [];
    let waiting: ((result: IteratorResult<PrintAgentJob>) => void) | null = null;
    let done = false;
    const finished: IteratorResult<PrintAgentJob> = { done: true, value: undefined };

    const tell = (job: PrintAgentJob) => {
      if (waiting) {
        waiting({ done: false, value: job });
        waiting = null;
      } else {
        queue.push(job);
      }
    };
    const watchers = this.watchers.get(agentId) ?? new Set();
    this.watchers.set(agentId, watchers);
    watchers.add(tell);
    // Registered first, then read, in one synchronous step: no job can fall between the two.
    for (const job of this.jobs.values()) {
      if (job.agentId === agentId && job.status === 'waiting' && !job.fetcher) queue.push(job.job);
    }

    const stop = () => {
      done = true;
      watchers.delete(tell);
      if (watchers.size === 0) this.watchers.delete(agentId);
      waiting?.(finished);
      waiting = null;
    };
    return {
      next: () => {
        if (done) return Promise.resolve(finished);
        const job = queue.shift();
        if (job) return Promise.resolve({ done: false, value: job });
        return new Promise((resolve) => {
          waiting = resolve;
        });
      },
      return: () => {
        stop();
        return Promise.resolve(finished);
      },
      throw: (error) => {
        stop();
        return Promise.reject(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /** Both halves are here: pass the one into the other. */
  private join(job: RelayJob): void {
    const { sender, fetcher } = job;
    if (!sender || !fetcher || job.status !== 'waiting') return;
    job.status = 'sending';
    this.disarm(job);

    void pipeline(
      sender.stream,
      gate(job.job.size, () => fetcher.begin(job.job.size)),
      fetcher.stream,
    ).then(
      () => {
        job.status = 'printing';
        this.arm(job, PRINT_JOB_PRINT_SECONDS, () => this.fail(job, 'timed_out'));
        this.settle(job, true);
      },
      (error: unknown) => this.fail(job, error instanceof RelayStop ? error.failure : 'interrupted'),
    );
  }

  private fail(job: RelayJob, failure: PrintJobFailure): void {
    if (isJobEnded(job.status)) return;
    job.failure = failure;
    this.end(job, 'failed');
  }

  private end(job: RelayJob, status: 'printed' | 'failed'): void {
    this.disarm(job);
    job.status = status;
    job.endedAt = Date.now();
    this.settle(job, false);
  }

  /** Answer whichever requests are still held, once. */
  private settle(job: RelayJob, delivered: boolean): void {
    const { sender, fetcher } = job;
    job.sender = null;
    job.fetcher = null;
    sender?.settle(view(job));
    fetcher?.settle(delivered);
  }

  private arm(job: RelayJob, seconds: number, onTime: () => void): void {
    this.disarm(job);
    job.timer = setTimeout(onTime, seconds * this.secondsToMs);
    // A job waiting must not keep a server that is shutting down alive.
    job.timer.unref();
  }

  private disarm(job: RelayJob): void {
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
  }

  /** Drop what ended long enough ago. Run when a job is opened: nothing else needs the room. */
  private forget(now: number): void {
    for (const [id, job] of this.jobs) {
      if (job.endedAt !== null && now - job.endedAt > PRINT_JOB_KEPT_SECONDS * this.secondsToMs) this.jobs.delete(id);
    }
  }
}

function view(job: RelayJob): PrintJobView {
  return { id: job.id, status: job.status, failure: job.failure, message: job.message };
}

/**
 * What stands between the two requests: it lets through exactly `size` bytes
 * of something that starts like a PDF, and stops the transfer otherwise.
 *
 * ⚠ NOTHING REACHES THE COMPUTER UNTIL THE START HAS BEEN SEEN. `begin` runs
 * then, so a file that is not a PDF is refused with the computer's request
 * still unanswered — a refusal, not half a download.
 */
function gate(size: number, begin: () => void): Transform {
  let seen = 0;
  let held: Buffer | null = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > size) return callback(new RelayStop('wrong_size'));
      if (held === null) return callback(null, chunk);

      held = Buffer.concat([held, chunk]);
      // Five bytes decide it; a sender may deliver them one at a time.
      if (held.length < 5 && seen < size) return callback();
      if (!startsLikePdf(held)) return callback(new RelayStop('not_a_pdf'));
      const first = held;
      held = null;
      begin();
      callback(null, first);
    },
    flush(callback) {
      if (held !== null) return callback(new RelayStop(held.length === 0 ? 'nothing_sent' : 'not_a_pdf'));
      callback(seen === size ? null : new RelayStop('wrong_size'));
    },
  });
}
