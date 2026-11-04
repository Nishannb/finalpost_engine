import {spawn} from 'node:child_process';
import path from 'node:path';

import {stageLogger} from '../../lib/logger.ts';
import {
  bedFresh,
  buildSpawnSpec,
  redactSecrets,
  resolveBedSource,
  resolveHardKillMs,
  resolveMaxUsd,
  resolveMoodPool,
  resolveMusicMode,
  resolvePython,
  resolveTimeoutMs,
  sfxEnabled,
} from './flags.ts';
import {musicResultSchema, type MusicResult} from './schema.ts';
import {flushSpool, removeSpool, spoolDir, writeSpool} from './spool.ts';
import type {MusicBrief} from './musicBrief.ts';
import type {BedPlacementMeta} from './placementMeta.ts';
import {cachedMoodBed, findUploadedBed, pickPoolBed, readPool, uploadBed, uploadBedDetailed, type PoolBed} from './uploadBed.ts';

const log = stageLogger('music');

export type MusicJob = {
  transcript_segments: Array<{text: string; start_ms: number; end_ms: number}>;
  visual_cuts: Array<{at_ms: number; kind?: string}>;
  emotional_tone: string;
  canvas_sec: number;
  include_sfx?: boolean;
  seed?: number;
  /** Stable per source video. Seeds the bed and picks the pool bed. Never the blueprint id. */
  video_id?: string;
  /** Personalised generation: the brief for this video. Absent = the family mood from emotional_tone, as before. */
  brief?: Pick<MusicBrief, 'style' | 'family' | 'bpm' | 'key' | 'arc'>;
};

export type MusicPlan = {
  cacheKey: string;
  seed: number;
  bpm: number;
  musicalKey: string;
  mood: string;
  url: string | null;
  costUsd: number;
  estimatedCostUsd: number;
  integratedLufs?: number;
  durationSec?: number;
  promptVersion: number;
  postprocessVersion?: number;
  source: 'generated';
  /** Personalised: the style this bed was made for (or picked for), its family and the arc that was REQUESTED. */
  style?: string;
  family?: string;
  arc?: string;
  /** Measured on the bed (downbeats, energy map, lift). Absent on old pool entries. */
  placement?: BedPlacementMeta;
  /** Which fallback tier supplied this bed when generation failed: the same style, or the same family. */
  fallbackTier?: 'style' | 'family';
  /** Why this plan is a fallback (a pool bed used because generation failed). Absent on a normal plan. */
  fallbackReason?: string;
  /** True when the bed came from the mood pool (no generation, $0). */
  fromPool?: boolean;
  /** Public URL of the loop body. Unset until an upload provides one. */
  loopUrl?: string | null;
  /** Public URL of bed_full.wav (the trimmed bed). Unset until an upload provides one. */
  fullUrl?: string | null;
  /** Public URL of bed_carved.wav. Played under speech only when MUSIC_CARVED_TWIN=1. */
  carvedUrl?: string | null;
  /** Local bar-aligned loop wav from the specialist. */
  loopFilePath?: string;
  /** Duration of the full bed, set when a clean loop exists. */
  fullDurationSec?: number;
};

export function agentsDir(): string {
  return path.resolve(process.cwd(), process.cwd().endsWith(`${path.sep}server`) ? '../agents' : 'agents');
}

type SpawnFn = typeof spawn;

/**
 * Runs the Python specialist. Does NOT kill the child when the resolver stops waiting (that
 * would throw away a paid file). Only the hard ceiling (MUSIC_SPECIALIST_HARD_KILL_MS) kills it.
 */
