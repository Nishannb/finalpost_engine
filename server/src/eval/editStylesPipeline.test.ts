/**
 * Phase 2, Checkpoint 2: each edit style through the REAL runner and pipeline (startAnalysis -> analyzeVideo) on an ffmpeg test clip, models stubbed.
 * Asserts which stages really ran (blueprint warnings, the Gemini call labels that left the process, the blueprint tracks), that no Claude request is
 * ever attempted by a styled job (a fake Claude key AND a Claude budget are set, so an unstyled graphics job WOULD try), that Documentary / Newsroom
 * stay off for styled jobs although the server env turns them on, and that a cap reached mid-run never fails the job.
 *
 * No paid call is possible: fetch is stubbed globally (only the Groq and Gemini hosts answer, with canned replies; anything else is blocked and
 * recorded), keys are fake, the music specialist is off, RVM is not configured. Like the parity suite it runs real analyses (ffmpeg + the pipeline),
 * so it is an explicit step:   PARITY_TESTS=1 npx vitest run src/eval/editStylesPipeline.test.ts
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

const ENABLED = process.env.PARITY_TESTS === '1';
const recorded = vi.hoisted(() => ({labels: [] as string[], blocked: [] as string[], sentGemini: 0}));

vi.mock('../storage/r2.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../storage/r2.ts')>()),
  uploadSourceVideo: async () => ({publicUrl: 'staticFile:source.mp4', key: 'synthetic'}),
  uploadRenderedVideo: async () => ({publicUrl: 'staticFile:rendered.mp4', key: 'synthetic'}),
}));
vi.mock('../stages/render/renderBudget.ts', () => ({assertAnalysisAllowed: async () => {}, recordAnalysis: async () => {}}));
// Records the label of every Gemini attempt the pipeline asks for (sent or refused) at the real chokepoint.
vi.mock('../lib/geminiEditBudget.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/geminiEditBudget.ts')>();
  return {
    ...actual,
    reserveGeminiAttempt: (url: string, label: string, code: Parameters<typeof actual.reserveGeminiAttempt>[2]) => {
      if (actual.isGeminiUrl(url)) recorded.labels.push(label);
      return actual.reserveGeminiAttempt(url, label, code);
    },
  };
});

import {env} from '../config/env.ts';
import type {EditStyleId} from '../lib/editStyles.ts';
import type {AnalysisJob} from '../types/blueprint.ts';

const ALLOWED_HOSTS = ['generativelanguage.googleapis.com', 'api.groq.com'];
const WORDS = Array.from({length: 40}, (_, i) => ({word: i % 9 === 8 ? `point${i}.` : i % 7 === 3 ? '42%' : `word${i}`, start: i * 0.3, end: i * 0.3 + 0.26}));
const gemini = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}}), {status: 200});
const DIRECTOR_REPLY = {topic: 't', hook_title: 'Silence Speaks', hook_style: 'minimal', moments: [{timestamp: 5, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}};

function reply(body: string, host: string): Response {
  if (host === 'api.groq.com') return new Response(JSON.stringify({text: WORDS.map(word => word.word).join(' '), language: 'en', duration: 12, words: WORDS}), {status: 200});
  if (body.includes('Vertical talking-head video frame')) return gemini(JSON.stringify({x: 0.2, y: 0.1, w: 0.6, h: 0.7}));
  if (body.includes('planned overlay layout')) return gemini('{"notes":""}');
  if (body.includes('"beats"') || body.includes('"elements"')) return gemini('{}');
  if (/keep[ _-]?plan|keepRanges|keep_ranges/i.test(body)) return gemini('{}');
  return gemini(JSON.stringify(DIRECTOR_REPLY));
}

const e = env as unknown as Record<string, unknown>;
/** The server env: every risky lane ON server-wide, a Claude budget and a (fake) Claude key, so anything not pinned by the style would show. */
const SERVER: Record<string, unknown> = {
  GEMINI_API_KEY: 'test-gemini-offline', GROQ_API_KEY: 'test-groq-offline', ANTHROPIC_API_KEY: 'test-claude-offline', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', KLIPY_API_KEY: '',
  CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false,
  CLAUDE_EDIT_BUDGET_USD: 0.5, GEMINI_EDIT_MAX_REQUESTS: 0, POLISH_MUSIC_BED_URL: '', RVM_PYTHON: '', REDIS_URL: '',
  PRODUCT_EDIT_PROFILE: 'polish', EDIT_STYLES_ENGINE_FLAGS: true,
  MOTION_GRAPHICS_ENABLED: true, POLISH_FACELESS_DOC: true, POLISH_NEWSROOM_MG: true, POLISH_SUBJECT_STAGE: true, POLISH_TEXTUAL_MG: true,
  POLISH_RISO_TEMPLATES: true, POLISH_COLLAGE_BROLL: true, POLISH_ANIDOODLE: true, POLISH_EXPLAINER_SKILL: false, POLISH_KINETIC_LED: false, POLISH_MOTION_TEMPLATES: false,
};
const original: Record<string, unknown> = {};
const originalProcess: Record<string, string | undefined> = {};
let work: string;
let video: string;
let clip = 0;

