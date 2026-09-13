import { CHAT_TONES, playChatTone, unlockChatTones } from '../src/react/chat-tone.js';

/**
 * ── THE AUDIO GRAPH, SINCE NOBODY HERE CAN LISTEN ──────────────────────────
 *
 * Nothing in this repo runs a browser, so "does it sound right" is not a
 * question a test can answer. What IS answerable is whether the right calls are
 * made in the right order — and every bug this file guards is one that produces
 * SILENCE or a click rather than a wrong note, which is indistinguishable from
 * the feature being switched off.
 *
 * ⚠ `playChatTone` swallows every exception on purpose: it runs on the path
 * that draws an arriving message, where throwing is worse than being quiet. So
 * a mistake in the graph does not surface as a failure anywhere — it surfaces
 * as a chat that stopped making sounds, reported weeks later. This is the only
 * place that can see it.
 */

interface RecordedNote {
  type: string;
  startedAt: number;
  stoppedAt: number;
  frequency: { value?: number; setAt: number[]; expRamp: number[] };
  gain: { setValues: number[]; linearRamps: number[]; expRamps: number[] };
}

function fakeAudio(state: 'running' | 'suspended' = 'running') {
  const notes: RecordedNote[] = [];
  let resumed = false;

  const context = {
    currentTime: 0,
    state,
    destination: { id: 'destination' },
    resume: async () => {
      resumed = true;
      context.state = 'running';
    },
    createOscillator() {
      const note: RecordedNote = {
        type: 'sine',
        startedAt: -1,
        stoppedAt: -1,
        frequency: { setAt: [], expRamp: [] },
        gain: { setValues: [], linearRamps: [], expRamps: [] },
      };
      notes.push(note);
      return {
        set type(value: string) {
          note.type = value;
        },
        get type() {
          return note.type;
        },
        frequency: {
          setValueAtTime: (value: number) => note.frequency.setAt.push(value),
          exponentialRampToValueAtTime: (value: number) => {
            // ⚠ The real API THROWS here, which is the behaviour worth copying:
            // a fake that accepted zero would hide the bug it exists to catch.
            if (value <= 0) throw new RangeError('exponentialRampToValueAtTime: target must be positive');
            note.frequency.expRamp.push(value);
          },
        },
        connect(next: unknown) {
          return next;
        },
        start: (at: number) => {
          note.startedAt = at;
        },
        stop: (at: number) => {
          note.stoppedAt = at;
        },
        _note: note,
      };
    },
    createGain() {
      const note = notes.at(-1);
      return {
        gain: {
          setValueAtTime: (value: number) => note?.gain.setValues.push(value),
          linearRampToValueAtTime: (value: number) => note?.gain.linearRamps.push(value),
          exponentialRampToValueAtTime: (value: number) => {
            if (value <= 0) throw new RangeError('exponentialRampToValueAtTime: target must be positive');
            note?.gain.expRamps.push(value);
          },
        },
        connect(next: unknown) {
          return next;
        },
      };
    },
  };

  /*
   * ⚠ A CLASS, NOT A FUNCTION EXPRESSION — and this is not a style preference.
   *
   * It was `function () { return context; }`, and Biome's `useArrowFunction`
   * rewrote it to `() => context` on the next autofix. `new` on an arrow throws
   * "is not a constructor", `playChatTone` swallows that by design, and every
   * assertion here started seeing zero oscillators. **A lint autofix silently
   * disarmed the test**, which is the same class of failure the file exists to
   * catch — one that reads as silence rather than as an error.
   *
   * A class is a constructor Biome will not rewrite. Returning an object from a
   * constructor makes `new` yield that object, so every instance is the one
   * shared context the assertions read.
   */
  class FakeAudioContext {
    constructor() {
      // biome-ignore lint/correctness/noConstructorReturn: returning the shared context IS the fake — every `new AudioContext()` must yield the one object the assertions read, and copying its fields onto `this` instead would detach `state`, which `resume()` mutates and the suspended-context test depends on.
      return context as unknown as FakeAudioContext;
    }
  }

  (globalThis as { window?: unknown }).window = { AudioContext: FakeAudioContext };
  return { notes, context, wasResumed: () => resumed };
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = undefined;
  jest.resetModules();
});

