/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const BOOKS_PRISMA = 'kwtech:books-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because a host may point reads at a replica, and a service that took one
 * client would silently write to it.
 */
export const BOOKS_PRISMA_WRITE = 'kwtech:books-prisma-write';

export const BOOKS_OPTIONS = 'kwtech:books-options';

/**
 * A `BooksAccessCheck`. ⚠ Unbound means NOBODY holds any key beyond what the
 * guard already checked: voiding an investor's entry is refused to everybody,
 * because the void runs under `books:record` and an investor's money needs
 * `books:manage_investors` too. Fail closed.
 */
export const BOOKS_ACCESS_CHECK = 'kwtech:books-access-check';

/** A `BooksMemberDirectory`. Unbound means nobody has a name: the ledger says "a team member". */
export const BOOKS_MEMBER_DIRECTORY = 'kwtech:books-member-directory';

/** A `BooksWorkspaceTimeZone`. Unbound means every workspace runs on `DEFAULT_TIME_ZONE` (Asia/Manila). */
export const BOOKS_WORKSPACE_TIME_ZONE = 'kwtech:books-workspace-time-zone';

/**
 * A `BooksSalesSource`: the point of sale's takings. ⚠ Unbound means THERE IS
 * NO POINT OF SALE: sales are entered by hand, the overview says so, and
 * bringing sales in is refused (`pos_not_connected`) — never an empty import
 * that would close the days with ₱0 of sales in them.
 */
export const BOOKS_SALES_SOURCE = 'kwtech:books-sales-source';

/**
 * The pub/sub engine. Unbound means NOT LIVE: every write still works, and an
 * open screen only sees somebody else's entry when it reads again.
 *
 * ⚠ Bind the app's OWN engine, never a fresh one: two engines in one process do
 * not see each other's publishes.
 */
export const BOOKS_PUBSUB = 'kwtech:books-pubsub';
