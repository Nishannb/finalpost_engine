import {spawn} from 'node:child_process';
import path from 'node:path';

import {stageLogger} from '../../lib/logger.ts';
import {
  bedFresh,
  buildSpawnSpec,
  isProductionEnv,
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
import {musicResultSchema, type MusicResult, type PaidFailure} from './schema.ts';
import {flushSpool, removeSpool, spoolDir, writeSpool} from './spool.ts';
import type {MusicBrief} from './musicBrief.ts';
import type {BedPlacementMeta} from './placementMeta.ts';
import {BRIEF_RULES} from './musicBrief.ts';
import {findUploadedBed, pickNearestBpm, pickPoolBed, placementPoolFields, readBedMeta, readPool, uploadBed, uploadBedDetailed, type PoolBed} from './uploadBed.ts';
import {
  claimGeneration,
  resolveGeneration,
  resolveMusicLedgerStore,
  viewLedger,
  type LedgerView,
  type MusicLedgerAsset,
  type MusicLedgerRecord,
  type MusicLedgerResolution,
  type MusicLedgerStore,
} from './generationLedger.ts';

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
        const failure = new Error(`music_specialist exited ${code}: ${safeErr}`) as Error & {paid?: PaidFailure};
        const paid = parsePaidFailure(redactSecrets(err, secret));
        if (paid) failure.paid = paid;
        reject(failure);
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
    // Phase 1.7.3: the server NEVER authorises the agent's paid QC retry. Written after the spread, so no job field can override it.
    child.stdin.end(JSON.stringify({...payload, allow_qc_retry: false, max_usd: resolveMaxUsd(env), timeout_sec: Math.max(1, hardKillMs / 1000 - 5)}));
  });
}

/** The agent's one machine-readable line when a paid request ended without a usable bed. Anything malformed is ignored (the failure is then an ordinary spawn failure). */
export function parsePaidFailure(stderr: string): PaidFailure | null {
  const match = /MUSIC_PAID_FAILURE (\{[^\n]*\})/.exec(stderr);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!) as {stage?: unknown; cost_usd?: unknown; accounting?: unknown};
    if (parsed.stage !== 'post' && parsed.stage !== 'download') return null;
    const cost = typeof parsed.cost_usd === 'number' && Number.isFinite(parsed.cost_usd) ? parsed.cost_usd : null;
    const accounting = parsed.accounting && typeof parsed.accounting === 'object' ? (parsed.accounting as Record<string, unknown>) : {};
    return {stage: parsed.stage, costUsd: cost, accounting};
  } catch {
    return null;
  }
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
            ...(result.loudness_map && result.loudness_map.length > 0 ? {loudnessMap: result.loudness_map} : {}),
            ...(result.carved_loudness_map && result.carved_loudness_map.length > 0 ? {carvedLoudnessMap: result.carved_loudness_map} : {}),
            ...(result.loop_loudness_map && result.loop_loudness_map.length > 0 ? {loopLoudnessMap: result.loop_loudness_map} : {}),
            ...(result.loop_lufs !== undefined ? {loopLufs: result.loop_lufs} : {}),
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
    ...(bed.style ? {style: bed.style} : {}),
    ...(bed.family ? {family: bed.family} : {}),
    ...(bed.arc ? {arc: bed.arc} : {}),
    ...(bed.downbeat_times && bed.downbeat_times.length > 0
      ? {
          placement: {
            downbeatTimes: bed.downbeat_times,
            energyMap: bed.energy_map ?? [],
            liftSec: bed.lift_sec ?? null,
            liftBar: bed.lift_bar ?? null,
            barSec: bed.bar_sec ?? null,
            fullDurationSec: bed.duration_sec ?? null,
            loopDurationSec: bed.loop_duration_sec ?? null,
            loopBars: bed.loop_bars ?? null,
            hasLoop: Boolean(bed.loop_url) && Boolean(bed.loop_duration_sec),
            ...(bed.loudness_map && bed.loudness_map.length > 0 ? {loudnessMap: bed.loudness_map} : {}),
            ...(bed.carved_loudness_map && bed.carved_loudness_map.length > 0 ? {carvedLoudnessMap: bed.carved_loudness_map} : {}),
            ...(bed.loop_loudness_map && bed.loop_loudness_map.length > 0 ? {loopLoudnessMap: bed.loop_loudness_map} : {}),
            ...(bed.loop_lufs !== undefined ? {loopLufs: bed.loop_lufs} : {}),
          },
        }
      : {}),
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

