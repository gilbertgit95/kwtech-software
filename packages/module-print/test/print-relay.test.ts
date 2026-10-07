import { PassThrough, Writable } from 'node:stream';
import { PRINT_JOBS_PER_AGENT_MAX } from '../src/domain/jobs.js';
import { PRINT_AGENT_SECRET_PARAM } from '../src/domain/pairing.js';
import { PrintAgentService } from '../src/server/print-agent.service.js';
import { PrintJobService } from '../src/server/print-job.service.js';
import { PrintRelayService } from '../src/server/print-relay.service.js';
import { PrintWriteService } from '../src/server/print-write.service.js';
import { type FakeClient, fakeClient } from './fake-client.js';

const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
const OTHER = { organizationId: 'org-1', workspaceId: 'ws-2' };
const ANA = 'user-ana';
const BEN = 'user-ben';
const A4 = { name: 'A4', width: 21000, height: 29700, margins: null };
const PDF = Buffer.from(`%PDF-1.4\n${'x'.repeat(5000)}\n%%EOF\n`);

/** Somewhere to write a fetched file, recording what arrived and whether `begin` ran. */
function sink() {
  const chunks: Buffer[] = [];
  const state = { began: null as number | null, chunks };
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  return { stream, state, begin: (size: number) => (state.began = size), bytes: () => Buffer.concat(chunks) };
}

/** A sender that delivers `data` in small pieces. */
function source(data: Buffer, piece = 700): PassThrough {
  const stream = new PassThrough();
  for (let at = 0; at < data.length; at += piece) stream.write(data.subarray(at, at + piece));
  stream.end();
  return stream;
}

async function harness() {
  const prisma: FakeClient = fakeClient();
  const relay = new PrintRelayService();
  // One "second" is a millisecond: the 30 s wait for both ends is 30 ms.
  relay.secondsToMs = 1;
  const writes = new PrintWriteService(prisma);
  const agents = new PrintAgentService(prisma, writes, relay);
  const jobs = new PrintJobService(prisma, relay);

  const { code } = await writes.createPairingCode(SCOPE, ANA, 'Front desk PC');
  const paired = await agents.pair(code, 'DESKTOP-1', '0.0.0');
  if (!paired) throw new Error('the harness could not pair');
  const admission = await agents.admit({ [PRINT_AGENT_SECRET_PARAM]: paired.secret });
  if (!admission) throw new Error('the harness could not connect');
  await agents.reportPrinters(admission, [
    { name: 'EPSON L5290', driver: 'EPSON', isDefault: true, status: 'ready', papers: [A4] },
  ]);
  const printer = prisma.printers[0];
  if (!printer) throw new Error('the harness has no printer');
  const start = (size = PDF.length, actor = ANA) =>
    jobs.start(SCOPE, actor, { printerId: printer.id, paperName: 'A4', copies: 1, size });
  return { prisma, relay, agents, jobs, admission, secret: paired.secret, printer, start };
}

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

