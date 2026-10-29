import {
  clampOrderPanelWidth,
  ORDER_PANEL_WIDTH,
  orderPanelWidthAfterDrag,
  orderPanelWidthAfterKey,
  parseStoredOrderPanelWidth,
} from '../src/react/view/order-panel.js';

describe('the order panel’s width', () => {
  it('stays within its bounds', () => {
    expect(clampOrderPanelWidth(10)).toBe(ORDER_PANEL_WIDTH.min);
    expect(clampOrderPanelWidth(5000)).toBe(ORDER_PANEL_WIDTH.max);
    expect(clampOrderPanelWidth(400.4)).toBe(400);
  });

  it('⚠ widens when its LEFT edge is dragged left', () => {
    expect(orderPanelWidthAfterDrag(352, 800, 700)).toBe(452);
    expect(orderPanelWidthAfterDrag(352, 800, 850)).toBe(302);
    expect(orderPanelWidthAfterDrag(352, 800, 2000)).toBe(ORDER_PANEL_WIDTH.min);
  });

  it('moves the edge the way the arrow points, and Home / End go to the bounds', () => {
    expect(orderPanelWidthAfterKey(352, 'ArrowLeft', false)).toBe(368);
    expect(orderPanelWidthAfterKey(352, 'ArrowRight', true)).toBe(288);
    expect(orderPanelWidthAfterKey(352, 'Home', false)).toBe(ORDER_PANEL_WIDTH.min);
    expect(orderPanelWidthAfterKey(352, 'End', false)).toBe(ORDER_PANEL_WIDTH.max);
    expect(orderPanelWidthAfterKey(352, 'Enter', false)).toBeNull();
  });

  it('reads back a stored width, clamped, and anything unreadable as the default', () => {
    expect(parseStoredOrderPanelWidth('500')).toBe(500);
    expect(parseStoredOrderPanelWidth('99999')).toBe(ORDER_PANEL_WIDTH.max);
    expect(parseStoredOrderPanelWidth(null)).toBe(ORDER_PANEL_WIDTH.default);
    expect(parseStoredOrderPanelWidth('wide')).toBe(ORDER_PANEL_WIDTH.default);
    expect(parseStoredOrderPanelWidth('')).toBe(ORDER_PANEL_WIDTH.default);
  });
});
