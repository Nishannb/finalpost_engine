/**
 * Phase 1.6 / 1.6A: the first supervised personalised-prompt BGM generation for the hi edit, a pipeline integration test. ONE Runware call, only with
 * explicit approval of the exact request body (--approve takes the call id: sha256 of the exact POST body).
 *
 * Phase 1.6A: settings.lyrics is the 2026-11-03 smoke's exact value ([intro], [inst], [inst]); the hand-written story progression and emotions are
 * local-only metadata (kept in the request and manifest, not sent). This is NOT proof that an AI Director can score from video understanding.
 *
 *   Plan (default; no network, no credentials, writes nothing):
 *     node --experimental-strip-types src/stages/audioDirector/listeningTest/generateFirstBgm.ts
 *   Live (one paid call; meant to be run by the human, see docs/ai-music-director/PHASE_1_6_BGM_GENERATION_PREFLIGHT.md):
 *     node --experimental-strip-types src/stages/audioDirector/listeningTest/generateFirstBgm.ts --live --approve <callId> --max-usd 0.0075
 *
 * Live mode, in order: refuse unless --approve equals this request's id and --max-usd covers the estimate; refuse if any output already exists (never
 * overwrites); one audioInference task through FetchRunwareTransport (getResponse polls only while Runware reports `processing`); no retry; append the
 * spend line to the spend log (agents/music_specialist/spend.py format and path); ingest into the git-ignored proof-bed folder; validate the manifest;
 * compile the UNCHANGED listening plan with the generated bed; write the comparison blueprint. It does not render.
 * AUDIO_DIRECTOR_GENERATION and createTransport() are untouched: this runner is the only live path, and it is not reachable from the pipeline.
 */

import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {audioCatalog} from '../audioPlan/assets.ts';
import {compileAudioPlan} from '../audioPlan/compile.ts';
import {toRemotionAudioDesign} from '../audioPlan/remotionAdapter.ts';
import {FetchRunwareTransport} from '../generation/fetchTransport.ts';
import {applyGeneratedAssets, assetIdFor, ingestGeneration, manifestAssets, validateManifest, type LufsMeter} from '../generation/manifest.ts';
import {buildBgmRequest, type BgmGenerationRequest} from '../generation/requests.ts';
import {buildBgmTask, estimateCostUsd, runGenerationJob, type ProviderTask, type RunwareTransport} from '../generation/runware.ts';
import {hiIntent, hiPlan, hiSheet} from './firstBgmStory.ts';
import {firstListeningBlueprint, type CaptureFixture} from './firstListening.ts';
import {CAPTURE_FIXTURE, SOURCE_VIDEO} from './prepareFirstListening.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** The edit's identity in requests (the hi listening edit); outputs use FIRST_BGM_OUTPUT_ID so nothing of the first listening test is touched. */
export const FIRST_BGM_REQUEST_VIDEO_ID = 'adir_first_listening_hi';
export const FIRST_BGM_OUTPUT_ID = 'adir_first_bgm_hi';
/** Speech-gated voice loudness of hi.mp4, measured with ffmpeg in the first listening test. */
export const HI_VO_LUFS = -24.7;

export const LOCAL_REVIEW_USAGE = Object.freeze({
  cleared: true,
  licence: 'Runware-generated (runware:ace-step@v1.5-base); user-approved for the local Phase 1.6 listening review only; Runware commercial terms not verified',
  restriction: 'local listening review only: no upload, distribution or production use',
});

export type FirstBgmPaths = {publicRoot: string; relDir: string; workDir: string; manifestOut: string; blueprintOut: string; spendLog: string; ledgerDir: string};

