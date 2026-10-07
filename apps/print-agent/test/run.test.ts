import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrintAgentJob, PrintReportedPrinter } from '@kwtech/module-print';
import type { PrinterDriver, PrintRequest } from '../src/printers/driver.js';
import { createFakeDriver, FAKE_PRINTERS } from '../src/printers/fake.js';
import { nextReconnectDelay, RECONNECT_MAX_SECONDS, runAgent, sameReport } from '../src/run.js';
import { type AgentSession, fetchJobFile, type openSession, type SessionEnd } from '../src/server-api.js';
import { clearState, readState, stateMatchesServer, statePath, writeState } from '../src/state.js';

const SECRET = 'S'.repeat(43);

/** A stand-in for the socket: the test decides when it opens, what a heartbeat says, and when it ends. */
function fakeServer(script: { heartbeat?: () => boolean | Promise<boolean>; jobs?: PrintAgentJob[] } = {}) {
  const reports: PrintReportedPrinter[][] = [];
  const results: Array<{ jobId: string; printed: boolean; message: string | null }> = [];
  const sessions: Array<{ end: (reason: SessionEnd) => void; closed: boolean }> = [];
  const open: typeof openSession = (_url, _secret, handlers) => {
    const entry = { end: handlers.onEnd, closed: false };
    sessions.push(entry);
    const session: AgentSession = {
      async heartbeat() {
        return script.heartbeat?.() ?? true;
      },
      async reportPrinters(printers) {
        reports.push([...printers]);
      },
      watchJobs(onJob) {
        for (const job of script.jobs ?? []) onJob(job);
      },
      async reportJob(jobId, printed, message) {
        results.push({ jobId, printed, message });
      },
      close() {
        entry.closed = true;
      },
    };
    setTimeout(() => handlers.onOpen(session), 0);
    return session;
  };
  return { open, reports, sessions, results };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the wait before reconnecting', () => {
  it('doubles from two seconds to a ceiling of a minute', () => {
    const waits: number[] = [];
    let delay: number | null = null;
    for (let i = 0; i < 8; i += 1) {
      delay = nextReconnectDelay(delay);
      waits.push(delay);
    }
    expect(waits).toEqual([2, 4, 8, 16, 32, RECONNECT_MAX_SECONDS, RECONNECT_MAX_SECONDS, RECONNECT_MAX_SECONDS]);
  });
});

describe('a report', () => {
  it('is the same only when nothing in it changed', () => {
    const printers = [...FAKE_PRINTERS];
    expect(sameReport(null, printers)).toBe(false);
    expect(sameReport(printers, [...FAKE_PRINTERS])).toBe(true);
    expect(sameReport(printers, [{ ...printers[0], status: 'offline' } as PrintReportedPrinter])).toBe(false);
  });
});