/**
 * Generation failed, timed out or missed the cost cap. Fallback order: the pool bed of the SAME STYLE with the nearest tempo; else the same FAMILY (the
 * family pool and every style pool in that family), nearest tempo; else no bed. Logs music.fallback {reason, tier}. The salvaged bed lives in the family pool.
 */
export async function failOpen(poolKey: string, reason: string, videoId: string, brief?: MusicJob['brief']): Promise<MusicPlan | null> {
  try {
    const target = brief?.bpm ?? 0;
    const pick = (beds: readonly PoolBed[]) => (target > 0 ? pickNearestBpm(videoId, beds, target) : pickPoolBed(videoId, beds));
    const styleBed = pick(await readPool(poolKey).catch(() => []));
    if (styleBed) {
      log.warn({reason, tier: 'style', style: poolKey}, 'music.fallback');
      return {...poolPlan(styleBed, poolKey), fallbackReason: reason, fallbackTier: 'style'};
    }
    const family = brief?.family ?? poolKey;
    const familyPools = [family, ...Object.entries(BRIEF_RULES.styles).filter(([name, rule]) => rule.family === family && name !== poolKey).map(([name]) => name)];
    const familyBeds: PoolBed[] = [];
    for (const name of familyPools) familyBeds.push(...(await readPool(name).catch(() => [])));
    const familyBed = pick(familyBeds);
    if (familyBed) {
      log.warn({reason, tier: 'family', family}, 'music.fallback');
      return {...poolPlan(familyBed, familyBed.style ?? family), fallbackReason: reason, fallbackTier: 'family'};
    }
  } catch {
    // fail open: no bed
  }
  log.warn({reason, tier: 'none'}, 'music.fallback');
  return null;
}

/**
 * Everything runMusicPlan touches outside itself. Production uses DEFAULT_MUSIC_PLAN_DEPS (the module's own functions, unchanged); tests inject fakes.
 * `spawnMode` is the mode the child actually runs in (buildSpawnSpec forces live -> dry under vitest); tests may set it to exercise the live branch.
 */
export type MusicPlanDeps = {
  decide: typeof resolveMusicMode;
  spawnModeFor: (mode: 'plan' | 'dry' | 'live') => 'plan' | 'dry' | 'live';
  spawn: (requested: 'plan' | 'dry' | 'live', payload: MusicJob) => Promise<MusicResult>;
  readPool: typeof readPool;
  findUploadedBed: typeof findUploadedBed;
  readBedMeta: typeof readBedMeta;
  uploadBedDetailed: typeof uploadBedDetailed;
  writeSpool: typeof writeSpool;
  removeSpool: typeof removeSpool;
  flushSpool: typeof flushSpool;
  failOpen: typeof failOpen;
  /** Phase 1.7.2: the per-video generation ledger. Null = no verified store: live generation fails closed. */
  ledger: () => MusicLedgerStore | null;
  now: () => string;
  /** True only in production. In production a dry run (the synthetic placeholder bed) is never attached or uploaded. */
  isProduction: () => boolean;
};

export const DEFAULT_MUSIC_PLAN_DEPS: MusicPlanDeps = {
  decide: resolveMusicMode,
  spawnModeFor: mode => buildSpawnSpec(mode).mode,
  spawn: (requested, payload) => spawnMusic(requested, payload),
  readPool,
  findUploadedBed,
  readBedMeta,
  uploadBedDetailed,
  writeSpool,
  removeSpool,
  flushSpool,
  failOpen,
  ledger: resolveMusicLedgerStore,
  now: () => new Date().toISOString(),
  isProduction: () => isProductionEnv(),
};

