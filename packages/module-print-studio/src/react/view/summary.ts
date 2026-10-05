import { type StudioCell, type StudioLayoutSpec, sheetSize } from '../../domain/layout.js';
import { findStudioPaper } from '../../domain/papers.js';
import { STUDIO_CELL_SIZES } from '../../domain/sizes.js';
import { formatSize } from '../../domain/units.js';
import type { StudioUnit } from './lengths.js';

/**
 * What a layout is, in a line — for the list, the picker and the log.
 */

export interface StudioCellGroup {
  /** "2 × 2 in", or a built-in size's name with its dimensions. */
  label: string;
  count: number;
}

/**
 * The cells grouped by size, largest first: "2 of 2 × 2 in, 9 of 1 × 1 in".
 *
 * A cell turned on its side is the same size as one upright — a passport photo
 * placed sideways is still a passport photo — so sizes are compared short side
 * by long side.
 */
export function cellGroups(cells: readonly StudioCell[], unit: StudioUnit): StudioCellGroup[] {
  const groups = new Map<string, { short: number; long: number; count: number }>();
  for (const cell of cells) {
    const short = Math.min(cell.width, cell.height);
    const long = Math.max(cell.width, cell.height);
    const key = `${short}x${long}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { short, long, count: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => b.short * b.long - a.short * a.long)
    .map((group) => ({ label: sizeName(group.short, group.long, unit), count: group.count }));
}

/** A size by its built-in name when it has one ("Passport"), else by its dimensions. */
export function sizeName(short: number, long: number, unit: StudioUnit): string {
  const known = STUDIO_CELL_SIZES.find(
    (size) => Math.min(size.width, size.height) === short && Math.max(size.width, size.height) === long,
  );
  if (!known) return formatSize(short, long, unit);
  // "1 × 1" and "2 × 2" are already their own dimensions; a name gets them added.
  return /\d/u.test(known.label) && !known.key.startsWith('paper:') ? `${known.label} in` : known.label;
}

/** The paper as people call it, with "landscape" said when it is. */
export function paperName(spec: Pick<StudioLayoutSpec, 'paper' | 'orientation'>, unit: StudioUnit): string {
  const known = findStudioPaper(spec.paper.key);
  const sheet = sheetSize(spec);
  const name = known?.label ?? spec.paper.label;
  const base = name || formatSize(sheet.width, sheet.height, known?.unit ?? unit);
  return spec.orientation === 'landscape' ? `${base}, landscape` : base;
}

/** "4R · 2 of 2 × 2 in, 9 of 1 × 1 in" — or "no cells yet". */
export function layoutSummary(spec: StudioLayoutSpec, unit: StudioUnit): string {
  const groups = cellGroups(spec.cells, unit);
  const cells =
    groups.length === 0 ? 'no cells yet' : groups.map((group) => `${group.count} of ${group.label}`).join(', ');
  return `${paperName(spec, unit)} · ${cells}`;
}

/** How a person's count reads: "1 page", "3 pages". */
export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