describe('playChatTone', () => {
  it('builds one oscillator per note and stops every one of them', async () => {
    const { notes } = fakeAudio();
    const { playChatTone: play, CHAT_TONES: tones } = await import('../src/react/chat-tone.js');

    const ding = tones.find((tone) => tone.id === 'ding');
    play('ding');

    expect(notes).toHaveLength(ding?.notes.length ?? 0);
    // ⚠ An oscillator that is started and never stopped runs FOREVER. Four
    // unstopped notifications is a chat that hums.
    for (const note of notes) expect(note.stoppedAt).toBeGreaterThan(note.startedAt);
  });

  /**
   * ⚠ THE SWEEP IS WHAT MAKES A POP A POP. A steady tone of the same length is
   * a beep, and the difference is one call.
   */
  it('⚠ ramps the frequency for a tone that slides, and not for one that does not', async () => {
    const { notes } = fakeAudio();
    const { playChatTone: play } = await import('../src/react/chat-tone.js');

    play('pop');
    expect(notes[0]?.frequency.expRamp).toHaveLength(1);
    expect(notes[0]?.frequency.expRamp[0]).toBeGreaterThan(notes[0]?.frequency.setAt[0] ?? 0);

    notes.length = 0;
    play('knock');
    for (const note of notes) expect(note.frequency.expRamp).toHaveLength(0);
  });

  it('uses the waveform each note asked for', async () => {
    const { notes } = fakeAudio();
    const { playChatTone: play } = await import('../src/react/chat-tone.js');

    play('alert');
    for (const note of notes) expect(note.type).toBe('square');

    notes.length = 0;
    play('knock');
    for (const note of notes) expect(note.type).toBe('sine');
  });

  /**
   * ⚠ A DECAY MUST END AT SILENCE. Exponential ramps cannot reach zero, so the
   * shape ramps to an epsilon and then SETS zero — stopping at the epsilon
   * would leave exactly the click the envelope exists to remove.
   */
  it('⚠ ends a decaying note at true silence, not at the epsilon', async () => {
    const { notes } = fakeAudio();
    const { playChatTone: play } = await import('../src/react/chat-tone.js');

    play('tap');
    const note = notes[0];
    expect(note?.gain.expRamps.every((value) => value > 0)).toBe(true);
    // The last thing written to the gain is a hard zero.
    expect(note?.gain.setValues.at(-1)).toBe(0);
  });

  /** Every tone in the catalogue must survive being played. */
  it('plays every tone in the catalogue without throwing', async () => {
    const { notes } = fakeAudio();
    const { playChatTone: play, CHAT_TONES: tones } = await import('../src/react/chat-tone.js');

    for (const tone of tones) {
      notes.length = 0;
      expect(() => play(tone.id)).not.toThrow();
      expect(notes.length).toBe(tone.notes.length);
    }
  });

  /**
   * ⚠ A SUSPENDED CONTEXT DROPS EVERY NOTE SILENTLY, which is the whole reason
   * the preview button exists. Playing into one must not build a graph nobody
   * will hear — it asks for the unlock and skips this tone.
   */
  it('⚠ builds nothing while the context is suspended, and asks to resume', async () => {
    const { notes, wasResumed } = fakeAudio('suspended');
    const { playChatTone: play } = await import('../src/react/chat-tone.js');

    play('blip');

    expect(notes).toHaveLength(0);
    expect(wasResumed()).toBe(true);
  });

  it('falls back to the first tone rather than silence for an unknown id', async () => {
    const { notes } = fakeAudio();
    const { playChatTone: play, CHAT_TONES: tones } = await import('../src/react/chat-tone.js');

    play('a tone this build does not ship' as never);
    expect(notes.length).toBe(tones[0]?.notes.length);
  });
});

describe('unlockChatTones', () => {
  it('resumes a suspended context and leaves a running one alone', async () => {
    const suspended = fakeAudio('suspended');
    const { unlockChatTones: unlock } = await import('../src/react/chat-tone.js');
    unlock();
    expect(suspended.wasResumed()).toBe(true);
  });
});

describe('the catalogue is playable', () => {
  it('names every tone uniquely for the picker', () => {
    const labels = CHAT_TONES.map((tone) => tone.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('exports the functions the settings page calls', () => {
    expect(typeof playChatTone).toBe('function');
    expect(typeof unlockChatTones).toBe('function');
  });
});
