'use client';

/**
 * The documents this module subscribes to — and nothing else any more.
 *
 * ## What used to be here, and where it went
 *
 * The connection shapes, the ticket path and `createRealtimeConnection` all
 * started in this package, which was correct while exactly one module
 * subscribed to anything. They now live in `@kwtech/module-kit` — the contract
 * at the root, the factory behind `@kwtech/module-kit/realtime` — because a
 * socket is a resource of the APPLICATION and the second subscribing module
 * would otherwise open a second one. See that file; the reasoning is written
 * out there rather than summarised twice.
 *
 * The types are re-exported below so nothing downstream had to change its
 * imports, and because a page taking a `RealtimeConnection` prop should be able
 * to name it from the barrel it already uses.
 *
 * ## Why a document is a string in a file of its own
 *
 * Because that is all it is, and it must stay cheap to name. A page that says
 * which events it cares about — `plans-page.tsx` does — must not resolve a
 * WebSocket client to do it. That exact mistake was made here once: this file
 * held the documents AND imported the connection, so importing a string pulled
 * `graphql-ws` into every consumer of the `/react` barrel.
 *
 * Not in `operations.graphql` either: that file is for the app's CODEGEN, and
 * these are sent as strings by the hand-rolled client — the same arrangement
 * the queries in `permissions-client.ts` already use.
 */

export {
  DEFAULT_WS_TICKET_PATH,
  type RealtimeConnection,
  type RealtimeOptions,
} from '@kwtech/module-kit';

/**
 * A plan definition moved. ⚠ A HINT, not data: the payload carries the key and
 * the page re-reads through the guarded query, which is what keeps one
 * authorization path rather than a second one on the socket.
 */
export const PLAN_CHANGED = `subscription PlanChanged { planChanged { planKey } }`;
