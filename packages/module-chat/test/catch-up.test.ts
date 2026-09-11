import { withCatchUp } from '../src/server/chat.catch-up.js';

/**
 * A stand-in for `graphql-subscriptions`' iterator, with the ONE property that
 * makes the ordering in `withCatchUp` load-bearing:
 *
 * ⚠ A PUBLISH BEFORE THE FIRST PULL IS DROPPED. That is not a simplification —
 * it is exactly what the real engine does, because `next()` is what subscribes.
 * A fake that queued early publishes would make the race this file exists to
 * prove impossible to write.
 */
function fakeStream<T>() {
  const pushed: T[] = [];
  const waiting: ((result: IteratorResult<T>) => void)[] = [];
  let subscribed = false;
  let closed = false;

  const finish = () => {
    closed = true;
    for (const resolve of waiting.splice(0)) resolve({ value: undefined, done: true });
  };

  const iterator: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<T>> {
      subscribed = true;
      const ready = pushed.shift();
      if (ready !== undefined) return { value: ready, done: false };
      if (closed) return { value: undefined, done: true };
      return new Promise<IteratorResult<T>>((resolve) => waiting.push(resolve));
    },
    async return(): Promise<IteratorResult<T>> {
      finish();
      return { value: undefined, done: true };
    },
  };

  return {
    iterator,
    get subscribed() {
      return subscribed;
    },
    get closed() {
      return closed;
    },
    /** Returns whether anybody was listening — a dropped event answers false. */
    publish(value: T): boolean {
      if (!subscribed) return false;
      const pull = waiting.shift();
      if (pull) pull({ value, done: false });
      else pushed.push(value);
      return true;
    },
    end: finish,
  };
}

/** Pulls exactly `count` items, then walks away as a closing socket would. */
async function take<T>(stream: AsyncIterableIterator<T>, count: number): Promise<T[]> {
  const out: T[] = [];
  while (out.length < count) {
    const result = await stream.next();
    if (result.done) break;
    out.push(result.value);
  }
  await stream.return?.();
  return out;
}

interface Event {
  for: string;
  id: string;
  change: string;
}

const mine = (event: Event) => (event.for === 'me' ? event : null);
const keyOf = (event: Event) => (event.id ? `${event.change}:${event.id}` : null);

