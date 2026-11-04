import type {AudioDesign} from '../../types/blueprint.ts';
import type {DuckEnvelope} from './duckEnvelope.ts';
import {carvedTwinEnabled} from './flags.ts';
import type {MusicPlan} from './musicSpecialist.ts';
import type {ResolvedMusicBed} from './resolveMusicBed.ts';

/** Playback inputs from a plan. Carved is passed only when MUSIC_CARVED_TWIN=1. */
export function playbackFromPlan(
  plan: Pick<MusicPlan, 'url' | 'loopUrl' | 'fullUrl' | 'fullDurationSec' | 'carvedUrl'> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): {loop?: {fullUrl: string; loopUrl: string; fullDurationSec: number}; carvedUrl?: string} {
  if (!plan) return {};
  const fullUrl = plan.fullUrl ?? plan.url;
  return {
    ...(plan.loopUrl && plan.fullDurationSec && fullUrl
      ? {loop: {fullUrl, loopUrl: plan.loopUrl, fullDurationSec: plan.fullDurationSec}}
      : {}),
    ...(carvedTwinEnabled(env) && plan.carvedUrl ? {carvedUrl: plan.carvedUrl} : {}),
  };
}

/**
 * Maps a single resolved bed onto AudioDesign.
 * Licensed beds keep the legacy 0.18 / 0.04 gains.
 * Generated beds carry the dB envelope and do not set those gains.
 */
export function toAudioDesign(input: {
  existing?: AudioDesign;
  resolved: ResolvedMusicBed | null;
  duck?: DuckEnvelope | null;
  mood?: string;
  voLufs?: number;
  /** Generated beds only. Absent → single looping musicUrl, as before. */
  loop?: {fullUrl?: string; loopUrl: string; fullDurationSec: number} | null;
  /** Generated beds only. Public URL of bed_carved.wav; ignored when empty. */
  carvedUrl?: string | null;
}): AudioDesign {
  const existing = input.existing;
  const base: AudioDesign = {
    ...(existing?.musicMood ? {musicMood: existing.musicMood} : {}),
    ...(existing?.ducking !== undefined ? {ducking: existing.ducking} : {}),
    sfx: existing?.sfx ?? [],
    ...(existing?.hits ? {hits: existing.hits} : {}),
  };
  if (!input.resolved) return base;
  if (input.resolved.source === 'licensed') {
    return {
      ...base,
      musicMood: base.musicMood ?? 'polish_upbeat',
      musicUrl: input.resolved.url,
      musicGain: existing?.musicGain ?? 0.18,
      duckedGain: existing?.duckedGain ?? 0.04,
      ducking: true,
      musicSource: 'licensed',
    };
  }
  return {
    ...base,
    musicMood: base.musicMood ?? input.mood ?? 'neutral',
    musicUrl: input.resolved.url,
    ducking: true,
    musicSource: 'generated',
    ...(input.resolved.bpm !== undefined ? {musicBpm: input.resolved.bpm} : {}),
    ...(input.loop
      ? {
          musicFullUrl: input.loop.fullUrl ?? input.resolved.url,
          musicLoopUrl: input.loop.loopUrl,
          musicFullDurationSec: input.loop.fullDurationSec,
        }
      : {}),
    ...(input.carvedUrl ? {musicCarvedUrl: input.carvedUrl} : {}),
    ...(input.duck ? {duck: input.duck} : {}),
    ...(input.voLufs !== undefined ? {voLufs: input.voLufs} : {}),
  };
}
