/**
 * Where chat's own pages live. One constant, so the route and every link to it
 * agree.
 *
 * ## ⚠ Why this is its own file rather than a line in `module.tsx`
 *
 * It was one, and `chat-page.tsx` needed it to link to the preferences page —
 * which would have made a CYCLE: `module.tsx` imports the page, the page
 * imports `module.tsx` back. ESM survives that in the simple case, and this is
 * not the simple case: the pages are `'use client'`, so across that boundary
 * the module is replaced by a client-reference proxy and the order things
 * initialise in stops being something you can reason about.
 *
 * A constant no page-level module imports FROM has no such problem, so the
 * constant moved rather than the pages growing hardcoded paths.
 *
 * `module.tsx` re-exports it, so the public entry point is unchanged.
 */
export const CHAT_HREF = '/chat';

/** Chat's own preferences — per device, per browser. See `ChatPreferencesPage`. */
export const CHAT_PREFERENCES_HREF = `${CHAT_HREF}/preferences`;
