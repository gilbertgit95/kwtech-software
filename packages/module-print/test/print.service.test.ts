import { ANONYMOUS_ADMISSION_KEY, type LimitChecker } from '@kwtech/module-kit';
import { PRINT_AGENT_SECRET_PARAM } from '../src/domain/pairing.js';
import { PRINT_LIMIT } from '../src/feature-keys.js';
import { PrintResolver } from '../src/server/graphql/print.resolver.js';
import { PrintAgentResolver } from '../src/server/graphql/print-agent.resolver.js';
import { PRINT_AGENT_REFUSED_MESSAGE, PRINT_NOT_FOUND_MESSAGE } from '../src/server/print.errors.js';
import { PrintService } from '../src/server/print.service.js';
import {
  isPrintAgentHandshake,
  PrintAgentService,
  readPrintAgentAdmission,
} from '../src/server/print-agent.service.js';
import { PrintJobService } from '../src/server/print-job.service.js';
import { PrintRelayService } from '../src/server/print-relay.service.js';
import { hashPrintCredential, PrintWriteService } from '../src/server/print-write.service.js';
import { type FakeClient, fakeClient } from './fake-client.js';

const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
const OTHER = { organizationId: 'org-1', workspaceId: 'ws-2' };
const ANA = 'user-ana';

const A4 = { name: 'A4', width: 21000, height: 29700, margins: null };
const printer = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  driver: 'EPSON',
  isDefault: false,
  status: 'ready',
  papers: [A4],
  ...extra,
});

function harness(limits?: LimitChecker) {
  const prisma: FakeClient = fakeClient();
  const writes = new PrintWriteService(prisma, limits);
  const relay = new PrintRelayService();
  const agents = new PrintAgentService(prisma, writes, relay);
  const print = new PrintService(prisma);
  const jobs = new PrintJobService(prisma, relay);
  const options = { resolveActorId: (request: unknown) => (request as { userId?: string } | undefined)?.userId };
  return {
    prisma,
    writes,
    agents,
    print,
    relay,
    jobs,
    resolver: new PrintResolver(print, writes, jobs, options),
    agentResolver: new PrintAgentResolver(agents),
  };
}

/** Make a code, pair with it, and connect: what a computer has done by the time it reports. */
async function paired(h: ReturnType<typeof harness>, scope = SCOPE, name = 'Front desk PC') {
  const { code } = await h.writes.createPairingCode(scope, ANA, name);
  const answer = await h.agents.pair(code, 'DESKTOP-1', '0.0.0');
  if (!answer) throw new Error('the harness could not pair');
  const admission = await h.agents.admit({ [PRINT_AGENT_SECRET_PARAM]: answer.secret });
  if (!admission) throw new Error('the harness could not connect');
  return { code, ...answer, admission };
}

describe('making a pairing code', () => {
  it('returns the code once and stores only its hash', async () => {
    const h = harness();
    const { code, expiresAt } = await h.writes.createPairingCode(SCOPE, ANA, ' Front desk PC ');
    expect(code).toHaveLength(10);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(h.prisma.codes).toHaveLength(1);
    expect(h.prisma.codes[0]).toMatchObject({ ...SCOPE, name: 'Front desk PC', createdById: ANA, usedAt: null });
    expect(h.prisma.codes[0]?.codeHash).toBe(hashPrintCredential(code));
    expect(JSON.stringify(h.prisma.codes)).not.toContain(code);
  });

  it('refuses a name that is not one', async () => {
    const h = harness();
    await expect(h.writes.createPairingCode(SCOPE, ANA, '  ')).rejects.toMatchObject({ reason: 'invalid_name' });
    expect(h.prisma.codes).toHaveLength(0);
  });

  it('⚠ holds the DECLARED DEFAULT cap when no limit checker is bound — never unlimited', async () => {
    const h = harness();
    await paired(h, SCOPE, 'One');
    await paired(h, SCOPE, 'Two');
    await expect(h.writes.createPairingCode(SCOPE, ANA, 'Three')).rejects.toMatchObject({ reason: 'limit_reached' });
  });

  it('asks the host’s limit checker with the count of computers still paired', async () => {
    const calls: unknown[] = [];
    const h = harness({
      async check(input) {
        calls.push(input);
        return { allowed: input.current < 1, limit: 1, current: input.current, remaining: 0 };
      },
    });
    const first = await paired(h);
    await expect(h.writes.createPairingCode(SCOPE, ANA, 'Two')).rejects.toMatchObject({ reason: 'limit_reached' });
    // A revoked computer no longer counts: a broken one can be replaced.
    await h.writes.revokeAgent(SCOPE, ANA, first.agentId);
    await expect(h.writes.createPairingCode(SCOPE, ANA, 'Two')).resolves.toBeDefined();
    expect(calls.at(-1)).toMatchObject({ key: PRINT_LIMIT.agents, actorId: ANA, current: 0, ...SCOPE });
  });

  it('clears the workspace’s used and expired codes, and nobody else’s', async () => {
    const h = harness();
    await paired(h, SCOPE, 'One');
    const stale = await h.writes.createPairingCode(SCOPE, ANA, 'Stale');
    const staleRow = h.prisma.codes.find((row) => row.codeHash === hashPrintCredential(stale.code));
    if (staleRow) staleRow.expiresAt = new Date(Date.now() - 1000);
    await h.writes.createPairingCode(OTHER, ANA, 'Elsewhere');

    const fresh = await h.writes.createPairingCode(SCOPE, ANA, 'Fresh');
    const here = h.prisma.codes.filter((row) => row.workspaceId === SCOPE.workspaceId);
    expect(here.map((row) => row.codeHash)).toEqual([hashPrintCredential(fresh.code)]);
    expect(h.prisma.codes.filter((row) => row.workspaceId === OTHER.workspaceId)).toHaveLength(1);
  });
});

