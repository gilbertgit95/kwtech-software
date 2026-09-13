import type { LimitChecker } from '@kwtech/module-kit';
import { DEFAULT_VOICE } from '../src/domain/voice.js';
import { QUEUE_LIMIT } from '../src/feature-keys.js';
import type { QueueStaffCheck } from '../src/server/ports.js';
import type { QueueWriteError } from '../src/server/queue.errors.js';
import type { QueueScope } from '../src/server/queue.service.js';
import { MAX_DISPLAYS_CEILING, QueueWriteService } from '../src/server/queue-write.service.js';
import { fakeClient } from './fake-client.js';

/**
 * The write path, against a literal rather than a database.
 *
 * Every test is about the SECOND half of an authorisation. The guard has already
 * said the caller may serve, assign or manage in this workspace; these assert
 * what the rows say — whether queuing is running, which window is theirs, and
 * whether a number is somebody else's.
 */

const SCOPE: QueueScope = { organizationId: 'org', workspaceId: 'ws' };
const ELSEWHERE: QueueScope = { organizationId: 'org', workspaceId: 'ws-2' };

function caps(windows: number | null, displays: number | null): LimitChecker {
  return {
    async check({ key, current }) {
      const limit = key === QUEUE_LIMIT.windows ? windows : displays;
      return {
        allowed: limit === null || current < limit,
        limit,
        current,
        remaining: limit === null ? null : Math.max(0, limit - current),
      };
    },
  };
}

const everybodyServes: QueueStaffCheck = { canServe: async () => true };

function harness(options: { windows?: number | null; displays?: number | null; staff?: QueueStaffCheck } = {}) {
  const { client, state } = fakeClient();
  const limits = caps(options.windows ?? null, options.displays === undefined ? 5 : options.displays);
  return { svc: new QueueWriteService(client, limits, options.staff), client, state };
}

type Harness = ReturnType<typeof harness>;

async function refusal(promise: Promise<unknown>): Promise<QueueWriteError> {
  try {
    await promise;
  } catch (error) {
    return error as QueueWriteError;
  }
  throw new Error('expected a refusal');
}

/** Line C, Window 3 with joy assigned to it, and queuing started. */
async function running(h: Harness = harness()) {
  const line = await h.svc.createLine(SCOPE, { name: 'Cashier', prefix: 'C' });
  const window = await h.svc.createWindow(SCOPE, 'boss', { name: 'Window 3' });
  await h.svc.assignWindow(SCOPE, 'joy', { windowId: window.id, userId: 'joy', confirmReplace: false });
  const session = await h.svc.startQueue(SCOPE, 'boss', { continueNumbering: false });
  return { ...h, line, window, session };
}

/** A second window, Window 4, with ben at it. */
async function withBen(h: Awaited<ReturnType<typeof running>>) {
  const window = await h.svc.createWindow(SCOPE, 'boss', { name: 'Window 4' });
  await h.svc.assignWindow(SCOPE, 'ben', { windowId: window.id, userId: 'ben', confirmReplace: false });
  return window;
}

