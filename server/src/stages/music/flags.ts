import fs from 'node:fs';
import path from 'node:path';
import {stageLogger} from '../../lib/logger.ts';
// Imported (not read with fs) so the production build emits the file next to flags.js: tsc copies imported JSON only. Python reads the same source file.
import contentMoodMapJson from './contentMoodMap.json' with {type: 'json'};

export type MusicMode = 'off' | 'dry' | 'live';
export type MusicBedSource = 'auto' | 'licensed' | 'generated' | 'off';

export type MusicModeDecision = {
  mode: MusicMode;
  requested: string;
  downgraded: boolean;
};

/** off | dry | live. Legacy `=1` is dry, or live when MUSIC_SPECIALIST_LIVE=1 and a key is present. */
export function resolveMusicMode(env: NodeJS.ProcessEnv = process.env): MusicModeDecision {
  const requested = (env.MUSIC_SPECIALIST ?? '').trim().toLowerCase();
  const liveFlag = env.MUSIC_SPECIALIST_LIVE === '1';
  const hasKey = Boolean((env.RUNWARE_API_KEY ?? '').trim());
  const wantLive = (mode: MusicMode): MusicModeDecision => {
    if (mode !== 'live') return {mode, requested, downgraded: false};
    if (isTestEnv(env)) return {mode: 'dry', requested, downgraded: true};
    if (hasKey) return {mode: 'live', requested, downgraded: false};
    return {mode: 'dry', requested, downgraded: true};
  };
  if (requested === 'live') return wantLive('live');
  if (requested === 'dry') return {mode: 'dry', requested, downgraded: false};
  if (requested === '1') return wantLive(liveFlag ? 'live' : 'dry');
  return {mode: 'off', requested, downgraded: false};
}

export function resolveBedSource(env: NodeJS.ProcessEnv = process.env): MusicBedSource {
  const raw = (env.MUSIC_BED_SOURCE ?? 'auto').trim().toLowerCase();
  if (raw === 'licensed' || raw === 'generated' || raw === 'off' || raw === 'auto') return raw;
  return 'auto';
}

export type DuckPresetChoice = 'talking' | 'default' | 'legacy_brief';

/** `talking` (relative to the measured voice) unless the env asks for an A/B preset. */
export function resolveDuckPreset(env: NodeJS.ProcessEnv = process.env): DuckPresetChoice {
  const raw = (env.MUSIC_DUCK_PRESET ?? '').trim().toLowerCase();
  if (raw === 'legacy_brief' || raw === 'default') return raw;
  return 'talking';
}

/** Vitest and NODE_ENV=test never reach a paid path. */
export function isTestEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VITEST) || env.NODE_ENV === 'test';
}

/** MUSIC_BED_FRESH=1 skips the pool and generates a new bed. */
export function bedFresh(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MUSIC_BED_FRESH === '1';
}

/** MUSIC_MIX_MEASURE=1 renders bed-only and VO-only stems locally after a local render and logs music.mix_measured. Default off. */
export function mixMeasureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MUSIC_MIX_MEASURE === '1';
}

/**
 * The VO-carved bed (bed_carved.wav) plays under speech, crossfaded with the full bed. Default ON (voice-first: the carved bed sits
 * further under the voice, which is the goal for talking-head). MUSIC_CARVED_TWIN=0 turns it off. Any other value, or unset, is on.
 * It only changes new blueprints: the URL is stored on the blueprint at analyze time, and `render-blueprint --carved 0|1` A/Bs it.
 */
export function carvedTwinEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MUSIC_CARVED_TWIN ?? '').trim() !== '0';
}

/**
 * Local renders run a two-pass loudnorm (I=-14, TP=-1, LRA=11) on the finished MP4 audio. Default ON: the unmastered mix lands near -22 LUFS.
 * MUSIC_MASTER_PASS=0 is the off switch. Any other value, or unset, is on.
 */
export function masterPassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MUSIC_MASTER_PASS ?? '').trim() !== '0';
}

/**
 * MUSIC_PERSONALIZE (default 1): each NEW edit gets a MusicBrief (style, tempo, key, arc) built from its own data, and the bed is placed on the video
 * (starts on a beat, lifts at the hook, ends on a bar line). 0 restores the Phase 2.4 behaviour: the 5 family moods and no placement.
 * Saved blueprints are never affected: the brief and the placement are stored on the blueprint at analyze time.
 */
export function personalizeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MUSIC_PERSONALIZE ?? '').trim() !== '0';
}

