/**
 * runKinetic: S1 ingest/shots -> S2 transcript -> S3 matte -> S4 depth -> S5 camera -> S6 scene -> D1 director -> D2 worker gate -> L1 solve -> (R) render.
 * Every stage is cached by content hash under `.cache/kinetic/<jobHash>/`; a rerun recomputes only the stages whose inputs changed. Default providers need no model weights:
 * Groq/JSON transcript, existing RVM (or noMatte), subject-band depth, static camera. Optional adapters sit behind env flags and degrade to the defaults (recorded in the report).
 * Providers/IO are injectable so the whole pipeline is testable without ffmpeg / network.
 */
import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {BboxMotionCamera, StaticCamera, loadCameraTracker, type CameraProvider, type CameraTrack} from './camera.ts';
import {StageCache, fileSha256, sha256} from './cache.ts';
import {SubjectBandDepth, loadDepthProvider, type DepthProvider} from './depth.ts';
import {KINETIC_DIRECTOR_SYSTEM, runKineticDirector, type DirectorCall} from './director.ts';
import {verifyRenderSpec, type Violation} from './guardrails.ts';
import {detectShots, probeVideo, type ShotDetector, type VideoMeta} from './ingest.ts';
import {solveLayout} from './layout.ts';
import {analyzeMatte, composeForeground, gridOf, resolveMatte, type MatteAnalysis} from './matte.ts';
import {buildScene, type ShotScene} from './scene.ts';
import {brandConfigSchema, type BrandConfig, type KineticShot, type KineticWord, type RenderSpec} from './schema.ts';
import {JsonTranscriptProvider, GroqTranscriptProvider, loadWhisperXProvider, toKineticWords, type RawWord, type TranscriptProvider} from './transcript.ts';
import {gateCustomTreatments, type GateOutcome, type WorkerRun} from './workerGate.ts';

const execP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const REMOTION_DIR = path.resolve(here, '../../../../remotion');
export const DEFAULT_CACHE_ROOT = path.resolve(here, '../../../../.cache/kinetic');

export type KineticOptions = {
  video: string;
  out?: string;
  brandPath?: string;
  brand?: BrandConfig;
  matte?: string;
  transcriptPath?: string;
  debug?: boolean;
  cacheRoot?: string;
  seed?: number;
  /** render the video (default true when `out` is set) */
  render?: boolean;
  /** inclusive frame range to render (smoke / partial) */
  frameRange?: [number, number];
  deps?: Partial<KineticDeps>;
};

export type KineticDeps = {
  probe: (video: string) => Promise<VideoMeta>;
  shotDetector: ShotDetector | null;
  transcript: TranscriptProvider | null;
  analyzeMatte: (matte: string, fps: number) => Promise<MatteAnalysis>;
  resolveMatte: typeof resolveMatte;
  luminance: (video: string, meta: VideoMeta, shots: KineticShot[]) => Promise<Record<string, number>>;
  /** mean plate colour (#rrggbb) per shot: the director and the solver pick accents that suit it */
  plateColor: (video: string, meta: VideoMeta, shots: KineticShot[]) => Promise<Record<string, string>>;
  directorCall: DirectorCall | null | undefined;
  workerRun?: WorkerRun;
  render: (spec: RenderSpec, assets: {video: string; foreground: string | null}, out: string, range?: [number, number]) => Promise<void>;
  composeForeground: typeof composeForeground;
};

export type KineticReport = {
  jobHash: string;
  cacheDir: string;
  providers: {transcript: string; matte: string; depth: string; camera: string; shots: string; director: string; worker: string[]};
  /** device the RVM speaker matte ran on ('none' = no matte) and why it differs from RVM_DEVICE */
  matte: {source: string; device: string; note?: string};
  fontPair: string | null;
  captionCount: number;
  /** per lockup: entry / exit / accent / zone / hero px (for the review of what the solver actually drew) */
  lockups: Array<{id: string; preset: string; zone: string | null; layering: string; heroPx: number; heroFont: string; enter: string; exit: string; accent: string | null}>;
  cache: Record<string, boolean>;
  planSource: string;
  planReason?: string;
  fallbackReasons: string[];
  noMatte: boolean;
  guardrailViolations: Violation[];
  solverActions: unknown[];
  dropped: unknown[];
  occlusionPerEvent: Array<{id: string; layering: string; mean: number; max: number}>;
  workerGate: GateOutcome[];
  meta: VideoMeta;
  warnings: string[];
};