describe('sessions', () => {
  it('starts one session with a display code and a display cap resolved from the plan', async () => {
    const { svc, state } = harness({ displays: 3 });
    const session = await svc.startQueue(SCOPE, 'boss', { continueNumbering: false });

    expect(session.displayCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(session.openWorkspaceId).toBe('ws');
    expect(session.maxDisplays).toBe(3);
    expect(state.queueSettings).toHaveLength(1);
  });

  it('⚠ refuses a second Start while one is open', async () => {
    const { svc } = harness();
    await svc.startQueue(SCOPE, 'boss', { continueNumbering: false });
    expect((await refusal(svc.startQueue(SCOPE, 'other', { continueNumbering: false }))).reason).toBe(
      'already_running',
    );
  });

  it('⚠ holds an unlimited plan to the display ceiling', async () => {
    const { svc } = harness({ displays: null });
    expect((await svc.startQueue(SCOPE, 'boss', { continueNumbering: false })).maxDisplays).toBe(MAX_DISPLAYS_CEILING);
  });

  it('starts every line fresh, or carries the numbering on when asked', async () => {
    const h = await running();
    await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    await h.svc.stopQueue(SCOPE, 'boss');

    await h.svc.startQueue(SCOPE, 'boss', { continueNumbering: true });
    expect((await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id })).number).toBe(3);
    await h.svc.stopQueue(SCOPE, 'boss');

    await h.svc.startQueue(SCOPE, 'boss', { continueNumbering: false });
    expect((await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id })).number).toBe(1);
  });

  it('⚠ stop clears the code, deletes every pass, and KEEPS every seat', async () => {
    const h = await running();
    h.state.queueDisplayPass.push({ id: 'pass-1', sessionId: h.session.id, tokenHash: 'x' });

    const stopped = await h.svc.stopQueue(SCOPE, 'boss');

    expect(stopped.displayCode).toBeNull();
    expect(stopped.openWorkspaceId).toBeNull();
    expect(stopped.stoppedById).toBe('boss');
    expect(h.state.queueDisplayPass).toHaveLength(0);
    expect(h.state.queueSeat).toHaveLength(1);
  });

  it('refuses Stop when nothing is running', async () => {
    expect((await refusal(harness().svc.stopQueue(SCOPE, 'boss'))).reason).toBe('not_started');
  });
});

describe('Call next', () => {
  it('⚠ refuses before queuing has started', async () => {
    const { svc } = harness();
    const line = await svc.createLine(SCOPE, { name: 'Cashier', prefix: 'C' });
    const window = await svc.createWindow(SCOPE, 'joy', { name: 'Window 3' });
    await svc.assignWindow(SCOPE, 'joy', { windowId: window.id, userId: 'joy', confirmReplace: false });

    expect((await refusal(svc.callNext(SCOPE, 'joy', { lineId: line.id }))).reason).toBe('not_started');
  });

  it('⚠ refuses somebody who is not assigned a window', async () => {
    const h = await running();
    expect((await refusal(h.svc.callNext(SCOPE, 'ben', { lineId: h.line.id }))).reason).toBe('no_window');
  });

  it('refuses a line the window does not call from', async () => {
    const h = await running();
    const enrollment = await h.svc.createLine(SCOPE, { name: 'Enrollment', prefix: 'E' });
    await h.svc.setWindowLines(SCOPE, { windowId: h.window.id, lineIds: [h.line.id] });

    expect((await refusal(h.svc.callNext(SCOPE, 'joy', { lineId: enrollment.id }))).reason).toBe('line_not_served');
  });

  it('calls numbers in order, labelled the way the customer was told', async () => {
    const h = await running();
    const first = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    const second = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });

    expect([first.label, second.label]).toEqual(['C-001', 'C-002']);
    expect(first.windowName).toBe('Window 3');
  });

  it('⚠ skips a number already called out of order', async () => {
    const h = await running();
    await h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 2 });

    expect((await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id })).number).toBe(1);
    expect((await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id })).number).toBe(3);
  });

  it('⚠ is idempotent on clientRequestId — a double-tap never skips a number', async () => {
    const h = await running();
    const once = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id, clientRequestId: 'tap-1' });
    const twice = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id, clientRequestId: 'tap-1' });

    expect(twice.id).toBe(once.id);
    expect(h.state.queueTicket).toHaveLength(1);
  });

  it('⚠ completes the ticket the window was serving', async () => {
    const h = await running();
    const first = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });

    expect(h.state.queueTicket.find((row) => row.id === first.id)?.status).toBe('done');
  });

  it('wraps after the last number into a new cycle', async () => {
    const h = harness();
    await h.svc.createLine(SCOPE, { name: 'Short', prefix: 'S', startNumber: 1, endNumber: 2 });
    const { line } = await running(h).then((r) => ({ line: r.state.queueLine[0] as { id: string } }));

    const calls = [];
    for (let i = 0; i < 3; i += 1) calls.push(await h.svc.callNext(SCOPE, 'joy', { lineId: line.id }));
    expect(calls.map((ticket) => [ticket.number, ticket.cycle])).toEqual([
      [1, 0],
      [2, 0],
      [1, 1],
    ]);
  });

  it('numbers a line added after Start from its first number', async () => {
    const h = await running();
    const enrollment = await h.svc.createLine(SCOPE, { name: 'Enrollment', prefix: 'E' });
    expect((await h.svc.callNext(SCOPE, 'joy', { lineId: enrollment.id })).label).toBe('E-001');
  });

  it('⚠ runs again when it loses the race for the sequence, and calls exactly one number', async () => {
    const h = await running();
    const moveSequence = h.client.queueSequence.updateMany;
    let lost = false;
    h.client.queueSequence.updateMany = async (args) => {
      if (!lost) {
        lost = true;
        return { count: 0 };
      }
      return moveSequence(args);
    };

    const ticket = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    expect(ticket.number).toBe(1);
    expect(h.state.queueTicket).toHaveLength(1);
  });

  it('gives up and says so when it keeps losing', async () => {
    const h = await running();
    h.client.queueSequence.updateMany = async () => ({ count: 0 });
    expect((await refusal(h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id }))).reason).toBe('conflict');
    expect(h.state.queueTicket).toHaveLength(0);
  });
});

