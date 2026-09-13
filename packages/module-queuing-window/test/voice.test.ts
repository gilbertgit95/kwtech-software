import { DEFAULT_VOICE, normalizeVoice, VOICE_LABELS, voiceRefusal } from '../src/domain/voice.js';
import { announcementSentence, spokenCall } from '../src/react/view/board-view.js';
import { FALLBACK_PITCH_SHIFT, pickVoice, speechPlan } from '../src/react/view/voice-view.js';
import { voiceColumns, voiceOf } from '../src/server/voice-columns.js';

/**
 * What a waiting room hears. Every failure here sounds like a working TV — the
 * wrong window read out, a voice nobody chose, or silence.
 */

describe('the sentence', () => {
  it('asks the number to proceed to the window', () => {
    expect(spokenCall({ label: 'C-042', windowName: 'Cashier 1' })).toBe(
      'Number C, zero four two, please proceed to window Cashier 1.',
    );
  });

  it('⚠ does not say "window Window 3" for a window already named that way', () => {
    expect(announcementSentence('C-042', 'Window 3')).toBe('Number C-042, please proceed to Window 3.');
    expect(announcementSentence('C-042', '  window 3 ')).toBe('Number C-042, please proceed to window 3.');
  });
});

describe('the stored voice', () => {
  it('accepts a complete voice made of offered choices', () => {
    expect(
      voiceRefusal({ enabled: false, type: 'woman', pitch: 'very_high', speed: 'slow', volume: 'soft', repeat: 2 }),
    ).toBeNull();
  });

  it.each([
    ['enabled', { ...DEFAULT_VOICE, enabled: 'yes' }],
    ['type', { ...DEFAULT_VOICE, type: 'robot' }],
    ['pitch', { ...DEFAULT_VOICE, pitch: 2 }],
    ['speed', { ...DEFAULT_VOICE, speed: undefined }],
    ['volume', { ...DEFAULT_VOICE, volume: 'LOUD' }],
    ['repeat', { ...DEFAULT_VOICE, repeat: 3 }],
  ])('⚠ names %s when it is not one of the choices, or missing', (field, input) => {
    expect(voiceRefusal(input)).toBe(field);
  });

  it('reads a value no longer offered as its default, so a TV never breaks on an old row', () => {
    expect(normalizeVoice({ enabled: true, type: 'robot', pitch: 'high', speed: 9, volume: null, repeat: 2 })).toEqual({
      ...DEFAULT_VOICE,
      pitch: 'high',
      repeat: 2,
    });
    expect(normalizeVoice(null)).toEqual(DEFAULT_VOICE);
  });

  it('round-trips through the settings columns, and a workspace with no row hears the defaults', () => {
    const voice = { enabled: false, type: 'man', pitch: 'low', speed: 'fast', volume: 'medium', repeat: 2 } as const;
    expect(voiceOf(voiceColumns(voice))).toEqual(voice);
    expect(voiceOf(null)).toEqual(DEFAULT_VOICE);
  });

  it('labels every choice', () => {
    expect(Object.keys(VOICE_LABELS.pitch)).toEqual(['low', 'normal', 'high', 'very_high']);
  });
});

describe('choosing a voice on the device', () => {
  const voices = [
    { name: 'Google Deutsch', lang: 'de-DE' },
    { name: 'Microsoft David - English (United States)', lang: 'en-US' },
    { name: 'Google UK English Female', lang: 'en-GB' },
    { name: 'Google UK English Male', lang: 'en-GB' },
  ];

  it('picks a woman’s voice by name — and never a "Female" voice for a man, though it contains "male"', () => {
    expect(pickVoice(voices, 'woman')?.name).toBe('Google UK English Female');
    expect(pickVoice(voices, 'man')?.name).toBe('Microsoft David - English (United States)');
    expect(pickVoice([{ name: 'Google UK English Female', lang: 'en-GB' }], 'man')).toBeNull();
  });

  it('leaves "any" to the device’s own default voice', () => {
    expect(pickVoice(voices, 'any')).toBeNull();
  });

  it('⚠ with no matching voice, shifts the default voice’s pitch instead of pretending', () => {
    const none = [{ name: 'Google Deutsch', lang: 'de-DE' }];
    expect(speechPlan({ ...DEFAULT_VOICE, type: 'woman' }, none)).toMatchObject({
      voice: null,
      pitch: 1 + FALLBACK_PITCH_SHIFT,
    });
    expect(speechPlan({ ...DEFAULT_VOICE, type: 'man' }, none)).toMatchObject({
      voice: null,
      pitch: 1 - FALLBACK_PITCH_SHIFT,
    });
    expect(speechPlan({ ...DEFAULT_VOICE, type: 'woman' }, voices).pitch).toBe(1);
  });

  it('keeps every preset inside what the API accepts', () => {
    const shrillest = speechPlan({ ...DEFAULT_VOICE, type: 'woman', pitch: 'very_high' }, []);
    const quietest = speechPlan({ ...DEFAULT_VOICE, volume: 'soft', speed: 'slow', repeat: 2 }, []);
    expect(shrillest.pitch).toBeLessThanOrEqual(2);
    expect(quietest).toMatchObject({ volume: 0.4, rate: 0.7, repeat: 2 });
  });
});
