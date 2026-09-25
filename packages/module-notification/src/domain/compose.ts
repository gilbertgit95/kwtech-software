import type { NotificationAction, NotificationContext, NotificationSeverity, NotificationSource } from '../types.js';
import { isNotificationSeverity } from '../types.js';
import { type HrefPolicy, prepareActions } from './actions.js';
import { type ContextColumns, prepareContext } from './context.js';
import { NOTIFICATION_GROUP_KEY_MAX } from './grouping.js';

/**
 * Validating a send — everything `NotificationSender.send` checks before it
 * writes a row, in one pure function so every rule is tested with a literal.
 */

export const NOTIFICATION_TITLE_MAX = 160;
export const NOTIFICATION_BODY_MAX = 2000;
export const NOTIFICATION_DEDUPE_KEY_MAX = 200;

/**
 * Recipients per send when the app configures nothing. Five hundred: a real
 * fan-out to a large team fits, and a loop that passed every user id it could
 * find is refused before it writes anything. Sends to EVERYONE are not this
 * path at all — they are announcements.
 */
export const NOTIFICATION_RECIPIENTS_FLOOR = 500;

/** What a producer hands the sender. */
export interface NotificationSendInput {
  recipientIds: readonly string[];
  /** Defaults to `info`. */
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  /** A key the app declared in the module's `sources`. */
  source: string;
  /** Omitted means global. */
  context?: NotificationContext;
  actions?: readonly NotificationAction[];
  /**
   * Fold into the recipient's open (unread) row with the same key instead of
   * adding one. `title` may contain `{count}`. See `domain/grouping.ts`.
   */
  group?: { key: string; title: string };
  /** Sending the same key to the same person twice writes one row. */
  dedupeKey?: string;
  /** After this the buttons are hidden. */
  expiresAt?: Date;
  /**
   * Who pressed send on a screen, for the audit on the batch. Omitted means the
   * system. ⚠ Never shown to recipients: they see the source.
   */
  senderId?: string;
}

export interface PreparedSend extends ContextColumns {
  recipientIds: string[];
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  source: NotificationSource;
  actions: NotificationAction[];
  group: { key: string; title: string } | null;
  dedupeKey: string | null;
  expiresAt: Date | null;
  senderId: string | null;
}

export interface ComposeRules {
  sources: readonly NotificationSource[];
  maxRecipients: number;
  hrefPolicy: HrefPolicy;
}

export type ComposeRefusal = 'invalid' | 'unknown_source' | 'too_many_recipients' | 'no_recipients';

/**
 * The send, normalised, or why not.
 *
 * ⚠ Recipients are DE-DUPLICATED, not refused: a producer that builds its list
 * from two queries and passes one person twice means "tell them", and two rows
 * would be two toasts for one event.
 */
export function prepareSend(
  input: NotificationSendInput,
  rules: ComposeRules,
): PreparedSend | { refused: ComposeRefusal; message: string } {
  const recipientIds = [...new Set(input.recipientIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  if (recipientIds.length === 0) return { refused: 'no_recipients', message: 'A notification needs a recipient.' };
  if (recipientIds.length > rules.maxRecipients) {
    return {
      refused: 'too_many_recipients',
      message: `One send can reach at most ${rules.maxRecipients} people. Use an announcement to reach everyone.`,
    };
  }

  const source = rules.sources.find((candidate) => candidate.key === input.source);
  if (!source) {
    return { refused: 'unknown_source', message: `"${input.source}" is not a notification source this app declared.` };
  }

  const severity = input.severity ?? 'info';
  if (!isNotificationSeverity(severity)) return { refused: 'invalid', message: 'That severity does not exist.' };

  const title = input.title.trim();
  if (!title) return { refused: 'invalid', message: 'A notification needs a title.' };
  if (title.length > NOTIFICATION_TITLE_MAX) {
    return { refused: 'invalid', message: `A title can be at most ${NOTIFICATION_TITLE_MAX} characters.` };
  }

  const body = input.body?.trim() ?? '';
  if (body.length > NOTIFICATION_BODY_MAX) {
    return { refused: 'invalid', message: `The text can be at most ${NOTIFICATION_BODY_MAX} characters.` };
  }

  const context = prepareContext(input.context);
  if ('refused' in context) return { refused: 'invalid', message: context.refused };

  const actions = prepareActions(input.actions, rules.hrefPolicy);
  if ('refused' in actions) return { refused: 'invalid', message: actions.refused };

  let group: PreparedSend['group'] = null;
  if (input.group) {
    const key = input.group.key.trim();
    const groupTitle = input.group.title.trim();
    if (!key || key.length > NOTIFICATION_GROUP_KEY_MAX) {
      return { refused: 'invalid', message: `A group key must be 1 to ${NOTIFICATION_GROUP_KEY_MAX} characters.` };
    }
    // Rendered with the largest count a group can plausibly show, so a title
    // that fits today does not overflow the column at the thousandth event.
    if (!groupTitle || groupTitle.replaceAll('{count}', '99999').length > NOTIFICATION_TITLE_MAX) {
      return { refused: 'invalid', message: `A group title must be 1 to ${NOTIFICATION_TITLE_MAX} characters.` };
    }
    group = { key, title: groupTitle };
  }

  const dedupeKey = input.dedupeKey?.trim() ?? '';
  if (dedupeKey.length > NOTIFICATION_DEDUPE_KEY_MAX) {
    return { refused: 'invalid', message: `A dedupe key can be at most ${NOTIFICATION_DEDUPE_KEY_MAX} characters.` };
  }
  // ⚠ A deduped send cannot also fold: dedupe says "this exact thing once", a
  // group says "count these", and a row that did both would count a re-send.
  if (dedupeKey && group) return { refused: 'invalid', message: 'A notification cannot be both deduped and grouped.' };

  if (input.expiresAt && Number.isNaN(input.expiresAt.getTime())) {
    return { refused: 'invalid', message: 'The expiry is not a valid date.' };
  }

  return {
    recipientIds,
    severity,
    title,
    body: body || null,
    source,
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    contextLabel: context.contextLabel,
    actions: actions.actions,
    group,
    dedupeKey: dedupeKey || null,
    expiresAt: input.expiresAt ?? null,
    senderId: input.senderId?.trim() || null,
  };
}
