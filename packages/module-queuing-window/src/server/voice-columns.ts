import { normalizeVoice, type QueueVoice } from '../domain/voice.js';

/** The voice as `queue_settings` stores it: one column per field. */
export interface VoiceColumns {
  voiceEnabled: boolean;
  voiceType: string;
  voicePitch: string;
  voiceSpeed: string;
  voiceVolume: string;
  voiceRepeat: number;
}

export function voiceColumns(voice: QueueVoice): VoiceColumns {
  return {
    voiceEnabled: voice.enabled,
    voiceType: voice.type,
    voicePitch: voice.pitch,
    voiceSpeed: voice.speed,
    voiceVolume: voice.volume,
    voiceRepeat: voice.repeat,
  };
}

/** A settings row's voice, or the defaults for a workspace with no row yet. */
export function voiceOf(row: VoiceColumns | null | undefined): QueueVoice {
  if (!row) return normalizeVoice(null);
  return normalizeVoice({
    enabled: row.voiceEnabled,
    type: row.voiceType,
    pitch: row.voicePitch,
    speed: row.voiceSpeed,
    volume: row.voiceVolume,
    repeat: row.voiceRepeat,
  });
}