const qcOf = (result: MusicResult): MusicLedgerResolution['qc'] => ({
  passed: typeof result.qc_passed === 'boolean' ? result.qc_passed : null,
  retried: typeof result.qc_retried === 'boolean' ? result.qc_retried : null,
  vocalScore: typeof result.qc_vocal_score === 'number' ? result.qc_vocal_score : null,
  silenceSec: typeof result.qc_silence_sec === 'number' ? result.qc_silence_sec : null,
  truePeakDbfs: typeof result.qc_true_peak_dbfs === 'number' ? result.qc_true_peak_dbfs : null,
  bpmErrorRatio: typeof result.qc_bpm_error_ratio === 'number' ? result.qc_bpm_error_ratio : null,
  seamDb: typeof result.qc_seam_db === 'number' ? result.qc_seam_db : null,
});

/** A video's finished generated bed, from its ledger record: reused at $0 for re-runs (whatever the new prompt's cache key). */
async function reuseFromLedger(asset: MusicLedgerAsset, mood: string, d: MusicPlanDeps): Promise<MusicPlan> {
  const meta = await d.readBedMeta(asset.cacheKey, false).catch(() => ({} as Record<string, unknown>));
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const plan = poolPlan(
    {
      cache_key: asset.cacheKey,
      url: asset.url,
      ...(asset.fullUrl ? {full_url: asset.fullUrl} : {}),
      ...(asset.loopUrl ? {loop_url: asset.loopUrl} : {}),
      ...(asset.carvedUrl ? {carved_url: asset.carvedUrl} : {}),
      ...(asset.durationSec !== undefined ? {duration_sec: asset.durationSec} : {}),
      ...(num(meta.seed) !== undefined ? {seed: num(meta.seed)} : {}),
      ...(num(meta.bpm) !== undefined ? {bpm: num(meta.bpm)} : {}),
      ...(typeof meta.key === 'string' ? {key: meta.key} : {}),
      ...placementPoolFields(meta),
    },
    mood,
  );
  const {fromPool: _fromPool, ...rest} = plan;
  return rest;
}

