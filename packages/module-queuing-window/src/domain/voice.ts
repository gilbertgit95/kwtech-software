/**
 * How a TV reads a call aloud — one setting per workspace.
 *
 * ## Presets, not numbers
 *
 * A browser speaks with a pitch from 0 to 2, a rate from 0.1 to 10 and a volume
 * from 0 to 1. A supervisor setting up a waiting room should not have to learn
 * that 1.8 is shrill or 3 is a blur, so the choices are named, and every one
 * maps to a value that sounds reasonable (`speechPlan` in the web half).
 *
 * Stored as TEXT, not a Prisma enum: adding a preset is then a code change
 * rather than a migration, and a value that stops being offered reads back as
 * its default (`normalizeVoice`) instead of breaking every TV.
 *
 * ## ⚠ "Woman" and "Man" are a PREFERENCE
 *
 * The Web Speech API does not say what a voice sounds like — only its name and
 * language. A TV picks a voice whose name is known to be a woman's or a man's,
 * and a TV that has none uses its own default voice pitched a little higher or
 * lower. The settings page says so, rather than promising what a device cannot.
 *
 * English only, like `spokenLabel` — §12.64 (language) is still open.
 */

export const VOICE_TYPES = ['any', 'woman', 'man'] as const;
export const VOICE_PITCHES = ['low', 'normal', 'high', 'very_high'] as const;
export const VOICE_SPEEDS = ['slow', 'normal', 'fast'] as const;
export const VOICE_VOLUMES = ['soft', 'medium', 'full'] as const;
/** How many times each call is read. Twice helps a noisy room; more is a nuisance. */
export const VOICE_REPEATS = [1, 2] as const;

export type VoiceType = (typeof VOICE_TYPES)[number];
export type VoicePitch = (typeof VOICE_PITCHES)[number];
export type VoiceSpeed = (typeof VOICE_SPEEDS)[number];
export type VoiceVolume = (typeof VOICE_VOLUMES)[number];
export type VoiceRepeat = (typeof VOICE_REPEATS)[number];

export interface QueueVoice {
  /** Off means the chime only. */
  enabled: boolean;
  type: VoiceType;
  pitch: VoicePitch;
  speed: VoiceSpeed;
  volume: VoiceVolume;
  repeat: VoiceRepeat;
}

/** As it crosses the wire: plain strings, not yet trusted. */
export interface StoredVoice {
  enabled: boolean;
  type: string;
  pitch: string;
  speed: string;
  volume: string;
  repeat: number;
}

/** What a workspace that never chose hears — the voice every TV had before this setting. */
export const DEFAULT_VOICE: QueueVoice = {
  enabled: true,
  type: 'any',
  pitch: 'normal',
  speed: 'normal',
  volume: 'full',
  repeat: 1,
};

export const VOICE_LABELS = {
  type: { any: "The display's own voice", woman: 'Woman', man: 'Man' },
  pitch: { low: 'Low', normal: 'Normal', high: 'High', very_high: 'Very high' },
  speed: { slow: 'Slow', normal: 'Normal', fast: 'Fast' },
  volume: { soft: 'Soft', medium: 'Medium', full: 'Full' },
  repeat: { 1: 'Once', 2: 'Twice' },
} as const satisfies {
  type: Record<VoiceType, string>;
  pitch: Record<VoicePitch, string>;
  speed: Record<VoiceSpeed, string>;
  volume: Record<VoiceVolume, string>;
  repeat: Record<VoiceRepeat, string>;
};

/** What each field is called in a refusal. */
export const VOICE_FIELD_LABELS: Record<keyof QueueVoice, string> = {
  enabled: 'announcement switch',
  type: 'voice',
  pitch: 'pitch',
  speed: 'speed',
  volume: 'volume',
  repeat: 'repeat',
};

type VoiceInput = Partial<Record<keyof QueueVoice, unknown>>;

const oneOf = <T extends string | number>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value);

/**
 * The first field that is not one of the choices, or null when all are.
 *
 * ⚠ ALL SIX ARE REQUIRED. A write replaces the whole voice, so a missing field
 * is refused rather than quietly reset to its default.
 */
export function voiceRefusal(input: VoiceInput): keyof QueueVoice | null {
  if (typeof input.enabled !== 'boolean') return 'enabled';
  if (!oneOf(VOICE_TYPES, input.type)) return 'type';
  if (!oneOf(VOICE_PITCHES, input.pitch)) return 'pitch';
  if (!oneOf(VOICE_SPEEDS, input.speed)) return 'speed';
  if (!oneOf(VOICE_VOLUMES, input.volume)) return 'volume';
  if (!oneOf(VOICE_REPEATS, input.repeat)) return 'repeat';
  return null;
}

/** Whatever was stored or sent, as a voice a TV can use. Anything not offered reads as its default. */
export function normalizeVoice(input: VoiceInput | null | undefined): QueueVoice {
  const value = input ?? {};
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_VOICE.enabled,
    type: oneOf(VOICE_TYPES, value.type) ? value.type : DEFAULT_VOICE.type,
    pitch: oneOf(VOICE_PITCHES, value.pitch) ? value.pitch : DEFAULT_VOICE.pitch,
    speed: oneOf(VOICE_SPEEDS, value.speed) ? value.speed : DEFAULT_VOICE.speed,
    volume: oneOf(VOICE_VOLUMES, value.volume) ? value.volume : DEFAULT_VOICE.volume,
    repeat: oneOf(VOICE_REPEATS, value.repeat) ? value.repeat : DEFAULT_VOICE.repeat,
  };
}
