import { jobFailureText } from '../domain/jobs.js';
import { PRINT_PAIRING_ALPHABET } from '../domain/pairing.js';
import type { PrintPaper } from '../types.js';
import type { PrintAgentView, PrintJobView, PrintPrinterView } from './print-client.js';

/**
 * What the Printers page SAYS, worked out from what it was given. Pure, so the
 * wording is tested without rendering anything.
 */

/** Hundredths of a millimetre as millimetres, without a trailing `.0`. */
export function millimetres(length: number): string {
  return String(Math.round(length / 10) / 10);
}

/** "210 × 297 mm". */
export function paperSizeText(paper: Pick<PrintPaper, 'width' | 'height'>): string {
  return `${millimetres(paper.width)} × ${millimetres(paper.height)} mm`;
}

/**
 * How far in from the edges a paper prints, in a few words.
 *
 * ⚠ "Not reported" for null, never "borderless": the driver did not say, and
 * a page laid out to the edge on that guess would be clipped.
 */
export function paperMarginsText(paper: Pick<PrintPaper, 'margins'>): string {
  const margins = paper.margins;
  if (!margins) return 'margins not reported';
  const { top, right, bottom, left } = margins;
  if (top === right && right === bottom && bottom === left) {
    return top === 0 ? 'prints to the edge' : `${millimetres(top)} mm margin all round`;
  }
  return `margins ${millimetres(top)} / ${millimetres(right)} / ${millimetres(bottom)} / ${millimetres(left)} mm`;
}

/** What to say about one printer's state, and whether it is a problem. */
export function printerStatusText(printer: Pick<PrintPrinterView, 'status' | 'gone'>): {
  label: string;
  tone: 'ok' | 'muted' | 'bad';
} {
  if (printer.gone) return { label: 'No longer on that computer', tone: 'muted' };
  switch (printer.status) {
    case 'ready':
      return { label: 'Ready', tone: 'ok' };
    case 'offline':
      return { label: 'Offline', tone: 'bad' };
    case 'error':
      return { label: 'Needs attention', tone: 'bad' };
    default:
      return { label: 'State unknown', tone: 'muted' };
  }
}

/** The line under a computer's name. `seenText` is the last-seen time, already formatted in the workspace's zone. */
export function agentStatusText(agent: Pick<PrintAgentView, 'online' | 'lastSeenAt'>, seenText: string | null): string {
  if (agent.online) return 'Online';
  if (!agent.lastSeenAt || !seenText) return 'Paired — has not connected yet';
  return `Offline — last seen ${seenText}`;
}

/**
 * How the agent is run on a shop's computer: the one file it is delivered as,
 * under Node, from its own folder. One spelling for every command the page
 * shows, so the pairing dialog and the setup guide cannot disagree.
 */
export const AGENT_COMMAND = 'node print-agent.mjs';

/** Where the agent finds the server: the two lines of its settings file. */
export interface AgentServerSettings {
  apiUrl: string;
  wsUrl: string;
}

/**
 * The agent's two addresses, worked out from the one the browser already has:
 * the server's socket.
 *
 * The agent needs the API and its socket on ONE host and port (it refuses
 * anything else, because the secret the one issues is sent to the other), so
 * the API's address is the socket's with the scheme turned and `/graphql`
 * taken off. Null for anything that is not a socket address ending that way:
 * ⚠ a guessed address typed into a shop's computer sends its pairing code to
 * whoever is there, so the page shows a blank to fill in rather than a guess.
 */
