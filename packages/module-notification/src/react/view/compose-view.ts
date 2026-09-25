import { checkHref, isExternalHref } from '../../domain/actions.js';
import { NOTIFICATION_BODY_MAX, NOTIFICATION_TITLE_MAX } from '../../domain/compose.js';
import type { NotificationSeverity } from '../../types.js';

/**
 * The admin compose and Sent screens' pure rules — validation, the counters,
 * the summary line, the read bar — so the components stay thin and every rule
 * here is tested with a literal.
 */

export interface ComposeRecipient {
  userId: string;
  displayName: string;
  email: string;
}

export interface ComposeDraft {
  recipients: ComposeRecipient[];
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** Whether the optional button is switched on. Off means its fields are ignored, not validated. */
  withButton: boolean;
  linkLabel: string;
  linkHref: string;
}

export const EMPTY_COMPOSE_DRAFT: ComposeDraft = {
  recipients: [],
  severity: 'info',
  title: '',
  body: '',
  withButton: false,
  linkLabel: '',
  linkHref: '',
};

export type ComposeErrors = Partial<Record<'recipients' | 'title' | 'body' | 'linkHref', string>>;

/**
 * The same limits the server enforces, from the same constants. The server
 * checks again regardless; this only saves a round trip and says it where the
 * field is.
 */
export function validateComposeDraft(draft: ComposeDraft): ComposeErrors {
  const errors: ComposeErrors = {};
  if (draft.recipients.length === 0) errors.recipients = 'Add at least one person.';
  const title = draft.title.trim();
  if (!title) errors.title = 'Give it a title.';
  else if (title.length > NOTIFICATION_TITLE_MAX) errors.title = `Keep it to ${NOTIFICATION_TITLE_MAX} characters.`;
  if (draft.body.trim().length > NOTIFICATION_BODY_MAX) {
    errors.body = `Keep it to ${NOTIFICATION_BODY_MAX} characters.`;
  }
  if (draft.withButton) {
    const href = draft.linkHref.trim();
    // `allowHttp: true` only because the SERVER decides that per environment;
    // this catches a `javascript:` or a typo before sending.
    if (!href) errors.linkHref = 'Add the link the button opens, or turn the button off.';
    else if (checkHref(href, { allowHttp: true })) {
      errors.linkHref = 'Use a path on this site (/…) or a full https:// address.';
    }
  }
  return errors;
}

/** What is actually sent for the optional button: nothing unless it is switched on. */
export function composeButton(draft: ComposeDraft): { linkLabel: string | null; linkHref: string | null } {
  const href = draft.linkHref.trim();
  if (!draft.withButton || !href) return { linkLabel: null, linkHref: null };
  return { linkLabel: draft.linkLabel.trim() || null, linkHref: href };
}

/** Whether the button will open a new tab — said under the field, before anybody sends. */
export function buttonOpensNewTab(href: string): boolean {
  const trimmed = href.trim();
  return trimmed.length > 0 && isExternalHref(trimmed);
}

/** "12 / 160", and whether it is close enough to the limit to show in the warning colour. */
export function counter(value: string, max: number): { text: string; near: boolean; over: boolean } {
  const length = value.trim().length;
  return { text: `${length} / ${max}`, near: length >= max * 0.9, over: length > max };
}

/** Two letters for a person's chip. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? (words[1]?.[0] ?? '') : (words[0]?.[1] ?? '');
  return `${first}${second}`.toUpperCase();
}

/** The line beside the Send button. */
export function recipientSummary(count: number): string {
  if (count === 0) return 'No recipients yet';
  return `Sending to ${count === 1 ? '1 person' : `${count.toLocaleString('en-US')} people`} as Platform`;
}

/** How each severity behaves, in a sentence under its card. */
export function severityHint(severity: NotificationSeverity): string {
  switch (severity) {
    case 'info':
      return 'General news. Pops up for 2 seconds.';
    case 'success':
      return 'Something finished well. Pops up for 2 seconds.';
    case 'warning':
      return 'Needs attention soon. Pops up for 3 seconds.';
    case 'alert':
      return 'Urgent. Pops up for 3 seconds and plays louder.';
  }
}

/** The Sent list's read bar. */
export function readShare(read: number, total: number): { percent: number; label: string } {
  if (total <= 0) return { percent: 0, label: 'Nobody to read it' };
  const percent = Math.round((Math.min(read, total) / total) * 100);
  return { percent, label: `${read.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} read` };
}

/**
 * The combobox's highlighted option after an arrow key. Wraps at both ends; -1
 * (nothing highlighted) steps to the first or last option.
 */
export function moveHighlight(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}
