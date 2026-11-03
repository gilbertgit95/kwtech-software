/**
 * The widths of the print studio's resizable side panels, each dragged by one
 * edge (the operator, 2026-11-03): the Print screen's settings column, and the
 * layout editor's palette and inspector.
 *
 * `module-basic-pos`'s `view/order-panel.ts`, copied structurally: a module
 * never imports another. ⚠ UNLIKE THE POINT OF SALE, NOTHING IS STORED. The
 * studio writes nothing to browser storage (`test/web-module.test.ts`), so a
 * width lasts while the studio is open (`use-panel-widths.tsx`) and a reload
 * starts from the default.
 */

/** A panel's bounds and default, in pixels. */
export interface StudioPanelBounds {
  min: number;
  default: number;
  max: number;
}

/** Which edge the handle is: dragging TOWARD the panel's outside widens it. */
export type StudioPanelEdge = 'left' | 'right';

export interface StudioPanelRules {
  bounds: StudioPanelBounds;
  edge: StudioPanelEdge;
  clamp(width: number): number;
  /** The width a drag from `fromX` to `toX` gives. */
  afterDrag(start: number, fromX: number, toX: number): number;
  /**
   * The width a key on the focused handle gives, or null when the key is not
   * the handle's. ← and → move the edge the way they point, Shift for bigger
   * steps; Home and End go to the bounds (the ARIA window splitter).
   */
  afterKey(width: number, key: string, shift: boolean): number | null;
}

export function studioPanelRules(bounds: StudioPanelBounds, edge: StudioPanelEdge): StudioPanelRules {
  const clamp = (width: number) => Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
  // ⚠ A LEFT edge widens as the pointer moves left — the opposite of a right edge.
  const outward = edge === 'left' ? -1 : 1;
  return {
    bounds,
    edge,
    clamp,
    afterDrag(start, fromX, toX) {
      return clamp(start + outward * (toX - fromX));
    },
    afterKey(width, key, shift) {
      const step = shift ? 64 : 16;
      switch (key) {
        case 'ArrowLeft':
          return clamp(width - outward * step);
        case 'ArrowRight':
          return clamp(width + outward * step);
        case 'Home':
          return bounds.min;
        case 'End':
          return bounds.max;
        default:
          return null;
      }
    },
  };
}

/** The panels, by name: what `usePanelWidth` keys each width by. */
export type StudioPanelKey = 'print_settings' | 'editor_palette' | 'editor_inspector';

/**
 * Each panel's rules. The defaults are the 18rem every one of them had before
 * it could be resized. The most is wide enough for long names and the text
 * panel's fields, and leaves the sheet most of a laptop's width.
 */
export const STUDIO_PANELS: Readonly<Record<StudioPanelKey, StudioPanelRules>> = {
  print_settings: studioPanelRules({ min: 240, default: 288, max: 520 }, 'right'),
  editor_palette: studioPanelRules({ min: 240, default: 288, max: 480 }, 'right'),
  editor_inspector: studioPanelRules({ min: 240, default: 288, max: 480 }, 'left'),
};
