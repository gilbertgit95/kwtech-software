import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { composeApps, composeNav, composeRoutes } from '@kwtech/module-kit';
import { PRINT_FEATURE, PRINT_LIMIT } from '../src/feature-keys.js';
import { printWebModule } from '../src/react/module.js';
import type { PrintAgentView, PrintClient, PrintJobView } from '../src/react/print-client.js';
import { printThroughAgent } from '../src/react/print-flow.js';
import { createPrintTarget } from '../src/react/print-target.js';
import {
  agentServerSettings,
  agentSettingsFile,
  agentStatusText,
  cannotPrintReason,
  defaultRulerPaper,
  fleetSummary,
  fleetSummaryText,
  jobStatusText,
  millimetres,
  newlyPaired,
  pairCommand,
  paperMarginsText,
  paperOptionText,
  paperSizeText,
  printerStatusText,
  splitPrinters,
} from '../src/react/view.js';

/** What adopting the printing side on the web contributes. */
describe('printWebModule', () => {
  const module = printWebModule();

  it('offers Printers on the Apps page, gated on print:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({ key: 'print', label: 'Printers', feature: PRINT_FEATURE.read }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts of the Apps page', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['print']);
  });

  it('⚠ has no route and nothing in the drawer — a sub-app is reached from the Apps page', () => {
    expect(composeRoutes([module])).toEqual([]);
    expect(composeNav([module], [PRINT_FEATURE.read], { params: {} })).toEqual([]);
  });

  it('carries its keys and its cap, so an app composing descriptors sees them', () => {
    expect(module.features?.map((spec) => spec.key)).toEqual(Object.values(PRINT_FEATURE));
    expect(module.limits?.map((spec) => spec.key)).toEqual(Object.values(PRINT_LIMIT));
  });
});

describe('what the page says', () => {
  it('shows lengths as millimetres', () => {
    expect(millimetres(21000)).toBe('210');
    expect(millimetres(296)).toBe('3');
    expect(millimetres(10160)).toBe('101.6');
    expect(paperSizeText({ width: 21000, height: 29700 })).toBe('210 × 297 mm');
  });

  it('⚠ says “not reported” for margins a driver did not give — never “to the edge”', () => {
    expect(paperMarginsText({ margins: null })).toBe('margins not reported');
    expect(paperMarginsText({ margins: { top: 0, right: 0, bottom: 0, left: 0 } })).toBe('prints to the edge');
    expect(paperMarginsText({ margins: { top: 300, right: 300, bottom: 300, left: 300 } })).toBe(
      '3 mm margin all round',
    );
    expect(paperMarginsText({ margins: { top: 300, right: 300, bottom: 1400, left: 300 } })).toBe(
      'margins 3 / 3 / 14 / 3 mm',
    );
  });

  it('names a printer’s state, and a gone one first', () => {
    expect(printerStatusText({ status: 'ready', gone: false })).toEqual({ label: 'Ready', tone: 'ok' });
    expect(printerStatusText({ status: 'offline', gone: false }).tone).toBe('bad');
    expect(printerStatusText({ status: 'error', gone: false }).tone).toBe('bad');
    expect(printerStatusText({ status: 'whatever', gone: false })).toEqual({ label: 'State unknown', tone: 'muted' });
    expect(printerStatusText({ status: 'ready', gone: true }).label).toBe('No longer on that computer');
  });

  it('tells a computer that never connected from one that went away', () => {
    expect(agentStatusText({ online: true, lastSeenAt: 'x' }, 'Oct 7, 1:00 PM')).toBe('Online');
    expect(agentStatusText({ online: false, lastSeenAt: null }, null)).toBe('Paired — has not connected yet');
    expect(agentStatusText({ online: false, lastSeenAt: 'x' }, 'Oct 7, 1:00 PM')).toBe(
      'Offline — last seen Oct 7, 1:00 PM',
    );
  });

  it('⚠ builds the command only from something that is a code', () => {
    expect(pairCommand('ABCDE-FGHJK')).toBe('node print-agent.mjs pair ABCDE-FGHJK');
    expect(pairCommand('ABCDE; rm -rf ~')).toBeNull();
  });
});

