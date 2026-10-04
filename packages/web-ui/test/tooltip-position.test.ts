import { TOOLTIP_GAP_PX, tooltipPosition } from '../src/react/tooltip-position.js';

/** Where a hint goes for a trigger, in viewport coordinates. */
describe('tooltipPosition', () => {
  // A 40 × 20 trigger whose top-left corner is at (100, 200).
  const anchor = { left: 100, top: 200, width: 40, height: 20 };

  it('opens below, centred on the trigger', () => {
    expect(tooltipPosition(anchor, 'bottom', 'center')).toEqual({
      left: 120,
      top: 220 + TOOLTIP_GAP_PX,
      translate: '-50% 0',
    });
  });

  it('opens above by hanging its own bottom edge off the point', () => {
    expect(tooltipPosition(anchor, 'top', 'center')).toEqual({
      left: 120,
      top: 200 - TOOLTIP_GAP_PX,
      translate: '-50% -100%',
    });
  });

  it('opens to the right, centred on the trigger’s height — the collapsed rail', () => {
    expect(tooltipPosition(anchor, 'right', 'center')).toEqual({
      left: 140 + TOOLTIP_GAP_PX,
      top: 210,
      translate: '0 -50%',
    });
  });

  it('opens to the left by hanging its own right edge off the point', () => {
    expect(tooltipPosition(anchor, 'left', 'center')).toEqual({
      left: 100 - TOOLTIP_GAP_PX,
      top: 210,
      translate: '-100% -50%',
    });
  });

  it('lines up with the trigger’s start or end edge, for a trigger near the screen’s edge', () => {
    expect(tooltipPosition(anchor, 'bottom', 'start')).toMatchObject({ left: 100, translate: '0 0' });
    expect(tooltipPosition(anchor, 'bottom', 'end')).toMatchObject({ left: 140, translate: '-100% 0' });
    expect(tooltipPosition(anchor, 'right', 'start')).toMatchObject({ top: 200, translate: '0 0' });
    expect(tooltipPosition(anchor, 'right', 'end')).toMatchObject({ top: 220, translate: '0 -100%' });
  });
});