export const defaultPaths = (env: NodeJS.ProcessEnv = process.env): FirstBgmPaths => ({
  publicRoot: path.join(REPO, 'remotion', 'public'),
  relDir: `_proof-beds/generated/${FIRST_BGM_OUTPUT_ID}`,
  workDir: path.join(REPO, 'out', 'proof', FIRST_BGM_OUTPUT_ID),
  manifestOut: path.join(REPO, 'out', 'proof', FIRST_BGM_OUTPUT_ID, 'manifest.json'),
  blueprintOut: path.join(REPO, 'out', 'blueprints', `${FIRST_BGM_OUTPUT_ID}.json`),
  // agents/music_specialist/spend.py spend_log_path(): MUSIC_SPEND_LOG, else beside spend.py
  spendLog: (env.MUSIC_SPEND_LOG ?? '').trim() || path.join(REPO, 'agents', 'music_specialist', 'spend.log'),
  // Phase 1.7.1: per-video BGM generation ledger (git-ignored under out/proof/).
  ledgerDir: path.join(REPO, 'out', 'proof', '_bgm-ledger'),
});

export type FirstBgmPlan = {
  request: BgmGenerationRequest;
  task: ProviderTask;
  /** The exact bytes FetchRunwareTransport POSTs (JSON.stringify of the one-task array). */
  body: string;
  /** What --approve must equal: `bgmcall-v1:` + sha256(body). Any change to any sent byte changes it. */
  callId: string;
  seed: number;
  estimatedUsd: number;
  assetId: string;
  assetRelPath: string;
  rawPath: string;
};

/** The structure tags sent: only those with live evidence (the smoke). The story progression is not sent. */
export const FIRST_BGM_STRUCTURE = 'verified_smoke' as const;

