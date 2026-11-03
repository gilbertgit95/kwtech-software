import { STUDIO_PANELS, studioPanelRules } from '../src/react/view/panel-width.js';

describe('the side panels’ widths', () => {
  const right = studioPanelRules({ min: 240, default: 288, max: 480 }, 'right');
  const left = studioPanelRules({ min: 240, default: 288, max: 480 }, 'left');

  it('widens a right edge dragged right, and a left edge dragged left', () => {
    expect(right.afterDrag(288, 100, 150)).toBe(338);
    expect(left.afterDrag(288, 100, 50)).toBe(338);
    expect(left.afterDrag(288, 100, 150)).toBe(240);
  });

  it('keeps every width inside its bounds, in whole pixels', () => {
    expect(right.afterDrag(288, 0, 10_000)).toBe(480);
    expect(right.afterDrag(288, 0, -10_000)).toBe(240);
    expect(right.clamp(300.6)).toBe(301);
  });

  it('moves with the arrow keys the way they point, and Home and End go to the bounds', () => {
    expect(right.afterKey(288, 'ArrowRight', false)).toBe(304);
    expect(left.afterKey(288, 'ArrowRight', false)).toBe(272);
    expect(right.afterKey(288, 'ArrowLeft', true)).toBe(240);
    expect([right.afterKey(288, 'Home', false), right.afterKey(288, 'End', false)]).toEqual([240, 480]);
    expect(right.afterKey(288, 'Enter', false)).toBeNull();
  });

  it('starts every panel at the 18rem it had before it could be resized', () => {
    for (const rules of Object.values(STUDIO_PANELS)) expect(rules.bounds.default).toBe(288);
    expect([STUDIO_PANELS.editor_inspector.edge, STUDIO_PANELS.editor_palette.edge]).toEqual(['left', 'right']);
  });
});
