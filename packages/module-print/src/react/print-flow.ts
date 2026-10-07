import { isJobEnded, PRINT_JOB_CONNECT_SECONDS, PRINT_JOB_PRINT_SECONDS } from '../domain/jobs.js';
import type { PrintClient, PrintJobRequest, PrintJobView, PrintScopeView } from './print-client.js';

/** How often a job under way is read again. */
export const JOB_REREAD_MS = 1000;

/**
 * The longest a job can take on the server, plus a little: both ends arriving,
 * then the computer saying how it went. Past it the page stops asking.
 */
export const JOB_WATCH_MS = (PRINT_JOB_CONNECT_SECONDS + PRINT_JOB_PRINT_SECONDS + 15) * 1000;

/**
 * Print one PDF on one printer, start to finish: open the job, send the file,
 * and read the job until it ends. `onChange` hears each state on the way.
 *
 * Resolves with how it ended, or null when the server has forgotten the job —
 * which the page words as "look at the printer". Throws only for a job that
 * could not be OPENED (offline, not permitted, too large): those are refusals
 * with a sentence for the reader.
 *
 * ⚠ THE FILE IS READ FROM MEMORY AND KEPT NOWHERE. This writes to no browser
 * storage, and the ticket lives in a local variable for as long as the send
 * takes.
 *
 * `wait` is the seam the tests replace.
 */
export async function printThroughAgent(
  api: Pick<PrintClient, 'startJob' | 'sendJob' | 'job'>,
  scope: PrintScopeView,
  request: PrintJobRequest,
  pdf: Uint8Array,
  onChange: (job: PrintJobView | null) => void = () => {},
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<PrintJobView | null> {
  const start = await api.startJob(scope, request, pdf.byteLength);
  onChange({ id: start.jobId, status: 'waiting', failure: null, message: null });

  // Not awaited before the first read: the send resolves only when the transfer is over, and the page shows it moving.
  let sent = false;
  const sending = api.sendJob(start, pdf).then(() => {
    sent = true;
  });

  let job: PrintJobView | null = null;
  for (let waited = 0; waited <= JOB_WATCH_MS; waited += JOB_REREAD_MS) {
    await (sent ? wait(JOB_REREAD_MS) : Promise.race([sending, wait(JOB_REREAD_MS)]));
    job = await api.job(scope, start.jobId);
    onChange(job);
    if (!job || isJobEnded(job.status)) return job;
  }
  return job;
}
