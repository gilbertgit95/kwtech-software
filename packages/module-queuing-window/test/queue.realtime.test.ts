import { ANONYMOUS_ADMISSION_KEY } from '@kwtech/module-kit';
import { DEFAULT_VOICE } from '../src/domain/voice.js';
import { QueueResolver } from '../src/server/graphql/queue.resolver.js';
import type { QueueEventType } from '../src/server/graphql/queue.types.js';
import type { QueueWorkspaceLocator } from '../src/server/ports.js';
import { QueueEventPublisher } from '../src/server/queue.events.js';
import { QUEUE_EVENT, type QueueCallEvent, type QueuePubSub } from '../src/server/queue.pubsub.js';
import { QueueService } from '../src/server/queue.service.js';
import { QueueBoardService, type QueueDisplayEvent } from '../src/server/queue-board.service.js';
import { QueueDisplayService, readDisplayAdmission } from '../src/server/queue-display.service.js';
import { QueueWriteService } from '../src/server/queue-write.service.js';
import { fakeClient } from './fake-client.js';

/**
 * The realtime half: what is announced, and what a TV and a console receive.
 *
 * ⚠ A subscription is authorised ONCE. So the questions here are the ones a
 * subscription cannot ask for itself — is this still the session that admitted
 * the TV, is this event for this workspace, and does a name belong on a public
 * screen — re-answered on every publish.
 */

const SCOPE = { organizationId: 'org', workspaceId: 'ws' };

/**
 * An engine that behaves like `graphql-subscriptions`' in-memory one: fan-out,
 * no replay. Subscribes when the iterator is created, which is a superset of the
 * real engine's "on first pull".
 */
function memoryPubSub(): QueuePubSub & { sent: { trigger: string; payload: unknown }[]; failing: boolean } {
  const listeners = new Set<(trigger: string, payload: unknown) => void>();
  const engine = {
    sent: [] as { trigger: string; payload: unknown }[],
    failing: false,
    async publish(trigger: string, payload: unknown) {
      if (engine.failing) throw new Error('engine down');
      engine.sent.push({ trigger, payload });
      for (const listener of [...listeners]) listener(trigger, payload);
    },
    asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T> {
      const wanted = new Set(typeof triggers === 'string' ? [triggers] : triggers);
      const queue: T[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const listener = (trigger: string, payload: unknown) => {
        if (!wanted.has(trigger)) return;
        queue.push(payload as T);
        wake?.();
      };
      listeners.add(listener);

      const iterator: AsyncIterableIterator<T> = {
        async next(): Promise<IteratorResult<T>> {
          while (!closed && queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
          const value = queue.shift();
          return value === undefined ? { value: undefined, done: true } : { value, done: false };
        },
        async return(): Promise<IteratorResult<T>> {
          closed = true;
          listeners.delete(listener);
          wake?.();
          return { value: undefined, done: true };
        },
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
      return iterator;
    },
  };
  return engine;
}

const locator: QueueWorkspaceLocator = {
  locate: async () => ({ organizationId: 'org', workspaceId: 'ws', workspaceName: 'Main branch' }),
};

/** Line C, Window 3 with joy at it, queuing started, and one TV admitted by its pass. */
async function harness() {
  const { client, state } = fakeClient();
  const pubsub = memoryPubSub();
  const writes = new QueueWriteService(client, undefined, undefined, new QueueEventPublisher(pubsub));
  const displays = new QueueDisplayService(client, locator);
  const board = new QueueBoardService(client, pubsub);

  const line = await writes.createLine(SCOPE, { name: 'Cashier', prefix: 'C' });
  const window = await writes.createWindow(SCOPE, 'joy', { name: 'Window 3' });
  await writes.assignWindow(SCOPE, 'joy', { windowId: window.id, userId: 'joy', confirmReplace: false });
  const session = await writes.startQueue(SCOPE, 'boss', { continueNumbering: false });

  const opened = await displays.openDisplay('acme', 'main', session.displayCode as string);
  const admission = await displays.admit({ displayPass: opened?.pass });
  if (!admission) throw new Error('expected the pass to be admitted');

  const calls = () =>
    pubsub.sent.filter((one) => one.trigger === QUEUE_EVENT.call).map((one) => one.payload as QueueCallEvent);

  return { client, state, pubsub, writes, displays, board, line, window, session, admission, calls };
}

async function next<T>(stream: AsyncIterableIterator<T>): Promise<T> {
  const result = await stream.next();
  if (result.done) throw new Error('the stream ended');
  return result.value;
}

describe('what is announced', () => {
  it('announces a call once it has committed, as a payload that survives JSON', async () => {
    const h = await harness();
    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });

    expect(h.calls()).toHaveLength(1);
    expect(h.calls()[0]).toMatchObject({
      kind: 'call',
      workspaceId: 'ws',
      change: 'called',
      ticket: { label: 'C-001' },
    });
    // ⚠ With Redis behind the engine a payload is JSON; a Date would arrive as a string.
    expect(typeof h.calls()[0]?.ticket.calledAt).toBe('string');
  });

  it('announces a recall, a Done and a no-show by name', async () => {
    const h = await harness();
    const ticket = await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });
    await h.writes.actOnTicket(SCOPE, 'joy', ticket.id, 'recall');
    await h.writes.actOnTicket(SCOPE, 'joy', ticket.id, 'no_show');

    expect(h.calls().map((event) => event.change)).toEqual(['called', 'recalled', 'no_show']);
  });

  it('⚠ announces nothing for a replayed clientRequestId — one call, one chime', async () => {
    const h = await harness();
    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id, clientRequestId: 'tap-1' });
    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id, clientRequestId: 'tap-1' });

    expect(h.calls()).toHaveLength(1);
  });

  it('announces nothing for a refused call', async () => {
    const h = await harness();
    await expect(h.writes.callNext(SCOPE, 'ben', { lineId: h.line.id })).rejects.toMatchObject({ reason: 'no_window' });
    expect(h.calls()).toHaveLength(0);
  });

  it('⚠ never fails a call because the engine is down — a retry would call the NEXT number', async () => {
    const h = await harness();
    h.pubsub.failing = true;

    const ticket = await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });
    expect(ticket.label).toBe('C-001');
  });
});

