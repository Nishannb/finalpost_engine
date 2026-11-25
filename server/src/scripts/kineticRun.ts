/**
 * PAID: one Kinetic Typography (Kinetic V2 + Composer) edit of a local clip, through the same path the app uses
 * (startAnalysis with style kinetic_typography, footage camera, a caption preset), rendered on this Mac.
 *
 *   node --experimental-strip-types src/scripts/kineticRun.ts /path/to/clip.mp4 [--preset=punchline] [--out=<dir>] [--no-matte]
 *
 * Calls: Groq (one transcription), Gemini (the style's cap, 12) and the production music path: the mood pool first ($0, read through the
 * public media URL), else ONE Runware bed generation capped by MUSIC_SPECIALIST_MAX_USD (.env), guarded by a local one-per-video ledger.
 * Storage is local (no R2 writes: the source, a generated bed and its pool entry stay in the run folder), render is local (no Lambda), Claude is
 * blanked, and a fetch guard refuses every host but Gemini, Groq, the public media host (GET) and this machine.
 * Fails (exit 1, no video handed over) unless Kinetic V2 really produced the edit: warnings must contain
 * editing_pipeline:kinetic_v2:selected and kinetic_composer:on, and the blueprint must carry `kinetic`.
 */
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import fsp from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(here, '../../..');
const argv = process.argv.slice(2);
const clip = argv.find(arg => !arg.startsWith('--'));
const opt = (name: string) => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!clip || !existsSync(clip)) {
  console.error('usage: kineticRun.ts /path/to/clip.mp4 [--preset=punchline] [--out=<dir>] [--no-matte]');
  process.exit(2);
}
const clipAbs = path.resolve(clip);
const preset = opt('preset') ?? 'punchline';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = path.resolve(opt('out') ?? path.join(engineRoot, 'out/kinetic-v2', `${path.basename(clipAbs, path.extname(clipAbs))}-${stamp}`));
const useMatte = !argv.includes('--no-matte');
mkdirSync(outDir, {recursive: true});

// Optional RVM matte (behind-the-speaker type). The venv and weights live in the creators_kinmel engine copy.
const rvmRoot = path.resolve(engineRoot, '../creators_kinmel/finalpost_engine/subjectmatte');
const rvmPython = path.join(rvmRoot, '.venv-rvm/bin/python');
const rvmWeights = path.join(rvmRoot, 'weights/rvm_mobilenetv3.pth');
const matteOn = useMatte && existsSync(rvmPython) && existsSync(rvmWeights);

// config/env.ts loads the .env files with override:true at import, so the safe settings are forced AFTER it loads, on both
// process.env and the parsed env object, before any pipeline module is imported.
const {env, isProduction} = await import('../config/env.ts');
if (isProduction) throw new Error('NODE_ENV=production: refusing');
// the public media base (read-only GETs of the music pool and its beds); captured before the R2 settings are blanked
const mediaBase = String(env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
const mediaHost = (() => { try { return new URL(mediaBase).hostname; } catch { return ''; } })();
const musicDir = path.join(outDir, 'music');
mkdirSync(path.join(musicDir, 'spool'), {recursive: true});
const creatorsAgentsPython = path.resolve(engineRoot, '../creators_kinmel/finalpost_engine/agents/.venv/bin/python');
const forced: Record<string, string | boolean | number> = {
  STORAGE_BACKEND: 'local',
  LOCAL_STORAGE_DIR: path.join(outDir, 'storage'),
  LOCAL_STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:0', // replaced once the dev-storage server has a port
  LOCAL_RENDER_SKIP_R2: '1',
  // the source is served by this script's own dev-storage server; the ingest address guard needs that exact host opted in
  INGEST_ALLOWED_PRIVATE_HOSTS: '127.0.0.1',
  R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET_NAME: '', R2_PUBLIC_BASE_URL: '',
  REMOTION_FUNCTION_NAME: '', REMOTION_SERVE_URL: '',
  ANTHROPIC_API_KEY: '',
  // music: production behaviour (.env MUSIC_SPECIALIST / RUNWARE_API_KEY / MUSIC_SPECIALIST_MAX_USD / MUSIC_BED_FRESH kept); only the machine paths are this run's
  MUSIC_SPEND_LOG: path.join(musicDir, 'spend.log'),
  MUSIC_SPOOL_DIR: path.join(musicDir, 'spool'),
  ...(existsSync(creatorsAgentsPython) && !existsSync(path.join(engineRoot, 'agents/.venv/bin/python')) ? {MUSIC_SPECIALIST_PYTHON: creatorsAgentsPython} : {}),
  PEXELS_API_KEY: '', PIXABAY_API_KEY: '', KLIPY_APP_KEY: '', KLIPY_OVERLAYS_ENABLED: false,
  SPEAKER_CUTOUT_API_URL: '', REDIS_URL: '',
  CLAUDE_EDIT_BUDGET_USD: 0,
  DEV_AUTH_BYPASS: true,
  EDIT_STYLES_ENABLED: true,
  EDIT_STYLES_ENGINE_FLAGS: true,
  PRODUCT_EDIT_PROFILE: 'polish',
  V1_KINETIC_RELEASE: true, // without it the style runs the old polish path, not Kinetic V2
  POLISH_KINETIC_COMPOSER: true,
  POLISH_KINETIC_AI_PALETTE: true, // owner decision 2026-11-25: the AI picks the colours for Pro (the style forces it too)
  POLISH_KINETIC_ENGINE_3D: false,
  POLISH_KINETIC_ENGINE_MATTE: matteOn,
  POLISH_SUBJECT_STAGE: false,
  NORTH_STAR: false,
  DIRECTOR_V2: false,
  RVM_PYTHON: matteOn ? rvmPython : '',
  RVM_WEIGHTS_PATH: matteOn ? rvmWeights : '',
  RVM_DEVICE: 'mps',
};
const e = env as unknown as Record<string, unknown>;
const setForced = (key: string, value: string | boolean | number) => {
  process.env[key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  e[key] = value;
};
for (const [key, value] of Object.entries(forced)) setForced(key, value);

// Fetch guard: only Gemini, Groq and this machine.
const ALLOWED = new Set(['generativelanguage.googleapis.com', 'api.groq.com', '127.0.0.1', 'localhost', ...(mediaHost ? [mediaHost] : [])]);
const hosts: Record<string, number> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  hosts[host] = (hosts[host] ?? 0) + 1;
  if (!ALLOWED.has(host)) throw new Error(`kineticRun fetch guard: ${host} is not allowed`);
  if (host === mediaHost && (init?.method ?? 'GET').toUpperCase() !== 'GET') throw new Error('kineticRun fetch guard: only GET to the media host');
  return realFetch(input, init);
}) as typeof fetch;