beforeAll(() => {
  if (!ENABLED) return;
  for (const key of Object.keys(SERVER)) original[key] = e[key];
  for (const key of ['TMPDIR', 'MUSIC_SPECIALIST', 'MUSIC_SPECIALIST_LIVE', 'RUNWARE_API_KEY', 'POLISH_MUSIC_BED_URL', 'RVM_PYTHON']) originalProcess[key] = process.env[key];
  process.env.MUSIC_SPECIALIST = 'off';
  process.env.MUSIC_SPECIALIST_LIVE = '';
  process.env.RUNWARE_API_KEY = '';
  process.env.POLISH_MUSIC_BED_URL = '';
  process.env.RVM_PYTHON = '';
  work = mkdtempSync(join(tmpdir(), 'style-pipeline-'));
  process.env.TMPDIR = join(work, 'tmp');
  mkdirSync(process.env.TMPDIR);
  video = join(work, 'source.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const parsed = new URL(String(url));
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      recorded.blocked.push(parsed.hostname);
      throw new Error(`blocked outbound request to ${parsed.hostname}`);
    }
    if (parsed.hostname === 'generativelanguage.googleapis.com') recorded.sentGemini += 1;
    return reply(typeof init?.body === 'string' ? init.body : '', parsed.hostname);
  });
}, 120_000);

afterAll(() => {
  if (!ENABLED) return;
  vi.unstubAllGlobals();
  Object.assign(e, original);
  for (const [key, value] of Object.entries(originalProcess)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, {recursive: true, force: true});
});

type Run = {job: AnalysisJob; warnings: string[]; labels: string[]; sentGemini: number; blocked: string[]};

/** One real analysis through startAnalysis; each call uses a fresh copy path so no cache entry is shared. */
async function run(style: EditStyleId | undefined, envOverride: Record<string, unknown> = {}): Promise<Run> {
  Object.assign(e, original, SERVER, envOverride);
  const {startAnalysis} = await import('../pipeline/analysisRunner.ts');
  const {loadAnalysisJob} = await import('../store/engineStore.ts');
  recorded.labels = [];
  recorded.blocked = [];
  recorded.sentGemini = 0;
  clip += 1;
  const started = await startAnalysis({
    userId: 'styles',
    videoUrl: video,
    languageCode: 'en' as never,
    useCache: false,
    ...(style ? {style} : {}),
    ...(style === 'basic_captions' ? {basicCaptions: true, requestedEdits: ['captions']} : {}),
  });
  let job: AnalysisJob | null = started;
  await vi.waitFor(
    async () => {
      job = await loadAnalysisJob(started.analysisJobId);
      expect(['done', 'failed']).toContain(job?.status);
    },
    {timeout: 200_000, interval: 50},
  );
  const done = job as unknown as AnalysisJob;
  const warnings = (done.blueprint?.stats as {warnings?: string[]} | undefined)?.warnings ?? [];
  const dumpDir = process.env.STYLE_PIPELINE_DUMP_DIR;
  if (dumpDir) {
    mkdirSync(dumpDir, {recursive: true});
    writeFileSync(join(dumpDir, `${style ?? 'unstyled'}-${clip}.json`), JSON.stringify({job: {...done, blueprint: undefined}, warnings, labels: recorded.labels, blocked: recorded.blocked}, null, 1));
  }
  return {job: done, warnings, labels: [...recorded.labels], sentGemini: recorded.sentGemini, blocked: [...recorded.blocked]};
}