/**
 * ⚠ NO CREDENTIAL IS KEPT IN THE BROWSER, TURNED INTO A RED BUILD.
 *
 * A pairing code is shown once and lives in the page's memory until the panel
 * closes. These read the web half's SOURCE, so storing one is a failing test
 * and a conversation rather than a quiet change.
 */
describe('the web half', () => {
  const root = join(__dirname, '..', 'src', 'react');

  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/u.test(name) ? [path] : [];
    });
  }

  /** Code only: a comment may NAME localStorage to say it is not used. */
  const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const files = sources(root);

  it('finds the web half — the walk has to work for this suite to mean anything', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it('⚠ writes nothing to browser storage', () => {
    for (const path of files) {
      expect([path, /localStorage|sessionStorage|indexedDB|caches\.open/u.test(code(path))]).toEqual([path, false]);
    }
  });

  it('reaches the network from the API client alone', () => {
    const callers = files.filter((path) => /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket\(/u.test(code(path)));
    expect(callers.map((path) => path.slice(root.length + 1))).toEqual(['print-client.ts']);
  });

  it('⚠ never imports the server half, and sends none of the computer’s operations', () => {
    for (const path of files) {
      expect([path, /from '\.\.\/(\.\.\/)?server\//u.test(code(path))]).toEqual([path, false]);
    }
    const client = code(join(root, 'print-client.ts'));
    expect(
      /pairPrintAgent|printAgentHeartbeat|reportPrintAgentPrinters|printAgentJobs|reportPrintAgentJob/u.test(client),
    ).toBe(false);
  });
});

describe('printing from the page', () => {
  const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
  const REQUEST = { printerId: 'printer-1', paperName: 'A4', copies: 1 };
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const job = (status: PrintJobView['status'], failure: PrintJobView['failure'] = null): PrintJobView => ({
    id: 'job-1',
    status,
    failure,
    message: null,
  });

  /** A client that answers `job` with each of `states` in turn, then the last one for ever. */
  function client(states: Array<PrintJobView | null>) {
    const calls: string[] = [];
    let at = 0;
    const api: Pick<PrintClient, 'startJob' | 'sendJob' | 'job'> = {
      async startJob(_scope, _request, size) {
        calls.push(`start:${size}`);
        return { jobId: 'job-1', ticket: 't'.repeat(43) };
      },
      async sendJob(start, pdf) {
        calls.push(`send:${start.jobId}:${pdf.byteLength}`);
      },
      async job() {
        calls.push('job');
        const state = states[Math.min(at, states.length - 1)] ?? null;
        at += 1;
        return state;
      },
    };
    return { api, calls };
  }
  const noWait = () => Promise.resolve();

  it('opens the job with the file’s length, sends it, and reads until it ends', async () => {
    const { api, calls } = client([job('sending'), job('printing'), job('printed')]);
    const seen: Array<string | null> = [];
    const ended = await printThroughAgent(
      api,
      SCOPE,
      REQUEST,
      PDF,
      (state) => seen.push(state?.status ?? null),
      noWait,
    );
    expect(ended).toMatchObject({ status: 'printed' });
    expect(calls.slice(0, 2)).toEqual(['start:5', 'send:job-1:5']);
    expect(seen).toEqual(['waiting', 'sending', 'printing', 'printed']);
  });

  it('stops at a failure, and at a job the server has forgotten', async () => {
    const failed = client([job('failed', 'agent_did_not_fetch')]);
    expect(await printThroughAgent(failed.api, SCOPE, REQUEST, PDF, undefined, noWait)).toMatchObject({
      failure: 'agent_did_not_fetch',
    });
    const forgotten = client([null]);
    expect(await printThroughAgent(forgotten.api, SCOPE, REQUEST, PDF, undefined, noWait)).toBeNull();
  });

  it('⚠ stops asking after the longest a job can take, rather than for ever', async () => {
    const { api, calls } = client([job('printing')]);
    const ended = await printThroughAgent(api, SCOPE, REQUEST, PDF, undefined, noWait);
    expect(ended).toMatchObject({ status: 'printing' });
    expect(calls.filter((call) => call === 'job').length).toBeLessThan(300);
  });

  it('⚠ says “sent to the printer”, never “printed”: the spooler took it, and that is all anybody knows', () => {
    expect(jobStatusText(job('printed'))).toEqual({ label: 'Sent to the printer.', tone: 'ok', ended: true });
    expect(jobStatusText(job('waiting')).ended).toBe(false);
    expect(jobStatusText(job('failed', 'not_a_pdf'))).toMatchObject({ tone: 'bad', ended: true });
    expect(jobStatusText({ status: 'failed', failure: 'printer_refused', message: 'Out of paper' }).label).toContain(
      'It said: Out of paper',
    );
    expect(jobStatusText(null)).toMatchObject({ tone: 'muted', ended: true });
  });

  it('⚠ blocks printing only on what is certain: a computer that is offline, a printer that is gone', () => {
    expect(cannotPrintReason({ online: true }, { gone: false })).toBeNull();
    expect(cannotPrintReason({ online: false }, { gone: false })).toContain('offline');
    expect(cannotPrintReason({ online: true }, { gone: true })).toContain('no longer');
  });

  it('offers the ruler page on A4 first, else the printer’s first paper', () => {
    const a4 = { name: 'A4 210 x 297 mm', width: 21000, height: 29700, margins: null };
    const photo = { name: '4R', width: 10160, height: 15240, margins: null };
    expect(defaultRulerPaper([photo, a4])).toBe(a4);
    expect(defaultRulerPaper([photo])).toBe(photo);
    expect(defaultRulerPaper([])).toBeNull();
  });
});

describe('printing for another module', () => {
  const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const A4 = { name: 'A4', width: 21000, height: 29700, margins: null };
  const NONE = { mediaTypes: [], mediaType: null, qualities: [], quality: null };
  const SETTINGS = {
    mediaTypes: [
      { id: 'psk:Plain', label: 'Plain paper' },
      { id: 'psk:PhotographicHighGloss', label: 'Epson Premium Glossy' },
    ],
    mediaType: 'psk:Plain',
    qualities: [{ id: 'ns0000:HighQuality', label: 'High' }],
    quality: null,
  };
  const agent = (over: Partial<PrintAgentView> = {}): PrintAgentView => ({
    id: 'agent-1',
    name: 'Front desk PC',
    hostName: null,
    agentVersion: null,
    online: true,
    lastSeenAt: null,
    pairedAt: '2026-10-07T00:00:00.000Z',
    printers: [
      {
        id: 'printer-1',
        name: 'L5290',
        driver: 'Epson',
        isDefault: true,
        status: 'ready',
        gone: false,
        papers: [A4],
        ...SETTINGS,
      },
      {
        id: 'printer-2',
        name: 'Old one',
        driver: 'Epson',
        isDefault: false,
        status: 'ready',
        gone: true,
        papers: [A4],
        ...NONE,
      },
    ],
    ...over,
  });

  /** A client whose computers are `agents`, and whose one job ends as `ends`. */
  function target(agents: PrintAgentView[] | Error, ends: PrintJobView | null | Error = null) {
    const started: Array<Record<string, unknown>> = [];
    const client: PrintClient = {
      async agents() {
        if (agents instanceof Error) throw agents;
        return agents;
      },
      async createPairingCode() {
        throw new Error('not used');
      },
      async revokeAgent() {},
      async startJob(_scope, request, size) {
        if (ends instanceof Error) throw ends;
        started.push({ ...request, size });
        return { jobId: 'job-1', ticket: 't'.repeat(43) };
      },
      async sendJob() {},
      async job() {
        return ends instanceof Error ? null : ends;
      },
    };
    return { print: createPrintTarget({ client, wait: () => Promise.resolve() }), started };
  }
  const printed: PrintJobView = { id: 'job-1', status: 'printed', failure: null, message: null };
  const job = { printerId: 'printer-1', pdf: PDF, width: 21000, height: 29700 };

  it('offers the printers that are still there, each with its computer', async () => {
    expect(await target([agent()]).print.printers(SCOPE)).toEqual([
      {
        id: 'printer-1',
        name: 'L5290',
        computer: 'Front desk PC',
        blocked: null,
        settings: [
          { key: 'mediaType', label: 'Paper type', options: SETTINGS.mediaTypes, initial: 'psk:Plain' },
          { key: 'quality', label: 'Quality', options: SETTINGS.qualities, initial: null },
        ],
      },
    ]);
  });

  it('says why a printer on a computer that is off cannot be used', async () => {
    const [printer] = await target([agent({ online: false })]).print.printers(SCOPE);
    expect(printer?.blocked).toMatch(/offline/u);
  });

  it('⚠ offers none to somebody the API refuses, rather than failing the caller’s screen', async () => {
    expect(await target(new Error('You do not have access')).print.printers(SCOPE)).toEqual([]);
  });

  it('prints on the paper of the page’s size, one copy, and says it was sent', async () => {
    const { print, started } = target([agent()], printed);
    const heard: string[] = [];
    expect(await print.print(SCOPE, job, (text) => heard.push(text))).toEqual({
      sent: true,
      message: 'Sent to the printer.',
    });
    expect(started).toEqual([
      { printerId: 'printer-1', paperName: 'A4', copies: 1, mediaType: null, quality: null, size: PDF.byteLength },
    ]);
    expect(heard.length).toBeGreaterThan(0);
  });

  it('passes on the paper type and quality a person chose, by the keys it offered them under', async () => {
    const { print, started } = target([agent()], printed);
    await print.print(SCOPE, {
      ...job,
      settings: { mediaType: 'psk:PhotographicHighGloss', quality: 'ns0000:HighQuality' },
    });
    expect(started[0]).toMatchObject({ mediaType: 'psk:PhotographicHighGloss', quality: 'ns0000:HighQuality' });
  });

  it('offers no settings for a printer whose driver named none', async () => {
    const bare = agent();
    bare.printers = bare.printers.map((printer) => ({ ...printer, ...NONE, gone: false }));
    const offered = await target([bare]).print.printers(SCOPE);
    expect(offered.map((printer) => printer.settings)).toEqual([[], []]);
  });

  it('⚠ opens no job for a page the printer has no paper for, and says which size', async () => {
    const { print, started } = target([agent()], printed);
    const outcome = await print.print(SCOPE, { ...job, width: 10200, height: 15200 });
    expect(outcome.sent).toBe(false);
    expect(outcome.message).toMatch(/no paper of 102 × 152 mm/u);
    expect(started).toEqual([]);
  });

  it('opens no job for a computer that is off or a printer that is gone', async () => {
    const off = target([agent({ online: false })], printed);
    expect((await off.print.print(SCOPE, job)).sent).toBe(false);
    const gone = target([agent()], printed);
    expect(await gone.print.print(SCOPE, { ...job, printerId: 'printer-2' })).toMatchObject({ sent: false });
    expect(await gone.print.print(SCOPE, { ...job, printerId: 'nowhere' })).toMatchObject({ sent: false });
    expect([...off.started, ...gone.started]).toEqual([]);
  });

  it('⚠ never throws: a refusal, a failed job and a forgotten one are each an outcome with a sentence', async () => {
    const refused = await target([agent()], new Error('That computer is busy')).print.print(SCOPE, job);
    expect(refused).toEqual({ sent: false, message: 'That computer is busy' });
    const failed = await target([agent()], {
      id: 'job-1',
      status: 'failed',
      failure: 'printer_refused',
      message: 'Out of paper',
    }).print.print(SCOPE, job);
    expect(failed.sent).toBe(false);
    expect(failed.message).toMatch(/Out of paper/u);
    const forgotten = await target([agent()], null).print.print(SCOPE, job);
    expect(forgotten.sent).toBe(false);
  });
});

describe('the page at a glance', () => {
  const printer = (gone = false) => ({ gone });
  const agent = (online: boolean, printers: { gone: boolean }[] = []) => ({ online, printers });

  it('counts the computers that can be reached and the printers that can be printed on now', () => {
    const summary = fleetSummary([
      agent(true, [printer(), printer(), printer(true)]),
      agent(false, [printer(), printer()]),
    ] as never);
    expect(summary).toEqual({ computers: 2, online: 1, printers: 2 });
    expect(fleetSummaryText(summary)).toBe('1 of 2 computers online · 2 printers ready');
  });

  it('says it plainly for one computer, on and off, and for none', () => {
    expect(fleetSummaryText({ computers: 1, online: 1, printers: 1 })).toBe('1 computer online · 1 printer ready');
    expect(fleetSummaryText({ computers: 1, online: 0, printers: 0 })).toBe('1 computer, offline');
    expect(fleetSummaryText({ computers: 0, online: 0, printers: 0 })).toBe('No computer is paired yet.');
  });

  it('⚠ never counts an offline computer’s printers as ready', () => {
    expect(fleetSummary([agent(false, [printer(), printer()])] as never).printers).toBe(0);
    expect(fleetSummaryText({ computers: 2, online: 0, printers: 0 })).toBe('0 of 2 computers online');
  });

  it('folds away the printers a computer no longer has', () => {
    const { present, gone } = splitPrinters([printer(), printer(true), printer()]);
    expect([present.length, gone.length]).toEqual([2, 1]);
  });
});

describe('pairing, watched from the page', () => {
  it('is the computer that was not there when the code was made, by id', () => {
    const known = new Set(['a1']);
    expect(newlyPaired(known, [{ id: 'a1' }])).toBeNull();
    expect(newlyPaired(known, [{ id: 'a1' }, { id: 'a2' }])).toEqual({ id: 'a2' });
  });

  it('⚠ is not fooled by a computer that was already there under the same name', () => {
    const known = new Set(['a1']);
    expect(newlyPaired(known, [{ id: 'a1', name: 'Front desk PC' }])).toBeNull();
  });
});

describe('a paper in a list to choose from', () => {
  it('adds the size to a name that does not say it, and not to one that does', () => {
    expect(paperOptionText({ name: 'A4', width: 21000, height: 29700 })).toBe('A4 · 210 × 297 mm');
    expect(paperOptionText({ name: 'A4 210 x 297 mm', width: 21000, height: 29700 })).toBe('A4 210 x 297 mm');
    expect(paperOptionText({ name: '10 x 15 cm (4 x 6 in)', width: 10160, height: 15240 })).toBe(
      '10 x 15 cm (4 x 6 in)',
    );
  });
});

describe('where the agent finds the server', () => {
  it('works the API’s address out from the socket’s: the same host and port, the scheme turned', () => {
    expect(agentServerSettings('wss://app.example.com/api/v1/graphql')).toEqual({
      apiUrl: 'https://app.example.com/api/v1',
      wsUrl: 'wss://app.example.com/api/v1/graphql',
    });
    expect(agentServerSettings('ws://localhost:8080/api/v1/graphql')).toEqual({
      apiUrl: 'http://localhost:8080/api/v1',
      wsUrl: 'ws://localhost:8080/api/v1/graphql',
    });
  });

  it('⚠ never guesses: nothing, or anything that is not a socket address ending /graphql, is no answer', () => {
    for (const value of [
      undefined,
      null,
      '',
      'nonsense',
      'https://app.example.com/api/v1/graphql',
      'wss://app.example.com/',
      'wss://app.example.com/graphql?x=1',
    ]) {
      expect([value, agentServerSettings(value)]).toEqual([value, null]);
    }
  });

  it('writes the settings file to paste, and leaves the two lines blank when the addresses are not known', () => {
    expect(agentSettingsFile({ apiUrl: 'https://a/api/v1', wsUrl: 'wss://a/api/v1/graphql' })).toBe(
      'API_URL="https://a/api/v1"\nWS_URL="wss://a/api/v1/graphql"',
    );
    expect(agentSettingsFile(null)).toBe('API_URL=""\nWS_URL=""');
  });
});
