'use client';

import { useEffect, useState } from 'react';

/** How often waiting times are worked out again. They are shown to the minute, so twice a minute is enough. */
const NOW_TICK_MS = 30_000;

/**
 * The time now, again every half minute: what makes "12 min" become "13 min"
 * on a screen nobody touches (issue #23, the Cashier's column). Without it a
 * waiting time only moved when something else redrew the screen.
 *
 * Null until mounted, as the queue display's `useNow`: the server's clock is
 * not the browser's, and a time rendered on one and hydrated on the other
 * would not match. Copied, not imported — modules never import each other.
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