/** MUSIC_BED_POOL_SIZE: the most beds one mood pool holds. A generated bed is appended only while the pool is under this. Default 3. */
export function resolvePoolSize(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.MUSIC_BED_POOL_SIZE ?? '3');
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 3;
}

/** MUSIC_DUCK_RELEASE_MS: how long the bed takes to come back up after a phrase. Default 300 (150 ms hold stays). Stored on each new blueprint. */
export function resolveDuckReleaseSec(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.MUSIC_DUCK_RELEASE_MS ?? '').trim();
  const ms = Number(raw);
  return raw !== '' && Number.isFinite(ms) && ms >= 10 && ms <= 3000 ? ms / 1000 : 0.3;
}

export const MUSIC_CALLER_ENV ='MUSIC_SPECIALIST_CALLER';

export type SpawnSpec = {
  args: string[];
  mode: 'plan' | 'dry' | 'live';
  env: NodeJS.ProcessEnv;
  forced: boolean;
};

/**
 * Pure: the argv and child env for one `music_specialist` spawn.
 * Under test, live is forced to dry. The pipeline token is set only on a live child.
 */
export function buildSpawnSpec(requested: 'plan' | 'dry' | 'live', env: NodeJS.ProcessEnv = process.env): SpawnSpec {
  const forced = requested === 'live' && isTestEnv(env);
  const mode = forced ? 'dry' : requested;
  const childEnv: NodeJS.ProcessEnv = {...env};
  delete childEnv[MUSIC_CALLER_ENV];
  if (mode === 'live') childEnv[MUSIC_CALLER_ENV] = 'pipeline';
  return {args: ['-m', 'music_specialist', '--mode', mode], mode, env: childEnv, forced};
}

const MOOD_BUCKETS: Array<[string[], string]> = [
  [['high-energy', 'energetic', 'hype', 'upbeat'], 'high-energy'],
  [['nostalgic', 'warm', 'sentimental'], 'nostalgic'],
  [['calm', 'relax', 'chill', 'soft'], 'calm'],
  [['tense', 'dark', 'suspense', 'dramatic'], 'tense'],
  [['neutral'], 'neutral'],
];

const moodLog = stageLogger('music');

/** VisualMood → music mood. Single source of truth shared with agents/music_specialist/prompts.py. */
export function loadContentMoodMap(): Record<string, string> {
  return contentMoodMapJson as Record<string, string>;
}

/**
 * MoodSpec name the Python side will resolve for this tone (mirror of prompts.py resolve_mood).
 * MUSIC_BED_MOOD forces a pool name. Exact VisualMood lookup runs before the keyword buckets.
 */
export function resolveMoodPool(tone: string, env: NodeJS.ProcessEnv = process.env): string {
  const forced = (env.MUSIC_BED_MOOD ?? '').trim().toLowerCase();
  if (MOOD_BUCKETS.some(([, name]) => name === forced)) return forced;
  const text = (tone || '').trim().toLowerCase();
  const mapped = loadContentMoodMap()[text];
  if (mapped) return mapped;
  for (const [keys, name] of MOOD_BUCKETS) {
    if (keys.some(key => text.includes(key))) return name;
  }
  if (text) moodLog.warn({tone}, 'music.mood_unmapped');
  return 'neutral';
}

/** The resolver stops waiting at this point. The child is never killed for it. */
export function resolveHardKillMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.MUSIC_SPECIALIST_HARD_KILL_MS ?? '300000');
  return Number.isFinite(parsed) && parsed >= 10000 ? parsed : 300000;
}

export function resolveMaxUsd(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.MUSIC_SPECIALIST_MAX_USD ?? '0.02');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.02;
}

export function resolveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.MUSIC_SPECIALIST_TIMEOUT_MS ?? '45000');
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 45000;
}

export function sfxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MUSIC_SPECIALIST_SFX === '1';
}

export function resolvePython(agentsDir: string, env: NodeJS.ProcessEnv = process.env): {command: string; via: string} {
  const explicit = (env.MUSIC_SPECIALIST_PYTHON ?? '').trim();
  if (explicit) return {command: explicit, via: 'MUSIC_SPECIALIST_PYTHON'};
  const venv = path.join(agentsDir, '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return {command: venv, via: 'agents/.venv'};
  return {command: 'python3', via: 'python3'};
}

/** Masks a secret value and any Authorization bearer token. */
export function redactSecrets(text: string, secret?: string): string {
  let out = text;
  const key = (secret ?? '').trim();
  if (key.length >= 4) out = out.split(key).join('[redacted]');
  out = out.replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [redacted]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [redacted]');
  return out;
}
