/**
 * Next calls `register()` once per server process, before it handles a
 * request — which is the only place a configuration mistake can be turned into
 * a failed boot rather than a broken page.
 */
export async function register() {
  // Node runtime only: the edge runtime gets its own copy of this module with
  // a different (much smaller) environment, and asserting there would fail on
  // variables that are legitimately absent.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertEnv } = await import('@/config/env');
  assertEnv();
}