describe('Call number…', () => {
  it('calls a number ahead without moving Call next', async () => {
    const h = await running();
    expect((await h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 5 })).label).toBe('C-005');
    expect((await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id })).number).toBe(1);
  });

  it('refuses a number the line does not have', async () => {
    const h = await running();
    expect((await refusal(h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 1000 }))).reason).toBe('invalid');
  });

  it('treats the same number at the same window as a recall', async () => {
    const h = await running();
    const first = await h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 5 });
    const again = await h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 5 });

    expect(again.id).toBe(first.id);
    expect(again.recallCount).toBe(1);
  });

  it('⚠ calls a no-show again on the same row, moving it to the window that called', async () => {
    const h = await running();
    const windowFour = await withBen(h);
    const ticket = await h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 5 });
    await h.svc.actOnTicket(SCOPE, 'joy', ticket.id, 'no_show');

    const again = await h.svc.callNumber(SCOPE, 'ben', { lineId: h.line.id, number: 5 });
    expect(again.id).toBe(ticket.id);
    expect(again.status).toBe('called');
    expect(again.windowId).toBe(windowFour.id);
    expect(h.state.queueTicket).toHaveLength(1);
  });

  it('⚠ refuses a number being served at another window', async () => {
    const h = await running();
    await withBen(h);
    await h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 5 });

    const refused = await refusal(h.svc.callNumber(SCOPE, 'ben', { lineId: h.line.id, number: 5 }));
    expect(refused.detail).toEqual({ reason: 'called_elsewhere' });
  });

  it('refuses a number already served', async () => {
    const h = await running();
    const ticket = await h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 5 });
    await h.svc.actOnTicket(SCOPE, 'joy', ticket.id, 'done');

    const refused = await refusal(h.svc.callNumber(SCOPE, 'joy', { lineId: h.line.id, number: 5 }));
    expect(refused.detail).toEqual({ reason: 'already_served' });
  });
});

describe('acting on a ticket', () => {
  it('completes a ticket at your own window', async () => {
    const h = await running();
    const ticket = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    const done = await h.svc.actOnTicket(SCOPE, 'joy', ticket.id, 'done');

    expect(done.status).toBe('done');
    expect(done.completedAt).toBeInstanceOf(Date);
  });

  it("⚠ refuses another window's ticket", async () => {
    const h = await running();
    await withBen(h);
    const ticket = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });

    expect((await refusal(h.svc.actOnTicket(SCOPE, 'ben', ticket.id, 'no_show'))).reason).toBe('not_permitted');
  });

  it('refuses somebody with no window', async () => {
    const h = await running();
    const ticket = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    expect((await refusal(h.svc.actOnTicket(SCOPE, 'zed', ticket.id, 'done'))).reason).toBe('no_window');
  });

  it('counts a recall', async () => {
    const h = await running();
    const ticket = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    expect((await h.svc.actOnTicket(SCOPE, 'joy', ticket.id, 'recall')).recallCount).toBe(1);
  });

  it('refuses a recall once queuing has stopped', async () => {
    const h = await running();
    const ticket = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    await h.svc.stopQueue(SCOPE, 'boss');

    expect((await refusal(h.svc.actOnTicket(SCOPE, 'joy', ticket.id, 'recall'))).reason).toBe('not_started');
  });

  it('refuses a second Done', async () => {
    const h = await running();
    const ticket = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    await h.svc.actOnTicket(SCOPE, 'joy', ticket.id, 'done');

    expect((await refusal(h.svc.actOnTicket(SCOPE, 'joy', ticket.id, 'done'))).reason).toBe('invalid');
  });

  it('⚠ treats a ticket from another workspace as not found', async () => {
    const h = await running();
    const ticket = await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    expect((await refusal(h.svc.actOnTicket(ELSEWHERE, 'joy', ticket.id, 'done'))).reason).toBe('not_found');
  });
});

