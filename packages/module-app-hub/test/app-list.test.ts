import {
  APP_LIST_WIDTH,
  appListWidthAfterKey,
  clampAppListWidth,
  DEFAULT_APP_LIST,
  parseStoredAppList,
} from '../src/react/view/app-list.js';

/** The grid's app list as a panel: its width bounds and what the browser remembers. */
describe('the app list panel', () => {
  it('keeps a width inside the bounds, in whole pixels', () => {
    expect(clampAppListWidth(10)).toBe(APP_LIST_WIDTH.min);
    expect(clampAppListWidth(10_000)).toBe(APP_LIST_WIDTH.max);
    expect(clampAppListWidth(240.6)).toBe(241);
  });

  it('opens expanded at the default width when nothing is stored', () => {
    expect(parseStoredAppList(null)).toEqual(DEFAULT_APP_LIST);
    expect(DEFAULT_APP_LIST).toEqual({ collapsed: false, width: APP_LIST_WIDTH.default });
  });

  it('reads back what it stored, keeping the expanded width while collapsed', () => {
    expect(parseStoredAppList(JSON.stringify({ collapsed: true, width: 300 }))).toEqual({
      collapsed: true,
      width: 300,
    });
  });

  it('⚠ treats anything unreadable as the default, never as a panel with no width', () => {
    expect(parseStoredAppList('not json')).toEqual(DEFAULT_APP_LIST);
    expect(parseStoredAppList('null')).toEqual(DEFAULT_APP_LIST);
    expect(parseStoredAppList('"wide"')).toEqual(DEFAULT_APP_LIST);
    expect(parseStoredAppList(JSON.stringify({ collapsed: 'yes', width: 'wide' }))).toEqual(DEFAULT_APP_LIST);
    // JSON has no NaN: it arrives as null.
    expect(parseStoredAppList(JSON.stringify({ collapsed: true, width: Number.NaN }))).toEqual({
      collapsed: true,
      width: APP_LIST_WIDTH.default,
    });
  });

  it('clamps a stored width that is out of range rather than discarding it', () => {
    expect(parseStoredAppList(JSON.stringify({ collapsed: false, width: 9_000 })).width).toBe(APP_LIST_WIDTH.max);
    expect(parseStoredAppList(JSON.stringify({ collapsed: false, width: 1 })).width).toBe(APP_LIST_WIDTH.min);
  });

  it('steps with the arrows, further with Shift, and goes to the bounds with Home and End', () => {
    expect(appListWidthAfterKey(208, 'ArrowRight', false)).toBe(224);
    expect(appListWidthAfterKey(208, 'ArrowLeft', false)).toBe(192);
    expect(appListWidthAfterKey(208, 'ArrowRight', true)).toBe(272);
    expect(appListWidthAfterKey(APP_LIST_WIDTH.min, 'ArrowLeft', false)).toBe(APP_LIST_WIDTH.min);
    expect(appListWidthAfterKey(208, 'Home', false)).toBe(APP_LIST_WIDTH.min);
    expect(appListWidthAfterKey(208, 'End', false)).toBe(APP_LIST_WIDTH.max);
  });

  it('leaves every other key alone, so Tab still leaves the handle', () => {
    expect(appListWidthAfterKey(208, 'Tab', false)).toBeNull();
    expect(appListWidthAfterKey(208, 'a', false)).toBeNull();
  });
});
