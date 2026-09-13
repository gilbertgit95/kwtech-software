import { CHAT_TONES, playChatTone, unlockChatTones } from '../src/react/chat-tone.js';

/**
 * Chat's tones through the shared engine.
 *
 * How notes become sound — oscillators, sweeps, fades, the suspended context —
 * is tested with the engine in `@kwtech/web-ui` (`test/tones.test.ts`). What is
 * left here is chat's half: every tone in the catalogue reaches the engine with
 * all its notes, an unknown id is not silence, and the unlock still unlocks.
 */

function fakeAudio(state: 'running' | 'suspended' = 'running') {
  const oscillators: string[] = [];
  let resumed = false;
  const node = () => ({ connect: (next: unknown) => next });
  const context = {
    currentTime: 0,
    state,
    destination: {},
    resume: async () => {
      resumed = true;
      context.state = 'running';
    },
    createOscillator: () => {
      oscillators.push('note');
      return {
        ...node(),
        type: 'sine',
        frequency: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
        start: () => undefined,
        stop: () => undefined,
      };
    },
    createGain: () => ({
      ...node(),
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
    }),
  };
  // A class, so `new` works — see the engine's test for why not a function.
  class FakeAudioContext {
    constructor() {
      // biome-ignore lint/correctness/noConstructorReturn: every `new AudioContext()` must yield the one shared fake.
      return context as unknown as FakeAudioContext;
    }
  }
  (globalThis as { window?: unknown }).window = { AudioContext: FakeAudioContext };
  return { oscillators, wasResumed: () => resumed };
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = undefined;
  jest.resetModules();
});

describe('playChatTone', () => {
  it('plays every tone in the catalogue with all of its notes', async () => {
    const { oscillators } = fakeAudio();
    const { playChatTone: play, CHAT_TONES: tones } = await import('../src/react/chat-tone.js');

    for (const tone of tones) {
      oscillators.length = 0;
      expect(() => play(tone.id)).not.toThrow();
      expect(oscillators).toHaveLength(tone.notes.length);
    }
  });

  it('falls back to the first tone rather than silence for an unknown id', async () => {
    const { oscillators } = fakeAudio();
    const { playChatTone: play, CHAT_TONES: tones } = await import('../src/react/chat-tone.js');

    play('a tone this build does not ship' as never);
    expect(oscillators).toHaveLength(tones[0]?.notes.length ?? -1);
  });
});

describe('unlockChatTones', () => {
  it('resumes a suspended context through the engine', async () => {
    const audio = fakeAudio('suspended');
    const { unlockChatTones: unlock } = await import('../src/react/chat-tone.js');

    unlock();
    await Promise.resolve();
    expect(audio.wasResumed()).toBe(true);
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