describe('the agent', () => {
  it('reports its printers once connected, and stops when told', async () => {
    const server = fakeServer();
    const stop = new AbortController();
    const log: string[] = [];
    const running = runAgent({
      wsUrl: 'ws://x',
      apiUrl: 'http://x',
      secret: SECRET,
      driver: createFakeDriver(),
      log: (line) => log.push(line),
      signal: stop.signal,
      open: server.open,
      secondsToMs: 1,
    });
    await tick();
    expect(server.reports).toHaveLength(1);
    expect(server.reports[0]?.map((printer) => printer.name)).toEqual(FAKE_PRINTERS.map((printer) => printer.name));

    stop.abort();
    expect(await running).toBe('stopped');
    expect(server.sessions[0]?.closed).toBe(true);
    expect(log.join('\n')).toContain('Reported 2 printer(s)');
  });

  it('⚠ stops for good when the server refuses its secret, without trying again', async () => {
    const server = fakeServer();
    const stop = new AbortController();
    const running = runAgent({
      wsUrl: 'ws://x',
      apiUrl: 'http://x',
      secret: SECRET,
      driver: createFakeDriver(),
      log: () => {},
      signal: stop.signal,
      open: server.open,
      secondsToMs: 1,
    });
    await tick(5);
    server.sessions[0]?.end('refused');
    expect(await running).toBe('revoked');
    expect(server.sessions).toHaveLength(1);
  });

  it('⚠ stops for good when a heartbeat is answered “no longer paired”', async () => {
    const server = fakeServer({ heartbeat: () => false });
    const running = runAgent({
      wsUrl: 'ws://x',
      apiUrl: 'http://x',
      secret: SECRET,
      driver: createFakeDriver(),
      log: () => {},
      signal: new AbortController().signal,
      open: server.open,
      // A heartbeat every 30 ms.
      secondsToMs: 1,
    });
    expect(await running).toBe('revoked');
    expect(server.sessions).toHaveLength(1);
  });

  it('connects again after a lost connection, and reports again', async () => {
    const server = fakeServer();
    const stop = new AbortController();
    const running = runAgent({
      wsUrl: 'ws://x',
      apiUrl: 'http://x',
      secret: SECRET,
      driver: createFakeDriver(),
      log: () => {},
      signal: stop.signal,
      open: server.open,
      secondsToMs: 1,
    });
    await tick(5);
    server.sessions[0]?.end('lost');
    await tick(30);
    expect(server.sessions.length).toBeGreaterThanOrEqual(2);
    expect(server.reports.length).toBeGreaterThanOrEqual(2);
    stop.abort();
    expect(await running).toBe('stopped');
  });

  it('⚠ connects again when a heartbeat is never answered: the socket died without closing', async () => {
    const server = fakeServer({ heartbeat: () => new Promise<boolean>(() => {}) });
    const stop = new AbortController();
    const log: string[] = [];
    const running = runAgent({
      wsUrl: 'ws://x',
      apiUrl: 'http://x',
      secret: SECRET,
      driver: createFakeDriver(),
      log: (line) => log.push(line),
      signal: stop.signal,
      open: server.open,
      // A heartbeat every 30 ms, given 30 ms to be answered.
      secondsToMs: 1,
    });
    await tick(120);
    expect(log.join('\n')).toContain('The server stopped answering.');
    expect(server.sessions[0]?.closed).toBe(true);
    expect(server.sessions.length).toBeGreaterThanOrEqual(2);
    stop.abort();
    expect(await running).toBe('stopped');
  });

  it('keeps the connection when the printers cannot be read, and says why', async () => {
    const server = fakeServer();
    const stop = new AbortController();
    const log: string[] = [];
    const broken: PrinterDriver = {
      async list() {
        throw new Error('the spooler is stopped');
      },
      async print() {},
    };
    const running = runAgent({
      wsUrl: 'ws://x',
      apiUrl: 'http://x',
      secret: SECRET,
      driver: broken,
      log: (line) => log.push(line),
      signal: stop.signal,
      open: server.open,
      secondsToMs: 1,
    });
    await tick();
    expect(server.reports).toHaveLength(0);
    expect(server.sessions).toHaveLength(1);
    expect(log.join('\n')).toContain('the spooler is stopped');
    stop.abort();
    await running;
  });
});