/** The exact request and provider task. Pure: no network, no credentials, no files written. */
export function planFirstBgm(paths: FirstBgmPaths = defaultPaths()): FirstBgmPlan {
  const built = buildBgmRequest({sheet: hiSheet, plan: hiPlan, intent: hiIntent(), videoId: FIRST_BGM_REQUEST_VIDEO_ID, voLufs: HI_VO_LUFS});
  if (!built.ok) throw new Error(`request refused: ${JSON.stringify(built.errors)}`);
  if (built.warnings.length > 0) throw new Error(`request has warnings: ${built.warnings.join('; ')}`);
  const {task, seed} = buildBgmTask(built.request, 0, {structure: FIRST_BGM_STRUCTURE});
  const body = JSON.stringify([task]);
  const callId = `bgmcall-v1:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
  const assetId = assetIdFor('music', built.request.requestId);
  // runGenerationJob's raw file name (bgm-<last 12 of the request id>.raw)
  const rawPath = path.join(paths.workDir, `bgm-${built.request.requestId.slice(-12)}.raw`);
  return {request: built.request, task, body, callId, seed, estimatedUsd: estimateCostUsd(1, 0), assetId, assetRelPath: `${paths.relDir}/${assetId}.wav`, rawPath};
}

/** Integrated loudness with the local ffmpeg (ebur128), of the whole file or of [startSec, startSec + durationSec). Analysis only: null muxer. */
export const ffmpegWindowLufs = (absPath: string, window?: {startSec: number; durationSec: number}): Promise<number> =>
  new Promise((resolve, reject) => {
    const trim = window ? ['-ss', String(window.startSec), '-t', String(window.durationSec)] : [];
    execFile('ffmpeg', ['-hide_banner', '-nostats', ...trim, '-i', absPath, '-filter_complex', 'ebur128', '-f', 'null', '-'], {maxBuffer: 1 << 26}, (error, _stdout, stderr) => {
      if (error) return reject(new Error(`ffmpeg failed (${error.code ?? 'error'})`));
      const value = String(stderr).split('Summary:')[1]?.match(/I:\s*(-?[\d.]+) LUFS/)?.[1];
      if (value === undefined) return reject(new Error('ffmpeg printed no integrated loudness'));
      resolve(Number(value));
    });
  });

export const ffmpegIntegratedLufs: LufsMeter = absPath => ffmpegWindowLufs(absPath);

/**
 * The part of the generated bed the edit actually plays: from musicStartOffsetSec for the music window's length (43.667 s of the 60 s file). The
 * whole file is kept for inspection; evaluation (loudness here, energy and listening later) uses only this window.
 */
export type UsedWindow = {bedStartSec: number; bedEndSec: number; editStartSec: number; editEndSec: number; fileDurationSec: number; integratedLufs: number | null; fullFileLufs: number | null; note: string};

export type FirstBgmResult =
  | {status: 'refused'; code: string; detail: string}
  | {status: 'generation_failed'; code: string; detail: string; providerPosts: number; costUsd: number | null; manifestOut: string}
  | {status: 'invalid_asset'; issues: unknown; manifestOut: string; costUsd: number | null}
  | {status: 'ready'; requestId: string; callId: string; assetId: string; assetPath: string; sha256: string; durationSec: number; integratedLufs: number | null; usedWindow: UsedWindow; costUsd: number | null; manifestOut: string; blueprintOut: string; warnings: string[]};

/** Live run. Everything is injected so tests can run it with a mock fetch and temporary folders. */
export async function runFirstBgm(input: {
  approveRequestId: string;
  maxUsd: number;
  transport: RunwareTransport & {posts?: number};
  paths: FirstBgmPaths;
  isoTime: string;
  measureLufs: LufsMeter;
  /** Loudness of the used window only (analysis; does not change the manifest or the duck). */
  measureWindowLufs?: (absPath: string, window: {startSec: number; durationSec: number}) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<FirstBgmResult> {
  const plan = planFirstBgm(input.paths);
  if (input.approveRequestId !== plan.callId) return {status: 'refused', code: 'approval_mismatch', detail: `--approve must be exactly ${plan.callId}`};
  if (!(input.maxUsd >= plan.estimatedUsd)) return {status: 'refused', code: 'cost_cap_below_estimate', detail: `--max-usd ${input.maxUsd} < estimate ${plan.estimatedUsd}`};
  for (const existing of [path.join(input.paths.publicRoot, plan.assetRelPath), plan.rawPath, input.paths.manifestOut, input.paths.blueprintOut]) {
    if (existsSync(existing)) return {status: 'refused', code: 'output_exists', detail: `${existing} already exists; nothing is overwritten`};
  }
  const job = await runGenerationJob({bgm: plan.request, sfx: [], transport: input.transport, maxUsd: input.maxUsd, workDir: input.paths.workDir, isoTime: input.isoTime, maxPolls: 20, sleep: input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), bgmStructure: FIRST_BGM_STRUCTURE, bgmLedger: {dir: input.paths.ledgerDir, videoId: plan.request.videoId, manifests: [input.paths.manifestOut]}});
  if (job.status === 'refused') return {status: 'refused', code: job.code, detail: job.detail};
  for (const line of job.spendLines) {
    mkdirSync(path.dirname(input.paths.spendLog), {recursive: true});
    appendFileSync(input.paths.spendLog, `${line}\n`, 'utf8');
  }
  const outcome = job.outcomes[0]!;
  const manifest = await ingestGeneration({videoId: FIRST_BGM_OUTPUT_ID, sheet: hiSheet, bgm: plan.request, sfx: [], outcomes: job.outcomes, publicRoot: input.paths.publicRoot, relDir: input.paths.relDir, measureLufs: input.measureLufs, usage: {...LOCAL_REVIEW_USAGE}});
  mkdirSync(path.dirname(input.paths.manifestOut), {recursive: true});
  writeFileSync(input.paths.manifestOut, `${JSON.stringify(manifest, null, 2)}\n`);
  if (outcome.status === 'failed') return {status: 'generation_failed', code: outcome.failure!.code, detail: outcome.failure!.detail, providerPosts: input.transport.posts ?? 0, costUsd: outcome.costUsd, manifestOut: input.paths.manifestOut};
  const valid = validateManifest(manifest, {sheet: hiSheet, bgm: plan.request, sfx: [], publicRoot: input.paths.publicRoot});
  if (!valid.ok) return {status: 'invalid_asset', issues: valid.issues, manifestOut: input.paths.manifestOut, costUsd: outcome.costUsd};
  const entry = valid.manifest.assets[0]!;
  if (entry.status !== 'ready') return {status: 'invalid_asset', issues: [entry.failure], manifestOut: input.paths.manifestOut, costUsd: outcome.costUsd};

  // The UNCHANGED listening plan (entry, fade-in, quiet section, stop-down, ending) with the generated bed in place of bgm.mp3.
  const applied = applyGeneratedAssets(hiPlan, valid.manifest, []);
  if (!applied.ok) return {status: 'invalid_asset', issues: [applied.detail], manifestOut: input.paths.manifestOut, costUsd: outcome.costUsd};
  const assets = manifestAssets(valid.manifest);
  const compiled = compileAudioPlan(applied.plan, {sheet: hiSheet, assets: audioCatalog(assets.music, []), voLufs: HI_VO_LUFS, videoId: FIRST_BGM_OUTPUT_ID});
  if (!compiled.ok) return {status: 'invalid_asset', issues: compiled.errors, manifestOut: input.paths.manifestOut, costUsd: outcome.costUsd};
  const lowered = toRemotionAudioDesign(compiled.timeline);
  if (!lowered.ok) return {status: 'invalid_asset', issues: lowered.unsupported, manifestOut: input.paths.manifestOut, costUsd: outcome.costUsd};
  const window = plan.request.window;
  const bedStartSec = lowered.audioDesign.musicStartOffsetSec ?? 0;
  const assetAbs = path.join(input.paths.publicRoot, entry.file!.path);
  let usedLufs: number | null = null;
  if (input.measureWindowLufs) {
    try {
      usedLufs = await input.measureWindowLufs(assetAbs, {startSec: bedStartSec, durationSec: window.durationSec});
    } catch {
      usedLufs = null;
    }
  }
  const usedWindow: UsedWindow = {
    bedStartSec,
    bedEndSec: Math.round((bedStartSec + window.durationSec) * 1000) / 1000,
    editStartSec: window.startSec,
    editEndSec: window.endSec,
    fileDurationSec: entry.file!.durationSec,
    integratedLufs: usedLufs,
    fullFileLufs: entry.measured!.integratedLufs,
    note: 'evaluate only bed [bedStartSec, bedEndSec); the rest of the file is never played. The duck uses fullFileLufs (unchanged Phase 1.5 behaviour)',
  };
  const fixture = JSON.parse(readFileSync(CAPTURE_FIXTURE, 'utf8')) as CaptureFixture;
  mkdirSync(path.dirname(input.paths.blueprintOut), {recursive: true});
  writeFileSync(
    input.paths.blueprintOut,
    `${JSON.stringify({videoId: FIRST_BGM_OUTPUT_ID, sourceVideoPath: SOURCE_VIDEO, voLufs: HI_VO_LUFS, savedAt: 'generated-first-bgm', blueprint: {...firstListeningBlueprint(fixture), audioDesign: lowered.audioDesign}}, null, 2)}\n`,
  );
  return {
    status: 'ready',
    requestId: plan.request.requestId,
    callId: plan.callId,
    assetId: entry.assetId,
    assetPath: entry.file!.path,
    sha256: entry.file!.sha256,
    durationSec: entry.file!.durationSec,
    integratedLufs: entry.measured!.integratedLufs,
    usedWindow,
    costUsd: entry.costUsd,
    manifestOut: input.paths.manifestOut,
    blueprintOut: input.paths.blueprintOut,
    warnings: compiled.timeline.warnings,
  };
}

async function main(argv: string[]): Promise<void> {
  const arg = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const paths = defaultPaths();
  const plan = planFirstBgm(paths);
  if (!argv.includes('--live')) {
    console.log(JSON.stringify({mode: 'plan (no network, nothing written)', callId: plan.callId, storyRequestId: plan.request.requestId, estimatedUsd: plan.estimatedUsd, seed: plan.seed, asset: plan.assetRelPath, usedWindowSec: plan.request.window.durationSec, body: plan.body, task: plan.task}, null, 2));
    return;
  }
  // Credentials only in live mode, through the engine's own configuration loader (the same files every engine process loads). The key is never printed.
  await import('../../../config/env.ts');
  const transport = new FetchRunwareTransport({apiKey: process.env.RUNWARE_API_KEY ?? ''});
  const result = await runFirstBgm({approveRequestId: arg('--approve') ?? '', maxUsd: Number(arg('--max-usd')), transport, paths, isoTime: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'), measureLufs: ffmpegIntegratedLufs, measureWindowLufs: ffmpegWindowLufs});
  console.log(JSON.stringify({...result, providerPosts: transport.posts}, null, 2));
  if (result.status !== 'ready') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
