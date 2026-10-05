import { bookingEventFor } from '../src/domain/events.js';
import { ANA, BEN, book, harness, OTHER_WORKSPACE, SCOPE, shop } from './harness.js';

async function take<T>(iterator: AsyncIterableIterator<T>, count: number): Promise<T[]> {
  const out: T[] = [];
  while (out.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

describe('bookingEventFor', () => {
  const event = { ...SCOPE, change: 'appointment' as const };

  it('tells a viewer of the same workspace what changed', () => {
    expect(bookingEventFor(event, SCOPE)).toBe('appointment');
  });

  it('⚠ tells nobody in another workspace, or another organization', () => {
    expect(bookingEventFor(event, OTHER_WORKSPACE)).toBeNull();
    expect(bookingEventFor(event, { organizationId: 'org-2', workspaceId: SCOPE.workspaceId })).toBeNull();
  });
});

describe('bookingEvents', () => {
  it('sends sync first, then ids — never a customer’s name', async () => {
    const h = harness();
    const ids = await shop(h);
    const stream = h.resolver.bookingEvents({ req: BEN }, SCOPE.organizationId, SCOPE.workspaceId);
    const pending = take(stream, 2);
    await new Promise((resolve) => setImmediate(resolve));
    const made = await book(h, ids, '10:00');
    const events = await pending;
    await stream.return?.();
    expect(events).toEqual([
      { kind: 'sync', appointmentId: null, actorId: null },
      { kind: 'appointment', appointmentId: made.id, actorId: ANA },
    ]);
    expect(JSON.stringify(events)).not.toContain('Maria');
  });

  it('⚠ never tells another workspace that something was booked', async () => {
    const h = harness();
    const ids = await shop(h);
    const stream = h.resolver.bookingEvents({ req: BEN }, OTHER_WORKSPACE.organizationId, OTHER_WORKSPACE.workspaceId);
    const pending = take(stream, 2);
    await new Promise((resolve) => setImmediate(resolve));
    await book(h, ids, '10:00');
    // The one event this subscriber may hear: a change in its own workspace.
    await h.catalogue.saveSettings(OTHER_WORKSPACE, BEN, { slotMinutes: 15, reminderMinutes: 15 });
    const events = await pending;
    await stream.return?.();
    expect(events.map((event) => event.kind)).toEqual(['sync', 'settings']);
  });

  it('refuses a socket with nobody behind it', () => {
    const h = harness();
    expect(() => h.resolver.bookingEvents({ req: undefined }, SCOPE.organizationId, SCOPE.workspaceId)).toThrow(
      'Not signed in',
    );
  });
});
