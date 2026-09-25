/**
 * Where the notification pages live. Constants in their own file so the route,
 * every link to it, and the pages that link to each other agree without a cycle
 * through `module.tsx` — the reason chat's `routes.ts` exists.
 *
 * ⚠ None of these is under `/organizations/…`. The inbox belongs to the person,
 * across every tenant, so the pages are app level like `/chat`.
 */

/** The full inbox. Unlisted: the bell in the header is the one way in. */
export const NOTIFICATIONS_HREF = '/notifications';

/** This device's settings: toasts, sound, background pop-ups. Unlisted. */
export const NOTIFICATION_PREFERENCES_HREF = '/notifications/preferences';

/** Sending as the platform, and the Sent list. In the drawer's Administration group. */
export const NOTIFICATIONS_ADMIN_HREF = '/admin/notifications';
