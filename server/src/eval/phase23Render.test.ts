/**
 * Phase 23 audit driver (opt-in: PHASE23=1). Scenario-driven version of the Phase 22 driver: runs the REAL analyzeVideo (with
 * DIRECTOR_DUMP_DIR so the planner's own edit ledger and stage traces are written) and, unless PHASE23_RENDER=0, the REAL renderLocally.
 * Network is stubbed (Groq + Gemini replies come from the scenario file); anything else is blocked and recorded.
 *   PHASE23=1 PHASE23_SCENARIO=<file under remotion/out/phase23-audit/scenarios> PHASE23_RUN=<id> [PHASE23_RENDER=0]
 * Output: remotion/out/phase23-audit/<scenario>/run-<id>/. Never writes outside phase23-audit except the scratch served render.
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

const ENABLED = process.env.PHASE23 === '1';
const SCENARIO = process.env.PHASE23_SCENARIO ?? '';
const RUN = process.env.PHASE23_RUN ?? 'a';
const DO_RENDER = process.env.PHASE23_RENDER !== '0';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AUDIT = join(REPO, 'remotion', 'out', 'phase23-audit');
type Scenario = {
  id: string; source: string; userBroll: string[]; transcript: string; durationSec: number;
  words: Array<{text: string; start: number; end: number}>; directorRaw: string; detectorBox: Record<string, number>;
  describes: Array<{kind: string; description: string; regions: unknown[]}>; requestedEdits: string[]; captionTemplate: string;
  /** Stub the stock providers: a fake key is configured and Pexels/Pixabay answer with EMPTY results (still no network). */
  fakeStock?: boolean;
};
const scenario: Scenario | null = ENABLED && SCENARIO ? JSON.parse(readFileSync(join(AUDIT, 'scenarios', SCENARIO), 'utf8')) : null;
const OUT = scenario ? join(AUDIT, scenario.id, `run-${RUN}`) : '';
const ALLOWED = ['generativelanguage.googleapis.com', 'api.groq.com', ...(scenario?.fakeStock ? ['api.pexels.com', 'pixabay.com'] : [])];

vi.mock('../storage/r2.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../storage/r2.ts')>()),
  uploadSourceVideo: async () => ({publicUrl: scenario?.source ?? '', key: 'synthetic'}),
}));

const calls: Array<{host: string; path: string; kind: string; bytes: number; bodySha?: string}> = [];
const escaped: string[] = [];
const saved = {tmpdir: process.env.TMPDIR, dump: process.env.DIRECTOR_DUMP_DIR};
let work = '';
let describeIndex = 0;

const classify = (body: string, host: string) =>
  host === 'api.groq.com' ? 'asr'
  : body.includes('Vertical talking-head video frame') ? 'occupancy'
  : body.includes('Frames from a creator-uploaded') ? 'user_asset_describe'
  : body.includes('planned overlay layout') ? 'critique'
  : 'director';
const gemini = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 0, candidatesTokenCount: 0}}), {status: 200});

