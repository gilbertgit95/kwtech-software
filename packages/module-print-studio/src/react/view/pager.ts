/**
 * The page buttons under the sheet, as data: which page numbers to show and
 * where a gap ("…") stands for the ones left out.
 *
 * ⚠ AT MOST `STUDIO_PAGER_SLOTS` ITEMS, however many pages. A button per page
 * was fine for three and a wrapped wall of buttons at thirty (the operator,
 * 2026-10-06). The first and last pages are always there, so either end is
 * one press away, and the current page keeps a neighbour on each side.
 */

/** A page number (0-based), or a gap standing for the pages between its neighbours. */
export type StudioPagerItem = { kind: 'page'; index: number } | { kind: 'gap'; key: 'start' | 'end' };

/** How many items the pager shows at most: first, last, current, a neighbour each side, and two gaps. */
export const STUDIO_PAGER_SLOTS = 7;

export function pagerItems(count: number, current: number): StudioPagerItem[] {
  const total = Math.max(Math.trunc(count), 0);
  const page = (index: number): StudioPagerItem => ({ kind: 'page', index });
  if (total <= STUDIO_PAGER_SLOTS) return Array.from({ length: total }, (_unused, index) => page(index));

  const last = total - 1;
  const at = Math.min(Math.max(Math.trunc(current), 0), last);
  // Near an end, the window runs out to it with no gap on that side: "1 2 3 4 5 … 20", not "1 … 3 4 5 … 20".
  const inner = STUDIO_PAGER_SLOTS - 2;
  if (at <= inner - 2) {
    return [...Array.from({ length: inner }, (_unused, index) => page(index)), { kind: 'gap', key: 'end' }, page(last)];
  }
  if (at >= last - (inner - 2)) {
    const from = last - inner + 1;
    return [
      page(0),
      { kind: 'gap', key: 'start' },
      ...Array.from({ length: inner }, (_unused, index) => page(from + index)),
    ];
  }
  return [
    page(0),
    { kind: 'gap', key: 'start' },
    page(at - 1),
    page(at),
    page(at + 1),
    { kind: 'gap', key: 'end' },
    page(last),
  ];
}
