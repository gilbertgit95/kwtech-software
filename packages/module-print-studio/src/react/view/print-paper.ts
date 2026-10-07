import {
  checkLayoutOnPaper,
  STUDIO_ORIENTATIONS,
  type StudioLayoutPaper,
  type StudioLayoutSpec,
  type StudioOrientation,
  sizingOf,
} from '../../domain/layout.js';
import { STUDIO_PAPERS } from '../../domain/papers.js';
import { formatSize } from '../../domain/units.js';
import type { StudioUnit } from './lengths.js';
import { plural } from './summary.js';

/**
 * The page one print may go on, for the Print screen's paper and orientation
 * choice.
 *
 * A layout is made on one paper, one way round, and a print of it may go on
 * another paper or be turned. The layout itself is never changed: a `fixed`
 * one keeps its cells exactly, a `percent` one is resized to the page
 * (`layoutOnPage`). A paper the cells cannot go on is still LISTED, marked and
 * not choosable — a paper that silently went missing reads as a paper the
 * studio does not know. An orientation they cannot go in is the same: shown,
 * not pressable, with the reason under it.
 */

/** The option standing for the layout's own paper when that is not one of the built-in ones. */
export const LAYOUT_PAPER_VALUE = 'layout';

export interface StudioPaperOption {
  /** What the `<select>` holds: a built-in paper's key, or `LAYOUT_PAPER_VALUE`. */
  value: string;
  paper: StudioLayoutPaper;
  /** "Long bond / Folio — 8.5 × 13 in", with what makes it special said after it. */
  label: string;
  /** Whether this is the paper the layout was made on. */
  own: boolean;
  /** Whether the layout's cells fit on it, the way the print is turned. An option that does not fit is shown disabled. */
  fits: boolean;
}

export interface StudioOrientationOption {
  value: StudioOrientation;
  label: string;
  /** Whether this is the way round the layout was made. */
  own: boolean;
  /** Whether the layout's cells fit on the print's paper turned this way. */
  fits: boolean;
}

/** The page one print goes on, and what else it could be asked to go on. */
export interface StudioPrintPage {
  paper: StudioLayoutPaper;
  orientation: StudioOrientation;
  /** The `<select>`'s value for `paper`. */
  paperValue: string;
  /** Every paper, checked the way the print is turned now. */
  paperOptions: StudioPaperOption[];
  /** Both ways round, checked on the print's paper. */
  orientationOptions: StudioOrientationOption[];
  /** Whether the print is on another page than the layout was made on. */
  changed: boolean;
}

/**
 * Every paper a print of this layout could be asked to go on: the built-in
 * ones, and before them the layout's own when it is a typed size (or a
 * built-in one whose size has since been corrected — the layout keeps the size
 * it was made on).
 *
 * `orientation` is the way THIS PRINT is turned, the layout's own unless
 * another was chosen: a paper is checked the way it will go through.
 *
 * ⚠ THE LAYOUT'S OWN PAPER IS ALWAYS THERE, AND THE LAYOUT'S OWN WAY ROUND IT
 * ALWAYS FITS, so there is always something to choose and "back to how it
 * was" is never out of reach.
 */
export function printPaperOptions(
  spec: StudioLayoutSpec,
  unit: StudioUnit,
  orientation: StudioOrientation = spec.orientation,
): StudioPaperOption[] {
  const fitsOn = (paper: StudioLayoutPaper, own: boolean): boolean =>
    (own && orientation === spec.orientation) || checkLayoutOnPaper(spec, paper, orientation) === null;
  const builtIn = STUDIO_PAPERS.map((paper): StudioPaperOption => {
    const own = paper.key === spec.paper.key && paper.width === spec.paper.width && paper.height === spec.paper.height;
    const fits = fitsOn(paper, own);
    const name = paper.alias ? `${paper.label} / ${paper.alias}` : paper.label;
    return {
      value: paper.key,
      paper: { key: paper.key, label: paper.label, width: paper.width, height: paper.height },
      label: optionLabel(`${name} — ${formatSize(paper.width, paper.height, paper.unit)}`, own, fits),
      own,
      fits,
    };
  });
  if (builtIn.some((option) => option.own)) return builtIn;
  const size = formatSize(spec.paper.width, spec.paper.height, unit);
  const name = spec.paper.label ? `${spec.paper.label} — ${size}` : size;
  const fits = fitsOn(spec.paper, true);
  return [
    { value: LAYOUT_PAPER_VALUE, paper: spec.paper, label: optionLabel(name, true, fits), own: true, fits },
    ...builtIn,
  ];
}