export function spawnMusic(
  requested: 'plan' | 'dry' | 'live',
  payload: MusicJob,
  deps: {spawnImpl?: SpawnFn; hardKillMs?: number; env?: NodeJS.ProcessEnv} = {},
): Promise<MusicResult> {
  const env = deps.env ?? process.env;
  const hardKillMs = deps.hardKillMs ?? resolveHardKillMs(env);
  const spec = buildSpawnSpec(requested, env);
  if (spec.forced) log.warn({requested, mode: spec.mode}, 'music.mode_forced_test');
  const python = resolvePython(agentsDir(), env);
  log.info({via: python.via, mode: spec.mode}, 'music.python');
  const secret = env.RUNWARE_API_KEY;
  const doSpawn = deps.spawnImpl ?? spawn;
  return new Promise((resolve, reject) => {
    const child = doSpawn(python.command, spec.args, {
      cwd: agentsDir(),
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      log.warn({hardKillMs}, 'music.hard_kill');
      child.kill('SIGKILL');
    }, hardKillMs);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(new Error(redactSecrets(error.message, secret)));
    });
    child.on('close', code => {
      clearTimeout(timer);
      const safeErr = redactSecrets(err, secret).slice(0, 500);
      if (code !== 0) {
        reject(new Error(`music_specialist exited ${code}: ${safeErr}`));
        return;
      }
      try {
        const parsed = musicResultSchema.parse(JSON.parse(out));
        if (typeof parsed.qc_vocal_score === 'number') log.info({score: parsed.qc_vocal_score}, 'music.qc_vocal_score');
        if (parsed.qc_speech_band) log.info({...parsed.qc_speech_band}, 'music.qc_speech_band');
        resolve(parsed);
      } catch (error) {
        reject(new Error(`music schema: ${redactSecrets(error instanceof Error ? error.message : String(error), secret)}`));
      }
    });
    child.stdin.end(JSON.stringify({...payload, max_usd: resolveMaxUsd(env), timeout_sec: Math.max(1, hardKillMs / 1000 - 5)}));
  });
}

function toPlan(result: MusicResult, url: string | null): MusicPlan {
  return {
    cacheKey: result.cache_key,
    seed: result.seed,
    bpm: result.bpm,
    musicalKey: result.key,
    mood: result.mood ?? 'neutral',
    url,
    costUsd: result.cost_usd ?? 0,
    estimatedCostUsd: result.estimated_cost_usd ?? 0,
    ...(result.integrated_lufs !== undefined ? {integratedLufs: result.integrated_lufs} : {}),
    ...(result.duration_sec !== undefined ? {durationSec: result.duration_sec} : {}),
    ...(result.style ? {style: result.style} : {}),
    ...(result.family ? {family: result.family} : {}),
    ...(result.arc ? {arc: result.arc} : {}),
    ...(result.downbeat_times && result.downbeat_times.length > 0
      ? {
          placement: {
            downbeatTimes: result.downbeat_times,
            energyMap: result.energy_map ?? [],
            liftSec: result.lift_sec ?? null,
            liftBar: result.lift_bar ?? null,
            barSec: result.bar_sec ?? null,
            fullDurationSec: result.duration_sec ?? null,
            loopDurationSec: result.loop_duration_sec ?? null,
            loopBars: result.loop_bars ?? null,
            hasLoop: Boolean(result.bed_loop_path) && result.loop_fallback === false,
          } satisfies BedPlacementMeta,
        }
      : {}),
    promptVersion: result.prompt_version,
    ...(result.postprocess_version !== undefined ? {postprocessVersion: result.postprocess_version} : {}),
    source: 'generated',
    ...(result.bed_loop_path && result.loop_duration_sec !== undefined && result.loop_fallback === false && result.duration_sec !== undefined
      ? {loopFilePath: result.bed_loop_path, fullDurationSec: result.duration_sec}
      : {}),
  };
}

export function poolPlan(bed: PoolBed, mood: string): MusicPlan {
  return {
    cacheKey: bed.cache_key,
    seed: bed.seed ?? 0,
    bpm: bed.bpm ?? 0,
    musicalKey: bed.key ?? '',
    mood,
    url: bed.url,
    costUsd: 0,
    estimatedCostUsd: 0,
    ...(bed.integrated_lufs !== undefined ? {integratedLufs: bed.integrated_lufs} : {}),
    ...(bed.duration_sec !== undefined ? {durationSec: bed.duration_sec} : {}),
    promptVersion: 0,
    source: 'generated',
    fromPool: true,
    ...(bed.full_url ? {fullUrl: bed.full_url} : {}),
    ...(bed.carved_url ? {carvedUrl: bed.carved_url} : {}),
    ...(bed.loop_url ? {loopUrl: bed.loop_url, ...(bed.duration_sec !== undefined ? {fullDurationSec: bed.duration_sec} : {})} : {}),
  };
}

