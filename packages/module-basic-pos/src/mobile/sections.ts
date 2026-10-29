/**
 * The point of sale's sections on the phone (issue #22), by key. Sell only for
 * now — Take orders since issue #23 — and Items, Reports and the others join
 * here as they come to the phone.
 *
 * ⚠ NEVER RENAME A KEY. It is kept in the address (`?section=sell`), in
 * bookmarks and on home screens; a renamed key opens nothing. `sell` stayed
 * `sell` when its screen became Take orders for exactly that reason.
 *
 * In a file of its own, without `'use client'`: the app's server reads these
 * keys through the module's descriptor, and a value from a client module
 * cannot be read on the server.
 */
export const POS_MOBILE_SECTION = { sell: 'sell' } as const;
