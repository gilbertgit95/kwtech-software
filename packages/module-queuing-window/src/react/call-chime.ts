import type { Tone } from '@kwtech/web-ui';

/**
 * The sound a public display makes when a number is called.
 *
 * A falling "ding-dong": two struck notes a major third apart, each with a quiet
 * octave above so it reads as a bell rather than a test tone. The genre every
 * waiting room already knows means "look up", so nobody has to learn it.
 *
 * Built on the tone engine that moved to `@kwtech/web-ui` in step 7. The sound is
 * this module's; the engine is shared.
 */
export const QUEUE_CALL_CHIME: Tone = {
  id: 'queue-call',
  label: 'Call',
  notes: [
    { hz: 659, at: 0, ms: 360, wave: 'triangle', shape: 'decay' },
    { hz: 1318, at: 0, ms: 200, shape: 'decay', level: 0.3 },
    { hz: 523, at: 380, ms: 620, wave: 'triangle', shape: 'decay' },
    { hz: 1046, at: 380, ms: 320, shape: 'decay', level: 0.3 },
  ],
};

/**
 * Louder than chat's desk-level default: a waiting room has a door, a radio and
 * forty people in it. Still under the engine's ceiling, which exists because
 * overlapping notes past it clip.
 */
export const CALL_CHIME_PEAK = 0.35;

/** When the chime has finished — so the spoken announcement starts after it, not over it. */
export const CALL_CHIME_MS = Math.max(...QUEUE_CALL_CHIME.notes.map((note) => note.at + note.ms));
