/**
 * The point of sale's sections on the phone (issue #22), by key — kept in the
 * address (`?section=`), so never renamed. Sell only for now; Items, Reports
 * and the others join here as they come to the phone.
 *
 * In a file of its own, without `'use client'`: the app's server reads these
 * keys through the module's descriptor, and a value from a client module
 * cannot be read on the server.
 */
export const POS_MOBILE_SECTION = { sell: 'sell' } as const;
