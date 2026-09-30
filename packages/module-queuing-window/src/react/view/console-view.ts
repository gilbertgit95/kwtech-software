import { zonedDayKey } from '@kwtech/module-kit';
import type {
  QueueConsoleView,
  QueueLineView,
  QueueSeatView,
  QueueTicketView,
  QueueWindowView,
} from '../queue-client.js';

/**
 * The console's view rules — pure, and tested without a renderer.
 *
 * None of them decide anything the server does not decide again. They choose
 * what to SHOW; the API decides what may happen.
 */

export function activeWindows(view: Pick<QueueConsoleView, 'windows'>): QueueWindowView[] {
  return view.windows.filter((window) => !window.archived);
}

export function activeLines(view: Pick<QueueConsoleView, 'lines'>): QueueLineView[] {
  return view.lines.filter((line) => !line.archived);
}

/** The live lines a window calls from. A window naming none calls from all. */
export function linesServedBy(
  window: Pick<QueueWindowView, 'lineIds'>,
  lines: readonly QueueLineView[],
): QueueLineView[] {
  const live = lines.filter((line) => !line.archived);
  return window.lineIds.length === 0 ? live : live.filter((line) => window.lineIds.includes(line.id));
}

export function servingAt(view: Pick<QueueConsoleView, 'serving'>, windowId: string): QueueTicketView | null {
  return view.serving.find((ticket) => ticket.windowId === windowId) ?? null;
}

export function seatAt(view: Pick<QueueConsoleView, 'seats'>, windowId: string): QueueSeatView | null {
  return view.seats.find((seat) => seat.windowId === windowId) ?? null;
}

/**
 * The line Space calls from: the one the window's current ticket is in, if the
 * window still serves it, or the only line it serves. Otherwise none — guessing
 * between two lines is how the wrong customer is called.
 */
export function spaceLine(lines: readonly QueueLineView[], current: QueueTicketView | null): QueueLineView | null {
  if (current) {
    const same = lines.find((line) => line.id === current.lineId);
    if (same) return same;
  }
  return lines.length === 1 ? (lines[0] ?? null) : null;
}

export type SessionAge = 'today' | 'yesterday' | 'older';

/**
 * How long ago queuing started, in the WORKSPACE's calendar days (PLAN §13,
 * 2026-09-29) — so "started yesterday" means the same to every staff member,
 * wherever their browser thinks it is. Without a zone, the browser's own.
 *
 * ⚠ §12.68: nothing stops a session at closing time, so numbering carries on
 * into the next morning and TVs stay admitted. The console says so in warning
 * colour when a session is not from today.
 */
export function sessionAge(startedAt: string, now: Date = new Date(), timeZone?: string): SessionAge {
  const started = new Date(startedAt);
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Calendar days, compared as UTC midnights of the zone's day keys: no DST hour can tip the count.
  const dayOf = (date: Date) => Date.parse(`${zonedDayKey(date, zone)}T00:00:00Z`);
  const days = Math.round((dayOf(now) - dayOf(started)) / 86_400_000);
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : 'older';
}

/**
 * The display link a QR code encodes.
 *
 * ⚠ THE CODE GOES IN THE FRAGMENT, never the query string. A browser never sends
 * the fragment to a server, so the code does not land in any request log or
 * `Referer` header, and the board page removes it from the address bar.
 *
 * ⚠ THE ORIGIN IS THE BROWSER'S OWN, so the QR points wherever this staff member
 * is looking at the console. Served from an internal hostname the TVs cannot
 * reach, the QR would be wrong.
 */
export function displayLink(origin: string, displayPath: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${displayPath}#code=${code.replace(/-/g, '')}`;
}

/**
 * Whether a key press belongs to a control rather than to the console.
 *
 * Space on a focused button already presses it, and in a field it types a
 * space — so the Call next shortcut must stand aside for both, or it fires twice
 * or eats a character.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!element || typeof element.tagName !== 'string') return false;
  return element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(element.tagName);
}

/**
 * "9:02 am", in the viewer's locale and in `timeZone`: the workspace's, passed
 * by the console and by the TV board alike, so both read the same clock.
 * Without one, the device's own zone.
 */
export function clockTime(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}
