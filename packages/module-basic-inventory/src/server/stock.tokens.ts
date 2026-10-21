/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const STOCK_PRISMA = 'kwtech:stock-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because a host may point reads at a replica, and a service that took one
 * client would silently write to it.
 */
export const STOCK_PRISMA_WRITE = 'kwtech:stock-prisma-write';

export const STOCK_OPTIONS = 'kwtech:stock-options';

/**
 * A `LimitChecker` for `stock:items`. ⚠ Unbound means the DECLARED DEFAULT (1000)
 * applies, never module-kit's `NULL_LIMIT_CHECKER` (which allows everything):
 * an unset cap is a floor, never unlimited.
 */
export const STOCK_LIMIT_CHECKER = 'kwtech:stock-limit-checker';

/** A `StockMemberDirectory`. Unbound means nobody has a name: the history says "a team member". */
export const STOCK_MEMBER_DIRECTORY = 'kwtech:stock-member-directory';

/**
 * A `StockSourceCatalogue`: the point of sale's items. ⚠ Unbound means THERE IS
 * NO POINT OF SALE: no list can be hung on a product, and "Create from POS
 * products" is refused (`no_source`). Stock items can still be received,
 * adjusted, wasted and counted by hand.
 */
export const STOCK_SOURCE_CATALOGUE = 'kwtech:stock-source-catalogue';

/**
 * A `StockSaleFeed`: the point of sale's finalised, voided and refunded lines
 * since a time, for the catch-up process. ⚠ Unbound means NOTHING IS CAUGHT UP:
 * a sale whose push was lost (the server stopped between the POS's commit and
 * the call) never takes its stock, and the next stock take finds it.
 */
export const STOCK_SALE_FEED = 'kwtech:stock-sale-feed';

/**
 * A `StockChangeListener`, told after every commit that moved stock, so the
 * till's "3 left" can refresh. Unbound means the till learns of a new count only
 * when it reads again.
 */
export const STOCK_CHANGE_LISTENER = 'kwtech:stock-change-listener';

/**
 * The pub/sub engine. Unbound means NOT LIVE: every write still works, and an
 * open screen only sees somebody else's delivery when it reads again.
 *
 * ⚠ Bind the app's OWN engine, never a fresh one: two engines in one process do
 * not see each other's publishes.
 */
export const STOCK_PUBSUB = 'kwtech:stock-pubsub';