beforeAll(() => {
  if (!scenario) return;
  work = mkdtempSync(join(tmpdir(), 'phase23-'));
  process.env.TMPDIR = join(work, 'tmp');
  mkdirSync(process.env.TMPDIR);
  mkdirSync(OUT, {recursive: true});
  process.env.DIRECTOR_DUMP_DIR = join(OUT, 'director-dump');
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const parsed = new URL(String(url));
    if (!ALLOWED.includes(parsed.hostname)) {
      escaped.push(String(url));
      throw new Error(`blocked outbound request to ${parsed.hostname}`);
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    if (parsed.hostname === 'api.pexels.com' || parsed.hostname === 'pixabay.com') {
      calls.push({host: parsed.hostname, path: parsed.pathname, kind: 'stock_search', bytes: 0});
      return new Response(JSON.stringify({videos: [], photos: [], hits: [], total_results: 0}), {status: 200});
    }
    const kind = classify(body, parsed.hostname);
    calls.push({host: parsed.hostname, path: parsed.pathname, kind, bytes: body.length});
    switch (kind) {
      case 'asr': return new Response(JSON.stringify({text: scenario.transcript, language: 'en', duration: scenario.durationSec, words: scenario.words.map(w => ({word: w.text, start: w.start, end: w.end}))}), {status: 200});
      case 'occupancy': return gemini(JSON.stringify(scenario.detectorBox));
      case 'user_asset_describe': {
        const reply = scenario.describes[describeIndex] ?? scenario.describes.at(-1)!;
        describeIndex += 1;
        return gemini(JSON.stringify(reply));
      }
      case 'critique': return gemini('{"notes":""}');
      default: return gemini(scenario.directorRaw);
    }
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env.TMPDIR = saved.tmpdir;
  if (saved.dump === undefined) delete process.env.DIRECTOR_DUMP_DIR; else process.env.DIRECTOR_DUMP_DIR = saved.dump;
  if (work) rmSync(work, {recursive: true, force: true});
});

describe.skipIf(!scenario)('phase 23: real analyzeVideo (+ real renderLocally) on a scenario', () => {
  it('produces the blueprint, the planner ledger and, unless disabled, an encoded MP4', async () => {
    const s = scenario!;
    expect(existsSync(s.source) && s.userBroll.every(p => existsSync(p))).toBe(true);
    Object.assign(env as unknown as Record<string, unknown>, {
      GEMINI_API_KEY: 'offline-test', GROQ_API_KEY: 'offline-test', PEXELS_API_KEY: s.fakeStock ? 'offline-fake-key' : '', PIXABAY_API_KEY: '', ANTHROPIC_API_KEY: '',
      R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET_NAME: '', R2_PUBLIC_BASE_URL: '',
      CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false, MOTION_GRAPHICS_ENABLED: false,
    });
    const {r2Configured} = await import('../storage/r2.ts');
    expect(r2Configured()).toBe(false);
    const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
    const {value: blueprint, record} = await captureRun({
      run: hooks => analyzeVideo({videoUrl: s.source, languageCode: 'en', userId: 'phase23', requestedEdits: s.requestedEdits, userBrollUrls: s.userBroll, captionTemplate: s.captionTemplate as never}, hooks),
    });
    expect(blueprint).toBeTruthy();
    writeFileSync(join(OUT, 'blueprint.json'), JSON.stringify(blueprint, null, 2));
    writeFileSync(join(OUT, 'run-record.json'), JSON.stringify(record, null, 2));
    writeFileSync(join(OUT, 'network-calls.json'), JSON.stringify({calls, escaped}, null, 2));
    expect(escaped).toEqual([]);
    const result: Record<string, unknown> = {
      scenario: s.id, run: RUN, flags: {HOOK_TITLE_POLICY: env.HOOK_TITLE_POLICY, OCCUPANCY_CONTEXT_V2: env.OCCUPANCY_CONTEXT_V2},
      style: DEFAULT_RENDER_STYLE, blueprintIdentitySha256: blueprintIdentitySha256(blueprint as Record<string, any>), rendered: DO_RENDER,
    };
    if (DO_RENDER) {
      const {renderLocally} = await import('../stages/render/localRender.ts');
      const jobId = `phase23-${s.id}-${RUN}`;
      const started = Date.now();
      let renderError: string | null = null;
      try {
        await renderLocally({blueprint: blueprint!, style: DEFAULT_RENDER_STYLE, renderJobId: jobId});
      } catch (error) {
        renderError = (error as Error).message + JSON.stringify((error as {detail?: unknown}).detail ?? '').slice(0, 3000);
      }
      const served = join(REPO, 'remotion', 'out', 'served', `${jobId}.mp4`);
      if (renderError === null && existsSync(served)) copyFileSync(served, join(OUT, 'edited.mp4'));
      Object.assign(result, {renderMs: Date.now() - started, renderError, servedScratch: served, encodedSha256: existsSync(join(OUT, 'edited.mp4')) ? sha256File(join(OUT, 'edited.mp4')) : null});
      writeFileSync(join(OUT, 'render-result.json'), JSON.stringify(result, null, 2));
      expect(renderError).toBeNull();
    } else {
      writeFileSync(join(OUT, 'render-result.json'), JSON.stringify(result, null, 2));
    }
  }, 50 * 60 * 1000);
});
