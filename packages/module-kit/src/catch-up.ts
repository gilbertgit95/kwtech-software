/**
 * Catch-up: the reason a stream over `graphql-ws` does not lose events.
 *
 * ## Why it lives in module-kit
 *
 * It was `module-chat`'s, written for mail that must not go missing. The queue
 * needs the same ordering for its staff console, and a module may not import a
 * module (PLAN §9) — so the second consumer is what moves it here (§9 rule 8).
 * It is a plain async generator, framework-free, like everything at this root.
 *
 * ## The gap this closes
 *
 * A socket closes when the authorization that opened it expires — by design —
 * so every client reconnects on a timer it does not control, and between the
 * old socket closing and the new one subscribing it receives nothing. The
 * in-memory pub/sub has NO REPLAY: an event published in that gap is gone. So
 * on every (re)subscribe the server replays what the viewer missed before it
 * streams anything live.
 *
 * ## The race, and the ONE ordering that closes it
 *
 * The naive version — query what was missed, then subscribe — has a window
 * exactly as long as the query. Reversing it is what makes this correct:
 *
 *   1. PULL FIRST. `live.next()` is what makes `graphql-subscriptions`
 *      subscribe, and from that instant every publish is queued, not dropped.
 *   2. Then run the catch-up query, with the subscription already live.
 *   3. Emit the missed items, remembering their keys.
 *   4. Then drain the live stream, SKIPPING anything already emitted.
 *
 * ⚠ Step 1 is not a style choice and cannot be moved. The code that does it —
 * starting a promise and not awaiting it — is exactly what a later reader would
 * tidy away.
 */

export interface CatchUpOptions<Live, Out> {
  /** The live stream. Pulled before anything else happens. */
  live: AsyncIterableIterator<Live>;
  /**
   * What the viewer missed, newest last, already in the output shape. Run AFTER
   * the subscription is live, so it may overlap the stream; `keyOf` resolves that.
   */
  catchUp: () => Promise<readonly Out[]>;
  /**
   * One published event, seen through one viewer's eyes: the output to emit, or
   * `null` for an event that is not theirs.
   *
   * ⚠ THE PER-PUBLISH FILTER LIVES HERE. Every subscriber runs its own copy over
   * the same payload.
   */
  transform: (event: Live) => Out | null;
  /** The identity of an emitted item, for the overlap check, or `null` for one that must never be suppressed. */
  keyOf: (item: Out) => string | null;
}

/**
 * The merged stream: everything missed, then everything live, each item once.
 *
 * ⚠ The `seen` set holds ONLY the catch-up keys. Live items cannot repeat among
 * themselves, so adding them would grow a set for the life of a socket.
 */
export async function* withCatchUp<Live, Out>(options: CatchUpOptions<Live, Out>): AsyncIterableIterator<Out> {
  const { live, catchUp, transform, keyOf } = options;

  /*
   * ⚠ NOT AWAITED HERE. This call is what subscribes; awaiting it before the
   * catch-up query would block until the first live event, which on a quiet
   * stream is never.
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
        if (key === null || !seen.has(key)) yield item;
      }
      result = await live.next();
    }
  } finally {
    /*
     * Unsubscribe when the consumer walks away — a closed socket, a client
     * unsubscribing, an error upstream. Without it the engine keeps a handler per
     * dead socket. ⚠ Reached by `return()` on THIS generator too, which is how
     * `graphql-ws` ends a subscription.
     */
    await live.return?.();
  }
}