/** Evidence that a lane / toolkit RAN (or was considered and lost): `polish_subject_stage:off` is the stage reporting itself off, so it does not count. */
const LANE_RAN = /polish_pace:faceless|faceless_doc|newsroom|polish_subject_stage:(?!off)|visual_backend:|riso|collage|anidoodle|polish_textual_mg/;
const DIRECTOR_LABELS = /Director|visual director|motion graphics director/;

describe.skipIf(!ENABLED)('edit styles through the real pipeline (models stubbed)', () => {
  it('control: the same server env WITHOUT a style runs the server-wide lanes with Claude allowed (so the pins below are meaningful)', async () => {
    const r = await run(undefined, {POLISH_MOTION_TEMPLATES: true});
    expect(r.job.status).toBe('done');
    expect(r.warnings.join(' ')).toMatch(LANE_RAN);
    expect(r.warnings.join(' ')).toMatch(/polish_pace:faceless_skipped|polish_subject_stage:skipped:skill_faceless/); // Documentary won the lane server-wide
    expect(r.job.graphics).toBe('on'); // the Claude bound is open (budget + key set): a styled job must never get this
    expect(r.warnings).not.toContain('claude_graphics_disabled:library_only_style');
    expect(r.job).not.toHaveProperty('style');
  }, 240_000);

  it('basic_captions: transcription + captions only, zero Gemini requests sent', async () => {
    const r = await run('basic_captions');
    expect(r.job.status).toBe('done');
    expect(r.job).toMatchObject({editProfile: 'legacy', style: 'basic_captions', degraded: false, degradedReasons: []});
    expect(r.sentGemini).toBe(0);
    expect(r.blocked).toEqual([]);
    expect(r.warnings.join(' ')).not.toMatch(/polish_|cuts_keep|motion_graphics/);
  }, 240_000);

  it('ai_clean_cut: the cuts profile on a polish server: keep-plan only, no Director / motion / lanes, no Claude', async () => {
    const r = await run('ai_clean_cut');
    expect(r.job.status).toBe('done');
    expect(r.job).toMatchObject({editProfile: 'cuts', style: 'ai_clean_cut', degraded: false, degradedReasons: []});
    expect(r.labels.filter(label => DIRECTOR_LABELS.test(label))).toEqual([]);
    expect(r.labels.every(label => label === 'cuts ai keep plan')).toBe(true);
    expect(r.sentGemini).toBeLessThanOrEqual(3);
    expect(r.warnings.join(' ')).not.toMatch(LANE_RAN);
    expect(r.warnings.join(' ')).not.toMatch(/polish_kinetic_led|polish_explainer|motion_graphics/);
    expect(r.blocked).toEqual([]);
  }, 240_000);

  it('kinetic_typography: polish + Kinetic-Led + motion templates, library-only graphics (no Claude), lanes off; no RVM: front-only, degraded with a reason, never failed', async () => {
    const r = await run('kinetic_typography');
    expect(r.job.status).toBe('done');
    expect(r.job).toMatchObject({editProfile: 'polish', style: 'kinetic_typography', styleApplied: 'kinetic_typography', graphics: 'library_only'});
    expect(r.warnings).toEqual(expect.arrayContaining(['polish_kinetic_led:on', 'motion_graphics:library_only', 'claude_graphics_disabled:library_only_style']));
    expect(r.warnings.join(' ')).not.toMatch(LANE_RAN);
    expect(r.warnings.join(' ')).not.toMatch(/polish_motion_templates:skipped:no_motion/);
    expect(r.labels).toEqual(expect.arrayContaining(['cuts ai keep plan']));
    expect(r.sentGemini).toBeLessThanOrEqual(12);
    expect(r.blocked).toEqual([]); // no Claude (or any other) request was attempted
    expect(r.warnings.some(warning => warning.startsWith('kinetic_led:budget:'))).toBe(true); // the Kinetic-Led planner ran
    expect(r.warnings.some(warning => warning.startsWith('craft_templates:beats:'))).toBe(true); // and planned kinetic beats
    expect(r.warnings).not.toContain('gemini_edit_budget_unconfigured'); // the style's cap is in force
    expect(r.job.degraded).toBe(true);
    expect(r.job.degradedReasons).toContain('kinetic_front_only:no_matte');
    // Offline the beats cannot be published (no Remotion runtime check / R2 upload here), and the outcome says so instead of claiming the style
    if (r.warnings.some(warning => warning.startsWith('craft_templates:publish_failed:')) && !r.warnings.some(warning => warning.startsWith('craft_templates:published:'))) {
      expect(r.job.degradedReasons).toContain('kinetic_type_unpublished');
    }
    expect(r.job.degradedReasons!.filter(reason => reason.startsWith('gemini_cap_reached:'))).toEqual([]); // the stub run fits the cap of 12
  }, 240_000);

  it('explainer: polish + the explainer lane + motion templates, library-only graphics, no Kinetic-Led, lanes off', async () => {
    const r = await run('explainer');
    expect(r.job.status).toBe('done');
    expect(r.job).toMatchObject({editProfile: 'polish', style: 'explainer', styleApplied: 'explainer', graphics: 'library_only'});
    expect(r.warnings).toEqual(expect.arrayContaining(['polish_kinetic_led:off', 'motion_graphics:library_only', 'claude_graphics_disabled:library_only_style']));
    expect(r.warnings.some(warning => warning.startsWith('polish_palette:') && warning.includes('#'))).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(LANE_RAN);
    expect(r.warnings.join(' ')).not.toMatch(/explainer_skipped/);
    expect(r.sentGemini).toBeLessThanOrEqual(12);
    expect(r.blocked).toEqual([]);
    expect(r.warnings.some(warning => warning.startsWith('polish_explainer_mounted:layouts:'))).toBe(true); // the explainer layout track was mounted
    expect(r.warnings).toContain('polish_motion_templates:skill:explainer'); // the template stage ran inside the explainer lane
    expect(r.warnings).not.toContain('gemini_edit_budget_unconfigured');
    expect(r.job).toMatchObject({degraded: false, degradedReasons: []}); // fully honoured on this clip (no template trigger is not a fallback)
  }, 240_000);

  it.each([
    ['kinetic_typography', 1],
    ['kinetic_typography', 3],
    ['explainer', 2],
    ['ai_clean_cut', 1],
  ] as const)('%s with the cap tightened to %i: the job completes, the stopped stages are named, no more than the cap was sent', async (style, cap) => {
    const r = await run(style, {GEMINI_EDIT_MAX_REQUESTS: cap});
    expect(r.job.status).toBe('done');
    expect(r.sentGemini).toBeLessThanOrEqual(cap);
    if (r.labels.length > cap) {
      expect(r.job.degraded).toBe(true);
      expect(r.job.degradedReasons!.some(reason => reason.startsWith('gemini_cap_reached:'))).toBe(true);
    }
    expect(r.blocked).toEqual([]);
  }, 240_000);

  it('engine flags off: Kinetic runs as the server profile (Phase 1), degraded engine_flags_off', async () => {
    const r = await run('kinetic_typography', {EDIT_STYLES_ENGINE_FLAGS: false, PRODUCT_EDIT_PROFILE: 'cuts'});
    expect(r.job.status).toBe('done');
    expect(r.job).toMatchObject({editProfile: 'cuts', styleApplied: 'ai_clean_cut', degraded: true, degradedReasons: ['engine_flags_off']});
    expect(r.warnings.join(' ')).not.toMatch(/polish_kinetic_led/);
  }, 240_000);
});
