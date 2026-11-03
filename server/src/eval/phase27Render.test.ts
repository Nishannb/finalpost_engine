/**
 * Phase 27 driver (opt-in: PHASE27=1): edits the REAL supplied video (remotion/public/hi.mp4) with the real analyzeVideo and real renderLocally.
 * The only network answer is the Groq transcription, replayed from the saved real response of an earlier phase (see the scenario file).
 * Every other host (Gemini, Anthropic, Pexels, object storage, anything) is blocked and recorded: no model, no stock, no upload.
 *   PHASE27=1 PHASE27_RUN=<id> [PHASE27_RENDER=0] npx vitest run src/eval/phase27Render.test.ts
 * Output: remotion/out/phase27-audit/run-<id>/ . The source file is read, never modified (its hash is checked before and after).
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

const ENABLED = process.env.PHASE27 === '1';
const RUN = process.env.PHASE27_RUN ?? 'a';
const DO_RENDER = process.env.PHASE27_RENDER !== '0';
/** Measurement aid only: render the same blueprint with no caption words (background reference for caption-contrast measurement). */
const NO_CAPTIONS = process.env.PHASE27_NO_CAPTIONS === '1';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AUDIT = join(REPO, 'remotion', 'out', 'phase27-audit');
const scenario = ENABLED ? JSON.parse(readFileSync(join(AUDIT, 'scenarios', 'hi-real.json'), 'utf8')) : null;
const OUT = join(AUDIT, `run-${RUN}`);

vi.mock('../storage/r2.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../storage/r2.ts')>()),
  // the source is already a local file; Remotion's prefetch copies it. Nothing is uploaded anywhere.
  uploadSourceVideo: async () => ({publicUrl: scenario?.source ?? '', key: 'local'}),
}));

const calls: Array<{host: string; path: string}> = [];
const escaped: string[] = [];
const saved = {tmpdir: process.env.TMPDIR, dump: process.env.DIRECTOR_DUMP_DIR};
let work = '';

beforeAll(() => {
  if (!scenario) return;
  work = mkdtempSync(join(tmpdir(), 'phase27-'));
  process.env.TMPDIR = join(work, 'tmp');
  mkdirSync(process.env.TMPDIR);
  mkdirSync(OUT, {recursive: true});
  process.env.DIRECTOR_DUMP_DIR = join(OUT, 'director-dump');
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const parsed = new URL(String(url));
    if (parsed.hostname !== 'api.groq.com') {
      escaped.push(String(url).replace(/\?.*$/, ''));
      throw new Error(`blocked outbound request to ${parsed.hostname}`);
    }
    calls.push({host: parsed.hostname, path: parsed.pathname});
    return new Response(JSON.stringify({text: scenario.transcript, language: 'en', duration: scenario.durationSec, words: scenario.words.map((w: {text: string; start: number; end: number}) => ({word: w.text, start: w.start, end: w.end}))}), {status: 200});
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  process.env.TMPDIR = saved.tmpdir;
  if (saved.dump === undefined) delete process.env.DIRECTOR_DUMP_DIR; else process.env.DIRECTOR_DUMP_DIR = saved.dump;
  if (work) rmSync(work, {recursive: true, force: true});
});

describe.skipIf(!scenario)('phase 27: the real hi.mp4 through analyzeVideo and renderLocally', () => {
  it('produces the blueprint and, unless disabled, the encoded MP4', async () => {
    const s = scenario;
    const before = await sha256File(s.source);
    expect(before).toBe(s.sourceSha256);
    // keys are present in .env but must never be used here: blank them so even a bug cannot reach a service or the bucket
    Object.assign(env as unknown as Record<string, unknown>, {
      GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', GROQ_API_KEY: 'saved-response-replay',
      R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET_NAME: '', R2_PUBLIC_BASE_URL: '',
      CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false, MOTION_GRAPHICS_ENABLED: false,
      CUTAWAY_SCHEDULING: 'legacy',
      // Editorial parameter (not a feature flag), derived from measurement: the saved transcript's word times are up to ~0.15 s off against this audio,
      // so the default 0.08 s of padding around a trimmed pause cut 60 ms off the end of "relationships?" (source 4.16 s). 0.2 s keeps the speech tails.
      SILENCE_PADDING_SEC: Number(process.env.PHASE27_SILENCE_PADDING_SEC ?? 0.2),
    });
    const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
    const {value: blueprint, record} = await captureRun({
      // captions-only pipeline + the clean-edit trim (silence/filler/cough) that mode enables; no Director, B-roll, hook or zoom
      run: hooks => analyzeVideo({videoUrl: s.source, languageCode: 'en', userId: 'phase27', teleprompterClean: true}, hooks),
    });
    expect(blueprint).toBeTruthy();
    writeFileSync(join(OUT, 'blueprint.json'), JSON.stringify(blueprint, null, 2));
    writeFileSync(join(OUT, 'run-record.json'), JSON.stringify(record, null, 2));
    writeFileSync(join(OUT, 'network-calls.json'), JSON.stringify({allowedCalls: calls, blocked: escaped}, null, 2));
    expect(escaped).toEqual([]);
    const result: Record<string, unknown> = {
      scenario: s.id, run: RUN, sourceSha256: s.sourceSha256, flags: {HOOK_TITLE_POLICY: env.HOOK_TITLE_POLICY, OCCUPANCY_CONTEXT_V2: env.OCCUPANCY_CONTEXT_V2, CUTAWAY_SCHEDULING: env.CUTAWAY_SCHEDULING}, config: {SILENCE_PADDING_SEC: env.SILENCE_PADDING_SEC, SILENCE_THRESHOLD_SEC: env.SILENCE_THRESHOLD_SEC},
      blueprintIdentitySha256: blueprintIdentitySha256(blueprint as Record<string, any>), rendered: DO_RENDER,
    };
    if (DO_RENDER) {
      const {renderLocally} = await import('../stages/render/localRender.ts');
      const bp = blueprint as {captionDirection?: {template?: string}};
      // the caption template the pipeline chose for this edit (the app's preview uses the blueprint's own choice)
      const style = {...DEFAULT_RENDER_STYLE, captionTemplate: (bp.captionDirection?.template ?? DEFAULT_RENDER_STYLE.captionTemplate) as typeof DEFAULT_RENDER_STYLE.captionTemplate};
      const jobId = `phase27-${RUN}`;
      const started = Date.now();
      let renderError: string | null = null;
      try {
        await renderLocally({blueprint: NO_CAPTIONS ? ({...blueprint!, captionWords: []} as typeof blueprint) : blueprint!, style, renderJobId: jobId});
      } catch (error) {
        renderError = (error as Error).message + JSON.stringify((error as {detail?: unknown}).detail ?? '').slice(0, 3000);
      }
      const served = join(REPO, 'remotion', 'out', 'served', `${jobId}.mp4`);
      if (renderError === null && existsSync(served)) copyFileSync(served, join(OUT, 'edited.mp4'));
      Object.assign(result, {renderMs: Date.now() - started, renderError, style, encodedSha256: existsSync(join(OUT, 'edited.mp4')) ? await sha256File(join(OUT, 'edited.mp4')) : null});
      expect(renderError).toBeNull();
    }
    writeFileSync(join(OUT, 'render-result.json'), JSON.stringify(result, null, 2));
    expect(await sha256File(s.source)).toBe(before); // the source was not modified
  }, 50 * 60 * 1000);
});