export async function loadBrand(opts: {brand?: BrandConfig; brandPath?: string}): Promise<BrandConfig> {
  if (opts.brand) return brandConfigSchema.parse(opts.brand);
  if (opts.brandPath) return brandConfigSchema.parse(JSON.parse(await readFile(opts.brandPath, 'utf8')));
  return brandConfigSchema.parse({});
}

/** Mean plate luminance per shot (linear 0..1) from 1 fps 16x28 grey frames: cheap frame stats. */
export async function sampleLuminance(video: string, meta: VideoMeta, shots: KineticShot[]): Promise<Record<string, number>> {
  const W = 16, H = 28;
  const chunks: Buffer[] = [];
  const code = await new Promise<number | null>(resolve => {
    const c = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=1,scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {stdio: ['ignore', 'pipe', 'ignore']});
    c.stdout.on('data', d => chunks.push(d as Buffer));
    c.on('error', () => resolve(-1));
    c.on('close', resolve);
  });
  const buf = Buffer.concat(chunks);
  const n = Math.floor(buf.length / (W * H));
  const out: Record<string, number> = {};
  if (code !== 0 || n === 0) return out;
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  for (const s of shots) {
    const vals: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const frame = Math.round(i * meta.fps);
      if (frame >= s.startFrame && frame < s.endFrame) { let sum = 0; for (let k = 0; k < W * H; k += 1) sum += buf[i * W * H + k]!; vals.push(lin(sum / (W * H) / 255)); }
    }
    if (vals.length) out[s.id] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4);
  }
  return out;
}