function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

async function failOpen(mood: string, reason: string, videoId: string): Promise<MusicPlan | null> {
  log.warn({reason}, 'music.fallback');
  const cached = await cachedMoodBed(mood, videoId).catch(() => null);
  return cached ? {...poolPlan(cached, mood), fallbackReason: reason} : null;
}

async function runMusicPlan(job: MusicJob): Promise<MusicPlan | null> {
  const decision = resolveMusicMode();
  if (decision.downgraded) log.warn({from: decision.requested || 'live', to: decision.mode}, 'music.mode_downgraded');
  if (decision.mode === 'off') return null;
  const bedSource = resolveBedSource();
  const licensedSet = Boolean((process.env.POLISH_MUSIC_BED_URL ?? '').trim());
  if (bedSource === 'off' || bedSource === 'licensed') return null;
  if (bedSource === 'auto' && licensedSet) return null;
  const videoId = job.video_id ?? '';
  const mood = resolveMoodPool(job.emotional_tone || 'neutral');
  const spawnMode = buildSpawnSpec(decision.mode).mode;
  const dry = spawnMode !== 'live';
  const fresh = bedFresh();
  try {
    try {
      const flushed = await flushSpool({
        dir: spoolDir(),
        upload: entry => uploadBed({filePath: entry.filePath, cacheKey: entry.cacheKey, mood: entry.mood, dry: entry.dry, meta: entry.meta}),
      });
      if (flushed > 0) log.info({count: flushed}, 'music.spool_flushed');
    } catch (error) {
      log.warn({reason: error instanceof Error ? error.message : String(error)}, 'music.spool_flush_failed');
    }
    // Pool first: a mood with a bed never spawns Python. Dry reads the real pool too; dry writes go to a separate prefix.
    if (!fresh) {
      const picked = pickPoolBed(videoId, await readPool(mood));
      if (picked) {
        log.info({mood, cache_key: picked.cache_key, host: urlHost(picked.url), cost_usd: 0, video_id: videoId}, 'music.pool_hit');
        return poolPlan(picked, mood);
      }
    }
    if (fresh) log.info({mood}, 'music.pool_skipped_fresh');
    const jobWithSfx = {...job, include_sfx: job.include_sfx ?? sfxEnabled()};
    const plan = await spawnMusic('plan', jobWithSfx);
    const estimate = plan.estimated_cost_usd ?? 0.0075;
    if (estimate > resolveMaxUsd()) return failOpen(mood, 'cost_cap', videoId);
    const cached = await findUploadedBed(plan.cache_key, dry);
    if (cached) {
      log.info({cache_key: plan.cache_key, cost_usd: 0}, 'music.cache_hit');
      return toPlan(plan, cached);
    }
    const generated = await spawnMusic(decision.mode, {...jobWithSfx, seed: plan.seed});
    if (!generated.bed_path) return failOpen(mood, 'no_bed', videoId);
    let uploaded: Awaited<ReturnType<typeof uploadBedDetailed>>;
    const uploadMeta = {
      prompt: generated.caption,
      seed: generated.seed,
      cost: generated.cost_usd ?? 0,
      lufs: generated.integrated_lufs,
      integrated_lufs: generated.integrated_lufs,
      duration_sec: generated.duration_sec,
      bpm: generated.bpm,
      key: generated.key,
      prompt_version: generated.prompt_version,
      postprocess_version: generated.postprocess_version,
      trailing_trimmed_sec: generated.trailing_trimmed_sec,
      qc_passed: generated.qc_passed,
      qc_silence_sec: generated.qc_silence_sec,
      qc_true_peak_dbfs: generated.qc_true_peak_dbfs,
      qc_bpm_error_ratio: generated.qc_bpm_error_ratio,
      qc_seam_db: generated.qc_seam_db,
      qc_vocal_score: generated.qc_vocal_score,
      qc_speech_band: generated.qc_speech_band,
    };
    const spoolRoot = spoolDir();
    try {
      await writeSpool({dir: spoolRoot, cacheKey: generated.cache_key, filePath: generated.bed_path, meta: {mood: generated.mood ?? mood, dry, meta: uploadMeta}});
    } catch (error) {
      log.warn({reason: error instanceof Error ? error.message : String(error)}, 'music.spool_write_failed');
    }
    try {
      const loopOk = Boolean(generated.bed_loop_path) && generated.loop_fallback === false;
      uploaded = await uploadBedDetailed({
        filePath: generated.bed_path,
        cacheKey: generated.cache_key,
        mood: generated.mood ?? mood,
        dry,
        meta: uploadMeta,
        ...(loopOk ? {loopFilePath: generated.bed_loop_path} : {}),
        ...(generated.bed_full_path ? {fullFilePath: generated.bed_full_path} : {}),
        ...(generated.bed_carved_path ? {carvedFilePath: generated.bed_carved_path} : {}),
      });
      await removeSpool(spoolRoot, generated.cache_key).catch(() => undefined);
    } catch (error) {
      const reason = error instanceof Error && error.message === 'r2_unconfigured' ? 'r2_unconfigured' : 'upload';
      return failOpen(mood, reason, videoId);
    }
    log.info({cost_usd: generated.cost_usd ?? 0, cache_key: generated.cache_key, bpm: generated.bpm, seed: generated.seed}, 'music.generated');
    const plan2 = toPlan(generated, uploaded.url);
    return {
      ...plan2,
      ...(uploaded.fullUrl ? {fullUrl: uploaded.fullUrl} : {}),
      ...(uploaded.loopUrl && generated.duration_sec !== undefined ? {loopUrl: uploaded.loopUrl, fullDurationSec: generated.duration_sec} : {}),
      ...(uploaded.carvedUrl ? {carvedUrl: uploaded.carvedUrl} : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /timeout|SIGKILL|exited null/i.test(message) ? 'timeout' : 'spawn';
    return failOpen(mood, reason, videoId);
  }
}

/** Starts immediately and never rejects. Resolves null when the specialist is off or generation fails open. */
export function startMusicPlan(job: MusicJob): Promise<MusicPlan | null> {
  return runMusicPlan(job).catch(error => {
    log.warn({reason: error instanceof Error ? error.message : String(error)}, 'music.fallback');
    return null;
  });
}

/**
 * The resolver's wait. Stops waiting after MUSIC_SPECIALIST_TIMEOUT_MS (counted from this call) and
 * continues with no bed. The generation is NOT cancelled: when it later finishes (uploaded into the
 * pool by runMusicPlan) it logs music.late, and the next edit gets a pool hit.
 */
export async function awaitMusicPlan(pending: Promise<MusicPlan | null>, timeoutMs: number = resolveTimeoutMs()): Promise<MusicPlan | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const first = await Promise.race([pending, timeout]);
  if (timer) clearTimeout(timer);
  if (first !== 'timeout') return first;
  log.warn({reason: 'timeout', timeoutMs}, 'music.fallback');
  void pending.then(plan => {
    if (plan?.url && !plan.fromPool) log.info({cache_key: plan.cacheKey, cost_usd: plan.costUsd}, 'music.late');
  });
  return null;
}

/** @deprecated Prefer startMusicPlan. Kept for the opt-in unit test. */
export async function planMusicForDirector(payload: unknown): Promise<MusicPlan | null> {
  if (resolveMusicMode().mode === 'off') return null;
  const record = payload && typeof payload === 'object' ? payload as Partial<MusicJob> : {};
  return startMusicPlan({
    transcript_segments: record.transcript_segments ?? [],
    visual_cuts: record.visual_cuts ?? [],
    emotional_tone: record.emotional_tone ?? 'neutral',
    canvas_sec: record.canvas_sec ?? 60,
    include_sfx: record.include_sfx,
    ...(record.video_id ? {video_id: record.video_id} : {}),
  });
}
