'use client';

import { NOTIFICATION_TONES } from './notification-tones.js';

/**
 * Settings for THIS DEVICE, in localStorage. Not the database, and that is the
 * honest scope: turning the sound off at a shared desk means "here", not on
 * somebody's phone.
 */

export const NOTIFICATION_SETTINGS_KEY = 'kwtech_notification_settings';

export interface NotificationDeviceSettings {
  /** Pop-ups inside the app. On: they are the feature. */
  toasts: boolean;
  /**
   * A sound with each one. ⚠ OFF by default: a back-office tab that starts
   * making noise is a setting people hunt for angrily.
   */
  sound: boolean;
  tone: string;
  /**
   * The browser's own pop-ups when every tab is in the background. Off until
   * the person turns it on AND the browser grants permission.
   */
  systemPopups: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationDeviceSettings = {
  toasts: true,
  sound: false,
  tone: 'ding',
  systemPopups: false,
};

/**
 * Settings as stored, validated field by field. Storage that throws, JSON that
 * does not parse, the wrong shape, a tone this build no longer ships — each
 * falls back to the default for THAT field, because each would otherwise land
 * at the moment a notification arrives.
 */
export function parseNotificationSettings(raw: string | null): NotificationDeviceSettings {
  if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_NOTIFICATION_SETTINGS;
  const value = parsed as Record<string, unknown>;
  const tone =
    typeof value.tone === 'string' && NOTIFICATION_TONES.some((candidate) => candidate.id === value.tone)
      ? value.tone
      : DEFAULT_NOTIFICATION_SETTINGS.tone;
  return {
    toasts: typeof value.toasts === 'boolean' ? value.toasts : DEFAULT_NOTIFICATION_SETTINGS.toasts,
    sound: typeof value.sound === 'boolean' ? value.sound : DEFAULT_NOTIFICATION_SETTINGS.sound,
    tone,
    systemPopups:
      typeof value.systemPopups === 'boolean' ? value.systemPopups : DEFAULT_NOTIFICATION_SETTINGS.systemPopups,
  };
}

/** Reads this device's settings. Never throws. */
export function readNotificationSettings(): NotificationDeviceSettings {
  try {
    return parseNotificationSettings(window.localStorage.getItem(NOTIFICATION_SETTINGS_KEY));
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

const listeners = new Set<(settings: NotificationDeviceSettings) => void>();

/**
 * Saves, and tells every open part of THIS tab — the bell reads the same
 * settings the preferences page writes, and should not need a reload to notice.
 * Other tabs pick it up from the `storage` event.
 */
export function writeNotificationSettings(settings: NotificationDeviceSettings): void {
  try {
    window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A profile that blocks storage keeps the setting for this page's life only.
  }
  for (const listener of listeners) listener(settings);
}

export function onNotificationSettings(listener: (settings: NotificationDeviceSettings) => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === NOTIFICATION_SETTINGS_KEY) listener(parseNotificationSettings(event.newValue));
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
