import type { PosAlertToneId } from '../../domain/alert-tones.js';

/**
 * THE BUILT-IN TONES (issue #68), as notes the browser plays itself with Web
 * Audio (`tone-player.ts`): no sound file to ship, store or lose. Data, so the
 * sounds are reviewed here and the player stays one loop.
 *
 * Each is short — under a second and a half — and soft at its start, so it
 * says "look" without startling anybody at the counter.
 */

/** One note: its pitch in Hz, when it starts and how long it rings (seconds), and its waveform. */
export interface PosToneNote {
  frequency: number;
  at: number;
  duration: number;
  wave: 'sine' | 'triangle';
  /** 0–1, against the tone's volume: a quieter overtone under the main note. */
  level: number;
}

export interface PosToneSpec {
  label: string;
  /** What it is like, for the picker: "Two rising notes". */
  description: string;
  notes: readonly PosToneNote[];
}

export const POS_TONES: Record<PosAlertToneId, PosToneSpec> = {
  chime: {
    label: 'Chime',
    description: 'Two rising notes',
    notes: [
      { frequency: 659.25, at: 0, duration: 0.5, wave: 'sine', level: 1 },
      { frequency: 880, at: 0.18, duration: 0.7, wave: 'sine', level: 1 },
    ],
  },
  bell: {
    label: 'Bell',
    description: 'One bright ring',
    notes: [
      { frequency: 880, at: 0, duration: 1.3, wave: 'triangle', level: 1 },
      { frequency: 1760, at: 0, duration: 0.8, wave: 'sine', level: 0.35 },
    ],
  },
  ding: {
    label: 'Ding',
    description: 'One clear note',
    notes: [{ frequency: 1046.5, at: 0, duration: 0.6, wave: 'sine', level: 1 }],
  },
  marimba: {
    label: 'Marimba',
    description: 'Three quick notes',
    notes: [
      { frequency: 523.25, at: 0, duration: 0.25, wave: 'triangle', level: 1 },
      { frequency: 659.25, at: 0.1, duration: 0.25, wave: 'triangle', level: 1 },
      { frequency: 783.99, at: 0.2, duration: 0.4, wave: 'triangle', level: 1 },
    ],
  },
  pop: {
    label: 'Pop',
    description: 'A soft tap',
    notes: [{ frequency: 740, at: 0, duration: 0.15, wave: 'sine', level: 1 }],
  },
};

/** The loudest a tone gets at volume 100: a phone speaker clips above it, and a counter is not a stage. */
export const POS_TONE_PEAK = 0.4;

/** A note's peak gain at a volume (0–100): linear in the slider, never above `POS_TONE_PEAK`. */
export function noteGain(note: Pick<PosToneNote, 'level'>, volume: number): number {
  const clamped = Math.min(100, Math.max(0, volume));
  return (clamped / 100) * POS_TONE_PEAK * note.level;
}
