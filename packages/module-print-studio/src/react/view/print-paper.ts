import { checkLayoutOnPaper, type StudioLayoutPaper, type StudioLayoutSpec, sizingOf } from '../../domain/layout.js';
import { STUDIO_PAPERS } from '../../domain/papers.js';
import { formatSize } from '../../domain/units.js';
import type { StudioUnit } from './lengths.js';
import { plural } from './summary.js';

/**
 * The papers one print may go on, for the Print screen's paper choice.
 *
 * A layout is made on one paper, and a print of it may go on another. The
 * layout itself is never changed: a `fixed` one keeps its cells exactly, a
 * `percent` one is resized to the paper (`layoutOnPage`). A paper the cells
 * cannot go on is still LISTED, marked and not choosable — a paper that
 * silently went missing reads as a paper the studio does not know.
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
  /** Whether the layout's cells fit on it. An option that does not fit is shown disabled. */
  fits: boolean;
}

/**
 * Every paper a print of this layout could be asked to go on: the built-in
 * ones, and before them the layout's own when it is a typed size (or a
 * built-in one whose size has since been corrected — the layout keeps the size
 * it was made on).
 *
 * ⚠ THE LAYOUT'S OWN PAPER ALWAYS FITS AND IS ALWAYS THERE, so there is always
 * something to choose and "back to how it was" is one pick away.
 */
export function printPaperOptions(spec: StudioLayoutSpec, unit: StudioUnit): StudioPaperOption[] {
  const builtIn = STUDIO_PAPERS.map((paper): StudioPaperOption => {
    const own = paper.key === spec.paper.key && paper.width === spec.paper.width && paper.height === spec.paper.height;
    const fits = own || checkLayoutOnPaper(spec, paper) === null;
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
  return [
    { value: LAYOUT_PAPER_VALUE, paper: spec.paper, label: optionLabel(name, true, true), own: true, fits: true },
    ...builtIn,
  ];
}

/** The warning under the paper choice, or null when every paper can be chosen. */
export function tooSmallPapersWarning(options: readonly StudioPaperOption[]): string | null {
  const count = options.filter((option) => !option.fits).length;
  if (count === 0) return null;
  const which = count === 1 ? '1 paper is' : `${plural(count, 'paper')} are`;
  return `${which} too small for this layout’s cells and cannot be chosen.`;
}

/**
 * What choosing another paper does to this layout, said under the choice once
 * another paper IS chosen: the two kinds of layout answer differently, and a
 * person should not have to find out on paper which kind they have.
 */
export function otherPaperNote(spec: Pick<StudioLayoutSpec, 'sizing'>): string {
  if (sizingOf(spec) === 'percent') {
    return 'This layout is measured in percent: its cells are resized to fill this paper the same way. The layout itself is not changed.';
  }
  return 'The cells stay where the layout put them and keep their sizes. The layout itself is not changed.';
}

function optionLabel(name: string, own: boolean, fits: boolean): string {
  if (own) return `${name} (the layout’s)`;
  return fits ? name : `${name} — too small`;
}
