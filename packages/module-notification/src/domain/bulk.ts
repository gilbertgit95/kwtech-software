import { NOTIFICATION_PAGE_MAX } from './ordering.js';

/**
 * Bulk marks and archives take a LIST of ids, and an unbounded list is a query
 * anybody can send — the reason `permissions.service.ts` caps its own.
 *
 * ⚠ The same number as the largest page, so "select all on this page" is
 * always exactly one call and the cap is never something a person meets.
 */
export const NOTIFICATION_BULK_MAX = NOTIFICATION_PAGE_MAX;

/** The ids to act on, de-duplicated, or null when there are too many. */
export function prepareBulkIds(ids: readonly string[]): string[] | null {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  return unique.length > NOTIFICATION_BULK_MAX ? null : unique;
}
