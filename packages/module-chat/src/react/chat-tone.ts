/**
 * ── THE TONE ───────────────────────────────────────────────────────────────
 *
 * A short sound when a message arrives, and the whole of what `dnd` can
 * truthfully claim until a notification system exists (§12.44).
 *
 * ## ⚠ SYNTHESISED, NOT FETCHED — a deliberate departure from the plan
 *
 * The plan said "three to five short self-hosted files, mp3 (Safari does not
 * take ogg), mono, tiny". These are built from an oscillator instead, and no
 * audio file ships at all. The reasons, in the order they matter:
 *
 *   - **A file has to arrive before it can play.** The first message after a
 *     load would race the download, and the fix for that is a preload of every
 *     tone on every page — paying for four files so one might be needed.
 *   - **The repo has no binary assets and `apps/web-app` has no `public/`.**
 *     Adding an asset pipeline, and a second one for any app that adopts this
 *     module, to ship four blips is a poor trade.
 *   - A two-note blip is exactly describable in code. Nothing is lost in the
 *     translation, and the catalogue below is readable in a way four opaque
 *     binaries are not.
 *
 * ⚠ What this GIVES UP, stated plainly: a designer cannot replace a sound
 * without writing code, and richer sounds than a blip are not available this
 * way. If either becomes the point, `play` takes a URL and the catalogue grows
 * a `src` — the seam is one function wide.
 *
 * ⚠ It does NOT dodge the autoplay problem. An `AudioContext` is created
 * `suspended` in exactly the browsers that block `play()`, and resuming it
 * needs a user gesture just as playback does. See `unlockChatTones`.
 */

/**
 * ── ONE NOTE ───────────────────────────────────────────────────────────────
 *
 * Enough description to build the sounds people expect from a messenger, and
 * no more. ⚠ The engine grew these three fields together, because a "pop" is
 * not a tone: it is a fast upward PITCH SWEEP with a percussive decay, and a
 * catalogue of steady sine notes cannot express one at all.
 */
export interface ChatToneNote {
  /** Where the pitch starts, in hertz. */
  hz: number;
  /**
   * Where it ENDS, for a note that slides. Omitted means steady.
   *
   * ⚠ This is what makes a pop, a bubble and a swoop possible. It ramps
   * EXPONENTIALLY, because pitch is perceived that way — a linear sweep from
   * 200Hz to 800Hz spends most of its time sounding high.
   */
  toHz?: number;
  /** Milliseconds after the tone starts. */
  at: number;
  /** How long this note lasts. */
  ms: number;
  /**
   * `sine` is round and quiet, `triangle` is brighter, `square` is harsh and
   * carries across a noisy room. Defaults to `sine`.
   */
  wave?: 'sine' | 'triangle' | 'square';
  /**
   * `flat` holds its level and fades at the end; `decay` drops away from the
   * first instant, which is what makes something sound STRUCK rather than
   * played. Percussive sounds — pop, tap, marimba — need the second.
   */
  shape?: 'flat' | 'decay';
  /** Relative loudness, 0 to 1. For a note meant to sit under another. */
  level?: number;
}

export interface ChatTone {
  id: string;
  label: string;
  notes: readonly ChatToneNote[];
}

/**
 * ── THE CATALOGUE ──────────────────────────────────────────────────────────
 *
 * Ten, described rather than recorded, roughly ordered from most discreet to
 * most noticeable so the picker reads as a range rather than a list.
 *
 * ## ⚠ NAMED FOR WHAT THEY SOUND LIKE, NEVER FOR A PRODUCT
 *
 * "Pop", "Ding", "Ping" — not the name of any messenger that has one. Two
 * reasons and the second is the real one: a real product's notification sound
 * is a recorded asset somebody owns, so these are ORIGINAL sounds in the same
 * genre rather than imitations of a specific one; and a tone called after
 * another app sets an expectation this cannot meet, which reads as a bad copy
 * rather than as its own sound.
 *
 * ## Why there is a ceiling at all
 *
 * A picker somebody scrolls is a picker somebody abandons, and every tone here
 * has to be auditioned one at a time to be chosen. Ten is about the most that
 * stays a decision rather than a chore.
 */