describe('withCatchUp', () => {
  it('emits everything missed before anything live, in the order given', async () => {
    const live = fakeStream<Event>();
    const stream = withCatchUp<Event, Event>({
      live: live.iterator,
      catchUp: async () => [
        { for: 'me', id: 'old-1', change: 'sent' },
        { for: 'me', id: 'old-2', change: 'sent' },
      ],
      transform: mine,
      keyOf,
    });

    const first = stream.next();
    // The subscription is live before the replay has been handed over, which is
    // the whole ordering — see the pull-first note in the implementation.
    await Promise.resolve();
    live.publish({ for: 'me', id: 'new-1', change: 'sent' });

    expect((await first).value).toEqual({ for: 'me', id: 'old-1', change: 'sent' });
    expect((await stream.next()).value).toEqual({ for: 'me', id: 'old-2', change: 'sent' });
    expect((await stream.next()).value).toEqual({ for: 'me', id: 'new-1', change: 'sent' });
    await stream.return?.();
  });

  it('⚠ does not lose an event published WHILE the catch-up query is running', async () => {
    const live = fakeStream<Event>();
    let release: (() => void) | undefined;
    const querying = new Promise<void>((resolve) => {
      release = resolve;
    });

    const stream = withCatchUp<Event, Event>({
      live: live.iterator,
      catchUp: async () => {
        // The window the naive order — query, then subscribe — leaves open.
        await querying;
        return [{ for: 'me', id: 'old-1', change: 'sent' }];
      },
      transform: mine,
      keyOf,
    });

    const pending = take(stream, 2);
    await Promise.resolve();

    // Somebody sends a message mid-query. This is the assertion that matters:
    // the subscription already exists, so the engine has somewhere to put it.
    expect(live.publish({ for: 'me', id: 'during', change: 'sent' })).toBe(true);
    release?.();

    expect(await pending).toEqual([
      { for: 'me', id: 'old-1', change: 'sent' },
      { for: 'me', id: 'during', change: 'sent' },
    ]);
  });

  it('delivers an item in BOTH halves exactly once', async () => {
    const live = fakeStream<Event>();
    const stream = withCatchUp<Event, Event>({
      live: live.iterator,
      catchUp: async () => [
        { for: 'me', id: 'overlap', change: 'sent' },
        { for: 'me', id: 'old-2', change: 'sent' },
      ],
      transform: mine,
      keyOf,
    });

    const pending = take(stream, 3);
    await Promise.resolve();
    // The same message the query is about to return — the overlap subscribing
    // first makes unavoidable.
    live.publish({ for: 'me', id: 'overlap', change: 'sent' });
    live.publish({ for: 'me', id: 'after', change: 'sent' });

    expect(await pending).toEqual([
      { for: 'me', id: 'overlap', change: 'sent' },
      { for: 'me', id: 'old-2', change: 'sent' },
      { for: 'me', id: 'after', change: 'sent' },
    ]);
  });

  it('⚠ still delivers an EDIT of a message the replay already carried', async () => {
    const live = fakeStream<Event>();
    const stream = withCatchUp<Event, Event>({
      live: live.iterator,
      catchUp: async () => [{ for: 'me', id: 'msg-1', change: 'sent' }],
      transform: mine,
      keyOf,
    });

    const pending = take(stream, 2);
    await Promise.resolve();
    live.publish({ for: 'me', id: 'msg-1', change: 'changed' });

    // A key of the id alone would swallow this, and the edit would be invisible
    // until the next reload — the reason `change` is part of the key.
    expect(await pending).toEqual([
      { for: 'me', id: 'msg-1', change: 'sent' },
      { for: 'me', id: 'msg-1', change: 'changed' },
    ]);
  });

  it('drops what the transform says is not this viewer’s', async () => {
    const live = fakeStream<Event>();
    const stream = withCatchUp<Event, Event>({
      live: live.iterator,
      catchUp: async () => [],
      transform: mine,
      keyOf,
    });

    const pending = take(stream, 1);
    await Promise.resolve();
    live.publish({ for: 'somebody-else', id: 'private', change: 'sent' });
    live.publish({ for: 'me', id: 'ours', change: 'sent' });

    expect(await pending).toEqual([{ for: 'me', id: 'ours', change: 'sent' }]);
  });

  it('never suppresses an item with no key — `sync` may repeat forever', async () => {
    const live = fakeStream<Event>();
    const stream = withCatchUp<Event, Event>({
      live: live.iterator,
      catchUp: async () => [{ for: 'me', id: '', change: 'sync' }],
      transform: mine,
      keyOf,
    });

    const pending = take(stream, 2);
    await Promise.resolve();
    live.publish({ for: 'me', id: '', change: 'sync' });

    expect(await pending).toHaveLength(2);
  });

  it('⚠ unsubscribes when the consumer walks away', async () => {
    const live = fakeStream<Event>();
    const stream = withCatchUp<Event, Event>({
      live: live.iterator,
      catchUp: async () => [{ for: 'me', id: 'old-1', change: 'sent' }],
      transform: mine,
      keyOf,
    });

    await stream.next();
    expect(live.closed).toBe(false);

    // What `graphql-ws` does when a socket closes. Without the `finally`, the
    // engine keeps a handler per dead socket and the leak is invisible.
    await stream.return?.();
    expect(live.closed).toBe(true);
  });

  it('ends when the live stream ends', async () => {
    const live = fakeStream<Event>();
    const stream = withCatchUp<Event, Event>({
      live: live.iterator,
      catchUp: async () => [],
      transform: mine,
      keyOf,
    });

    const pending = stream.next();
    await Promise.resolve();
    live.end();

    expect((await pending).done).toBe(true);
  });
});
