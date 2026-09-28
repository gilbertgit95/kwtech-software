import type { NotificationSource } from '@kwtech/module-notification';

/**
 * The kinds of notification THIS app sends, declared once.
 *
 * `module-notification` refuses a send naming a source that is not here, so a
 * raw key never reaches a screen, and the preferences page can list every
 * source by its label. The module adds `platform` itself (the compose screen).
 *
 * ⚠ Add a source in the same change as the producer that uses it. A source
 * declared with no producer is a switch on the preferences page that does
 * nothing.
 *
 * `mutable: false` is for what must always arrive — security notices. Nothing
 * here yet: the first producers are wired in follow-up changes, each through a
 * port its own module declares (PLAN §9).
 */
export const NOTIFICATION_SOURCES: readonly NotificationSource[] = [
  /*
   * The dev-only demo script (`notify:demo`) sends under this, so the inbox can
   * be seen working before any real producer exists. Harmless in production:
   * nothing else sends under it.
   */
  { key: 'demo', label: 'Demo', mutable: true },

  /*
   * Task boards (`./task/notifier.ts`): somebody assigned you, and somebody
   * commented on a task you are on. Two sources because they are two things a
   * person may want to hear about differently — a busy thread is worth muting,
   * being handed work rarely is.
   */
  { key: 'task.assigned', label: 'Tasks: assigned to you', mutable: true },
  { key: 'task.comment', label: 'Tasks: comments', mutable: true },
];
