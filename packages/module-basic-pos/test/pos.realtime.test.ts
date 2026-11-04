import { isPosEventFor, type PosEvent } from '../src/server/pos.pubsub.js';
import { ANA, as, BEN, harness, OTHER_STORE, SCOPE } from './harness.js';

/** The first `count` items a stream yields. */
async function take<T>(iterator: AsyncIterableIterator<T>, count: number): Promise<T[]> {
  const out: T[] = [];
  while (out.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

/** Lets the stream reach its live phase before something is published. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('isPosEventFor', () => {
  const event: PosEvent = { ...SCOPE, change: 'order', orderId: 'order-1', actorId: ANA };

  it('is for a subscriber in the same store', () => {
    expect(isPosEventFor(event, SCOPE)).toBe(true);
  });

  it('⚠ is for nobody in another store, or another organization with the same workspace id', () => {
    expect(isPosEventFor(event, OTHER_STORE)).toBe(false);
    expect(isPosEventFor(event, { organizationId: 'org-2', workspaceId: SCOPE.workspaceId })).toBe(false);
  });
});

describe('posEvents', () => {
  it('sends sync first, then a held order with its id — what the cashier’s pending column re-reads on (#50)', async () => {
    const h = harness();
    const stream = h.resolver.posEvents(as(BEN), SCOPE.organizationId, SCOPE.workspaceId);
    const pending = take(stream, 2);
    await settle();
    const order = await h.writes.create(SCOPE, ANA, 'Table 4');
    const events = await pending;
    await stream.return?.();
    expect(events).toEqual([
      { kind: 'sync', orderId: null, actorId: null },
      { kind: 'order', orderId: order.id, actorId: ANA },
    ]);
  });

  it('tells a till that the references changed — the Sell tab’s reference dialog re-reads on it (#50)', async () => {
    const h = harness();
    const stream = h.resolver.posEvents(as(BEN), SCOPE.organizationId, SCOPE.workspaceId);
    const pending = take(stream, 2);
    await settle();
    await h.settings.saveReferenceOptions(SCOPE, ANA, ['Table 1', 'Table 2'], null);
    const events = await pending;
    await stream.return?.();
    expect(events.map((event) => event.kind)).toEqual(['sync', 'settings']);
  });

  it('⚠ never tells another store, and carries ids — never a label or a name', async () => {
    const h = harness();
    const stream = h.resolver.posEvents(as(BEN), OTHER_STORE.organizationId, OTHER_STORE.workspaceId);
    const pending = take(stream, 2);
    await settle();
    await h.writes.create(SCOPE, ANA, 'Table 4');
    // The one event this subscriber may hear: a change in its own store.
    await h.settings.saveReferenceOptions(OTHER_STORE, BEN, ['Counter'], null);
    const events = await pending;
    await stream.return?.();
    expect(events.map((event) => event.kind)).toEqual(['sync', 'settings']);
    expect(JSON.stringify(events)).not.toContain('Table 4');
  });
});
