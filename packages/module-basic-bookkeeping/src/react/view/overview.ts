import { BOOKS_PLACES } from '../../domain/entries.js';
import type { BooksPlace } from '../../types.js';
import type { BooksOverviewView } from '../books-client.js';
import { formatDay, PLACE_LABEL } from './labels.js';

/**
 * What the overview warns about, worked out from the overview's own figures.
 * Pure, so each warning is pinned by a test and none depends on how the page
 * happens to be laid out.
 */

export interface BooksNotice {
  key: string;
  tone: 'warning' | 'info';
  text: string;
  /** The button that fixes it, when there is one. */
  action?: 'pos' | 'settings';
}

/**
 * The overview's notices, most pressing first:
 *
 * - a NEGATIVE place: more went out than the books say came in — something
 *   (usually today's sales) is not recorded yet;
 * - point-of-sale days NOT YET BROUGHT IN, through yesterday — profit and cash
 *   on hand are short by them;
 * - a POS present but never connected: sales are being recorded by hand;
 * - a read past its limit: the figures are a lower bound.
 */
export function overviewNotices(overview: BooksOverviewView): BooksNotice[] {
  const notices: BooksNotice[] = [];
  for (const place of BOOKS_PLACES) {
    if (overview.money[place] >= 0) continue;
    notices.push({
      key: `negative-${place}`,
      tone: 'warning',
      text: `${PLACE_LABEL[place as BooksPlace]} is below zero: more went out than the books say came in. Record the missing money in, or count it and adjust.`,
    });
  }
  const pos = overview.pos;
  if (pos.connected && pos.nextFromDay !== null && pos.nextFromDay < overview.today) {
    notices.push({
      key: 'pos-behind',
      tone: 'warning',
      text: `Point-of-sale sales from ${formatDay(pos.nextFromDay)} are not in the books yet, so cash on hand and profit are short.`,
      action: 'pos',
    });
  }
  if (pos.available && !pos.connected) {
    notices.push({
      key: 'pos-off',
      tone: 'info',
      text: 'Sales are recorded by hand. To bring them in from the point of sale instead, choose a first day in Settings.',
      action: 'settings',
    });
  }
  if (overview.truncated) {
    notices.push({
      key: 'truncated',
      tone: 'warning',
      text: 'These books have more entries than one page adds up: the figures shown are lower than the real ones.',
    });
  }
  return notices;
}

/** The months worth showing: from the first with anything in it, so a new business is not twelve rows of ₱0. */
export function activeMonths(months: BooksOverviewView['months']): BooksOverviewView['months'] {
  const first = months.findIndex(
    (month) => month.sales !== 0 || month.refunds !== 0 || month.expenses !== 0 || month.purchases !== 0,
  );
  return first === -1 ? [] : months.slice(first);
}
