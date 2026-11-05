'use client';

import type { PosAlertToneId } from '../domain/alert-tones.js';
import { noteGain, POS_TONES } from './view/tone-notes.js';

/**
 * Plays the built-in tones (issue #68) with Web Audio: an oscillator per note
 * and a short envelope, so there is no sound file at all.
 *
 * ⚠ BROWSERS BLOCK SOUND UNTIL THE PERSON HAS TOUCHED THE PAGE. An
 * AudioContext made before a click or a tap starts `suspended` and plays
 * nothing; `blocked()` says so, so the screen can ask for one tap instead of
 * staying silent without a word, and `unlock()` (called from that tap)
 * resumes it. After one gesture on the page it stays allowed.
 */
export interface PosTonePlayer {
  /** Plays a tone at a volume (0–100). False when it could not: no Web Audio, or still blocked. */
  play(tone: PosAlertToneId, volume: number): boolean;
  /** True while the browser has not allowed sound yet. */
  blocked(): boolean;
  /** Asks the browser to allow sound; call it from a click or a tap. */
  unlock(): Promise<void>;
  /** Lets the audio device go, when the screen closes. */
  close(): void;
}

export function createTonePlayer(): PosTonePlayer {
  let context: AudioContext | null = null;

  const ensure = (): AudioContext | null => {
    if (context) return context;
    const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      // No audio device, or a policy forbids it: the screen still works, silently, and says nothing is blocked.
      context = null;
    }
    return context;
  };

  return {
    play(tone, volume) {
      const audio = ensure();
      if (audio?.state !== 'running' || volume <= 0) return false;
      const start = audio.currentTime + 0.02;
      for (const note of POS_TONES[tone].notes) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = note.wave;
        oscillator.frequency.value = note.frequency;
        const begin = start + note.at;
        const peak = noteGain(note, volume);
        // A 10 ms rise, then an exponential fall: no click at the start, a ring at the end.
        gain.gain.setValueAtTime(0.0001, begin);
        gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), begin + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, begin + note.duration);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(begin);
        oscillator.stop(begin + note.duration + 0.05);
      }
      return true;
    },
    blocked() {
      const audio = ensure();
      return audio !== null && audio.state !== 'running';
    },
    async unlock() {
      const audio = ensure();
      if (!audio || audio.state === 'running') return;
      try {
        await audio.resume();
      } catch {
        // Still blocked: the note stays up and the next tap tries again.
      }
    },
    close() {
      void context?.close().catch(() => {});
      context = null;
    },
  };
}
