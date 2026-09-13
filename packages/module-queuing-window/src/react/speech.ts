import type { QueueVoice } from '../domain/voice.js';
import { speechPlan } from './view/voice-view.js';

/**
 * Reading a call aloud, with the Web Speech API (`speechSynthesis`) that every
 * current browser ships.
 *
 * ⚠ SILENT FAILURE IS THE CONTRACT. A device with no voices, or a browser that
 * refuses, must never take the board down: the chime has already played and
 * the number is on the screen.
 */

function synth(): SpeechSynthesis | null {
  const speech = globalThis.speechSynthesis;
  return speech && typeof SpeechSynthesisUtterance !== 'undefined' ? speech : null;
}

/**
 * ⚠ CALL INSIDE A TAP. Browsers allow speech only after a user gesture, so the
 * display's Start button speaks nothing once. It also asks for the voice list,
 * which some browsers fill in only after the first request.
 */
export function primeSpeech(): void {
  const speech = synth();
  if (!speech) return;
  try {
    speech.getVoices();
    speech.cancel();
    speech.speak(new SpeechSynthesisUtterance(''));
  } catch {
    // No speech on this device. The chime still works.
  }
}

export function speakAnnouncement(text: string, voice: QueueVoice): void {
  const speech = synth();
  if (!speech || !voice.enabled) return;
  try {
    // A new call interrupts the last one rather than queueing behind it.
    speech.cancel();
    const plan = speechPlan(voice, speech.getVoices());
    for (let time = 0; time < plan.repeat; time += 1) {
      const utterance = new SpeechSynthesisUtterance(text);
      if (plan.voice) {
        utterance.voice = plan.voice;
        utterance.lang = plan.voice.lang;
      }
      utterance.pitch = plan.pitch;
      utterance.rate = plan.rate;
      utterance.volume = plan.volume;
      speech.speak(utterance);
    }
  } catch {
    // No voice is not an error; the chime still played.
  }
}