describe('lines', () => {
  it('refuses a second line with the same prefix, whatever its case', async () => {
    const { svc } = harness();
    await svc.createLine(SCOPE, { name: 'Cashier', prefix: 'C' });
    expect((await refusal(svc.createLine(SCOPE, { name: 'Cash 2', prefix: 'c' }))).reason).toBe('prefix_taken');
  });

  it('refuses a range that is not a range', async () => {
    const { svc } = harness();
    const refused = await refusal(svc.createLine(SCOPE, { name: 'One', prefix: 'O', startNumber: 5, endNumber: 5 }));
    expect(refused.detail).toEqual({ reason: 'end_not_after_start' });
  });

  it("⚠ sets the number Call next calls — the guard's fresh roll at 150", async () => {
    const h = await running();
    await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id });
    await h.svc.setLineNextNumber(SCOPE, { lineId: h.line.id, next: 150 });

    expect((await h.svc.callNext(SCOPE, 'joy', { lineId: h.line.id })).number).toBe(150);
  });

  it('refuses setting the next number while queuing is stopped', async () => {
    const { svc } = harness();
    const line = await svc.createLine(SCOPE, { name: 'Cashier', prefix: 'C' });
    expect((await refusal(svc.setLineNextNumber(SCOPE, { lineId: line.id, next: 5 }))).reason).toBe('not_started');
  });
});

describe('windows', () => {
  it('⚠ refuses a second window whose name differs only in case and spacing', async () => {
    const { svc } = harness();
    await svc.createWindow(SCOPE, 'boss', { name: 'Window 3' });
    expect((await refusal(svc.createWindow(SCOPE, 'boss', { name: 'window  3' }))).reason).toBe('name_taken');
  });

  it('⚠ enforces the window cap', async () => {
    const { svc } = harness({ windows: 1 });
    await svc.createWindow(SCOPE, 'boss', { name: 'Window 1' });
    expect((await refusal(svc.createWindow(SCOPE, 'boss', { name: 'Window 2' }))).reason).toBe('cap_reached');
  });

  it('⚠ archiving frees the seat and the cap slot; unarchiving counts again', async () => {
    const h = await running(harness({ windows: 1 }));
    await h.svc.setWindowArchived(SCOPE, 'boss', { windowId: h.window.id, archived: true });
    expect(h.state.queueSeat).toHaveLength(0);

    await h.svc.createWindow(SCOPE, 'boss', { name: 'Window 5' });
    const refused = await refusal(h.svc.setWindowArchived(SCOPE, 'boss', { windowId: h.window.id, archived: false }));
    expect(refused.reason).toBe('cap_reached');
  });

  it('refuses lines that are not in this workspace', async () => {
    const h = await running();
    const refused = await refusal(h.svc.setWindowLines(SCOPE, { windowId: h.window.id, lineIds: ['nope'] }));
    expect(refused.reason).toBe('not_found');
  });

  it('⚠ treats a window from another workspace as not found', async () => {
    const h = await running();
    const refused = await refusal(h.svc.updateWindow(ELSEWHERE, { windowId: h.window.id, name: 'Mine now' }));
    expect(refused.reason).toBe('not_found');
  });
});