async function runMusicPlan(job: MusicJob, d: MusicPlanDeps = DEFAULT_MUSIC_PLAN_DEPS): Promise<MusicPlan | null> {
  const decision = d.decide();
  if (decision.downgraded) log.warn({from: decision.requested || 'live', to: decision.mode, reason: decision.downgradeReason ?? 'unknown', production: d.isProduction()}, 'music.mode_downgraded');
  if (decision.mode === 'off') return null;
  const bedSource = resolveBedSource();
  const licensedSet = Boolean((process.env.POLISH_MUSIC_BED_URL ?? '').trim());
  if (bedSource === 'off' || bedSource === 'licensed') return null;
  if (bedSource === 'auto' && licensedSet) return null;
  const videoId = job.video_id ?? '';
  // Personalised: pools are keyed by the brief's STYLE. Without a brief it is the family mood, as before.
  const brief = job.brief;
  const mood = brief?.style ?? resolveMoodPool(job.emotional_tone || 'neutral');
  const spawnMode = d.spawnModeFor(decision.mode);
  const dry = spawnMode !== 'live';
  const fresh = bedFresh();
  // Production must never play the synthetic dry-mode placeholder bed (a 220 Hz tone with a 1 kHz click on every beat). A dry run in production is either a live request that
  // could not go live (no API key) or an explicit dry setting; both mean "no paid generation is available". The edit gets an eligible EXISTING pool bed (same style, then
  // same family, nearest tempo: the documented fallback policy) or no bed. Nothing is spawned, generated, spooled or uploaded, and the reason is explicit in the log and,
  // when a pool bed is used, in the plan's fallbackReason (blueprint musicProvenance.fallbackReason). Development and tests keep the dry behaviour unchanged.
  if (dry && d.isProduction()) {
    const reason = decision.downgraded ? `live_unavailable_${decision.downgradeReason ?? 'unknown'}` : 'dry_mode_in_production';
    log.warn({reason, requested: decision.requested || 'live', mood, video_id: videoId}, 'music.dry_blocked_in_production');
    return d.failOpen(mood, reason, videoId, brief);
  }
  try {
    try {
      const flushed = await d.flushSpool({
        dir: spoolDir(),
        upload: entry => uploadBed({filePath: entry.filePath, cacheKey: entry.cacheKey, mood: entry.mood, dry: entry.dry, meta: entry.meta}),
      });
      if (flushed > 0) log.info({count: flushed}, 'music.spool_flushed');
    } catch (error) {
      log.warn({reason: error instanceof Error ? error.message : String(error)}, 'music.spool_flush_failed');
    }
    // Pool first: a mood with a bed never spawns Python. Dry reads the real pool too; dry writes go to a separate prefix.
    if (!fresh) {
      const beds = await d.readPool(mood);
      const picked = brief ? pickNearestBpm(videoId, beds, brief.bpm) : pickPoolBed(videoId, beds);
      if (picked) {
        log.info({mood, cache_key: picked.cache_key, host: urlHost(picked.url), cost_usd: 0, video_id: videoId, ...(brief ? {bedBpm: picked.bpm, wantedBpm: brief.bpm} : {})}, 'music.pool_hit');
        return poolPlan(picked, mood);
      }
    }
    if (fresh) log.info({mood}, 'music.pool_skipped_fresh');
    const jobWithSfx = {...job, include_sfx: job.include_sfx ?? sfxEnabled()};
    const plan = await d.spawn('plan', jobWithSfx);
    const estimate = plan.estimated_cost_usd ?? 0.0075;
    if (estimate > resolveMaxUsd()) return d.failOpen(mood, 'cost_cap', videoId, brief);
    const cached = await d.findUploadedBed(plan.cache_key, dry);
    if (cached) {
      log.info({cache_key: plan.cache_key, cost_usd: 0}, 'music.cache_hit');
      // Re-rendering the same video costs $0 and still gets the full bed, the loop, the carved twin and the measured placement from the stored meta.json.
      const meta = await d.readBedMeta(plan.cache_key, dry).catch(() => ({} as Record<string, unknown>));
      const fromMeta = poolPlan({cache_key: plan.cache_key, url: cached, ...(typeof meta.full_url === 'string' ? {full_url: meta.full_url} : {}), ...(typeof meta.loop_url === 'string' ? {loop_url: meta.loop_url} : {}), ...(typeof meta.carved_url === 'string' ? {carved_url: meta.carved_url} : {}), ...(typeof meta.duration_sec === 'number' ? {duration_sec: meta.duration_sec} : {}), ...placementPoolFields(meta)}, mood);
      return {...toPlan(plan, cached), ...(fromMeta.fullUrl ? {fullUrl: fromMeta.fullUrl} : {}), ...(fromMeta.loopUrl ? {loopUrl: fromMeta.loopUrl, ...(fromMeta.fullDurationSec ? {fullDurationSec: fromMeta.fullDurationSec} : {})} : {}), ...(fromMeta.carvedUrl ? {carvedUrl: fromMeta.carvedUrl} : {}), ...(fromMeta.placement ? {placement: fromMeta.placement} : {})};
    }

    // Phase 1.7.2: a PAID generation needs the per-video ledger, claimed atomically before the child that calls the provider is spawned.
    // Dry and plan modes never pay and are unchanged.
    let claimed: MusicLedgerRecord | null = null;
    let store: MusicLedgerStore | null = null;
    if (spawnMode === 'live') {
      // A paid generation needs a spend log the agent can append to: checked BEFORE the ledger is claimed, so a broken spend log neither spends nor consumes the video's one attempt.
      if (plan.spend_log_ok === false) {
        log.error({video_id: videoId, reason: plan.spend_log_error ?? 'unknown'}, 'music.spend_log_unavailable');
        return d.failOpen(mood, 'spend_log_unavailable', videoId, brief);
      }
      store = d.ledger();
      if (!store) {
        log.warn({video_id: videoId}, 'music.ledger_unavailable');
        return d.failOpen(mood, 'ledger_unavailable', videoId, brief);
      }
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(videoId)) {
        log.warn({video_id_length: videoId.length}, 'music.ledger_invalid_video_id');
        return d.failOpen(mood, 'ledger_invalid_video_id', videoId, brief);
      }
      let claim: Awaited<ReturnType<typeof claimGeneration>>;
      try {
        claim = await claimGeneration(store, {videoId, cacheKey: plan.cache_key, seed: plan.seed, promptVersion: plan.prompt_version ?? null, estimatedCostUsd: plan.estimated_cost_usd ?? null, now: d.now()});
      } catch (error) {
        // Ambiguous: the create may or may not have landed. Never generate on an unknown claim.
        log.warn({video_id: videoId, reason: error instanceof Error ? error.name : 'error'}, 'music.ledger_claim_error');
        return d.failOpen(mood, 'ledger_claim_error', videoId, brief);
      }
      if (claim.outcome === 'lost') {
        const view = await viewLedger(store, videoId).catch(() => ({state: 'unreadable'} as LedgerView));
        if (view.state === 'resolved' && view.record.resolution?.outcome === 'generated' && view.record.resolution.asset) {
          log.info({video_id: videoId, cache_key: view.record.resolution.asset.cacheKey, cost_usd: 0}, 'music.ledger_reuse');
          return reuseFromLedger(view.record.resolution.asset, mood, d);
        }
        log.info({video_id: videoId, ledger: view.state, outcome: view.state === 'resolved' ? view.record.resolution?.outcome ?? null : null}, 'music.ledger_consumed');
        return d.failOpen(mood, 'already_generated', videoId, brief);
      }
      claimed = claim.record;
    }
    const resolveClaim = async (resolution: Omit<MusicLedgerResolution, 'resolvedAt'>) => {
      if (!store || !claimed) return;
      try {
        await resolveGeneration(store, claimed, {...resolution, resolvedAt: d.now()});
      } catch (error) {
        // The record stays `claimed`: still consumed. Nothing is retried.
        log.warn({video_id: videoId, reason: error instanceof Error ? error.name : 'error'}, 'music.ledger_resolve_failed');
      }
    };

    let generated: MusicResult;
    try {
      generated = await d.spawn(decision.mode, {...jobWithSfx, seed: plan.seed});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const paid = (error as {paid?: PaidFailure}).paid;
      if (paid) {
        // A paid request that ended without a bed: recorded in the durable ledger (cost when known) and loudly in the log. The video stays consumed: nothing is retried.
        const paidReason = `paid_${paid.stage}_failed`;
        log.error({video_id: videoId, stage: paid.stage, cost_usd: paid.costUsd, accounting: paid.accounting}, 'music.paid_request_without_bed');
        await resolveClaim({outcome: 'failed', reason: paidReason, costUsd: paid.costUsd, qc: null, asset: null});
        return d.failOpen(mood, paidReason, videoId, brief);
      }
      const reason = /timeout|SIGKILL|exited null/i.test(message) ? 'timeout' : 'spawn';
      await resolveClaim({outcome: 'failed', reason, costUsd: null, qc: null, asset: null});
      return d.failOpen(mood, reason, videoId, brief);
    }
    if (claimed && generated.accounting && (generated.accounting.paid_logged === false || (generated.accounting.errors?.length ?? 0) > 0)) {
      log.error({video_id: videoId, cache_key: generated.cache_key, cost_usd: generated.cost_usd ?? null, accounting: generated.accounting}, 'music.spend_accounting_degraded');
    }
    if (claimed && generated.qc_retried === true) log.warn({video_id: videoId, cache_key: generated.cache_key}, 'music.qc_retry_detected');
    // Phase 1.7.2: a bed that failed QC in a paid run is never used, uploaded, spooled or pooled, and nothing is regenerated.
    if (claimed && generated.qc_passed === false) {
      const qc = qcOf(generated);
      log.warn({video_id: videoId, cache_key: generated.cache_key, cost_usd: generated.cost_usd ?? null, qc}, 'music.qc_failed');
      await resolveClaim({outcome: 'qc_failed', reason: 'qc_failed', costUsd: generated.cost_usd ?? null, qc, asset: null});
      return d.failOpen(mood, 'qc_failed', videoId, brief);
    }
    if (!generated.bed_path) {
      await resolveClaim({outcome: 'failed', reason: 'no_bed', costUsd: generated.cost_usd ?? null, qc: qcOf(generated), asset: null});
      return d.failOpen(mood, 'no_bed', videoId, brief);
    }
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
      // Phase 3: what the brief asked for and what was measured on the bed. Placement reads the measured numbers, never the requested arc.
      style: generated.style ?? undefined,
      family: generated.family,
      arc: generated.arc ?? undefined,
      measured_bpm: generated.measured_bpm ?? undefined,
      downbeat_times: generated.downbeat_times,
      energy_map: generated.energy_map,
      lift_bar: generated.lift_bar,
      lift_sec: generated.lift_sec,
      bar_sec: generated.bar_sec,
      loop_duration_sec: generated.loop_duration_sec,
      loop_bars: generated.loop_bars,
      loudness_map: generated.loudness_map,
      carved_loudness_map: generated.carved_loudness_map,
      loop_loudness_map: generated.loop_loudness_map,
      loop_lufs: generated.loop_lufs ?? undefined,
    };
    const spoolRoot = spoolDir();
    try {
      await d.writeSpool({dir: spoolRoot, cacheKey: generated.cache_key, filePath: generated.bed_path, meta: {mood: generated.mood ?? mood, dry, meta: uploadMeta}});
    } catch (error) {
      log.warn({reason: error instanceof Error ? error.message : String(error)}, 'music.spool_write_failed');
    }
    try {
      const loopOk = Boolean(generated.bed_loop_path) && generated.loop_fallback === false;
      uploaded = await d.uploadBedDetailed({
        filePath: generated.bed_path,
        cacheKey: generated.cache_key,
        mood: generated.mood ?? mood,
        dry,
        meta: uploadMeta,
        ...(loopOk ? {loopFilePath: generated.bed_loop_path} : {}),
        ...(generated.bed_full_path ? {fullFilePath: generated.bed_full_path} : {}),
        ...(generated.bed_carved_path ? {carvedFilePath: generated.bed_carved_path} : {}),
      });
      await d.removeSpool(spoolRoot, generated.cache_key).catch(() => undefined);
    } catch (error) {
      const reason = error instanceof Error && error.message === 'r2_unconfigured' ? 'r2_unconfigured' : 'upload';
      await resolveClaim({outcome: 'upload_failed', reason, costUsd: generated.cost_usd ?? null, qc: qcOf(generated), asset: null});
      return d.failOpen(mood, reason, videoId, brief);
    }
    log.info({cost_usd: generated.cost_usd ?? 0, cache_key: generated.cache_key, bpm: generated.bpm, seed: generated.seed}, 'music.generated');
    const plan2 = toPlan(generated, uploaded.url);
    await resolveClaim({
      outcome: 'generated',
      // A paid, downloaded and uploaded bed whose `paid` spend-log line could not be written: the bed is kept, and the durable ledger carries the cost and this reason.
      reason: claimed && generated.accounting?.paid_logged === false ? 'spend_log_paid_append_failed' : null,
      costUsd: generated.cost_usd ?? null,
      qc: qcOf(generated),
      asset: {
        cacheKey: generated.cache_key,
        url: uploaded.url,
        ...(uploaded.fullUrl ? {fullUrl: uploaded.fullUrl} : {}),
        ...(uploaded.loopUrl ? {loopUrl: uploaded.loopUrl} : {}),
        ...(uploaded.carvedUrl ? {carvedUrl: uploaded.carvedUrl} : {}),
        ...(generated.duration_sec !== undefined ? {durationSec: generated.duration_sec} : {}),
      },
    });
    return {
      ...plan2,
      ...(uploaded.fullUrl ? {fullUrl: uploaded.fullUrl} : {}),
      ...(uploaded.loopUrl && generated.duration_sec !== undefined ? {loopUrl: uploaded.loopUrl, fullDurationSec: generated.duration_sec} : {}),
      ...(uploaded.carvedUrl ? {carvedUrl: uploaded.carvedUrl} : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /timeout|SIGKILL|exited null/i.test(message) ? 'timeout' : 'spawn';
    return d.failOpen(mood, reason, videoId, brief);
  }
}

/** Test entry: runMusicPlan with injected dependencies (never rejects, like startMusicPlan). */
export function runMusicPlanWith(job: MusicJob, deps: Partial<MusicPlanDeps>): Promise<MusicPlan | null> {
  return runMusicPlan(job, {...DEFAULT_MUSIC_PLAN_DEPS, ...deps}).catch(error => {
    log.warn({reason: error instanceof Error ? error.message : String(error)}, 'music.fallback');
    return null;
  });
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
