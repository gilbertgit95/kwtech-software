import { NOTIFICATION_VISIBLE_TOASTS } from '../../domain/toast.js';

/**
 * The toast stack as a pure reducer: at most three on screen, the rest queued,
 * and a toast for a row already showing is REPLACED in place — a growing group
 * is one toast, updated, not a pile.
 */

export interface ToastItem {
  /** The notification's id, or a synthetic one for the "while you were offline" summary. */
  id: string;
  severity: string;
  title: string;
  body: string | null;
  sourceLabel: string;
  contextLabel: string | null;
  /** The first link, if any — clicking the toast follows it. */
  href: string | null;
  hrefTarget: string | null;
  /** Bumped on every replace, so the component restarts its timer. */
  version: number;
}

export interface ToastQueue {
  visible: ToastItem[];
  waiting: ToastItem[];
}

export const EMPTY_TOAST_QUEUE: ToastQueue = { visible: [], waiting: [] };

/** Add or replace. A replaced toast keeps its place and restarts its clock. */
export function pushToast(queue: ToastQueue, toast: Omit<ToastItem, 'version'>): ToastQueue {
  const replace = (list: ToastItem[]) =>
    list.map((item) => (item.id === toast.id ? { ...toast, version: item.version + 1 } : item));
  if (queue.visible.some((item) => item.id === toast.id)) return { ...queue, visible: replace(queue.visible) };
  if (queue.waiting.some((item) => item.id === toast.id)) return { ...queue, waiting: replace(queue.waiting) };

  const fresh: ToastItem = { ...toast, version: 0 };
  if (queue.visible.length < NOTIFICATION_VISIBLE_TOASTS) return { ...queue, visible: [...queue.visible, fresh] };
  return { ...queue, waiting: [...queue.waiting, fresh] };
}

/** Remove one, and let the next waiting toast in. */
export function dismissToast(queue: ToastQueue, id: string): ToastQueue {
  const visible = queue.visible.filter((item) => item.id !== id);
  const waiting = queue.waiting.filter((item) => item.id !== id);
  const room = NOTIFICATION_VISIBLE_TOASTS - visible.length;
  return { visible: [...visible, ...waiting.slice(0, Math.max(0, room))], waiting: waiting.slice(Math.max(0, room)) };
}

/** The newest visible toast — what Escape dismisses. */
export function newestToast(queue: ToastQueue): ToastItem | null {
  return queue.visible.at(-1) ?? null;
}