describe('pairing a computer', () => {
  it('exchanges the code for a secret, stored only as a hash, in the code’s workspace', async () => {
    const h = harness();
    const { code } = await h.writes.createPairingCode(SCOPE, ANA, 'Front desk PC');
    const answer = await h.agents.pair(`${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase(), ' DESKTOP-1 ', '0.0.0');

    expect(answer).toMatchObject({ name: 'Front desk PC' });
    expect(answer?.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.prisma.agents[0]).toMatchObject({
      ...SCOPE,
      name: 'Front desk PC',
      hostName: 'DESKTOP-1',
      pairedById: ANA,
      lastSeenAt: null,
      revokedAt: null,
      secretHash: hashPrintCredential(answer?.secret ?? ''),
    });
    expect(JSON.stringify(h.prisma.agents)).not.toContain(answer?.secret);
  });

  it('⚠ works ONCE: the second computer to type the code gets nothing', async () => {
    const h = harness();
    const { code } = await h.writes.createPairingCode(SCOPE, ANA, 'Front desk PC');
    expect(await h.agents.pair(code, 'A', '0')).not.toBeNull();
    expect(await h.agents.pair(code, 'B', '0')).toBeNull();
    expect(h.prisma.agents).toHaveLength(1);
  });

  it('⚠ answers null for EVERY failure — not a code, wrong, expired, workspace full', async () => {
    const h = harness();
    expect(await h.agents.pair('not a code', 'A', '0')).toBeNull();
    expect(await h.agents.pair('ZZZZZ-ZZZZZ', 'A', '0')).toBeNull();

    const expired = await h.writes.createPairingCode(SCOPE, ANA, 'Late');
    const row = h.prisma.codes[0];
    if (row) row.expiresAt = new Date(Date.now() - 1);
    expect(await h.agents.pair(expired.code, 'A', '0')).toBeNull();

    expect(h.prisma.agents).toHaveLength(0);
  });

  it('⚠ does not burn a code refused for the cap: revoke one, and the same code works', async () => {
    const h = harness();
    const first = await paired(h, SCOPE, 'One');
    await paired(h, SCOPE, 'Two');
    // Made while there was room is impossible at the cap, so plant one as if it had been.
    await h.writes.revokeAgent(SCOPE, ANA, first.agentId);
    const waiting = await h.writes.createPairingCode(SCOPE, ANA, 'Three');
    await paired(h, SCOPE, 'Filler');

    expect(await h.agents.pair(waiting.code, 'C', '0')).toBeNull();
    expect(h.prisma.codes.find((code) => code.codeHash === hashPrintCredential(waiting.code))?.usedAt).toBeNull();
  });
});

describe('a computer connecting', () => {
  it('is admitted by its secret, tagged as a print agent of its own workspace, and counts as seen', async () => {
    const h = harness();
    const { admission, agentId } = await paired(h);
    expect(admission).toEqual({
      kind: 'print-agent',
      agentId,
      connectionKey: `print-agent:${agentId}`,
      ...SCOPE,
    });
    expect(h.prisma.agents[0]?.lastSeenAt).toBeInstanceOf(Date);
  });

  it('⚠ is refused for anything that is not a live secret, without a query for a misshapen one', async () => {
    const h = harness();
    const { secret, agentId } = await paired(h);
    expect(await h.agents.admit({})).toBeNull();
    expect(await h.agents.admit({ [PRINT_AGENT_SECRET_PARAM]: 'short' })).toBeNull();
    expect(await h.agents.admit({ [PRINT_AGENT_SECRET_PARAM]: 'B'.repeat(43) })).toBeNull();

    await h.writes.revokeAgent(SCOPE, ANA, agentId);
    expect(await h.agents.admit({ [PRINT_AGENT_SECRET_PARAM]: secret })).toBeNull();
  });

  it('is routed by its connection parameter, and read back only as its own kind', () => {
    expect(isPrintAgentHandshake({ [PRINT_AGENT_SECRET_PARAM]: 'x' })).toBe(true);
    expect(isPrintAgentHandshake({ displayPass: 'x' })).toBe(false);

    const admission = { kind: 'print-agent', agentId: 'a', ...SCOPE };
    expect(readPrintAgentAdmission({ [ANONYMOUS_ADMISSION_KEY]: admission })).toMatchObject({ agentId: 'a' });
    // ⚠ A queue display's admission is not a computer's.
    expect(readPrintAgentAdmission({ [ANONYMOUS_ADMISSION_KEY]: { ...admission, kind: 'queue-display' } })).toBeNull();
    expect(readPrintAgentAdmission({ userId: ANA })).toBeNull();
    expect(readPrintAgentAdmission(undefined)).toBeNull();
  });
});

describe('a connected computer', () => {
  it('says it is still there, until it is revoked', async () => {
    const h = harness();
    const { admission, agentId } = await paired(h);
    expect(await h.agents.heartbeat(admission)).toBe(true);
    await h.writes.revokeAgent(SCOPE, ANA, agentId);
    const before = h.prisma.agents[0]?.lastSeenAt;
    expect(await h.agents.heartbeat(admission)).toBe(false);
    expect(h.prisma.agents[0]?.lastSeenAt).toBe(before);
  });

  it('reports its printers, and a later report replaces the list: gone ones are marked, returning ones restored', async () => {
    const h = harness();
    const { admission } = await paired(h);
    await h.agents.reportPrinters(admission, [printer('L5290', { isDefault: true }), printer('L121')]);
    expect(h.prisma.printers.map((row) => [row.name, row.goneAt])).toEqual([
      ['L5290', null],
      ['L121', null],
    ]);
    const l121 = h.prisma.printers.find((row) => row.name === 'L121')?.id;

    await h.agents.reportPrinters(admission, [printer('L5290', { status: 'offline' })]);
    expect(h.prisma.printers.find((row) => row.name === 'L121')?.goneAt).toBeInstanceOf(Date);
    expect(h.prisma.printers.find((row) => row.name === 'L5290')?.status).toBe('offline');

    await h.agents.reportPrinters(admission, [printer('L5290'), printer('L121')]);
    const back = h.prisma.printers.find((row) => row.name === 'L121');
    // ⚠ The same row: what hangs off its id later (a calibration) survives a day unplugged.
    expect([back?.id, back?.goneAt]).toEqual([l121, null]);
    expect(h.prisma.printers).toHaveLength(2);
  });

  it('⚠ writes nothing for a list that is not one, or for a revoked computer', async () => {
    const h = harness();
    const { admission, agentId } = await paired(h);
    await expect(h.agents.reportPrinters(admission, [printer('A'), printer('A')])).rejects.toMatchObject({
      reason: 'invalid_printers',
    });
    await h.writes.revokeAgent(SCOPE, ANA, agentId);
    await expect(h.agents.reportPrinters(admission, [printer('A')])).rejects.toMatchObject({ reason: 'agent_revoked' });
    expect(h.prisma.printers).toHaveLength(0);
  });
});

describe('what a person sees and does', () => {
  it('lists the workspace’s paired computers by name with their printers, and no other workspace’s', async () => {
    const h = harness();
    const b = await paired(h, SCOPE, 'B back room');
    const a = await paired(h, SCOPE, 'A front desk');
    const elsewhere = await paired(h, OTHER, 'Elsewhere');
    await h.agents.reportPrinters(a.admission, [printer('Z'), printer('Y')]);
    await h.agents.reportPrinters(elsewhere.admission, [printer('Other')]);

    const listed = await h.resolver.agents(SCOPE.organizationId, SCOPE.workspaceId);
    expect(listed.map((agent) => agent.name)).toEqual(['A front desk', 'B back room']);
    expect(listed[0]).toMatchObject({ id: a.agentId, online: true, hostName: 'DESKTOP-1' });
    expect(listed[0]?.printers.map((entry) => entry.name)).toEqual(['Y', 'Z']);
    expect(listed[0]?.printers[0]).toMatchObject({ status: 'ready', gone: false, papers: [A4] });
    expect(listed[1]).toMatchObject({ id: b.agentId, printers: [] });
    // ⚠ Nothing a person reads carries a credential.
    expect(JSON.stringify(listed)).not.toMatch(/secret|hash/i);
  });

  it('leaves a revoked computer out of the list, and keeps its row', async () => {
    const h = harness();
    const { agentId } = await paired(h);
    expect(
      await h.resolver.revokeAgent({ req: { userId: ANA } }, SCOPE.organizationId, SCOPE.workspaceId, agentId),
    ).toBe(true);
    expect(await h.print.agents(SCOPE)).toEqual([]);
    expect(h.prisma.agents[0]).toMatchObject({ id: agentId, revokedById: ANA });
    // Twice is not an error.
    await expect(h.writes.revokeAgent(SCOPE, ANA, agentId)).resolves.toBeUndefined();
  });

  it('⚠ cannot revoke a computer of another workspace, and says only “not here”', async () => {
    const h = harness();
    const { agentId } = await paired(h, OTHER);
    await expect(h.writes.revokeAgent(SCOPE, ANA, agentId)).rejects.toMatchObject({
      reason: 'not_found',
      message: PRINT_NOT_FOUND_MESSAGE,
    });
    await expect(h.writes.revokeAgent(SCOPE, ANA, 'no-such-id')).rejects.toMatchObject({
      message: PRINT_NOT_FOUND_MESSAGE,
    });
    expect(h.prisma.agents[0]?.revokedAt).toBeNull();
  });

  it('returns a new code formatted for reading aloud, and refuses without an actor', async () => {
    const h = harness();
    const made = await h.resolver.createPairingCode(
      { req: { userId: ANA } },
      SCOPE.organizationId,
      SCOPE.workspaceId,
      'PC',
    );
    expect(made.code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(new Date(made.expiresAt).getTime()).toBeGreaterThan(Date.now());
    await expect(
      h.resolver.createPairingCode({ req: {} }, SCOPE.organizationId, SCOPE.workspaceId, 'PC'),
    ).rejects.toMatchObject({ reason: 'not_permitted' });
  });
});

describe('the computer’s own surface', () => {
  it('⚠ refuses a heartbeat and a report from anything not admitted as a print agent', async () => {
    const h = harness();
    await paired(h);
    for (const req of [undefined, {}, { userId: ANA }, { [ANONYMOUS_ADMISSION_KEY]: { kind: 'queue-display' } }]) {
      await expect(h.agentResolver.heartbeat({ req })).rejects.toMatchObject({ message: PRINT_AGENT_REFUSED_MESSAGE });
      await expect(h.agentResolver.reportPrinters({ req }, [])).rejects.toMatchObject({
        message: PRINT_AGENT_REFUSED_MESSAGE,
      });
    }
  });

  it('serves an admitted socket, for the workspace on its admission and no argument’s', async () => {
    const h = harness();
    const { admission } = await paired(h);
    const req = { [ANONYMOUS_ADMISSION_KEY]: admission };
    expect(await h.agentResolver.heartbeat({ req })).toBe(true);
    expect(await h.agentResolver.reportPrinters({ req }, [printer('L5290')] as never)).toBe(true);
    expect(h.prisma.printers[0]).toMatchObject({ ...SCOPE, name: 'L5290' });
  });

  it('pairs through the resolver with one answer for a refusal', async () => {
    const h = harness();
    const { code } = await h.writes.createPairingCode(SCOPE, ANA, 'PC');
    expect(await h.agentResolver.pair('ZZZZZ-ZZZZZ')).toBeNull();
    expect(await h.agentResolver.pair(code, 'HOST', '0.0.0')).toMatchObject({ name: 'PC' });
  });
});
