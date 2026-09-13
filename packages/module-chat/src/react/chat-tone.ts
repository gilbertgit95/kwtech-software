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

/** The catalogue. Each is a couple of notes, described rather than recorded. */
export const CHAT_TONES = [
  {
    id: 'blip',
    label: 'Blip',
    /** Two quick notes up. The default: short, and hard to mistake for the OS. */
    notes: [
      { hz: 880, at: 0, ms: 90 },
      { hz: 1175, at: 90, ms: 120 },
    ],
  },
  {
    id: 'knock',
    label: 'Knock',
    /** Two low, flat notes — the least musical option, for a shared room. */
    notes: [
      { hz: 220, at: 0, ms: 70 },
      { hz: 220, at: 110, ms: 70 },
    ],
  },
  {
    id: 'chime',
    label: 'Chime',
    /** A rising third, the longest of them, and still under a third of a second. */
    notes: [
      { hz: 660, at: 0, ms: 110 },
      { hz: 990, at: 80, ms: 200 },
    ],
  },
  {
    id: 'tap',
    label: 'Tap',
    /** One note, as short as is still audible. For somebody who wants almost nothing. */
    notes: [{ hz: 1320, at: 0, ms: 55 }],
  },
] as const;

export type ChatToneId = (typeof CHAT_TONES)[number]['id'];

/** Two notes up: short, distinct, and not mistakable for a system sound. */
export const DEFAULT_CHAT_TONE: ChatToneId = 'blip';

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

      // A sine, because every other wave shape is harsher at the volume a
      // notification wants to be.
      oscillator.type = 'sine';
      oscillator.frequency.value = note.hz;

      const from = start + note.at / 1000;
      const to = from + note.ms / 1000;
      const fade = FADE_MS / 1000;

      /*
       * ⚠ THE FADES ARE NOT POLISH. An oscillator switched on and off at full
       * amplitude produces a click at each end — a discontinuity in the
       * waveform — which is louder and more irritating than the note itself.
       */
      gain.gain.setValueAtTime(0, from);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, from + fade);
      gain.gain.setValueAtTime(PEAK_GAIN, Math.max(from + fade, to - fade));
      gain.gain.linearRampToValueAtTime(0, to);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(from);
      oscillator.stop(to);
    }
  } catch {
    // Same reasoning as above: a tone is never worth breaking a render over.
  }
}
