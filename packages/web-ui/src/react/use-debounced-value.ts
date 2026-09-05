'use client';

import { useEffect, useState } from 'react';

/**
 * A value that lags behind, so typing does not fire a request per keystroke.
 *
 * "features" typed at speed is eight renders and, once the filter reaches the
 * API, eight requests — of which seven are for prefixes nobody wanted. The last
 * one is the answer; the rest are load and, worse, races: responses can arrive
 * out of order and leave the grid showing results for "featur".
 *
 * ## Debounce, not throttle
 *
 * Throttling emits during the burst, which is exactly the useless prefixes.
 * Debouncing emits only after the typing STOPS, which is when the query is
 * worth asking.
 *
 * ## Why the immediate value is still returned by the caller
 *
 * The input stays controlled by the raw value so it never feels laggy — only
 * the QUERY waits. Binding the field itself to the debounced value is the
 * classic version of this bug: characters appear a beat after they are typed.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    /*
     * Cleared on every change, which is what makes it a debounce rather than a
     * delay: each keystroke cancels the pending emit and starts a new one, so
     * only a genuine pause gets through.
     */
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