const ORIENTATION_LABELS: Record<StudioOrientation, string> = { portrait: 'Portrait', landscape: 'Landscape' };

/**
 * Both ways round, for a print on this paper. The way the cells do not fit is
 * still an option, not pressable: turning a full sheet of fixed cells would
 * hang them over the edge, and the person is told that instead of finding a
 * control missing.
 */
export function printOrientationOptions(spec: StudioLayoutSpec, paper: StudioLayoutPaper): StudioOrientationOption[] {
  const ownPaper = paper.width === spec.paper.width && paper.height === spec.paper.height;
  return STUDIO_ORIENTATIONS.map((value): StudioOrientationOption => {
    const own = value === spec.orientation;
    return {
      value,
      label: ORIENTATION_LABELS[value],
      own,
      fits: (own && ownPaper) || checkLayoutOnPaper(spec, paper, value) === null,
    };
  });
}

/**
 * The page a print goes on, from what was picked: a paper's option value and
 * a way round, either of them null for "as the layout says".
 *
 * ⚠ NEVER A PAGE THE CELLS HANG OFF. A pick that does not fit (the screens do
 * not offer one, so this is a stale pick) falls back to the layout's own paper
 * turned the same way, and failing that to the layout's own page, which always
 * fits.
 */
export function printPage(
  spec: StudioLayoutSpec,
  unit: StudioUnit,
  paperValue: string | null,
  orientation: StudioOrientation | null,
): StudioPrintPage {
  const turned = orientation ?? spec.orientation;
  const paperOptions = printPaperOptions(spec, unit, turned);
  const chosen =
    paperOptions.find((option) => option.value === paperValue && option.fits) ??
    paperOptions.find((option) => option.own && option.fits);
  if (!chosen) {
    if (turned !== spec.orientation) return printPage(spec, unit, null, null);
    // Unreachable: the layout's own paper, its own way round, always fits. Said rather than assumed.
    throw new Error('A layout does not fit on its own page.');
  }
  return {
    paper: chosen.paper,
    orientation: turned,
    paperValue: chosen.value,
    paperOptions,
    orientationOptions: printOrientationOptions(spec, chosen.paper),
    changed: !chosen.own || turned !== spec.orientation,
  };
}

/** Why the sheet cannot be turned, said under the choice, or null when it can be turned either way. */
export function cannotTurnNote(options: readonly StudioOrientationOption[]): string | null {
  const blocked = options.find((option) => !option.fits);
  if (!blocked) return null;
  return `This layout’s cells do not fit on this paper turned ${blocked.value}.`;
}

/** The warning under the paper choice, or null when every paper can be chosen. */
export function tooSmallPapersWarning(options: readonly StudioPaperOption[]): string | null {
  const count = options.filter((option) => !option.fits).length;
  if (count === 0) return null;
  const which = count === 1 ? '1 paper is' : `${plural(count, 'paper')} are`;
  return `${which} too small for this layout’s cells and cannot be chosen.`;
}

/**
 * What choosing another paper, or turning it, does to this layout, said under
 * the choice once the print IS on another page: the two kinds of layout answer differently, and a
 * person should not have to find out on paper which kind they have.
 */
export function otherPaperNote(spec: Pick<StudioLayoutSpec, 'sizing'>): string {
  if (sizingOf(spec) === 'percent') {
    return 'This layout is measured in percent: its cells are resized to fill this page the same way. The layout itself is not changed.';
  }
  return 'The cells stay where the layout put them and keep their sizes. The layout itself is not changed.';
}

function optionLabel(name: string, own: boolean, fits: boolean): string {
  const named = own ? `${name} (the layout’s)` : name;
  return fits ? named : `${named} — too small`;
}