export function agentServerSettings(wsUrl: string | null | undefined): AgentServerSettings | null {
  if (!wsUrl) return null;
  let url: URL;
  try {
    url = new URL(wsUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
  if (!url.pathname.endsWith('/graphql') || url.search !== '' || url.hash !== '') return null;
  const scheme = url.protocol === 'wss:' ? 'https:' : 'http:';
  return { apiUrl: `${scheme}//${url.host}${url.pathname.slice(0, -'/graphql'.length)}`, wsUrl: url.href };
}

/** The agent's settings file, ready to paste. With no addresses known, the two lines are left to be filled in. */
export function agentSettingsFile(server: AgentServerSettings | null): string {
  return [`API_URL="${server?.apiUrl ?? ''}"`, `WS_URL="${server?.wsUrl ?? ''}"`].join('\n');
}

/**
 * The command to type on the computer being paired.
 *
 * ⚠ The code goes in AS SHOWN, dash and all: the server drops the dash. It is
 * checked against the alphabet first so a string that is not a code can never
 * be pasted into a terminal as part of a command.
 */
export function pairCommand(code: string): string | null {
  const symbols = code.replace(/-/g, '');
  for (const symbol of symbols) {
    if (!PRINT_PAIRING_ALPHABET.includes(symbol)) return null;
  }
  return `${AGENT_COMMAND} pair ${code}`;
}

/**
 * Why a printer cannot be printed on right now, or null when it can.
 *
 * ⚠ ONLY WHAT IS CERTAIN STOPS IT. A printer the spooler calls "offline" or
 * "in error" can still be sent a job — the spooler is often wrong about a
 * wireless printer, and holds the job if it is right — so the status is shown
 * and the button stays. A computer that is offline cannot be reached at all.
 */
export function cannotPrintReason(
  agent: Pick<PrintAgentView, 'online'>,
  printer: Pick<PrintPrinterView, 'gone'>,
): string | null {
  if (printer.gone) return 'This printer is no longer on that computer.';
  if (!agent.online) return 'That computer is offline. Start the print agent on it.';
  return null;
}

/**
 * A paper as one line in a list to choose from: its name, and its size unless
 * the name already says it. Drivers name most papers by their size
 * ("A4 210 x 297 mm"), and reading it twice helps nobody.
 */
export function paperOptionText(paper: Pick<PrintPaper, 'name' | 'width' | 'height'>): string {
  return /\d\s*[x×]\s*\d/iu.test(paper.name) ? paper.name : `${paper.name} · ${paperSizeText(paper)}`;
}

/** The paper a ruler page is offered on first: A4 where the printer has it, else its first. */
export function defaultRulerPaper(papers: readonly PrintPaper[]): PrintPaper | null {
  return papers.find((paper) => paper.width === 21000 && paper.height === 29700) ?? papers[0] ?? null;
}

/**
 * What to say about a job, and whether it is over.
 *
 * ⚠ "Sent to the printer", never "printed": the computer's operating system
 * took the job, which a printer with no paper also allows.
 */
export function jobStatusText(job: Pick<PrintJobView, 'status' | 'failure' | 'message'> | null): {
  label: string;
  tone: 'ok' | 'muted' | 'bad';
  ended: boolean;
} {
  if (!job) return { label: 'The server no longer has this print. Look at the printer.', tone: 'muted', ended: true };
  switch (job.status) {
    case 'waiting':
      return { label: 'Reaching the computer…', tone: 'muted', ended: false };
    case 'sending':
      return { label: 'Sending the file…', tone: 'muted', ended: false };
    case 'printing':
      return { label: 'The computer is handing it to the printer…', tone: 'muted', ended: false };
    case 'printed':
      return { label: 'Sent to the printer.', tone: 'ok', ended: true };
    case 'failed': {
      const why = jobFailureText(job.failure ?? 'interrupted');
      return { label: job.message ? `${why} It said: ${job.message}` : why, tone: 'bad', ended: true };
    }
  }
}

/** The page's one-line summary: how many computers are reachable, and how many printers can be printed on now. */
export interface PrintFleetSummary {
  computers: number;
  online: number;
  /** Printers still on a computer that is online. */
  printers: number;
}

export function fleetSummary(agents: readonly Pick<PrintAgentView, 'online' | 'printers'>[]): PrintFleetSummary {
  const online = agents.filter((agent) => agent.online);
  return {
    computers: agents.length,
    online: online.length,
    printers: online.flatMap((agent) => agent.printers).filter((printer) => !printer.gone).length,
  };
}

/** "2 of 3 computers online · 5 printers ready", in words a person reads at a glance. */
export function fleetSummaryText(summary: PrintFleetSummary): string {
  if (summary.computers === 0) return 'No computer is paired yet.';
  const computers =
    summary.computers === 1
      ? summary.online === 1
        ? '1 computer online'
        : '1 computer, offline'
      : `${summary.online} of ${summary.computers} computers online`;
  if (summary.online === 0) return computers;
  return `${computers} · ${summary.printers} ${summary.printers === 1 ? 'printer' : 'printers'} ready`;
}

/**
 * The computer that was paired while a code was on the screen: the first one
 * that was not there when the code was made. Null while nobody has typed it.
 *
 * By id, not by name: two computers may be given one name, and a code pairs
 * exactly one.
 */
export function newlyPaired<Agent extends Pick<PrintAgentView, 'id'>>(
  knownIds: ReadonlySet<string>,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => !knownIds.has(agent.id)) ?? null;
}

/** A computer's printers as the page shows them: the ones still there, then how many are not. */
export function splitPrinters<Printer extends Pick<PrintPrinterView, 'gone'>>(
  printers: readonly Printer[],
): { present: Printer[]; gone: Printer[] } {
  return { present: printers.filter((printer) => !printer.gone), gone: printers.filter((printer) => printer.gone) };
}

/** The classes of a small status pill, by tone. Theme tokens only: a pale ground and its own readable text. */
export function toneBadgeClass(tone: 'ok' | 'muted' | 'bad'): string {
  switch (tone) {
    case 'ok':
      return 'bg-status-success text-status-success-foreground';
    case 'bad':
      return 'bg-status-error text-status-error-foreground';
    case 'muted':
      return 'bg-muted text-muted-foreground';
  }
}
