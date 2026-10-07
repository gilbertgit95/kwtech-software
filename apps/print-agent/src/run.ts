import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRINT_AGENT_HEARTBEAT_SECONDS, type PrintAgentJob, type PrintReportedPrinter } from '@kwtech/module-print';
import type { PrinterDriver } from './printers/driver.js';
import { type AgentSession, fetchJobFile, openSession, type SessionEnd } from './server-api.js';

/**
 * The agent's life once paired: connect, report the printers, say "still here",
 * print the jobs it is sent, notice when the printers change, and reconnect
 * when the socket drops.
 */

/** How often the printers are read again. A printer added or unplugged shows in the web app within this. Seconds. */
export const PRINTER_RECHECK_SECONDS = 300;

/** The wait before reconnecting, doubling to a ceiling. Seconds. */
export const RECONNECT_FIRST_SECONDS = 2;
export const RECONNECT_MAX_SECONDS = 60;

/** A session that lasted this long was a working one, and the wait starts over. Seconds. */
const HEALTHY_SESSION_SECONDS = 60;

/** The wait before the next try. Pure, so the doubling and its ceiling are tested. */
export function nextReconnectDelay(previousSeconds: number | null): number {
  if (previousSeconds === null) return RECONNECT_FIRST_SECONDS;
  return Math.min(previousSeconds * 2, RECONNECT_MAX_SECONDS);
}

/** Whether two reports say the same thing, so an unchanged list is not sent again. */
export function sameReport(a: readonly PrintReportedPrinter[] | null, b: readonly PrintReportedPrinter[]): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

export interface RunOptions {
  wsUrl: string;
  /** Where a job's file is fetched from. The same server as `wsUrl` (`isSameServer`). */
  apiUrl: string;
  secret: string;
  driver: PrinterDriver;
  log: (message: string) => void;
  /** Set when the process is asked to stop. */
  signal: AbortSignal;
  /** The seam the tests replace: how a session is opened. */
  open?: typeof openSession;
  /** The other seam: how a job's file is fetched. */
  fetchJob?: typeof fetchJobFile;
  /** Where a job's file is kept for the moment it prints. The system's temporary folder when left out. */
  tempDir?: string;
  /** Scales every wait, so a test runs in milliseconds. */
  secondsToMs?: number;
}

/** Why `runAgent` returned. */
export type RunEnd = 'revoked' | 'stopped';

/**
 * Run until revoked or told to stop.
 *
 * ⚠ REVOKED IS FINAL: the agent stops and says so. Reconnecting with a secret
 * the server has declined cannot work, and a loop that tried would be a
 * computer knocking on the server every minute for ever.
 */
export async function runAgent(options: RunOptions): Promise<RunEnd> {
  const ms = options.secondsToMs ?? 1000;
  let delay: number | null = null;

  while (!options.signal.aborted) {
    const startedAt = Date.now();
    const end = await runSession(options, ms);
    if (end === 'refused') return 'revoked';
    if (options.signal.aborted) break;

    if (Date.now() - startedAt >= HEALTHY_SESSION_SECONDS * ms) delay = null;
    delay = nextReconnectDelay(delay);
    options.log(`Connection lost. Trying again in ${delay} s.`);
    await wait(delay * ms, options.signal);
  }
  return 'stopped';
}