export const CHAT_TONES: readonly ChatTone[] = [
  {
    id: 'tap',
    label: 'Tap',
    /** One note, as short as is still audible. For somebody who wants almost nothing. */
    notes: [{ hz: 1320, at: 0, ms: 55, shape: 'decay' }],
  },
  {
    id: 'knock',
    label: 'Knock',
    /** Two low, flat notes — the least musical option, for a shared room. */
    notes: [
      { hz: 220, at: 0, ms: 70, shape: 'decay' },
      { hz: 220, at: 110, ms: 70, shape: 'decay' },
    ],
  },
  {
    id: 'pop',
    label: 'Pop',
    /**
     * ⚠ THE BUBBLE-POP EVERY MESSENGER HAS, and it is a SWEEP rather than a
     * note: pitch rising fast through a very short decay is what the ear reads
     * as something bursting. A steady tone of the same length is just a beep.
     */
    notes: [{ hz: 420, toHz: 1180, at: 0, ms: 90, shape: 'decay' }],
  },
  {
    id: 'bubble',
    label: 'Bubble',
    /**
     * Two pops, the second higher and softer — a smaller bubble behind the
     * first. ⚠ THE DEFAULT: the sound people already read as "a message",
     * which is the one that needs no explanation.
     */
    notes: [
      { hz: 360, toHz: 980, at: 0, ms: 85, shape: 'decay' },
      { hz: 620, toHz: 1420, at: 95, ms: 70, shape: 'decay', level: 0.6 },
    ],
  },
  {
    id: 'blip',
    label: 'Blip',
    /** Two quick notes up. Short, and hard to mistake for an OS sound. */
    notes: [
      { hz: 880, at: 0, ms: 90 },
      { hz: 1175, at: 90, ms: 120 },
    ],
  },
  {
    id: 'ping',
    label: 'Ping',
    /** Bright and quick, a fifth apart. `triangle` is what makes it cut through. */
    notes: [
      { hz: 988, at: 0, ms: 70, wave: 'triangle' },
      { hz: 1480, at: 70, ms: 140, wave: 'triangle', shape: 'decay' },
    ],
  },
  {
    id: 'ding',
    label: 'Ding',
    /**
     * One bright note with a long tail. ⚠ The quiet note an octave above is
     * what stops it sounding like a test tone — a real bell has overtones, and
     * one sine alone never does.
     */
    notes: [
      { hz: 1046, at: 0, ms: 320, wave: 'triangle', shape: 'decay' },
      { hz: 2093, at: 0, ms: 180, shape: 'decay', level: 0.35 },
    ],
  },
  {
    id: 'chime',
    label: 'Chime',
    /** A rising third, the most musical of them. */
    notes: [
      { hz: 660, at: 0, ms: 110 },
      { hz: 990, at: 80, ms: 200, shape: 'decay' },
    ],
  },
  {
    id: 'marimba',
    label: 'Marimba',
    /** Warm and wooden — two struck notes, a fourth apart, with no sharp edge. */
    notes: [
      { hz: 587, at: 0, ms: 150, wave: 'triangle', shape: 'decay' },
      { hz: 880, at: 90, ms: 220, wave: 'triangle', shape: 'decay' },
    ],
  },
  {
    id: 'alert',
    label: 'Alert',
    /**
     * The loudest option, for somebody who must not miss one. ⚠ `square` is
     * deliberately harsh and the two notes are close together, which is what
     * the ear reads as urgent rather than pleasant.
     */
    notes: [
      { hz: 784, at: 0, ms: 80, wave: 'square', level: 0.55 },
      { hz: 1047, at: 95, ms: 80, wave: 'square', level: 0.55 },
      { hz: 784, at: 190, ms: 110, wave: 'square', level: 0.55, shape: 'decay' },
    ],
  },
];

export type ChatToneId = (typeof CHAT_TONES)[number]['id'];

/**
 * Two bubble pops, the second smaller. The sound people already associate with
 * a message arriving, which makes it the one that needs no explanation.
 *
 * ⚠ CHANGING THIS MOVES NOBODY WHO HAS CHOSEN. The setting lives in
 * `localStorage` and `readChatSettings` falls back to this only when the stored
 * value is absent or no longer valid — so a new default reaches people who
 * never opened the picker, and leaves everybody who did exactly where they
 * were. That is the right way round, and it is a property of where the setting
 * is stored rather than of anything written here.
 */
export const DEFAULT_CHAT_TONE: ChatToneId = 'bubble';

export function isChatToneId(value: unknown): value is ChatToneId {
  return typeof value === 'string' && CHAT_TONES.some((tone) => tone.id === value);
}

/**
 * ⚠ Loud enough to hear across a desk, quiet enough not to make somebody jump.
 * There is NO volume control in the settings on purpose: the operating system
 * has one, it is the one people already know how to reach, and a second slider
 * that only affects this tab is a worse answer to the same question.
 */
const PEAK_GAIN = 0.14;

/** Milliseconds of fade at each end of a note. */
const FADE_MS = 12;

type AudioContextConstructor = new () => AudioContext;

