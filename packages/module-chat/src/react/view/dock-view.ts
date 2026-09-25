/**
 * The floating chat window's rules — where it sits, where a drag takes it, and
 * what this browser remembers about it. Pure, and tested without a browser.
 */

/**
 * The window's place, as its distance from the viewport's BOTTOM-RIGHT corner.
 *
 * ⚠ From the bottom-right, not the top-left, because that is the corner it
 * belongs to. Stored as top/left, a window parked in the corner on a laptop
 * would reopen in the middle of a wider monitor; stored like this it stays in
 * the corner on every screen and only a window someone moved moves.
 */
export interface DockPosition {
  right: number;
  bottom: number;
}

export interface DockSize {
  width: number;
  height: number;
}

/** Pixels kept clear between the window and every edge of the viewport. */
export const DOCK_EDGE_PX = 8;

export const DEFAULT_DOCK_POSITION: DockPosition = { right: 16, bottom: 16 };

/** What this browser remembers. Per viewer and per device, so localStorage, never the server. */
export interface StoredDock {
  position: DockPosition;
  collapsed: boolean;
  /** The conversation open when the page was left, so a full navigation does not close it. */
  conversationId: string | null;
}

export const DOCK_STORAGE_KEY = 'kwtech:chat-dock';

/**
 * Keeps the whole window on screen.
 *
 * ⚠ The WHOLE window, title bar included: a window dragged until its bar is off
 * the top has nothing left to grab it by, and the only way back is clearing
 * site data. When the viewport is smaller than the window, the bar wins — it is
 * pinned to the top edge and the bottom is what gets cut off.
 */
export function clampDock(position: DockPosition, size: DockSize, viewport: DockSize): DockPosition {
  const maxRight = Math.max(DOCK_EDGE_PX, viewport.width - size.width - DOCK_EDGE_PX);
  const maxBottom = Math.max(DOCK_EDGE_PX, viewport.height - size.height - DOCK_EDGE_PX);
  return {
    right: Math.min(Math.max(position.right, DOCK_EDGE_PX), maxRight),
    bottom: Math.min(Math.max(position.bottom, DOCK_EDGE_PX), maxBottom),
  };
}

/**
 * Where a drag has taken the window: the start position moved by how far the
 * pointer went. Right and bottom grow as the pointer moves LEFT and UP, hence
 * the subtraction.
 */
export function draggedDock(
  start: DockPosition,
  from: { x: number; y: number },
  to: { x: number; y: number },
): DockPosition {
  return { right: start.right - (to.x - from.x), bottom: start.bottom - (to.y - from.y) };
}

/**
 * Reads back what was stored, and treats anything else as nothing.
 *
 * Untrusted like everything in localStorage: an older build, an extension or a
 * hand edit can leave any shape there, and a NaN position would put the window
 * nowhere at all.
 */
export function parseStoredDock(raw: string | null): StoredDock | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { position?: unknown; collapsed?: unknown; conversationId?: unknown };
  const position = record.position as { right?: unknown; bottom?: unknown } | undefined;
  if (typeof position !== 'object' || position === null) return null;
  if (!Number.isFinite(position.right) || !Number.isFinite(position.bottom)) return null;
  return {
    position: { right: position.right as number, bottom: position.bottom as number },
    collapsed: record.collapsed === true,
    conversationId:
      typeof record.conversationId === 'string' && record.conversationId.length > 0 ? record.conversationId : null,
  };
}
