import type { NotificationAction } from '../types.js';

/**
 * Buttons on a notification: validated once, here, and used by the sender on
 * the way in and by every read on the way out.
 *
 * ⚠ BOTH DIRECTIONS. The write check stops a `javascript:` URL being stored;
 * the read check means a row written before a rule tightened — or edited by
 * hand — renders with no buttons rather than with a dangerous one.
 */

/** At most this many buttons on one notification. More is a menu, not a notification. */
export const NOTIFICATION_MAX_ACTIONS = 3;

export const NOTIFICATION_ACTION_LABEL_MAX = 40;
export const NOTIFICATION_ACTION_KEY_MAX = 40;
export const NOTIFICATION_HREF_MAX = 2000;

export interface HrefPolicy {
  /**
   * Whether `http://` is accepted. Development only: a production notification
   * pointing at plain HTTP sends somebody somewhere a network can rewrite.
   */
  allowHttp: boolean;
}

/**
 * Why an href is refused, or null when it is fine.
 *
 * Accepted: a same-origin path (`/queue`, `/files/1?download=1`) or an absolute
 * `https://` URL. Refused:
 *   - `//evil.example` — a PROTOCOL-RELATIVE URL, which starts with a slash and
 *     leaves the site. The classic hole in "starts with / means ours".
 *   - `/\evil.example` — browsers normalise the backslash to a slash, which
 *     makes it the same hole.
 *   - `javascript:`, `data:`, and any other scheme, because a button that runs
 *     script is not a link.
 *   - whitespace and control characters, which some parsers strip and others
 *     do not — and that disagreement is where filters are bypassed.
 */
export function checkHref(href: string, policy: HrefPolicy): 'empty' | 'too_long' | 'unsafe' | null {
  if (!href) return 'empty';
  if (href.length > NOTIFICATION_HREF_MAX) return 'too_long';
  // Control characters, then plain whitespace — both are where parsers disagree.
  for (const char of href) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return 'unsafe';
  }
  if (/\s/.test(href)) return 'unsafe';

  if (href.startsWith('/')) {
    const second = href[1];
    if (second === '/' || second === '\\') return 'unsafe';
    return null;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return 'unsafe';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && policy.allowHttp) return null;
  return 'unsafe';
}

/** Whether an href leaves this site — a new tab is then the only sensible target. */
export function isExternalHref(href: string): boolean {
  return !href.startsWith('/');
}

/**
 * Validates buttons for a SEND. Returns them normalised, or a sentence saying
 * what is wrong — the sender turns that into a refusal the producer sees.
 */
export function prepareActions(
  input: readonly unknown[] | undefined,
  policy: HrefPolicy,
): { actions: NotificationAction[] } | { refused: string } {
  const list = input ?? [];
  if (list.length > NOTIFICATION_MAX_ACTIONS) {
    return { refused: `A notification can have at most ${NOTIFICATION_MAX_ACTIONS} buttons.` };
  }

  const actions: NotificationAction[] = [];
  const keys = new Set<string>();
  for (const candidate of list) {
    const parsed = parseAction(candidate, policy);
    if (typeof parsed === 'string') return { refused: parsed };
    if (keys.has(parsed.key)) return { refused: `Two buttons share the key "${parsed.key}".` };
    keys.add(parsed.key);
    actions.push(parsed);
  }
  return { actions };
}

/**
 * Buttons as READ from a row: whatever does not validate is dropped, never
 * thrown. A list with one bad row must still render.
 */
export function readActions(stored: unknown, policy: HrefPolicy): NotificationAction[] {
  if (!Array.isArray(stored)) return [];
  const actions: NotificationAction[] = [];
  const keys = new Set<string>();
  for (const candidate of stored.slice(0, NOTIFICATION_MAX_ACTIONS)) {
    const parsed = parseAction(candidate, policy);
    if (typeof parsed === 'string' || keys.has(parsed.key)) continue;
    keys.add(parsed.key);
    actions.push(parsed);
  }
  return actions;
}

/** One button, or a sentence saying what is wrong with it. */
function parseAction(candidate: unknown, policy: HrefPolicy): NotificationAction | string {
  if (typeof candidate !== 'object' || candidate === null) return 'A button must be an object.';
  const raw = candidate as Record<string, unknown>;

  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const href = typeof raw.href === 'string' ? raw.href.trim() : '';
  if (!key || key.length > NOTIFICATION_ACTION_KEY_MAX) {
    return `A button needs a key of at most ${NOTIFICATION_ACTION_KEY_MAX} characters.`;
  }
  if (!label || label.length > NOTIFICATION_ACTION_LABEL_MAX) {
    return `A button needs a label of at most ${NOTIFICATION_ACTION_LABEL_MAX} characters.`;
  }
  const hrefProblem = checkHref(href, policy);
  if (hrefProblem) return `The button "${label}" has a link that is not allowed (${hrefProblem.replace('_', ' ')}).`;

  if (raw.kind === 'link') {
    // An external link always opens a new tab: replacing the app with another
    // site mid-task is how a person loses their place, and a notification is
    // not where they decided to leave.
    const target = isExternalHref(href) || raw.target === 'blank' ? 'blank' : 'self';
    return { kind: 'link', key, label, href, target };
  }
  if (raw.kind === 'download') {
    const filename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
    // A filename is a hint to the browser, never a path: anything with a
    // separator is dropped rather than trusted.
    const safeName = filename && !/[\\/]/.test(filename) && filename.length <= 200 ? filename : '';
    return safeName
      ? { kind: 'download', key, label, href, filename: safeName }
      : { kind: 'download', key, label, href };
  }
  return `The button "${label}" is neither a link nor a download.`;
}
