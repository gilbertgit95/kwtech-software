/**
 * Catch-up: the reason a chat over `graphql-ws` does not lose mail.
 *
 * ## The gap this closes
 *
 * The socket closes when the authorization that opened it expires — by design,
 * and it is the property that makes subscribing safe at all (see the app's
 * `closeWhenAuthorizationExpires`). So every client reconnects on a timer it
 * does not control, and in the moments between the old socket closing and the
 * new one subscribing it is receiving nothing.
 *
 * The in-memory pub/sub has NO REPLAY. An event published in that gap is not
 * delayed, it is gone. For a plan badge that is a stale screen until the next
 * page load; for a message it is mail that never arrives, and the sender sees
 * it sent. So on every (re)subscribe the server replays what the viewer missed,
 * from the database, before it streams anything live.
 *
 * ## The race, and the ONE ordering that closes it
 *
 * The naive version — query what was missed, then subscribe — has a window
 * exactly as long as the query: anything published while it runs is in neither
 * half. Reversing it is what makes this correct:
 *
 *   1. PULL FIRST. `live.next()` is what makes `graphql-subscriptions`
 *      subscribe (it assigns `allSubscribed` synchronously, then pulls), and
 *      from that instant every publish is queued rather than dropped.
 *   2. Then run the catch-up query, with the subscription already live.
 *   3. Emit the missed items, remembering their keys.
 *   4. Then drain the live stream, SKIPPING anything already emitted — the two
 *      halves necessarily overlap, and a message delivered twice is a message
 *      shown twice.
 *
 * ⚠ Step 1 is not a style choice and cannot be moved. Written as a comment
 * because the code that does it — starting a promise and not awaiting it — is
 * exactly what a later reader would tidy away.
 */

export interface CatchUpOptions<Live, Out> {
  /** The live stream. Pulled before anything else happens. */
  live: AsyncIterableIterator<Live>;
  /**
   * What the viewer missed, newest last, already in the output shape.
   *
   * Run AFTER the subscription is live, so its own results may overlap the
   * stream. That overlap is expected and is what `keyOf` resolves.
   */
  catchUp: () => Promise<readonly Out[]>;
  /**
   * One published event, seen through one viewer's eyes: the output to emit, or
   * `null` for an event that is not theirs.
   *
   * ⚠ THE PER-PUBLISH FILTER LIVES HERE. Every subscriber runs its own copy
   * over the same payload, which is what makes a fan-out engine deliver a
   * private conversation privately.
   */
  transform: (event: Live) => Out | null;
  /**
   * The identity of an emitted item, for the overlap check, or `null` for one
   * that can never repeat and must never be suppressed.
   */
  keyOf: (item: Out) => string | null;
}

/**
 * The merged stream: everything missed, then everything live, each item once.
 *
 * ⚠ The `seen` set holds ONLY the catch-up keys. Live items cannot repeat among
 * themselves — each is published once — so adding them would grow a set for the
 * life of a socket to answer a question nobody asks.
 */
export async function* withCatchUp<Live, Out>(options: CatchUpOptions<Live, Out>): AsyncIterableIterator<Out> {
  const { live, catchUp, transform, keyOf } = options;

  /*
   * ⚠ NOT AWAITED HERE. This call is what subscribes; awaiting it before the
   * catch-up query would block until the first live event, which on a quiet
   * conversation is never.
   */
  const firstPull = live.next();

  try {
    const seen = new Set<string>();
    for (const item of await catchUp()) {
      const key = keyOf(item);
      if (key !== null) seen.add(key);
      yield item;
    }

    let result = await firstPull;
    while (!result.done) {
      const item = transform(result.value);
      if (item !== null) {
        const key = keyOf(item);
        // Already delivered by the catch-up half. The overlap is the price of
        // subscribing first, and it is the right price.
        if (key === null || !seen.has(key)) yield item;
      }
      result = await live.next();
    }
  } finally {
    /*
     * Unsubscribe when the consumer walks away — a closed socket, a client
     * unsubscribing, an error upstream. Without it the engine keeps a handler
     * per dead socket, and the leak is invisible until the process is old.
     *
     * ⚠ Reached by `return()` on THIS generator too, which is how `graphql-ws`
     * ends a subscription.
     */
    await live.return?.();
  }
}
