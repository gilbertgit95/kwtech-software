/**
 * `@kwtech/module-permissions/react/realtime` — the WebSocket half.
 *
 * A SEPARATE entry point, for the same reason `/server` and `/next` are: this
 * is the only code in the package that imports `graphql-ws`, and that peer is
 * optional. Importing the `/react` barrel resolves nothing from here, so an app
 * that never subscribes installs no WebSocket client.
 *
 * The contract — the option and connection shapes, the ticket path, the
 * subscription documents — is re-exported here for convenience and also lives
 * on the main `/react` entry, where a page can use it without this dependency.
 */
export { createRealtimeConnection } from './permissions-realtime.js';
export {
  DEFAULT_WS_TICKET_PATH,
  PLAN_CHANGED,
  type RealtimeConnection,
  type RealtimeOptions,
} from './realtime-contract.js';
