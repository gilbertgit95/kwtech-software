/**
 * ── THE AUDIO GRAPH, SINCE NOBODY HERE CAN LISTEN ──────────────────────────
 *
 * Nothing in this repo runs a browser, so "does it sound right" is not a
 * question a test can answer. What IS answerable is whether the right calls are
 * made in the right order — and every bug this file guards produces SILENCE or
 * a click, which is indistinguishable from the feature being switched off.
 *
 * ⚠ `playTone` swallows every exception on purpose, so a mistake in the graph
 * surfaces nowhere except here.
 *
 * Moved from `module-chat` with the engine (PLAN §9 rule 8).
 */

import type { ToneNote } from '../src/tones.js';

interface RecordedNote {
  type: string;
  startedAt: number;
  stoppedAt: number;
  frequency: { setAt: number[]; expRamp: number[] };
  gain: { setValues: number[]; linearRamps: number[]; expRamps: number[] };
}

function fakeAudio(state: 'running' | 'suspended' = 'running', resumeWorks = true) {
  const notes: RecordedNote[] = [];
  let resumed = false;

  const context = {
    currentTime: 0,
    state,
    destination: { id: 'destination' },
    resume: async () => {
      resumed = true;
      if (!resumeWorks) throw new Error('not allowed without a gesture');
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
            // ⚠ The real API THROWS here. A fake that accepted zero would hide the bug.
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
   * ⚠ A CLASS, NOT A FUNCTION EXPRESSION. It was `function () { return context; }`
   * in chat's copy, Biome's `useArrowFunction` rewrote it to an arrow, `new` on an
   * arrow throws, `playTone` swallowed that, and every assertion saw zero
   * oscillators. A lint autofix silently disarmed the test. A class is a
   * constructor Biome will not rewrite.
   */
  class FakeAudioContext {
    constructor() {
      // biome-ignore lint/correctness/noConstructorReturn: returning the shared context IS the fake — every `new AudioContext()` must yield the one object the assertions read.
      return context as unknown as FakeAudioContext;
    }
  }

  (globalThis as { window?: unknown }).window = { AudioContext: FakeAudioContext };
  return { notes, context, wasResumed: () => resumed };
}

/** Fresh module per test: the engine keeps ONE context per tab, by design. */
async function engine() {
  return import('../src/tones.js');
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = undefined;
  jest.resetModules();
});

const steady: ToneNote[] = [
  { hz: 220, at: 0, ms: 70, shape: 'decay' },
  { hz: 220, at: 110, ms: 70, shape: 'decay' },
];
const pop: ToneNote[] = [{ hz: 420, toHz: 1180, at: 0, ms: 90, shape: 'decay' }];
const harsh: ToneNote[] = [{ hz: 784, at: 0, ms: 80, wave: 'square', level: 0.55 }];
const flat: ToneNote[] = [{ hz: 880, at: 0, ms: 90 }];

describe('playTone', () => {
  it('builds one oscillator per note and stops every one of them', async () => {
    const { notes } = fakeAudio();
    const { playTone } = await engine();

    playTone({ notes: steady });

    expect(notes).toHaveLength(2);
    // ⚠ An oscillator started and never stopped runs FOREVER — a page that hums.
    for (const note of notes) expect(note.stoppedAt).toBeGreaterThan(note.startedAt);
  });

  it('⚠ ramps the frequency for a note that slides, and not for one that does not', async () => {
    const { notes } = fakeAudio();
    const { playTone } = await engine();

    playTone({ notes: pop });
    expect(notes[0]?.frequency.expRamp).toEqual([1180]);

    notes.length = 0;
    playTone({ notes: steady });
    for (const note of notes) expect(note.frequency.expRamp).toHaveLength(0);
  });

  it('uses the waveform each note asked for, and sine otherwise', async () => {
    const { notes } = fakeAudio();
    const { playTone } = await engine();

    playTone({ notes: [...harsh, ...flat] });
    expect(notes.map((note) => note.type)).toEqual(['square', 'sine']);
  });

  it('⚠ ends a decaying note at true silence, not at the epsilon', async () => {
    const { notes } = fakeAudio();
    const { playTone } = await engine();

    playTone({ notes: pop });
    expect(notes[0]?.gain.expRamps.every((value) => value > 0)).toBe(true);
    expect(notes[0]?.gain.setValues.at(-1)).toBe(0);
  });

  it('⚠ fades a flat note in and out, so it does not click', async () => {
    const { notes } = fakeAudio();
    const { playTone } = await engine();

    playTone({ notes: flat });
    expect(notes[0]?.gain.setValues[0]).toBe(0);
    expect(notes[0]?.gain.linearRamps.at(-1)).toBe(0);
  });

  it('scales every note by the peak asked for, and never past the ceiling', async () => {
    const { notes } = fakeAudio();
    const { playTone, DEFAULT_TONE_PEAK, MAX_TONE_PEAK } = await engine();

    playTone({ notes: flat });
    expect(notes[0]?.gain.linearRamps[0]).toBeCloseTo(DEFAULT_TONE_PEAK);

    notes.length = 0;
    playTone({ notes: flat }, { peak: 5 });
    expect(notes[0]?.gain.linearRamps[0]).toBeCloseTo(MAX_TONE_PEAK);

    notes.length = 0;
    playTone({ notes: harsh }, { peak: 0.4 });
    expect(notes[0]?.gain.linearRamps[0]).toBeCloseTo(0.4 * 0.55);
  });

  it('⚠ builds nothing while the context is suspended, and asks to resume', async () => {
    const { notes, wasResumed } = fakeAudio('suspended');
    const { playTone } = await engine();

    playTone({ notes: flat });

    expect(notes).toHaveLength(0);
    expect(wasResumed()).toBe(true);
  });

  it('⚠ never throws, even for a note the Web Audio API itself refuses', async () => {
    fakeAudio();
    const { playTone } = await engine();
    expect(() => playTone({ notes: [{ hz: 440, toHz: 0, at: 0, ms: 50 }] })).not.toThrow();
  });

  it('does nothing at all where there is no Web Audio, such as on a server', async () => {
    const { playTone, toneState } = await engine();
    expect(() => playTone({ notes: flat })).not.toThrow();
    expect(toneState()).toBe('unavailable');
  });
});

describe('unlockTones and toneState', () => {
  it('resumes a suspended context and reports it ready', async () => {
    const audio = fakeAudio('suspended');
    const { unlockTones, toneState } = await engine();

    expect(toneState()).toBe('locked');
    expect(await unlockTones()).toBe(true);
    expect(audio.wasResumed()).toBe(true);
    expect(toneState()).toBe('ready');
  });

  it('⚠ answers false, rather than rejecting, when the browser refuses the unlock', async () => {
    fakeAudio('suspended', false);
    const { unlockTones, toneState } = await engine();

    await expect(unlockTones()).resolves.toBe(false);
    expect(toneState()).toBe('locked');
  });

  it('leaves a running context alone', async () => {
    const audio = fakeAudio('running');
    const { unlockTones } = await engine();

    expect(await unlockTones()).toBe(true);
    expect(audio.wasResumed()).toBe(false);
  });
});