/** One socket's worth of work. Resolves when it ends, with why. */
function runSession(options: RunOptions, ms: number): Promise<SessionEnd> {
  const open = options.open ?? openSession;
  return new Promise((resolve) => {
    const timers: NodeJS.Timeout[] = [];
    let lastReport: PrintReportedPrinter[] | null = null;
    let finished = false;

    const finish = (end: SessionEnd) => {
      if (finished) return;
      finished = true;
      // `clearInterval` clears a timeout too: one list holds both kinds.
      for (const timer of timers) clearInterval(timer);
      options.signal.removeEventListener('abort', stop);
      session.close();
      resolve(end);
    };
    const stop = () => finish('lost');

    /** Read the printers and send them if they changed. A failure is logged and tried again next time. */
    async function report(current: AgentSession) {
      try {
        const printers = await options.driver.list();
        // ⚠ Reading the printers takes half a minute on Windows; the session may have ended meanwhile.
        if (finished || sameReport(lastReport, printers)) return;
        await current.reportPrinters(printers);
        lastReport = printers;
        options.log(
          `Reported ${printers.length} printer(s): ${printers.map((printer) => printer.name).join(', ') || 'none'}.`,
        );
      } catch (error) {
        // A report cut off by the session ending is not a failure worth a line; the next session reports again.
        if (finished) return;
        options.log(`Could not report the printers — ${error instanceof Error ? error.message : error}`);
      }
    }

    /*
     * ⚠ A HEARTBEAT NOBODY ANSWERS ENDS THE SESSION. A connection that died
     * without a close (a router restarted, a laptop slept) leaves the socket
     * looking open; the question would wait for ever, and the computer would
     * show offline in the web app while believing it is connected. One beat's
     * interval with no answer is that connection, so the agent reconnects.
     */
    async function beat(current: AgentSession) {
      const unanswered = setTimeout(() => {
        options.log('The server stopped answering.');
        finish('lost');
      }, PRINT_AGENT_HEARTBEAT_SECONDS * ms);
      timers.push(unanswered);
      try {
        const alive = await current.heartbeat();
        clearTimeout(unanswered);
        if (!alive) finish('refused');
      } catch {
        clearTimeout(unanswered);
        // A heartbeat that could not be sent is the socket's problem; its `closed` event ends the session.
      }
    }

    /*
     * ⚠ ONE JOB AT A TIME, in the order they came. A printer driver is not
     * something to call twice at once, and two jobs for one printer must come
     * out in the order they were sent.
     */
    let printing: Promise<void> = Promise.resolve();
    const queue = (current: AgentSession, job: PrintAgentJob) => {
      printing = printing.then(() => printJob(options, current, job));
    };

    const session = open(options.wsUrl, options.secret, {
      onOpen: (current) => {
        options.log('Connected.');
        current.watchJobs((job) => queue(current, job));
        void report(current);
        timers.push(setInterval(() => void beat(current), PRINT_AGENT_HEARTBEAT_SECONDS * ms));
        timers.push(setInterval(() => void report(current), PRINTER_RECHECK_SECONDS * ms));
      },
      onEnd: finish,
    });
    options.signal.addEventListener('abort', stop, { once: true });
  });
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * One job: fetch its file, print it, say how it went, and delete the file.
 *
 * ⚠ THE FILE IS ON THIS COMPUTER'S DISK ONLY WHILE IT PRINTS. The printing
 * program takes a path, so there has to be a file; it is in a folder made for
 * this one job, readable by this user alone where the system allows, and the
 * folder is removed in `finally` — printed, failed or thrown. Nothing a
 * person printed stays behind (PRINT-STUDIO-PLAN decision 8, on the shop's
 * side).
 *
 * Never throws: a job that fails is reported and logged, and the next one runs.
 */
async function printJob(options: RunOptions, current: AgentSession, job: PrintAgentJob): Promise<void> {
  const fetchJob = options.fetchJob ?? fetchJobFile;
  let folder: string | null = null;
  try {
    folder = await mkdtemp(join(options.tempDir ?? tmpdir(), 'kwtech-print-'));
    const file = join(folder, 'job.pdf');
    // Another socket of this computer took it, or it ended meanwhile: not this one's to answer for.
    if ((await fetchJob(options.apiUrl, options.secret, job, file)) === 'taken') return;

    await options.driver.print({
      file,
      printerName: job.printerName,
      paper: job.paper,
      copies: job.copies,
      mediaType: job.mediaType ?? null,
      quality: job.quality ?? null,
    });
    options.log(`Sent a job to "${job.printerName}" (${job.size} bytes, ${job.copies} copy(ies)).`);
    await current.reportJob(job.jobId, true, null).catch((error: unknown) => {
      // The paper is coming out either way; the web app will read "timed out", which says to look at the printer.
      options.log(`Could not tell the server the job was sent — ${reason(error)}`);
    });
  } catch (error) {
    options.log(`Could not print a job on "${job.printerName}" — ${reason(error)}`);
    await current.reportJob(job.jobId, false, reason(error)).catch(() => {});
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
