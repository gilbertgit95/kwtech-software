import type { NotificationSource } from '../types.js';

/**
 * The sources a notification can come from: the ones the app declares, plus
 * the one this module always has.
 */

export const NOTIFICATION_SOURCE_KEY_MAX = 64;

/**
 * What a platform administrator sends from the compose screen, and what every
 * platform-wide notice is filed under. Declared by the module itself, because
 * the compose screen needs it in every app.
 *
 * ⚠ NOT MUTABLE: a message the platform sends to named people is the one thing
 * a person must not be able to switch off.
 */
export const NOTIFICATION_PLATFORM_SOURCE: NotificationSource = {
  key: 'platform',
  label: 'Platform',
  mutable: false,
};

/**
 * Every source, the module's first, then the app's.
 *
 * ⚠ THROWS on a duplicate or a malformed key — a configuration error, found at
 * boot. Two sources with one key would file notifications under whichever the
 * lookup found first, and a person muting one would mute the other.
 */
export function composeSources(declared: readonly NotificationSource[]): NotificationSource[] {
  const all = [NOTIFICATION_PLATFORM_SOURCE, ...declared];
  const seen = new Set<string>();
  for (const source of all) {
    if (!/^[a-z][a-z0-9_.-]*$/.test(source.key) || source.key.length > NOTIFICATION_SOURCE_KEY_MAX) {
      throw new Error(
        `Notification source "${source.key}" is not a valid key: lowercase letters, digits, "_", "." and "-", starting with a letter, at most ${NOTIFICATION_SOURCE_KEY_MAX} characters.`,
      );
    }
    if (!source.label.trim()) throw new Error(`Notification source "${source.key}" needs a label.`);
    if (seen.has(source.key)) {
      throw new Error(`Notification source "${source.key}" is declared twice. Each key must be unique.`);
    }
    seen.add(source.key);
  }
  return all;
}
