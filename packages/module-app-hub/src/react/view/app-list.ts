/**
 * The grid's app list as a panel: how wide it may be, and what this browser
 * remembers about it. Pure, so the bounds are tested without a DOM.
 *
 * It behaves like the app's main drawer (`apps/web-app` `sidebar-state.ts`):
 * collapsed it is a rail of icons, expanded its edge drags. The rules are
 * copied rather than shared because a module cannot import the app, and the
 * two panels have different bounds anyway.
 */

/**
 * The bounds of the expanded list, in pixels.
 *
 * The default is the 13rem the list always had. The minimum is where an app's
 * name still fits beside its icon and "In grid"; below it the list is a worse
 * version of the collapsed rail. The maximum keeps the apps, not the list of
 * them, the widest thing on the page.
 */
export const APP_LIST_WIDTH = { min: 176, default: 208, max: 360 } as const;

/** What this browser remembers about the list. */
export interface StoredAppList {
  collapsed: boolean;
  /** The EXPANDED width, kept while collapsed so expanding puts it back. */
  width: number;
}

export const DEFAULT_APP_LIST: StoredAppList = { collapsed: false, width: APP_LIST_WIDTH.default };

/**
 * Per viewer and per device, so localStorage and not the saved layout: how
 * much room the list takes depends on the screen in front of you, and a
 * workspace default must not collapse it for everybody.
 */
export const APP_LIST_STORAGE_KEY = 'kwtech:app-hub-list';

export function clampAppListWidth(width: number): number {
  return Math.round(Math.min(APP_LIST_WIDTH.max, Math.max(APP_LIST_WIDTH.min, width)));
}

/**
 * Reads back what was stored. Anything unreadable is the default, and a width
 * out of range is clamped rather than refused, so tightening the bounds later
 * moves a stored width inside them instead of discarding it.
 *
 * Untrusted like everything in localStorage: a NaN width would give the panel
 * no width at all.
 */
export function parseStoredAppList(raw: string | null): StoredAppList {
  if (!raw) return DEFAULT_APP_LIST;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_APP_LIST;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_APP_LIST;
  const record = value as { collapsed?: unknown; width?: unknown };
  return {
    collapsed: record.collapsed === true,
    width:
      typeof record.width === 'number' && Number.isFinite(record.width)
        ? clampAppListWidth(record.width)
        : APP_LIST_WIDTH.default,
  };
}

/**
 * Where a key press on the resize handle takes the width, or null for a key
 * the handle does not answer: arrows step, Shift steps further, Home and End
 * go to the bounds — the WAI-ARIA window-splitter keys.
 */
export function appListWidthAfterKey(width: number, key: string, shift: boolean): number | null {
  const step = shift ? 64 : 16;
  switch (key) {
    case 'ArrowLeft':
      return clampAppListWidth(width - step);
    case 'ArrowRight':
      return clampAppListWidth(width + step);
    case 'Home':
      return APP_LIST_WIDTH.min;
    case 'End':
      return APP_LIST_WIDTH.max;
    default:
      return null;
  }
}