describe('opening a job', () => {
  it('answers with a ticket, and tells the computer what to print — not the ticket', async () => {
    const h = await harness();
    const watching = await h.agents.jobs(h.admission);
    const opened = await h.start();
    expect(opened.ticket).toHaveLength(43);
    const told = (await watching.next()).value;
    expect(told).toEqual({
      jobId: opened.jobId,
      printerName: 'EPSON L5290',
      paper: A4,
      copies: 1,
      size: PDF.length,
      mediaType: null,
      quality: null,
    });
    expect(JSON.stringify(told)).not.toContain(opened.ticket);
    expect(h.jobs.status(SCOPE, ANA, opened.jobId)).toMatchObject({ status: 'waiting', failure: null });
    await watching.return?.();
  });

  it('⚠ is refused, never queued, when the computer is offline', async () => {
    const h = await harness();
    const agent = h.prisma.agents[0];
    if (agent) agent.lastSeenAt = new Date(Date.now() - 10 * 60_000);
    await expect(h.start()).rejects.toMatchObject({ reason: 'agent_offline' });
  });

  it('⚠ reads a printer in another workspace as not found, and a revoked computer’s too', async () => {
    const h = await harness();
    await expect(
      h.jobs.start(OTHER, ANA, { printerId: h.printer.id, paperName: null, copies: 1, size: 10 }),
    ).rejects.toMatchObject({ reason: 'not_found' });
    const agent = h.prisma.agents[0];
    if (agent) agent.revokedAt = new Date();
    await expect(h.start()).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('refuses a printer the computer no longer has', async () => {
    const h = await harness();
    h.printer.goneAt = new Date();
    await expect(h.start()).rejects.toMatchObject({ reason: 'printer_gone' });
  });

  it('⚠ refuses a fourth job while three are under way for one computer', async () => {
    const h = await harness();
    for (let index = 0; index < PRINT_JOBS_PER_AGENT_MAX; index += 1) await h.start();
    await expect(h.start()).rejects.toMatchObject({ reason: 'agent_busy' });
  });

  it('tells a computer that connects late about the jobs already waiting', async () => {
    const h = await harness();
    const opened = await h.start();
    const watching = await h.agents.jobs(h.admission);
    expect((await watching.next()).value).toMatchObject({ jobId: opened.jobId });
    await watching.return?.();
  });

  it('⚠ lets a watcher go when its socket closes, even while it is waiting for a job', async () => {
    const h = await harness();
    const watching = await h.agents.jobs(h.admission);
    const pending = watching.next();
    await watching.return?.();
    expect(await pending).toEqual({ done: true, value: undefined });
    // Nothing is left listening: a job opened now is told to nobody and does not throw.
    await h.start();
  });
});

describe('the transfer', () => {
  it('passes the file from the browser to the computer, byte for byte, whichever arrives first', async () => {
    for (const fetchFirst of [true, false]) {
      const h = await harness();
      const opened = await h.start();
      const out = sink();
      const fetching = () => h.relay.fetch(opened.jobId, h.admission.agentId, out.stream, out.begin);
      const sending = () => h.relay.send(opened.jobId, opened.ticket, source(PDF));
      const [first, second] = fetchFirst ? [fetching(), sending()] : [sending(), fetching()];
      const results = await Promise.all([first, second]);
      const [delivered, job] = fetchFirst ? results : [results[1], results[0]];

      expect(delivered).toBe(true);
      expect(job).toMatchObject({ status: 'printing', failure: null });
      expect(out.state.began).toBe(PDF.length);
      expect(out.bytes().equals(PDF)).toBe(true);
    }
  });

  it('⚠ spends the ticket on its first use, and one message covers wrong, spent and unknown', async () => {
    const h = await harness();
    const opened = await h.start();
    const out = sink();
    void h.relay.fetch(opened.jobId, h.admission.agentId, out.stream, out.begin);
    await h.relay.send(opened.jobId, opened.ticket, source(PDF));

    expect(() => h.relay.send(opened.jobId, opened.ticket, source(PDF))).toThrow(
      expect.objectContaining({ reason: 'job_not_found' }),
    );
    const again = await h.start();
    expect(() => h.relay.send(again.jobId, 'b'.repeat(43), source(PDF))).toThrow(
      expect.objectContaining({ reason: 'job_not_found' }),
    );
    expect(() => h.relay.send(again.jobId, undefined, source(PDF))).toThrow(
      expect.objectContaining({ reason: 'job_not_found' }),
    );
    expect(() => h.relay.send('no-such-job', opened.ticket, source(PDF))).toThrow(
      expect.objectContaining({ reason: 'job_not_found' }),
    );
  });

  it('⚠ gives a job only to the computer it is for, and only once', async () => {
    const h = await harness();
    const opened = await h.start();
    const stranger = sink();
    expect(await h.relay.fetch(opened.jobId, 'another-agent', stranger.stream, stranger.begin)).toBe(false);

    const first = sink();
    const fetching = h.relay.fetch(opened.jobId, h.admission.agentId, first.stream, first.begin);
    const second = sink();
    expect(await h.relay.fetch(opened.jobId, h.admission.agentId, second.stream, second.begin)).toBe(false);

    await h.relay.send(opened.jobId, opened.ticket, source(PDF));
    expect(await fetching).toBe(true);
    expect(second.state.began).toBeNull();
    expect(stranger.state.began).toBeNull();
  });

  it('⚠ refuses a file that is not a PDF before the computer is sent a byte', async () => {
    const h = await harness();
    const exe = Buffer.from(`MZ${'\x00'.repeat(4000)}`);
    const opened = await h.start(exe.length);
    const out = sink();
    const fetching = h.relay.fetch(opened.jobId, h.admission.agentId, out.stream, out.begin);
    const job = await h.relay.send(opened.jobId, opened.ticket, source(exe));

    expect(job).toMatchObject({ status: 'failed', failure: 'not_a_pdf' });
    expect(await fetching).toBe(false);
    expect(out.state.began).toBeNull();
    expect(out.bytes()).toHaveLength(0);
  });

  it('⚠ fails a file that is longer or shorter than was declared', async () => {
    for (const declared of [PDF.length - 100, PDF.length + 100]) {
      const h = await harness();
      const opened = await h.start(declared);
      const out = sink();
      const fetching = h.relay.fetch(opened.jobId, h.admission.agentId, out.stream, out.begin);
      const job = await h.relay.send(opened.jobId, opened.ticket, source(PDF));
      expect(job).toMatchObject({ status: 'failed', failure: 'wrong_size' });
      expect(await fetching).toBe(false);
    }
  });

  it('fails as interrupted when the browser’s connection drops mid-file', async () => {
    const h = await harness();
    const opened = await h.start();
    const out = sink();
    const fetching = h.relay.fetch(opened.jobId, h.admission.agentId, out.stream, out.begin);
    const broken = new PassThrough();
    const sending = h.relay.send(opened.jobId, opened.ticket, broken);
    broken.write(PDF.subarray(0, 1000));
    await tick(5);
    broken.destroy(new Error('socket hang up'));

    expect(await sending).toMatchObject({ status: 'failed', failure: 'interrupted' });
    expect(await fetching).toBe(false);
  });

  it('⚠ fails after the wait when the computer never asks, and names it', async () => {
    const h = await harness();
    const opened = await h.start();
    const job = await h.relay.send(opened.jobId, opened.ticket, source(PDF));
    expect(job).toMatchObject({ status: 'failed', failure: 'agent_did_not_fetch' });
  });

  it('fails after the wait when the browser never sends, and names that instead', async () => {
    const h = await harness();
    const opened = await h.start();
    const out = sink();
    expect(await h.relay.fetch(opened.jobId, h.admission.agentId, out.stream, out.begin)).toBe(false);
    expect(h.jobs.status(SCOPE, ANA, opened.jobId)).toMatchObject({ status: 'failed', failure: 'nothing_sent' });
  });
});

describe('how it went', () => {
  async function delivered() {
    const h = await harness();
    const opened = await h.start();
    const out = sink();
    void h.relay.fetch(opened.jobId, h.admission.agentId, out.stream, out.begin);
    await h.relay.send(opened.jobId, opened.ticket, source(PDF));
    return { h, opened };
  }

  it('is “printed” once the computer says so, and only it may say', async () => {
    const { h, opened } = await delivered();
    expect(h.relay.report(opened.jobId, 'another-agent', true, null)).toBe(false);
    expect(await h.agents.reportJob(h.admission, opened.jobId, true, null)).toBe(true);
    expect(h.jobs.status(SCOPE, ANA, opened.jobId)).toMatchObject({ status: 'printed', failure: null });
    // A second report changes nothing.
    expect(await h.agents.reportJob(h.admission, opened.jobId, false, 'late')).toBe(false);
    expect(h.jobs.status(SCOPE, ANA, opened.jobId)).toMatchObject({ status: 'printed' });
  });

  it('carries what the computer said went wrong, cleaned to one line', async () => {
    const { h, opened } = await delivered();
    await h.agents.reportJob(h.admission, opened.jobId, false, 'The printer\nis   offline');
    expect(h.jobs.status(SCOPE, ANA, opened.jobId)).toEqual({
      id: opened.jobId,
      status: 'failed',
      failure: 'printer_refused',
      message: 'The printer is offline',
    });
  });

  it('⚠ reads “timed out” when the computer took the file and never said', async () => {
    const { h, opened } = await delivered();
    await tick(250);
    expect(h.jobs.status(SCOPE, ANA, opened.jobId)).toMatchObject({ status: 'failed', failure: 'timed_out' });
  });

  it('⚠ is shown to the person who printed, and to nobody else', async () => {
    const { h, opened } = await delivered();
    expect(h.jobs.status(SCOPE, BEN, opened.jobId)).toBeNull();
    expect(h.jobs.status(OTHER, ANA, opened.jobId)).toBeNull();
    expect(h.jobs.status(SCOPE, ANA, 'no-such-job')).toBeNull();
  });

  it('⚠ refuses a revoked computer’s report, and its subscription', async () => {
    const { h, opened } = await delivered();
    const agent = h.prisma.agents[0];
    if (agent) agent.revokedAt = new Date();
    await expect(h.agents.reportJob(h.admission, opened.jobId, true, null)).rejects.toMatchObject({
      reason: 'agent_revoked',
    });
    await expect(h.agents.jobs(h.admission)).rejects.toMatchObject({ reason: 'agent_revoked' });
    expect(await h.agents.admitSecret(h.secret)).toBeNull();
  });
});
