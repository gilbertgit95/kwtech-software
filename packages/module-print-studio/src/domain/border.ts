import type { StudioRect } from './layout.js';

/**
 * The lines to draw for the borders of a set of cells.
 *
 * ⚠ EACH EDGE ONCE. Two cells that touch share an edge, and drawing each
 * cell's own rectangle draws that edge twice — which nobody notices with a
 * solid line and everybody notices with a dashed one: the two sets of dashes
 * are out of step, fill each other's gaps, and the "dashed" line between two
 * photos prints solid while the sheet's outer edge prints dashed.
 *
 * So the rectangles are taken apart into their edges, and edges that lie on
 * the same line and touch or overlap are joined into one. A row of seven 1 × 1
 * cells has ONE top line, drawn in one stroke, with one run of dashes.
 */
export interface StudioSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function borderSegments(rects: readonly StudioRect[]): StudioSegment[] {
  /** For each line (a `y` for the horizontals, an `x` for the verticals): the stretches of it that are an edge. */
  const across = new Map<number, [number, number][]>();
  const down = new Map<number, [number, number][]>();
  const add = (lines: Map<number, [number, number][]>, at: number, from: number, to: number) => {
    const spans = lines.get(at);
    if (spans) spans.push([from, to]);
    else lines.set(at, [[from, to]]);
  };
  for (const rect of rects) {
    if (!(rect.width > 0) || !(rect.height > 0)) continue;
    add(across, rect.y, rect.x, rect.x + rect.width);
    add(across, rect.y + rect.height, rect.x, rect.x + rect.width);
    add(down, rect.x, rect.y, rect.y + rect.height);
    add(down, rect.x + rect.width, rect.y, rect.y + rect.height);
  }

  const segments: StudioSegment[] = [];
  // Top to bottom, then left to right: the same order every time, so the same sheet always draws the same way.
  for (const y of [...across.keys()].sort((a, b) => a - b)) {
    for (const [from, to] of joined(across.get(y) ?? [])) segments.push({ x1: from, y1: y, x2: to, y2: y });
  }
  for (const x of [...down.keys()].sort((a, b) => a - b)) {
    for (const [from, to] of joined(down.get(x) ?? [])) segments.push({ x1: x, y1: from, x2: x, y2: to });
  }
  return segments;
}

/** Stretches of one line, with those that touch or overlap joined into one. */
function joined(spans: readonly [number, number][]): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}