describe('admitting a display at the socket handshake', () => {
  it('admits a live pass, carrying the workspace and session it belongs to', async () => {
    const h = await harness();
    expect(h.admission).toMatchObject({ kind: 'queue-display', workspaceId: 'ws', sessionId: h.session.id });
    expect(h.state.queueDisplayPass[0]?.lastSeenAt).toBeInstanceOf(Date);
  });

  it.each([
    ['nothing', {}],
    ['a code instead of a pass', { displayPass: 'K7QM4XHT' }],
    ['a pass-shaped guess', { displayPass: 'x'.repeat(43) }],
  ])('refuses %s', async (_label, params) => {
    const h = await harness();
    expect(await h.displays.admit(params)).toBeNull();
  });

  it('⚠ refuses a pass once its session has stopped', async () => {
    const { client } = fakeClient();
    const writes = new QueueWriteService(client);
    const displays = new QueueDisplayService(client, locator);
    const session = await writes.startQueue(SCOPE, 'boss', { continueNumbering: false });
    const opened = await displays.openDisplay('acme', 'main', session.displayCode as string);

    await writes.stopQueue(SCOPE, 'boss');
    expect(await displays.admit({ displayPass: opened?.pass })).toBeNull();
  });

  it('⚠ reads a display admission only — not a principal, and not another module’s admission', () => {
    expect(readDisplayAdmission({ kwtechPrincipal: { userId: 'joy' } })).toBeNull();
    expect(readDisplayAdmission({ [ANONYMOUS_ADMISSION_KEY]: { kind: 'something-else', sessionId: 's' } })).toBeNull();
    expect(
      readDisplayAdmission({
        [ANONYMOUS_ADMISSION_KEY]: {
          kind: 'queue-display',
          passId: 'p',
          sessionId: 's',
          organizationId: 'o',
          workspaceId: 'w',
        },
      }),
    ).toMatchObject({ workspaceId: 'w' });
  });
});

