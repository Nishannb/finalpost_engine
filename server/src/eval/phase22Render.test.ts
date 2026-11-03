/**
 * Phase 22 audit driver (opt-in: PHASE22=1). Runs the REAL analyzeVideo and the REAL renderLocally (prefetch -> `remotion render` ->
 * object-storage upload, which falls back to a local file because no storage is configured) on a synthetic fixture, with the network
 * stubbed. Stubbed replies: Groq ASR (the saved transcript's words), Gemini Director (the SAVED real Gemini response from an earlier
 * phase, byte for byte), Gemini speaker detector and user-asset describe (authored from the synthetic fixture's known geometry), layout
 * critique (empty notes). Writes everything under remotion/out/phase22-audit/run-<RUN>/. Never reaches the network.
 */
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {DEFAULT_RENDER_STYLE} from '../http/schemas.ts';
import {sha256File} from './baseline.ts';
import {blueprintIdentitySha256, captureRun} from './runCapture.ts';

const ENABLED = process.env.PHASE22 === '1';
const RUN = process.env.PHASE22_RUN ?? 'a';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AUDIT = join(REPO, 'remotion', 'out', 'phase22-audit');
const FIXTURES = join(AUDIT, 'fixtures');
const SOURCE = join(FIXTURES, 'source.mp4');
const BROLL = join(FIXTURES, 'broll_ub1.mp4');
const SAVED = JSON.parse(readFileSync(join(REPO, 'server/src/eval/fixtures/v1-three-things-a967af3e27.json'), 'utf8'));
const OUT = join(AUDIT, `run-${RUN}`);
const ALLOWED = ['generativelanguage.googleapis.com', 'api.groq.com'];
const HEAD_BOX = {x: 0.36, y: 0.22, w: 0.28, h: 0.2}; // ground truth of the drawn head in source.mp4 (390..690 / 1080, 430..800 / 1920 plus margin)

vi.mock('../storage/r2.ts', async importOriginal => ({...(await importOriginal<typeof import('../storage/r2.ts')>()), uploadSourceVideo: async () => ({publicUrl: SOURCE, key: 'synthetic'})}));

const calls: Array<{host: string; path: string; kind: string; bytes: number}> = [];
const escaped: string[] = [];
const saved = {tmpdir: process.env.TMPDIR};
let work = '';

const classify = (body: string, host: string) =>
  host === 'api.groq.com' ? 'asr'
  : body.includes('Vertical talking-head video frame') ? 'occupancy'
  : body.includes('Frames from a creator-uploaded') ? 'user_asset_describe'
  : body.includes('planned overlay layout') ? 'critique'
  : 'director';
const gemini = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 0, candidatesTokenCount: 0}}), {status: 200});

beforeAll(() => {
  if (!ENABLED) return;
  work = mkdtempSync(join(tmpdir(), 'phase22-'));
  process.env.TMPDIR = join(work, 'tmp'); // private ASR cache
  mkdirSync(process.env.TMPDIR);
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const parsed = new URL(String(url));
    if (!ALLOWED.includes(parsed.hostname)) {
      escaped.push(String(url));
      throw new Error(`blocked outbound request to ${parsed.hostname}`);
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    const kind = classify(body, parsed.hostname);
    calls.push({host: parsed.hostname, path: parsed.pathname, kind, bytes: body.length});
    switch (kind) {
      case 'asr': return new Response(JSON.stringify({text: SAVED.transcript, language: 'en', duration: SAVED.sourceDurationSec, words: SAVED.words.map((w: any) => ({word: w.text, start: w.start, end: w.end}))}), {status: 200});
      case 'occupancy': return gemini(JSON.stringify(HEAD_BOX));
      case 'user_asset_describe': return gemini(JSON.stringify({kind: 'clip', description: 'Warm orange-to-purple gradient with a large yellow sun disc moving left to right.', regions: []}));
      case 'critique': return gemini('{"notes":""}');
      default: return gemini(SAVED.rawResponse);
    }
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env.TMPDIR = saved.tmpdir;
  if (work) rmSync(work, {recursive: true, force: true});
});

describe.skipIf(!ENABLED)('phase 22: real analyzeVideo -> real renderLocally on the synthetic fixture', () => {
  it('produces an encoded MP4 and the evidence to audit it', async () => {
    expect(existsSync(SOURCE) && existsSync(BROLL)).toBe(true);
    mkdirSync(OUT, {recursive: true});
    Object.assign(env as unknown as Record<string, unknown>, {
      GEMINI_API_KEY: 'offline-test', GROQ_API_KEY: 'offline-test', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', ANTHROPIC_API_KEY: '',
      R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET_NAME: '', R2_PUBLIC_BASE_URL: '',
      CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false, MOTION_GRAPHICS_ENABLED: false,
    });
    const {r2Configured} = await import('../storage/r2.ts');
    expect(r2Configured()).toBe(false);
    const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
    const {renderLocally} = await import('../stages/render/localRender.ts');

    const analysisStarted = new Date().toISOString();
    const {value: blueprint, record} = await captureRun({
      run: hooks => analyzeVideo({videoUrl: SOURCE, languageCode: 'en', userId: 'phase22', requestedEdits: SAVED.requestedEdits, userBrollUrls: [BROLL], captionTemplate: SAVED.captionTemplate}, hooks),
    });
    expect(blueprint).toBeTruthy();
    writeFileSync(join(OUT, 'blueprint.json'), JSON.stringify(blueprint, null, 2));
    writeFileSync(join(OUT, 'run-record.json'), JSON.stringify(record, null, 2));
    writeFileSync(join(OUT, 'network-calls.json'), JSON.stringify({calls, escaped}, null, 2));
    expect(escaped).toEqual([]);

    const jobId = `phase22-${RUN}`;
    const renderStarted = Date.now();
    let renderError: string | null = null;
    let outputUrl = '';
    try {
      outputUrl = (await renderLocally({blueprint: blueprint!, style: DEFAULT_RENDER_STYLE, renderJobId: jobId})).outputUrl;
    } catch (error) {
      renderError = (error as Error).message + JSON.stringify((error as {detail?: unknown}).detail ?? '').slice(0, 3000);
    }
    const served = join(REPO, 'remotion', 'out', 'served', `${jobId}.mp4`);
    if (renderError === null && existsSync(served)) copyFileSync(served, join(OUT, 'edited.mp4'));
    writeFileSync(join(OUT, 'render-result.json'), JSON.stringify({
      analysisStarted, renderMs: Date.now() - renderStarted, renderError, outputUrl, servedFile: served,
      encodedSha256: existsSync(join(OUT, 'edited.mp4')) ? sha256File(join(OUT, 'edited.mp4')) : null,
      blueprintIdentitySha256: blueprintIdentitySha256(blueprint as Record<string, any>),
      style: DEFAULT_RENDER_STYLE, flags: {HOOK_TITLE_POLICY: env.HOOK_TITLE_POLICY, OCCUPANCY_CONTEXT_V2: env.OCCUPANCY_CONTEXT_V2},
    }, null, 2));
    expect(renderError).toBeNull();
    expect(existsSync(join(OUT, 'edited.mp4'))).toBe(true);
  }, 50 * 60 * 1000);
});