describe('seats', () => {
  it('⚠ with no staff check bound, assigns only yourself', async () => {
    const { svc } = harness();
    const window = await svc.createWindow(SCOPE, 'boss', { name: 'Window 3' });

    const refused = await refusal(
      svc.assignWindow(SCOPE, 'boss', { windowId: window.id, userId: 'joy', confirmReplace: false }),
    );
    expect(refused.reason).toBe('not_permitted');
  });

  it('refuses somebody the staff check says cannot serve', async () => {
    const { svc } = harness({ staff: { canServe: async () => false } });
    const window = await svc.createWindow(SCOPE, 'boss', { name: 'Window 3' });

    const refused = await refusal(
      svc.assignWindow(SCOPE, 'boss', { windowId: window.id, userId: 'joy', confirmReplace: false }),
    );
    expect(refused.reason).toBe('not_permitted');
  });

  it('⚠ asks before replacing an occupant, then replaces them', async () => {
    const { svc, state } = harness({ staff: everybodyServes });
    const window = await svc.createWindow(SCOPE, 'boss', { name: 'Window 3' });
    await svc.assignWindow(SCOPE, 'boss', { windowId: window.id, userId: 'joy', confirmReplace: false });

    const asked = await refusal(
      svc.assignWindow(SCOPE, 'boss', { windowId: window.id, userId: 'ben', confirmReplace: false }),
    );
    expect(asked.reason).toBe('occupied');
    expect(asked.detail).toEqual({ occupantId: 'joy' });

    await svc.assignWindow(SCOPE, 'boss', { windowId: window.id, userId: 'ben', confirmReplace: true });
    expect(state.queueSeat.map((seat) => seat.userId)).toEqual(['ben']);
  });

  it('⚠ moves somebody who already sits at another window', async () => {
    const { svc, state } = harness({ staff: everybodyServes });
    const three = await svc.createWindow(SCOPE, 'boss', { name: 'Window 3' });
    const four = await svc.createWindow(SCOPE, 'boss', { name: 'Window 4' });
    await svc.assignWindow(SCOPE, 'boss', { windowId: three.id, userId: 'joy', confirmReplace: false });
    await svc.assignWindow(SCOPE, 'boss', { windowId: four.id, userId: 'joy', confirmReplace: false });

    expect(state.queueSeat.map((seat) => [seat.userId, seat.windowId])).toEqual([['joy', four.id]]);
  });

  it('lets anybody release their own seat', async () => {
    const h = await running();
    expect(await h.svc.releaseMySeat(SCOPE, 'joy')).toBe(true);
    expect(h.state.queueSeat).toHaveLength(0);
  });
});

describe('nicknames', () => {
  it('stores a trimmed nickname', async () => {
    expect(await harness().svc.setMyNickname(SCOPE, 'joy', '  Ate Joy ')).toBe('Ate Joy');
  });

  it('refuses one that cannot be shown on a public screen', async () => {
    expect((await refusal(harness().svc.setMyNickname(SCOPE, 'joy', 'Joy​'))).reason).toBe('invalid');
  });

  it('clears one', async () => {
    const { svc, state } = harness();
    await svc.setMyNickname(SCOPE, 'joy', 'Ate Joy');
    expect(await svc.clearNickname(SCOPE, 'joy')).toBe(true);
    expect(state.queueStaffNickname).toHaveLength(0);
  });
});

describe('announcements', () => {
  it('stores the voice a workspace chose', async () => {
    const { svc, state } = harness();
    await svc.setVoice(SCOPE, {
      enabled: true,
      type: 'woman',
      pitch: 'high',
      speed: 'slow',
      volume: 'medium',
      repeat: 2,
    });
    expect(state.queueSettings[0]).toMatchObject({
      workspaceId: 'ws',
      voiceEnabled: true,
      voiceType: 'woman',
      voicePitch: 'high',
      voiceSpeed: 'slow',
      voiceVolume: 'medium',
      voiceRepeat: 2,
    });
  });

  it('⚠ refuses a value that is not one of the choices, and saves nothing', async () => {
    const { svc, state } = harness();
    const error = await refusal(svc.setVoice(SCOPE, { ...DEFAULT_VOICE, pitch: 'ear-splitting' }));
    expect(error.reason).toBe('invalid');
    expect(error.detail).toEqual({ field: 'pitch' });
    expect(state.queueSettings ?? []).toHaveLength(0);
  });
});