describe('a job', () => {
  const temp = mkdtempSync(join(tmpdir(), 'print-agent-jobs-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));
  const PDF = Buffer.from('%PDF-1.4 a page');
  const job = (jobId: string): PrintAgentJob => ({
    jobId,
    printerName: FAKE_PRINTERS[0]?.name ?? '',
    paper: null,
    copies: 1,
    size: PDF.length,
    mediaType: null,
    quality: null,
  });

  /** Runs the agent over these jobs with a driver that records what it was handed, then stops it. */
  async function run(
    jobs: PrintAgentJob[],
    print: (request: PrintRequest, bytes: Buffer) => void = () => {},
    fetchJob: typeof fetchJobFile = async (_api, _secret, _job, destination) => {
      writeFileSync(destination, PDF);
      return 'fetched';
    },
  ) {
    const server = fakeServer({ jobs });
    const stop = new AbortController();
    const log: string[] = [];
    const printed: Array<PrintRequest & { bytes: Buffer }> = [];
    const driver: PrinterDriver = {
      ...createFakeDriver(),
      async print(request) {
        // Read while it is still there: the file is gone the moment this returns.
        const bytes = readFileSync(request.file);
        printed.push({ ...request, bytes });
        print(request, bytes);
      },
    };
    const running = runAgent({
      wsUrl: 'ws://x',
      apiUrl: 'http://x',
      secret: SECRET,
      driver,
      log: (line) => log.push(line),
      signal: stop.signal,
      open: server.open,
      fetchJob,
      tempDir: temp,
      secondsToMs: 1,
    });
    await tick(60);
    stop.abort();
    await running;
    return { server, printed, log };
  }

  it('is fetched, handed to the printer, and reported as sent', async () => {
    const { server, printed, log } = await run([job('job-1')]);
    expect(printed).toHaveLength(1);
    expect(printed[0]?.bytes.equals(PDF)).toBe(true);
    expect(printed[0]).toMatchObject({ printerName: FAKE_PRINTERS[0]?.name, paper: null, copies: 1 });
    expect(server.results).toEqual([{ jobId: 'job-1', printed: true, message: null }]);
    expect(log.join('\n')).toContain('Sent a job to');
  });

  it('⚠ leaves nothing on the disk afterwards — printed, refused by the printer, or never fetched', async () => {
    const files: string[] = [];
    await run([job('job-1'), job('job-2')], (request) => {
      files.push(request.file);
      // The second job is refused by the printer; its file must go too.
      if (files.length === 2) throw new Error('out of paper');
    });
    expect(files).toHaveLength(2);
    expect(files.filter((file) => existsSync(file))).toEqual([]);
    expect(readdirSync(temp)).toEqual([]);

    await run([job('job-3')], undefined, async () => {
      throw new Error('socket hang up');
    });
    expect(readdirSync(temp)).toEqual([]);
  });

  it('says what the printer said when it refuses, and goes on to the next job', async () => {
    let first = true;
    const { server, log } = await run([job('job-1'), job('job-2')], () => {
      if (first) {
        first = false;
        throw new Error('The printer is out of paper');
      }
    });
    expect(server.results).toEqual([
      { jobId: 'job-1', printed: false, message: 'The printer is out of paper' },
      { jobId: 'job-2', printed: true, message: null },
    ]);
    expect(log.join('\n')).toContain('Could not print a job');
  });

  it('⚠ says nothing about a job another socket of this computer already took', async () => {
    const { server, printed } = await run([job('job-1')], undefined, async () => 'taken');
    expect(printed).toHaveLength(0);
    expect(server.results).toEqual([]);
  });

  it('prints them one at a time, in the order they came', async () => {
    const order: string[] = [];
    const { server } = await run([job('job-1'), job('job-2'), job('job-3')], undefined, async (_a, _s, one, file) => {
      order.push(`fetch:${one.jobId}`);
      await tick(5);
      writeFileSync(file, PDF);
      order.push(`fetched:${one.jobId}`);
      return 'fetched';
    });
    expect(order).toEqual([
      'fetch:job-1',
      'fetched:job-1',
      'fetch:job-2',
      'fetched:job-2',
      'fetch:job-3',
      'fetched:job-3',
    ]);
    expect(server.results.map((result) => result.jobId)).toEqual(['job-1', 'job-2', 'job-3']);
  });
});

describe('fetching a job’s file', () => {
  const temp = mkdtempSync(join(tmpdir(), 'print-agent-fetch-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));
  const PDF = Buffer.from('%PDF-1.4 a page');
  const answering = (response: Response) => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const request = (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return response;
    }) as unknown as typeof fetch;
    return { request, calls };
  };

  it('asks the one path with the secret in its own header, and writes what arrives', async () => {
    const { request, calls } = answering(new Response(PDF));
    const file = join(temp, 'a.pdf');
    expect(await fetchJobFile('http://x/api/v1', SECRET, { jobId: 'job-1', size: PDF.length }, file, request)).toBe(
      'fetched',
    );
    expect(readFileSync(file).equals(PDF)).toBe(true);
    expect(calls).toEqual([
      { url: 'http://x/api/v1/print/jobs/job-1/content', headers: { 'x-print-agent-secret': SECRET } },
    ]);
  });

  it('⚠ reads “not there” as taken, not as a failure', async () => {
    const { request } = answering(new Response('{}', { status: 404 }));
    expect(await fetchJobFile('http://x', SECRET, { jobId: 'job-1', size: 1 }, join(temp, 'b.pdf'), request)).toBe(
      'taken',
    );
  });

  it('⚠ refuses a file that arrived shorter than the job said', async () => {
    const { request } = answering(new Response(PDF.subarray(0, 5)));
    await expect(
      fetchJobFile('http://x', SECRET, { jobId: 'job-1', size: PDF.length }, join(temp, 'c.pdf'), request),
    ).rejects.toThrow(/arrived as 5 bytes/);
  });

  it('throws for a server that answers anything else', async () => {
    const { request } = answering(new Response('boom', { status: 500 }));
    await expect(
      fetchJobFile('http://x', SECRET, { jobId: 'job-1', size: 1 }, join(temp, 'd.pdf'), request),
    ).rejects.toThrow(/answered 500/);
  });
});

describe('the saved pairing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'print-agent-test-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  const state = {
    version: 1 as const,
    apiUrl: 'http://localhost:8080/api/v1',
    agentId: 'agent-1',
    name: 'Front desk PC',
    secret: SECRET,
    pairedAt: '2026-10-07T05:00:00.000Z',
  };

  it('round-trips, in a file only its owner can read', () => {
    expect(readState(directory)).toBeNull();
    writeState(directory, state);
    expect(readState(directory)).toEqual(state);
    if (process.platform !== 'win32') expect(statSync(statePath(directory)).mode & 0o777).toBe(0o600);
  });

  it('⚠ is used only with the server it was issued by', () => {
    expect(stateMatchesServer(state, 'http://localhost:8080/api/v1')).toBe(true);
    expect(stateMatchesServer(state, 'https://somewhere.else/api/v1')).toBe(false);
  });

  it('reads a damaged file as “not paired”, and forgets on request', () => {
    writeFileSync(statePath(directory), '{ "version": 1, "secret": "short" }');
    expect(readState(directory)).toBeNull();
    writeFileSync(statePath(directory), 'not json');
    expect(readState(directory)).toBeNull();
    writeState(directory, state);
    clearState(directory);
    expect(readState(directory)).toBeNull();
  });
});
