import type { PrintJobFailure, PrintJobStatus, PrintPaper, PrintPrinterSettings, PrintRefusal } from '../types.js';
import { cleanLine } from './agents.js';
import { chosenOption } from './printers.js';

/**
 * One print job: a PDF on its way from a browser to a paired computer
 * (docs/PRINT-STUDIO-PLAN.md §10, PLAN §13 2026-10-07).
 *
 * ⚠ THE FILE IS NEVER HELD. The server joins two requests — the browser's
 * sending one and the computer's fetching one — and passes what arrives from
 * the first into the second. What is kept, in memory and for a few minutes, is
 * only what the job IS: which printer, how many copies, how it ended.
 */

/**
 * The largest file one job may carry. A page of photos at 300 dpi is a few
 * megabytes; a long scanned document a few tens. Past this it is a mistake.
 */
export const PRINT_JOB_MAX_BYTES = 50 * 1024 * 1024;

/** More copies than this is a number typed wrong, on paper somebody pays for. */
export const PRINT_JOB_COPIES_MAX = 50;

/**
 * How long a job waits for BOTH ends to arrive: the browser sending and the
 * computer fetching. Seconds. A computer that is online answers within one;
 * past this the job fails rather than hold a person's request open.
 */
export const PRINT_JOB_CONNECT_SECONDS = 30;

/**
 * How long the computer has, once it holds the whole file, to say how the
 * printing went. Seconds. Handing fifty megabytes to a driver takes a while;
 * past this the job reads `timed_out`, which is "nobody knows", not "failed".
 */
export const PRINT_JOB_PRINT_SECONDS = 180;

/** How long an ended job's outcome can still be read, so the page that sent it can show it. Seconds. */
export const PRINT_JOB_KEPT_SECONDS = 300;

/** Jobs one computer may have under way at once. More is somebody pressing Print repeatedly. */
export const PRINT_JOBS_PER_AGENT_MAX = 3;

/** The request header the browser's one-time ticket travels in. */
export const PRINT_JOB_TICKET_HEADER = 'x-print-job-ticket';

/**
 * The request header a computer presents its secret in when it fetches a job.
 * ⚠ Not `Authorization`: that header is the app's, read as a person's session.
 */
export const PRINT_AGENT_SECRET_HEADER = 'x-print-agent-secret';

/** 256 bits, as the agent's secret is: a ticket is not guessable, so taking one needs no attempt limiter. */
export const PRINT_JOB_TICKET_BYTES = 32;

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isJobTicketShaped(value: unknown): value is string {
  return typeof value === 'string' && TICKET_PATTERN.test(value);
}

/** Where a job's file is sent to and fetched from, under the API's own prefix. One spelling for the server, the web app and the agent. */
export function printJobContentPath(jobId: string): string {
  return `/print/jobs/${encodeURIComponent(jobId)}/content`;
}

/** What a person asks for when they print. */
export interface PrintJobOptions {
  /** The paper to print on, by the name the printer reported. Null: whatever that printer is set to. */
  paper: PrintPaper | null;
  copies: number;
  /** The file's length in bytes, said before any of it is sent. */
  size: number;
  /** The kind of paper in the tray, by the id the printer reported. Null: as the printer is set. */
  mediaType: string | null;
  /** How carefully to print, by the id the printer reported. Null: as the printer is set. */
  quality: string | null;
}

/**
 * A request to print, checked against the printer it names.
 *
 * ⚠ THE PAPER MUST BE ONE THE PRINTER REPORTED, matched by name. A paper the
 * driver does not have cannot be chosen by the computer, and a job sent with
 * one prints on whatever is loaded — at the wrong size, silently.
 *
 * ⚠ THE SIZE IS DECLARED UP FRONT and the relay holds the sender to it: a
 * file over the cap is refused before a byte moves, and a transfer that ends
 * short is a failure the computer can see, not a damaged page.
 *
 * ⚠ A PAPER TYPE AND A QUALITY MUST BE ONES THE PRINTER REPORTED, for the
 * paper's reason and one more: the computer writes them into a print ticket,
 * and only the driver's own words go there. Left out, the printer's own
 * setting stands.
 */
export function prepareJobOptions(
  input: { paperName: unknown; copies: unknown; size: unknown; mediaType?: unknown; quality?: unknown },
  papers: readonly PrintPaper[],
  settings: Pick<PrintPrinterSettings, 'mediaTypes' | 'qualities'> = { mediaTypes: [], qualities: [] },
): PrintJobOptions | { refused: PrintRefusal } {
  const { paperName, copies, size } = input;
  const mediaType = chosenOption(input.mediaType, settings.mediaTypes);
  const quality = chosenOption(input.quality, settings.qualities);
  if (mediaType === undefined || quality === undefined) return { refused: 'invalid_job' };
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > PRINT_JOB_COPIES_MAX) {
    return { refused: 'invalid_job' };
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) return { refused: 'invalid_job' };
  if (size > PRINT_JOB_MAX_BYTES) return { refused: 'job_too_large' };
  if (paperName == null) return { paper: null, copies, size, mediaType, quality };
  if (typeof paperName !== 'string') return { refused: 'invalid_job' };
  const paper = papers.find((one) => one.name === paperName);
  return paper ? { paper, copies, size, mediaType, quality } : { refused: 'invalid_job' };
}

/** `%PDF-`: what every PDF starts with. */
const PDF_START = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * Whether a file's first bytes are a PDF's.
 *
 * ⚠ CHECKED BEFORE ANYTHING IS PASSED ON. The computer hands what it fetches
 * to a program that opens it; "whatever a browser sent" is not that. This is
 * not a virus scan — a PDF can still be hostile — only the refusal of
 * everything that is plainly something else.
 */
export function startsLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= PDF_START.length && PDF_START.every((byte, index) => bytes[index] === byte);
}

/** A job that will not change again. */
export function isJobEnded(status: PrintJobStatus): boolean {
  return status === 'printed' || status === 'failed';
}

/** What the computer said went wrong, made safe to show: one line, cut. Null when it said nothing. */
export const PRINT_JOB_MESSAGE_MAX = 300;

export function cleanJobMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = [...cleanLine(value)].slice(0, PRINT_JOB_MESSAGE_MAX).join('');
  return text.length > 0 ? text : null;
}

/** The sentence for each way a job ends badly. One place, so the web app and a log say the same thing. */
export function jobFailureText(failure: PrintJobFailure): string {
  switch (failure) {
    case 'agent_did_not_fetch':
      return 'The computer did not pick the job up. Check that the print agent is running there.';
    case 'nothing_sent':
      return 'The file never arrived from this browser.';
    case 'not_a_pdf':
      return 'That file is not a PDF.';
    case 'wrong_size':
      return 'The file changed size on the way. Try again.';
    case 'interrupted':
      return 'The connection dropped while the file was on its way. Try again.';
    case 'printer_refused':
      return 'The computer could not print it.';
    case 'timed_out':
      return 'The computer took the file and has not said how the printing went. Look at the printer.';
  }
}
