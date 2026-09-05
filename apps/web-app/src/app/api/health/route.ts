import { NextResponse } from 'next/server';

/**
 * Can the browser still reach the API?
 *
 * ## Why the browser cannot ask directly
 *
 * `API_URL` is deliberately not `NEXT_PUBLIC_` (see @/config/env): the browser
 * talks to this app's route handlers, never to the API, because that is what
 * keeps the tokens in httpOnly cookies. A client-side probe of the API origin
 * would mean publishing that origin to every visitor — undoing the arrangement
 * for a health check.
 *
 * So the probe goes through here, and that is the better test anyway: it
 * exercises the ACTUAL path every request takes — browser to Next to API —
 * rather than a second path that could be healthy while the real one is not.
 *
 * ## Three answers, not two
 *
 * The upstream `/health` already distinguishes a live API from a live API with
 * a dead database, and that distinction is worth carrying: "we cannot reach the
 * server" and "the server cannot reach its database" send someone to different
 * people. A fetch that rejects outright is the third case and is handled by the
 * caller, which sees no response at all.
 *
 * ## What it does NOT reveal
 *
 * Up or down and nothing else. The upstream URL, its status text and any error
 * it returned stay on this side — an unauthenticated endpoint that echoed a
 * connection error would hand out the API's internal hostname to anyone who
 * asked.
 */

/**
 * Node, and never prerendered. It reads `process.env.API_URL` at REQUEST time —
 * on Edge that value would be inlined at build, so one image could not run
 * against two APIs, and a static render would freeze the first answer forever.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Long enough to ride out a slow hop, short enough that "unreachable" is a
 * usable answer rather than a spinner.
 *
 * Without a timeout at all, a black-holed connection — the case a status bar
 * most needs to report — never resolves and the bar never appears. A hung fetch
 * and a slow one are indistinguishable from here; only the clock separates them.
 */
const PROBE_TIMEOUT_MS = 5_000;

export type HealthState = 'ok' | 'degraded' | 'unreachable';

export async function GET() {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8080/api/v1';

  /*
   * `AbortSignal.timeout` rather than a manual controller and setTimeout: it
   * cannot leak a timer on the success path, which the hand-rolled version does
   * every time someone forgets the `clearTimeout` in the happy branch.
   */
  try {
    const response = await fetch(`${apiUrl}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (!response.ok) return answer('unreachable', 503);

    const body = (await response.json()) as { status?: string; database?: string };
    // The API answered, so it is reachable. Whether it can do anything useful
    // is the second question, and the one 'degraded' exists for.
    return answer(body.database === 'up' ? 'ok' : 'degraded', 200);
  } catch {
    // Refused, DNS failure, timeout. All the same to a reader: nothing is
    // getting through.
    return answer('unreachable', 503);
  }
}

function answer(state: HealthState, status: number) {
  return NextResponse.json(
    { state },
    {
      status,
      // Belt and braces alongside `dynamic`: a proxy caching a 200 here would
      // leave the bar cheerfully green through an outage.
      headers: { 'cache-control': 'no-store, max-age=0' },
    },
  );
}