/**
 * ONE context for the tab, created lazily.
 *
 * ⚠ Browsers cap how many an origin may have, and they are not cheap — one per
 * message would be a leak with a sound attached. Lazily, because constructing
 * one before anybody has asked for a sound is what makes a browser show the
 * "this site is playing audio" indicator over a silent page.
 */
let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (context) return context;

  const ctor =
    (window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor })
      .AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!ctor) return null;

  try {
    context = new ctor();
    return context;
  } catch {
    // A browser that refuses to construct one is a browser with no tone. Every
    // other part of chat still works, which is the point of failing quietly.
    return null;
  }
}

/**
 * ⚠ THE UNLOCK, AND WHY THE PREVIEW BUTTON IS NOT A NICETY.
 *
 * Browsers refuse to start audio until the page has been interacted with. A
 * context created before any gesture is born `suspended`, and every note played
 * into it is silently dropped — no error on screen, nothing in the console
 * worth reading, just a chat that never makes a sound and a person who
 * concludes the setting is broken.
 *
 * Resuming needs to happen INSIDE a real user gesture. Previewing a tone in
 * settings is that gesture, which is what makes the preview button load-bearing
 * rather than a convenience: it is how the setting gets switched on for real.
 * It is also called when the settings page is touched at all, so somebody who
 * flips the toggle and never presses preview is unlocked too.
 *
 * ⚠ Call it from an event handler, never from an effect. In an effect it runs
 * outside the gesture and the browser refuses it again.
 */
export function unlockChatTones(): void {
  const ctx = audioContext();
  if (ctx?.state !== 'suspended') return;
  // ⚠ Rejects when there was no gesture after all. Nothing to do about it, and
  // an unhandled rejection in a click handler is worse than a silent tone.
  void ctx.resume().catch(() => undefined);
}

/**
 * Plays one tone, if the browser will let it.
 *
 * ⚠ NEVER THROWS AND NEVER REJECTS. It is called from the socket's message
 * handler, where the only thing worse than no sound is an exception on the path
 * that draws an arriving message.
 *
 * ⚠ It does not decide WHETHER to play — see `use-chat-tone.ts`. This is the
 * half that knows about audio; that is the half that knows about chat.
 */
export function playChatTone(id: ChatToneId): void {
  const ctx = audioContext();
  if (!ctx) return;

  /*
   * ⚠ A suspended context drops every note silently, so this is the second
   * place the unlock is attempted — on the chance that the page was interacted
   * with somewhere other than the settings page. It is not a substitute for
   * the gesture: if there has been none, this resolves to nothing and the tone
   * is simply skipped rather than queued.
   */
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
    return;
  }

  const tone = CHAT_TONES.find((one) => one.id === id) ?? CHAT_TONES[0];
  if (!tone) return;

  try {
    const start = ctx.currentTime;
    for (const note of tone.notes) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = note.wave ?? 'sine';
      oscillator.frequency.setValueAtTime(note.hz, start + note.at / 1000);

      const from = start + note.at / 1000;
      const to = from + note.ms / 1000;
      const peak = PEAK_GAIN * (note.level ?? 1);
      const fade = Math.min(FADE_MS / 1000, note.ms / 2000);

      /*
       * ⚠ EXPONENTIAL, because pitch is PERCEIVED that way. A linear sweep from
       * 420Hz to 1180Hz spends most of its time already sounding high, and the
       * fast rise that makes a pop sound like a pop is gone.
       *
       * ⚠ `exponentialRampToValueAtTime` cannot approach zero and throws on a
       * non-positive target — harmless here because every `toHz` is a real
       * frequency, and stated because it is the trap in this API.
       */
      if (note.toHz) oscillator.frequency.exponentialRampToValueAtTime(note.toHz, to);

      /*
       * ⚠ THE FADES ARE NOT POLISH. An oscillator switched on and off at full
       * amplitude produces a click at each end — a discontinuity in the
       * waveform — which is louder and more irritating than the note itself.
       */
      gain.gain.setValueAtTime(0, from);
      gain.gain.linearRampToValueAtTime(peak, from + fade);

      if (note.shape === 'decay') {
        /*
         * ⚠ STRUCK RATHER THAN PLAYED. The level falls away from the first
         * instant, which is what a bell, a block of wood and a bursting bubble
         * all have in common and a held note does not.
         *
         * ⚠ Ramped to a near-zero epsilon and then SET to zero. Exponential
         * ramps cannot reach zero — passing it throws — and stopping at the
         * epsilon instead would leave the very click the fades exist to avoid.
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
    // Same reasoning as above: a tone is never worth breaking a render over.
  }
}
