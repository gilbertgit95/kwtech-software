import { isDisplayPassShaped } from '../../domain/session.js';

/**
 * The public board's view rules — pure, and tested without a browser.
 */

export interface QueueBoardCallView {
  ticketId: string;
  lineId: string;
  label: string;
  windowId: string;
  windowName: string;
  calledAt: string;
  recallCount: number;
  /** Only a nickname the person chose, and only while the workspace shows names. */
  nickname: string | null;
}

export interface QueueBoardView {
  showStaffNames: boolean;
  lines: Array<{ id: string; prefix: string; name: string }>;
  serving: QueueBoardCallView[];
  recent: QueueBoardCallView[];
}

export interface QueueDisplayEventView {
  /** 'board' | 'stopped'. */
  kind: string;
  board: QueueBoardView | null;
  announce: QueueBoardCallView | null;
}

export interface StoredDisplayPass {
  pass: string;
  workspaceName: string;
}

/** How long a board may be disconnected before it LOOKS stale. */
export const STALE_AFTER_MS = 15_000;

/** How long the newest call stands out. */
export const PULSE_MS = 10_000;

const STORAGE_PREFIX = 'kwtech.queue-display';

/**
 * Where a TV keeps what it knows, per organization and workspace.
 *
 * ⚠ TWO KEYS, and they are deliberately separate: Stop deletes the PASS, and the
 * line FILTER survives, so after the next code the Cashier TV still shows only
 * `C`. The filter's limit, stated up front: clearing this browser's data, or
 * opening another browser on the same screen, loses it.
 */
export function displayStorageKeys(organizationKey: string, workspaceKey: string) {
  const scope = `${organizationKey}/${workspaceKey}`;
  return { pass: `${STORAGE_PREFIX}.pass:${scope}`, filter: `${STORAGE_PREFIX}.filter:${scope}` };
}

/** A stored pass, if what is stored is one. Anything else is as good as nothing. */
export function parseStoredPass(raw: string | null): StoredDisplayPass | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredDisplayPass>;
    return isDisplayPassShaped(value.pass) && typeof value.workspaceName === 'string'
      ? { pass: value.pass, workspaceName: value.workspaceName }
      : null;
  } catch {
    return null;
  }
}

export function parseStoredFilter(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The code a QR link carried, from the URL FRAGMENT: `#code=K7QM4XHT`.
 *
 * ⚠ The fragment is never sent to a server, so the code lands in no log. The page
 * removes it from the address bar as soon as it has read it.
 */
export function codeFromFragment(hash: string): string | null {
  const code = new URLSearchParams(hash.replace(/^#/, '')).get('code');
  return code?.trim() ? code.trim() : null;
}

/**
 * The board through this TV's line filter. An empty filter shows every line.
 *
 * ⚠ A PRESENTATION FILTER, NOT A BOUNDARY. The pass admits the whole workspace's
 * board, and this only hides lines — acceptable while nothing on a board is
 * private.
 */
export function filterBoard(board: QueueBoardView, lineIds: readonly string[]): QueueBoardView {
  if (lineIds.length === 0) return board;
  const shown = (call: QueueBoardCallView) => lineIds.includes(call.lineId);
  return { ...board, serving: board.serving.filter(shown), recent: board.recent.filter(shown) };
}

/**
 * Now-serving rows in a STABLE order, by window name.
 *
 * The server lists each window's latest call newest first, and a TV that
 * reordered its rows on every call would make people re-find their window each
 * time. The newest call is marked by the pulse instead.
 */
export function servingRows(board: QueueBoardView): QueueBoardCallView[] {
  return [...board.serving].sort((a, b) =>
    a.windowName.localeCompare(b.windowName, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * A label as it should be SPOKEN: "C-042" → "C, zero four two".
 *
 * ⚠ Read naively, "C-042" is "C minus forty-two". Each digit is spoken on its
 * own, as it is printed on the slip in somebody's hand. English only — §12.64
 * (language, voice, and how a code is read elsewhere) is still open.
 */
export function spokenLabel(label: string): string {
  return label
    .split('-')
    .filter(Boolean)
    .map((part) => [...part].map((char) => (/\d/.test(char) ? (DIGIT_WORDS[Number(char)] ?? char) : char)).join(' '))
    .join(', ');
}

export function spokenCall(call: Pick<QueueBoardCallView, 'label' | 'windowName'>): string {
  return `Now serving ${spokenLabel(call.label)}, at ${call.windowName}.`;
}

/**
 * ⚠ A STALE BOARD MUST LOOK STALE. A TV showing "Now serving C-041" from a socket
 * that died ten minutes ago keeps people waiting for a number already called.
 */
export function isStale(disconnectedSince: number | null, now: number): boolean {
  return disconnectedSince !== null && now - disconnectedSince >= STALE_AFTER_MS;
}

/** Whether a call is the one to make stand out right now. */
export function isPulsing(announced: { ticketId: string; at: number } | null, ticketId: string, now: number): boolean {
  return announced !== null && announced.ticketId === ticketId && now - announced.at < PULSE_MS;
}
