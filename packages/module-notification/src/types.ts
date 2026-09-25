/**
 * The shapes every half of the module agrees on. Framework-free: the server,
 * the web half and the tests all import these, and none of them may restate
 * one.
 */

/**
 * How loud a notification is. What it is ABOUT is its `source`.
 *
 * ⚠ Closed on purpose: the toast's duration, its live region and its icon all
 * switch on this, and a value nothing draws would render blank. Mirrors the
 * Prisma enum `NotificationSeverity`.
 */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'alert';

export const NOTIFICATION_SEVERITIES: readonly NotificationSeverity[] = ['info', 'success', 'warning', 'alert'];

export function isNotificationSeverity(value: unknown): value is NotificationSeverity {
  return typeof value === 'string' && (NOTIFICATION_SEVERITIES as readonly string[]).includes(value);
}

/**
 * A button on a notification. Links and downloads only.
 *
 * ⚠ No server-side "command" kind. Its one use case (accepting an invitation)
 * was dropped, and a kind with no consumer is a code path nobody exercises. The
 * design for one is recorded in `docs/NOTIFICATIONS-PLAN.md` §15.
 */
export type NotificationAction =
  | { kind: 'link'; key: string; label: string; href: string; target: 'self' | 'blank' }
  | { kind: 'download'; key: string; label: string; href: string; filename?: string };

/**
 * Where a notification came from — exactly three shapes.
 *
 * ⚠ A workspace without its organization cannot be written here, which is the
 * point of the type: the two columns alone could hold that shape, and nothing
 * would draw it sensibly.
 *
 * ⚠ CONTEXT, NEVER ACCESS. Only the recipient decides who sees a notification;
 * someone who has left Acme still sees what Acme sent them.
 */
export type NotificationContext =
  | { scope: 'global' }
  | { scope: 'organization'; organizationId: string; label?: string }
  | { scope: 'workspace'; organizationId: string; workspaceId: string; label?: string };

/**
 * A kind of notification the app declared: "Queue", "Platform".
 *
 * Declared rather than free text, so what a person sees is always a LABEL and
 * the preferences page can list every source by name.
 */
export interface NotificationSource {
  /** `queue.session`, `platform`. At most 64 characters. */
  key: string;
  /** What a person reads on the item: "Queue". */
  label: string;
  /**
   * False for what must always arrive — security notices, a platform-wide
   * message. The preferences page shows it with no switch.
   */
  mutable: boolean;
}

/**
 * Why a send or a write was refused. Returned as a value by the domain and
 * thrown by the services as `NotificationWriteError`.
 */
export type NotificationRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'invalid'
  | 'unknown_source'
  | 'too_many_recipients'
  | 'no_recipients';
