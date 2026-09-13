import type { QueueVoice, VoicePitch, VoiceSpeed, VoiceType, VoiceVolume } from '../../domain/voice.js';

/**
 * Turning a workspace's voice presets into what the Web Speech API takes —
 * pure, so it is tested without a browser.
 */

/** The part of a `SpeechSynthesisVoice` that choosing one needs. */
export interface VoiceLike {
  name: string;
  lang: string;
}

/*
 * Voice NAMES known to be a woman's or a man's, across Chrome, Edge, Safari,
 * Android and Windows. The API gives nothing better. ⚠ Checked women first:
 * "Female" contains "male", and only the word boundary keeps them apart.
 */
const WOMEN =
  /\b(female|woman|zira|hazel|susan|heera|samantha|victoria|karen|moira|tessa|fiona|veena|allison|ava|kate|serena|libby|sonia|maisie|aria|jenny|michelle|emma|natasha|clara|salli|joanna|kendra|kimberly|ivy|amy|olivia|blessica|google us english)\b/i;
const MEN =
  /\b(male|man|david|mark|george|james|daniel|alex|fred|oliver|arthur|guy|ryan|william|thomas|brian|matthew|joey|justin|russell|christopher|eric|roger|angelo)\b/i;

const soundsLike = (name: string, type: Exclude<VoiceType, 'any'>): boolean =>
  type === 'woman' ? WOMEN.test(name) : !WOMEN.test(name) && MEN.test(name);

/**
 * The voice to read with, or null for the browser's own default.
 *
 * English voices first, because the sentence is English. `any` is always null:
 * the device's default voice is what every TV used before this setting existed.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], type: VoiceType): V | null {
  if (type === 'any') return null;
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  return pool.find((voice) => soundsLike(voice.name, type)) ?? null;
}

const PITCH: Record<VoicePitch, number> = { low: 0.6, normal: 1, high: 1.4, very_high: 1.8 };
const RATE: Record<VoiceSpeed, number> = { slow: 0.7, normal: 0.9, fast: 1.15 };
const VOLUME: Record<VoiceVolume, number> = { soft: 0.4, medium: 0.7, full: 1 };

/** How far a device with no woman's or man's voice shifts its own default instead. */
export const FALLBACK_PITCH_SHIFT = 0.3;

export interface SpeechPlan<V extends VoiceLike = VoiceLike> {
  voice: V | null;
  /** 0–2. */
  pitch: number;
  rate: number;
  /** 0–1. */
  volume: number;
  repeat: number;
}

export function speechPlan<V extends VoiceLike>(voice: QueueVoice, voices: readonly V[]): SpeechPlan<V> {
  const picked = pickVoice(voices, voice.type);
  const shift =
    picked || voice.type === 'any' ? 0 : voice.type === 'woman' ? FALLBACK_PITCH_SHIFT : -FALLBACK_PITCH_SHIFT;
  return {
    voice: picked,
    pitch: Math.min(2, Math.max(0, PITCH[voice.pitch] + shift)),
    rate: RATE[voice.speed],
    volume: VOLUME[voice.volume],
    repeat: voice.repeat,
  };
}
