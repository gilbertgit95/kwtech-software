import type { Tone } from '@kwtech/web-ui';

/**
 * This module's sounds — played by `@kwtech/web-ui`'s tone engine, which chat
 * and the queue board use too. The ENGINE is shared; each module keeps its own
 * CATALOGUE, because which sound a notification makes is this module's call.
 *
 * ⚠ Named for what they sound like, never for a product.
 */
export const NOTIFICATION_TONES: readonly Tone[] = [
  {
    id: 'ding',
    label: 'Ding',
    notes: [
      { hz: 1175, at: 0, ms: 420, wave: 'sine', shape: 'decay' },
      { hz: 2350, at: 0, ms: 200, shape: 'decay', level: 0.25 },
    ],
  },
  {
    id: 'chime',
    label: 'Chime',
    notes: [
      { hz: 784, at: 0, ms: 300, wave: 'triangle', shape: 'decay' },
      { hz: 1047, at: 140, ms: 420, wave: 'triangle', shape: 'decay' },
    ],
  },
  {
    id: 'soft',
    label: 'Soft',
    notes: [{ hz: 660, toHz: 880, at: 0, ms: 260, wave: 'sine', shape: 'decay' }],
  },
  {
    id: 'knock',
    label: 'Knock',
    notes: [
      { hz: 220, at: 0, ms: 90, wave: 'triangle', shape: 'decay' },
      { hz: 220, at: 150, ms: 90, wave: 'triangle', shape: 'decay' },
    ],
  },
];

export const DEFAULT_NOTIFICATION_TONE = 'ding';

/** The tone for an id, or the default for one this build no longer ships. */
export function notificationTone(id: string): Tone {
  return (
    NOTIFICATION_TONES.find((tone) => tone.id === id) ??
    NOTIFICATION_TONES.find((tone) => tone.id === DEFAULT_NOTIFICATION_TONE) ??
    (NOTIFICATION_TONES[0] as Tone)
  );
}
