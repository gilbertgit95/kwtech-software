/**
 * ── SHORT SYNTHESISED SOUNDS ────────────────────────────────────────────────
 *
 * The engine behind chat's message tone and the queue board's call chime.
 *
 * ## Why it lives here
 *
 * It was `module-chat`'s. `module-queuing-window`'s public display needs a chime
 * too, and a module may not import a module (PLAN §9) — so the second consumer
 * is what moved it (§9 rule 8). What moved is the ENGINE: how notes become
 * sound. Each module keeps its own CATALOGUE, because which sounds a message or
 * a call makes is that module's decision.
 *
 * Framework-free and at the package ROOT: no React, no dependency. It touches
 * `window` only when a sound is asked for, so importing it on a server is safe.
 *
 * ## ⚠ SYNTHESISED, NOT FETCHED
 *
 * No audio file ships. A file has to arrive before it can play, so the first
 * sound after a load would race the download; the repo has no binary assets and
 * no asset pipeline; and a two-note blip is exactly describable in code. What
 * this gives up: a designer cannot swap a sound without code, and nothing richer
 * than a synthesised blip is available. The seam, if that changes, is `playTone`.
 *
 * ## ⚠ It does NOT dodge the autoplay rule
 *
 * An `AudioContext` is born `suspended` in the browsers that block `play()`,
 * and resuming it needs a user gesture just as playback does. See `unlockTones`.
 */

/**
 * One note. Enough to build a pop, a bubble, a bell and an alert, and no more.
 * A "pop" is not a tone but a fast upward PITCH SWEEP with a percussive decay,
 * which is why a note has `toHz` and `shape` as well as a pitch.
 */
export interface ToneNote {
  /** Where the pitch starts, in hertz. ⚠ Must be positive — see `playTone`. */
  hz: number;
  /**
   * Where it ENDS, for a note that slides. Omitted means steady. Ramps
   * EXPONENTIALLY, because pitch is perceived that way.
   */
  toHz?: number;
  /** Milliseconds after the tone starts. */
  at: number;
  /** How long this note lasts. */
  ms: number;
  /** `sine` is round, `triangle` brighter, `square` harsh and carries across a room. Defaults to `sine`. */
  wave?: 'sine' | 'triangle' | 'square';
  /**
   * `flat` holds its level and fades at the end; `decay` drops away from the
   * first instant, which is what makes something sound STRUCK rather than played.
   */
  shape?: 'flat' | 'decay';
  /** Relative loudness, 0 to 1, for a note meant to sit under another. */
  level?: number;
}

export interface Tone {
  id: string;
  label: string;
  notes: readonly ToneNote[];
}

export interface PlayToneOptions {
  /**
   * Peak loudness, 0 to `MAX_TONE_PEAK`. Defaults to `DEFAULT_TONE_PEAK`: heard
   * across a desk without making somebody jump. A waiting room is louder than a
   * desk, which is what this exists for.
   */
  peak?: number;
}

/** Loud enough to hear across a desk, quiet enough not to make somebody jump. */
export const DEFAULT_TONE_PEAK = 0.14;

/**
 * The loudest a tone may be asked to play. Several notes can overlap, and a sum
 * past 1 clips into distortion — which sounds broken rather than loud.
 */
export const MAX_TONE_PEAK = 0.5;

/** Milliseconds of fade at each end of a note. */
const FADE_MS = 12;

type AudioContextConstructor = new () => AudioContext;

/**
 * ONE context for the tab, created lazily. Browsers cap how many an origin may
 * have, and constructing one before any sound is asked for makes a browser show
 * "this site is playing audio" over a silent page.
 */
let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (context) return context;

  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!ctor) return null;

  try {
    context = new ctor();
    return context;
  } catch {
    // A browser that refuses to construct one is a browser with no sound.
    return null;
  }
}

/**
 * Whether a tone played now would be heard.
 *
 *   unavailable  no Web Audio at all (or running on a server).
 *   locked       the browser is waiting for a user gesture — see `unlockTones`.
 *   ready        a tone will play.
 *
 * ⚠ For a screen nobody touches once it is up — a TV — this is how the page knows
 * to ask for the one tap that makes it audible, instead of chiming into silence.
 */
export function toneState(): 'unavailable' | 'locked' | 'ready' {
  const ctx = audioContext();
  if (!ctx) return 'unavailable';
  return ctx.state === 'running' ? 'ready' : 'locked';
}

/**
 * ⚠ THE UNLOCK. Browsers refuse audio until the page has been interacted with; a
 * context created before any gesture is `suspended`, and every note played into
 * it is dropped SILENTLY. Resuming must happen INSIDE a real user gesture.
 *
 * ⚠ Call it from an event handler, never an effect: in an effect it runs outside
 * the gesture and the browser refuses it again.
 *
 * Resolves when the context is running, or false when the browser refused.
 */
export async function unlockTones(): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  if (ctx.state === 'running') return true;
  try {
    await ctx.resume();
    return (ctx.state as string) === 'running';
  } catch {
    // Rejects when there was no gesture after all. An unhandled rejection in a
    // click handler is worse than a silent tone.
    return false;
  }
}

/**
 * Plays one tone, if the browser will let it.
 *
 * ⚠ NEVER THROWS AND NEVER REJECTS. It is called from socket handlers, where the
 * only thing worse than no sound is an exception on the path that draws what
 * just arrived.
 *
 * ⚠ A suspended context drops every note, so this tries to resume and SKIPS the
 * tone rather than queueing it — a chime that plays late, for a call already
 * gone, is worse than none.
 */
export function playTone(tone: Pick<Tone, 'notes'>, options: PlayToneOptions = {}): void {
  const ctx = audioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
    return;
  }

  const peakGain = Math.min(Math.max(options.peak ?? DEFAULT_TONE_PEAK, 0), MAX_TONE_PEAK);
  if (peakGain === 0) return;

  try {
    const start = ctx.currentTime;
    for (const note of tone.notes) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = note.wave ?? 'sine';
      const from = start + note.at / 1000;
      const to = from + note.ms / 1000;
      oscillator.frequency.setValueAtTime(note.hz, from);

      const peak = peakGain * (note.level ?? 1);
      const fade = Math.min(FADE_MS / 1000, note.ms / 2000);

      /*
       * ⚠ EXPONENTIAL, because pitch is PERCEIVED that way — a linear sweep
       * spends most of its time already sounding high. And
       * `exponentialRampToValueAtTime` THROWS on a non-positive target, which
       * is why every catalogue test checks its frequencies are positive.
       */
      if (note.toHz) oscillator.frequency.exponentialRampToValueAtTime(note.toHz, to);

      /*
       * ⚠ THE FADES ARE NOT POLISH. An oscillator switched on and off at full
       * amplitude clicks at each end, louder and more irritating than the note.
       */
      gain.gain.setValueAtTime(0, from);
      gain.gain.linearRampToValueAtTime(peak, from + fade);

      if (note.shape === 'decay') {
        /*
         * ⚠ Ramped to a near-zero epsilon and then SET to zero. An exponential
         * ramp cannot reach zero — passing it throws — and stopping at the
         * epsilon would leave the click the fades exist to avoid.
         */
        gain.gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 0.0001), to);
        gain.gain.setValueAtTime(0, to);
      } else {
        gain.gain.setValueAtTime(peak, Math.max(from + fade, to - fade));
        gain.gain.linearRampToValueAtTime(0, to);
      }

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(from);
      oscillator.stop(to);
    }
  } catch {
    // A tone is never worth breaking a render over.
  }
}