describe('the board a TV receives', () => {
  it('opens with the board as it stands', async () => {
    const h = await harness();
    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });

    const first = await next(h.board.stream(h.admission));
    expect(first.kind).toBe('board');
    expect(first.announce).toBeNull();
    expect(first.board?.serving.map((call) => [call.label, call.windowName])).toEqual([['C-001', 'Window 3']]);
    expect(first.board?.lines.map((line) => line.prefix)).toEqual(['C']);
  });

  it('⚠ receives a call as a whole new board, plus the one call to announce', async () => {
    const h = await harness();
    const stream = h.board.stream(h.admission);
    await next(stream);

    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });
    const event = await next(stream);

    expect(event.announce?.label).toBe('C-001');
    expect(event.board?.serving[0]?.label).toBe('C-001');
    await stream.return?.();
  });

  it('does not redraw for a Done — the board shows calls, not service', async () => {
    const h = await harness();
    const ticket = await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });
    const stream = h.board.stream(h.admission);
    await next(stream);

    await h.writes.actOnTicket(SCOPE, 'joy', ticket.id, 'done');
    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });

    // The next thing to arrive is the second call, not a redraw for the Done.
    expect((await next(stream)).announce?.label).toBe('C-002');
    await stream.return?.();
  });

  it('⚠ shows a nickname only once the workspace shows names — and never an account name', async () => {
    const h = await harness();
    await h.writes.setMyNickname(SCOPE, 'joy', 'Ate Joy');
    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });

    const stream = h.board.stream(h.admission);
    expect((await next(stream)).board?.serving[0]?.nickname).toBeNull();

    await h.writes.setShowStaffNames(SCOPE, true);
    expect((await next(stream)).board?.serving[0]?.nickname).toBe('Ate Joy');

    // Clearing it takes it off the board at once.
    await h.writes.clearNickname(SCOPE, 'joy');
    expect((await next(stream)).board?.serving[0]?.nickname).toBeNull();
    await stream.return?.();
  });

  it('carries the workspace voice, and a change reaches the TV with the next board', async () => {
    const h = await harness();
    const stream = h.board.stream(h.admission);
    expect((await next(stream)).board?.voice).toEqual(DEFAULT_VOICE);

    await h.writes.setVoice(SCOPE, { ...DEFAULT_VOICE, type: 'woman', repeat: 2 });
    expect((await next(stream)).board?.voice).toMatchObject({ type: 'woman', repeat: 2 });
    await stream.return?.();
  });

  it('⚠ ends with `stopped` when queuing stops', async () => {
    const h = await harness();
    const stream = h.board.stream(h.admission);
    await next(stream);

    await h.writes.stopQueue(SCOPE, 'boss');
    expect((await next(stream)).kind).toBe('stopped');
    expect((await stream.next()).done).toBe(true);
  });

  it('⚠ re-checks the session on every redraw, not only on the stop event', async () => {
    const h = await harness();
    const stream = h.board.stream(h.admission);
    await next(stream);

    // The stop event was missed: the session is over, and nothing said so.
    (h.state.queueSession[0] as { stoppedAt: Date | null }).stoppedAt = new Date();
    await h.writes.setShowStaffNames(SCOPE, true);

    expect((await next(stream)).kind).toBe('stopped');
  });

  it("ignores another workspace's queue", async () => {
    const h = await harness();
    const stream = h.board.stream(h.admission);
    await next(stream);

    await h.pubsub.publish(QUEUE_EVENT.workspace, {
      kind: 'workspace',
      organizationId: 'org',
      workspaceId: 'ws-2',
      change: 'settings',
    });
    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });

    expect((await next(stream)).announce?.label).toBe('C-001');
    await stream.return?.();
  });

  it('refuses to stream a session that is already over', async () => {
    const h = await harness();
    await h.writes.stopQueue(SCOPE, 'boss');
    const events: QueueDisplayEvent[] = [];
    for await (const event of h.board.stream(h.admission)) events.push(event);
    expect(events.map((event) => event.kind)).toEqual(['stopped']);
  });
});

describe('the staff console stream', () => {
  function resolver(h: Awaited<ReturnType<typeof harness>>) {
    return new QueueResolver(new QueueService(h.client), h.writes, { resolveActorId: () => 'joy' }, h.pubsub);
  }

  it('⚠ opens with `sync` on every subscribe — the engine has no replay', async () => {
    const h = await harness();
    const stream = resolver(h).queueEvents({ req: {} }, 'org', 'ws');
    expect(await next(stream)).toEqual({ kind: 'sync', change: null, ticket: null });
    await stream.return?.();
  });

  it("carries this workspace's calls and changes, and nothing from another", async () => {
    const h = await harness();
    const stream = resolver(h).queueEvents({ req: {} }, 'org', 'ws');
    await next(stream);

    await h.pubsub.publish(QUEUE_EVENT.workspace, {
      kind: 'workspace',
      organizationId: 'org',
      workspaceId: 'ws-2',
      change: 'windows',
    });
    await h.writes.callNext(SCOPE, 'joy', { lineId: h.line.id });
    await h.writes.createWindow(SCOPE, 'boss', { name: 'Window 4' });

    const call: QueueEventType = await next(stream);
    expect([call.kind, call.change, call.ticket?.label]).toEqual(['call', 'called', 'C-001']);
    expect(await next(stream)).toEqual({ kind: 'changed', change: 'windows', ticket: null });
    await stream.return?.();
  });

  it('refuses a socket with nobody on it at subscribe', async () => {
    const h = await harness();
    const anonymous = new QueueResolver(new QueueService(h.client), h.writes, {}, h.pubsub);
    expect(() => anonymous.queueEvents({ req: {} }, 'org', 'ws')).toThrow('Not signed in');
  });
});