const express = (await import('express')).default;
const {devStorageRoutes, localPutFile} = await import('../storage/localStorage.ts');
const app = express();
// music pool / beds not on this run's disk are read (GET) from the public media URL: the production pool, never written to
app.get(/^\/dev-storage\/(music\/.+)$/, async (req, res, next) => {
  try {
    const key = req.path.replace(/^\/dev-storage\//, '').split('/').map(decodeURIComponent).join('/');
    if (!mediaBase || key.includes('..') || existsSync(path.join(forced.LOCAL_STORAGE_DIR as string, key))) return next();
    const r = await realFetch(`${mediaBase}/${key}`);
    if (!r.ok) { res.status(r.status).end(); return; }
    res.setHeader('content-type', r.headers.get('content-type') ?? 'application/octet-stream');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (error) { next(error); }
});
app.use(devStorageRoutes());
const server = await new Promise<import('node:http').Server>(resolve => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
setForced('LOCAL_STORAGE_PUBLIC_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);

const {startAnalysis} = await import('../pipeline/analysisRunner.ts');
const {startRender, renderMode} = await import('../pipeline/renderRunner.ts');
const {loadAnalysisJob, loadRenderJob} = await import('../store/engineStore.ts');
const {localServedRenderPath} = await import('../stages/render/localRender.ts');
const {withObserver} = await import('../lib/runObserver.ts');
// a paid bed needs the one-generation-per-video ledger; production keeps it in R2. Here it is a local file store with an atomic create (O_EXCL), kept across runs.
const {DEFAULT_MUSIC_PLAN_DEPS} = await import('../stages/music/musicSpecialist.ts');
const ledgerDir = path.join(engineRoot, 'out/kinetic-v2/music-ledger');
mkdirSync(ledgerDir, {recursive: true});
const ledgerFile = (key: string) => path.join(ledgerDir, `${encodeURIComponent(key)}.json`);
const fileLedger = {
  name: 'local-file-excl', atomicCreateVerified: true,
  async createIfAbsent(key: string, body: string): Promise<'created' | 'exists'> {
    try { await fsp.writeFile(ledgerFile(key), body, {flag: 'wx'}); return 'created'; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists'; throw error; }
  },
  async read(key: string): Promise<string | null> { try { return await fsp.readFile(ledgerFile(key), 'utf8'); } catch { return null; } },
  async replace(key: string, body: string): Promise<void> { await fsp.writeFile(ledgerFile(key), body); },
};
(DEFAULT_MUSIC_PLAN_DEPS as {ledger: () => unknown}).ledger = () => fileLedger;
if (renderMode() !== 'local') throw new Error(`render mode is ${renderMode()}, expected local`);

const geminiByLabel: Record<string, number> = {};
const observer = (event: {type: string; [key: string]: unknown}) => {
  if (event.type === 'http_request' && String(event.url ?? '').includes('generativelanguage')) {
    const label = String(event.label ?? 'gemini');
    geminiByLabel[label] = (geminiByLabel[label] ?? 0) + 1;
  }
};

console.log(`Kinetic V2 run: ${clipAbs} (preset=${preset}, matte=${matteOn})\nRun folder: ${outDir}`);
const started = Date.now();
const ext = path.extname(clipAbs).toLowerCase() || '.mp4';
const source = await localPutFile(clipAbs, `ai-video/source/${new Date().toISOString().slice(0, 10)}/kinetic-run-${stamp}${ext}`);
const job = await withObserver(observer as never, () =>
  startAnalysis({
    userId: 'kinetic-run',
    videoUrl: source.publicUrl,
    languageCode: 'auto' as never,
    useCache: false,
    style: 'kinetic_typography',
    footageKind: 'camera',
    captionPreset: preset,
  }),
);
let analysis = await loadAnalysisJob(job.analysisJobId);
while (analysis && analysis.status !== 'done' && analysis.status !== 'failed') {
  await new Promise(resolve => setTimeout(resolve, 2000));
  analysis = await loadAnalysisJob(job.analysisJobId);
}
const analysisSec = (Date.now() - started) / 1000;
const bp = analysis?.blueprint as (Record<string, any> & {blueprintId: string}) | undefined;
const warnings: string[] = bp?.stats?.warnings ?? [];
writeFileSync(path.join(outDir, 'warnings.txt'), `${warnings.join('\n')}\n`);
if (bp) writeFileSync(path.join(outDir, 'blueprint.json'), JSON.stringify(bp, null, 2));

const report: Record<string, unknown> = {
  clip: clipAbs, preset, matte: matteOn, status: analysis?.status, errorCode: analysis?.errorCode,
  styleApplied: analysis?.styleApplied, degraded: analysis?.degraded, degradedReasons: analysis?.degradedReasons, styleNotes: analysis?.styleNotes,
  gemini: {attempts: Object.values(geminiByLabel).reduce((a, b) => a + b, 0), byLabel: geminiByLabel},
  fetchHosts: hosts, estimatedCostUsd: bp?.stats?.estimatedCostUsd, costBreakdownUsd: bp?.stats?.costBreakdownUsd, analysisSec,
  kineticWarnings: warnings.filter(w => /^(editing_pipeline|kinetic_|matte_gate|composer|match_cut)/.test(w)),
  music: {
    bed: bp?.audioDesign?.musicUrl ? (String(bp.audioDesign.musicUrl).includes('127.0.0.1') ? 'generated (local)' : 'pool') : 'none',
    provenance: bp?.musicProvenance ?? bp?.audioDesign?.musicProvenance ?? null,
    warnings: warnings.filter(w => /music|bed|bgm/i.test(w)),
    spendLog: existsSync(path.join(musicDir, 'spend.log')) ? readFileSync(path.join(musicDir, 'spend.log'), 'utf8').trim().split('\n').slice(-5) : [],
  },
};
const finish = (code: number, message: string) => {
  report.result = message;
  writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${JSON.stringify(report, null, 2)}\n${message}`);
  server.close();
  process.exit(code);
};

if (analysis?.status !== 'done' || !bp) finish(1, `FAILED: analysis ${analysis?.status ?? 'missing'} ${analysis?.errorCode ?? ''} ${analysis?.errorMessage ?? ''}`);
const proof = {
  pipeline: warnings.includes('editing_pipeline:kinetic_v2:selected'),
  composer: warnings.includes('kinetic_composer:on'),
  kineticSpec: Boolean(bp!.kinetic),
};
report.proof = proof;
if (!proof.pipeline || !proof.composer || !proof.kineticSpec) finish(1, `FAILED: not a Kinetic V2 edit ${JSON.stringify(proof)}`);

const renderStarted = Date.now();
const render = await startRender({
  userId: 'kinetic-run',
  blueprintId: bp!.blueprintId,
  style: {captionTemplate: (bp!.captionDirection?.template ?? 'karaoke') as never, layoutStyle: 'fullscreen' as never, captionBottomFrac: bp!.captionDirection?.bottomFrac ?? 0.22, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''},
});
let renderJob = await loadRenderJob(render.renderJobId);
while (renderJob && renderJob.status !== 'done' && renderJob.status !== 'failed') {
  await new Promise(resolve => setTimeout(resolve, 3000));
  renderJob = await loadRenderJob(render.renderJobId);
}
report.renderSec = (Date.now() - renderStarted) / 1000;
const served = localServedRenderPath(render.renderJobId);
if (renderJob?.status !== 'done' || !existsSync(served)) finish(1, `FAILED: render ${renderJob?.status ?? 'missing'} ${renderJob?.errorCode ?? ''}`);
const edited = path.join(outDir, 'edited.mp4');
copyFileSync(served, edited);
try {
  report.output = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', edited], {encoding: 'utf8'}));
} catch {
  /* probe is informational */
}
finish(0, `EDITED_VIDEO=${edited}`);