/** Mean plate colour per shot (#rrggbb) from 1 fps 8x14 rgb frames: cheap frame stats, used so the accent suits THIS plate. */
export async function samplePlateColors(video: string, meta: VideoMeta, shots: KineticShot[]): Promise<Record<string, string>> {
  const W = 8, H = 14;
  const chunks: Buffer[] = [];
  const code = await new Promise<number | null>(resolve => {
    const c = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=1,scale=${W}:${H}:flags=area,format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {stdio: ['ignore', 'pipe', 'ignore']});
    c.stdout.on('data', d => chunks.push(d as Buffer));
    c.on('error', () => resolve(-1));
    c.on('close', resolve);
  });
  const buf = Buffer.concat(chunks);
  const per = W * H * 3;
  const n = Math.floor(buf.length / per);
  const out: Record<string, string> = {};
  if (code !== 0 || n === 0) return out;
  for (const s of shots) {
    const sum = [0, 0, 0];
    let cnt = 0;
    for (let i = 0; i < n; i += 1) {
      const frame = Math.round(i * meta.fps);
      if (frame < s.startFrame || frame >= s.endFrame) continue;
      for (let k = 0; k < W * H; k += 1) for (let ch = 0; ch < 3; ch += 1) sum[ch]! += buf[i * per + k * 3 + ch]!;
      cnt += W * H;
    }
    if (cnt) out[s.id] = `#${sum.map(v => Math.round(v / cnt).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  return out;
}

/** Local Remotion render of the KineticEdit composition (same renderer family the repo's proof scripts use). */
export async function renderWithRemotion(spec: RenderSpec, assets: {video: string; foreground: string | null}, out: string, range?: [number, number]): Promise<void> {
  const tmp = path.join(path.dirname(out), `.kinetic-job-${process.pid}.json`);
  const job = {
    extraPublic: [{from: assets.video, to: 'kinetic-job/video.mp4'}, ...(assets.foreground ? [{from: assets.foreground, to: 'kinetic-job/fg.webm'}] : [])],
    videos: [{id: 'KineticEdit', out: path.resolve(out), props: {spec, videoSrc: 'staticFile:kinetic-job/video.mp4', ...(assets.foreground ? {matteSrc: 'staticFile:kinetic-job/fg.webm'} : {})}, ...(range ? {from: range[0], to: range[1]} : {})}],
  };
  await mkdir(path.dirname(out), {recursive: true});
  await writeFile(tmp, JSON.stringify(job));
  try {
    await execP('node', [path.join(REMOTION_DIR, 'scripts/kinetic/render.mjs'), tmp], {cwd: REMOTION_DIR, maxBuffer: 1 << 26, timeout: 60 * 60_000});
  } finally {
    await import('node:fs/promises').then(f => f.rm(tmp, {force: true}));
  }
}

export async function runKinetic(opts: KineticOptions): Promise<{spec: RenderSpec; report: KineticReport; outputs: string[]}> {
  const warnings: string[] = [];
  const fallbackReasons: string[] = [];
  const brand = await loadBrand(opts);
  const defaultDeps: KineticDeps = {
    probe: probeVideo,
    shotDetector: undefined as unknown as ShotDetector | null,
    transcript: null,
    analyzeMatte,
    resolveMatte,
    luminance: sampleLuminance,
    plateColor: samplePlateColors,
    directorCall: undefined,
    render: renderWithRemotion,
    composeForeground,
  };
  const deps: KineticDeps = {...defaultDeps, ...opts.deps};
  const videoHash = await fileSha256(opts.video);
  const jobHash = sha256(videoHash).slice(0, 16);
  const cacheDir = path.join(opts.cacheRoot ?? DEFAULT_CACHE_ROOT, jobHash);
  const cache = new StageCache(cacheDir);
  const seed = opts.seed ?? parseInt(jobHash.slice(0, 8), 16) % 2147483647;

  // S1
  const meta = await cache.run('ingest', {videoHash, v: 1}, () => deps.probe(opts.video));
  const shotsRes = await cache.run('shots', {videoHash, v: 1, detector: deps.shotDetector === null ? 'none' : 'pyscenedetect'}, () => detectShots(opts.video, meta, deps.shotDetector === undefined ? undefined : deps.shotDetector));
  const shots = shotsRes.shots;

  // S2
  let provider: TranscriptProvider | null = deps.transcript;
  let transcriptSource = 'none';
  if (!provider) {
    if (opts.transcriptPath) provider = new JsonTranscriptProvider(opts.transcriptPath);
    else if (process.env.WHISPERX === '1') { try { provider = await loadWhisperXProvider(); } catch (e) { warnings.push(`whisperx: ${(e as Error).message}`); } }
    if (!provider) provider = new GroqTranscriptProvider(async video => {
      const audio = path.join(cacheDir, 'speech.ogg');
      await mkdir(cacheDir, {recursive: true});
      await execP(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', audio]);
      return {audioPath: audio, audioBytes: (await import('node:fs')).statSync(audio).size};
    });
  }
  transcriptSource = provider.id;
  const tKey = {videoHash, provider: provider.id, version: provider.version, file: opts.transcriptPath ? await fileSha256(opts.transcriptPath) : null};
  let raw: RawWord[];
  try {
    raw = await cache.run('transcript', tKey, () => provider!.words({videoPath: opts.video, fps: meta.fps, durationSec: meta.durationSec}));
  } catch (err) {
    raw = [];
    warnings.push(`transcript unavailable: ${(err as Error).message}`);
  }
  const words: KineticWord[] = toKineticWords(raw, meta.fps);

  // S3 matte + S6 scene
  const matteRes = await deps.resolveMatte({video: opts.video, ...(opts.matte ? {matteArg: opts.matte} : {}), cacheDir});
  if (matteRes.reason) warnings.push(`matte: ${matteRes.reason}${matteRes.reason.includes('timed out') || matteRes.reason.includes('failed') || matteRes.reason.includes('unavailable') ? ' -> noMatte (behind-the-head / stack-over-cutout refused)' : ''}`);
  if (matteRes.deviceNote) warnings.push(`matte: ${matteRes.deviceNote}`);
  let matteHash = 'none';
  let analysis: MatteAnalysis | null = null;
  if (matteRes.path) {
    matteHash = await fileSha256(matteRes.path);
    analysis = await cache.run('matte-analysis', {matteHash, fps: meta.fps, v: 1}, () => deps.analyzeMatte(matteRes.path!, meta.fps), a => a.ok);
    if (!analysis.ok) { warnings.push(`matte analysis: ${analysis.reason}`); analysis = null; }
  }
  const lum = await cache.run('luminance', {videoHash, shots, v: 1}, () => deps.luminance(opts.video, meta, shots)).catch(() => ({} as Record<string, number>));
  const plateColors = await cache.run('plate-color', {videoHash, shots, v: 1}, () => deps.plateColor(opts.video, meta, shots)).catch(() => ({} as Record<string, string>));
  const scenes: Record<string, ShotScene> = await cache.run('scene', {matteHash, shots, lum, plateColors, size: [meta.width, meta.height], v: 2}, async () => {
    const out: Record<string, ShotScene> = {};
    for (const s of shots) {
      const ss = analysis ? analysis.samples.filter(x => x.frame >= s.startFrame && x.frame < s.endFrame && x.box) : [];
      if (!analysis || ss.length === 0) { out[s.id] = buildScene({shotId: s.id, noMatte: true, luminance: lum[s.id], ...(plateColors[s.id] ? {plateColor: plateColors[s.id]} : {}), width: meta.width, height: meta.height}); continue; }
      const x0 = Math.min(...ss.map(x => x.box!.x)), y0 = Math.min(...ss.map(x => x.box!.y)), x1 = Math.max(...ss.map(x => x.box!.x + x.box!.w)), y1 = Math.max(...ss.map(x => x.box!.y + x.box!.h));
      const grid = gridOf(analysis, s.startFrame, s.endFrame);
      out[s.id] = buildScene({shotId: s.id, subjectBox: {x: x0, y: y0, w: x1 - x0, h: y1 - y0}, boxTrack: ss.map(x => ({frame: x.frame, box: x.box!})), alphaAreaFrac: ss.reduce((a, x) => a + x.area, 0) / ss.length, ...(grid ? {grid} : {}), luminance: lum[s.id], ...(plateColors[s.id] ? {plateColor: plateColors[s.id]} : {}), width: meta.width, height: meta.height});
    }
    return out;
  });
  const noMatte = shots.every(s => scenes[s.id]?.noMatte);

  // S4 / S5 providers
  let depth: DepthProvider = new SubjectBandDepth();
  if (process.env.DEPTH_MODEL_PATH) { try { depth = await loadDepthProvider(); } catch (e) { warnings.push(`depth adapter: ${(e as Error).message}; using subject-band`); } }
  let camera: CameraProvider = new StaticCamera();
  if (process.env.CAMERA_TRACKER === '1') { try { camera = await loadCameraTracker(); } catch (e) { warnings.push(`camera adapter: ${(e as Error).message}; using static`); } }
  else if (process.env.CAMERA_PROVIDER === 'bbox') camera = new BboxMotionCamera();
  const cameras: Record<string, CameraTrack> = Object.fromEntries(shots.map(s => [s.id, camera.track(s, scenes[s.id], {width: meta.width, height: meta.height})]));

  // D1 + D2
  const planKey = {words: sha256(words), shots, scenes: sha256(scenes), brand: sha256(brand), director: deps.directorCall === undefined ? 'gemini-if-configured' : deps.directorCall ? 'injected' : 'none', fps: meta.fps, prompt: sha256(KINETIC_DIRECTOR_SYSTEM), v: 6};
  const resolved = await cache.run('plan', planKey, () => runKineticDirector({words, shots, scenes, brand, call: deps.directorCall, fps: meta.fps}));
  if (resolved.source === 'fallback' && resolved.reason) fallbackReasons.push(resolved.reason);
  for (const n of resolved.notes ?? []) warnings.push(`plan: ${n}`);
  const gate = await gateCustomTreatments(resolved.plan, {...(deps.workerRun ? {run: deps.workerRun} : {}), log: m => warnings.push(m)});

  // L1
  const solved = await cache.run('solve', {plan: sha256(resolved.plan), scenes: sha256(scenes), cameras: sha256(cameras), depth: `${depth.id}@${depth.version}`, brand: sha256(brand), seed, size: [meta.width, meta.height, meta.fps], overrides: gate.overrides, v: 6}, async () => solveLayout({plan: resolved.plan, words, shots, scenes, cameras, depth, brand, width: meta.width, height: meta.height, fps: meta.fps, seed, planSource: resolved.source, presetOverrides: gate.overrides}));
  const {spec, report: solveReport} = solved;
  const violations = verifyRenderSpec(spec, {scenes, depth, shots, cameras, words, plan: resolved.plan});

  const report: KineticReport = {
    jobHash, cacheDir,
    providers: {transcript: transcriptSource, matte: matteRes.source, depth: `${depth.id}@${depth.version}`, camera: `${camera.id}@${camera.version}`, shots: shotsRes.source, director: resolved.source, worker: gate.outcomes.map(o => o.outcome)},
    matte: {source: matteRes.source, device: matteRes.device ?? 'none', ...(matteRes.deviceNote ? {note: matteRes.deviceNote} : {})},
    fontPair: resolved.plan.fontPair ?? null,
    captionCount: spec.captions.length,
    lockups: spec.events.filter(e => e.presetResolved !== 'type.matchCut').map(e => {
      const heroL = e.lines.find(l => l.role === 'hero' || l.role === 'punch') ?? e.lines[0]!;
      return {id: e.id, preset: e.presetResolved, zone: e.zone, layering: e.layering, heroPx: Math.round(heroL.fontPx * (e.keyframes[Math.floor(e.keyframes.length / 2)]?.scale ?? 1)), heroFont: heroL.font, enter: heroL.anim, exit: e.exit, accent: heroL.color === '#FFFFFF' ? null : heroL.color};
    }),
    cache: {...cache.hits}, planSource: resolved.source, ...(resolved.reason ? {planReason: resolved.reason} : {}), fallbackReasons, noMatte,
    guardrailViolations: violations, solverActions: solveReport.actions, dropped: solveReport.dropped,
    occlusionPerEvent: spec.events.map(e => ({id: e.id, layering: e.layering, mean: e.occlusionFraction.mean, max: e.occlusionFraction.max})),
    workerGate: gate.outcomes, meta, warnings,
  };

  // R
  const outputs: string[] = [];
  if (opts.out) {
    await mkdir(path.dirname(path.resolve(opts.out)), {recursive: true});
    await writeFile(`${opts.out}.spec.json`, JSON.stringify(spec));
    outputs.push(`${opts.out}.spec.json`);
    if (opts.render !== false) {
      let foreground: string | null = null;
      if (matteRes.path) {
        foreground = path.join(cacheDir, 'foreground.webm');
        const fgKey = {videoHash, matteHash, v: 1};
        try { await cache.run('foreground', fgKey, async () => { await deps.composeForeground(opts.video, matteRes.path!, foreground!); return {path: foreground}; }); } catch (e) { warnings.push(`foreground compose failed: ${(e as Error).message}; text will render in front only`); foreground = null; }
      }
      await deps.render(spec, {video: opts.video, foreground}, opts.out, opts.frameRange);
      outputs.push(opts.out);
    }
    if (opts.debug) {
      const p = `${opts.out}.report.json`;
      await writeFile(p, JSON.stringify(report, null, 2));
      outputs.push(p);
    }
  }
  return {spec, report, outputs};
}
