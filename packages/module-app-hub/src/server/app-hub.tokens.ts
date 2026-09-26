/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/**
 * The client. Host-injected; this module opens no connection.
 *
 * ONE client, not a read and a write pair as the queue has: every write here is
 * a single upsert or delete, so there is no `$transaction` to dispatch, and a
 * host pointing reads at a replica would show somebody the layout they had
 * before the one they just saved.
 */
export const APP_HUB_PRISMA = 'kwtech:app-hub-prisma';

export const APP_HUB_OPTIONS = 'kwtech:app-hub-options';
