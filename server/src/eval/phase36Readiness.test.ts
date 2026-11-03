/**
 * Phase 36: single-run experiment readiness. Mocked providers only (stubbed `fetch`, no key reaches a network). Real local work: ffmpeg on synthetic clips and
 * the real analyzeVideo with its real request builders.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {createSpendGuard, SpendGuardError} from '../lib/spendGuard.ts';
import {decodeFully, inspectOutput, judgeExperiment, type VerdictInput} from '../pipeline/experimentVerdict.ts';

vi.mock('../storage/r2.ts', async importOriginal => ({...(await importOriginal<typeof import('../storage/r2.ts')>()), uploadSourceVideo: async () => ({publicUrl: 'staticFile:source.mp4', key: 'synthetic'})}));

// Phase 36G: the opening resolver measures footage behind the title. Fixed calm statistics keep the opening fixture deterministic (the real sampler is covered elsewhere).
vi.mock('../stages/openingPlan/regionStats.ts', async importOriginal => {
  const calm = {p10: 0.1, p50: 0.1, p90: 0.1, meanRgb: {r: 80, g: 80, b: 80}, spread: 0.03};
  return {...(await importOriginal<typeof import('../stages/openingPlan/regionStats.ts')>()), sampleRegionStats: async () => calm, worstOf: () => calm};
});

const e = env as unknown as Record<string, unknown>;
let work: string;
let video: string;
const saved: Record<string, unknown> = {};
const KEYS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'CONTENT_PROFILE_ENABLED', 'OCCUPANCY_CONTEXT_V2', 'HOOK_TITLE_POLICY', 'DIRECTOR_V2', 'NORTH_STAR', 'VISUAL_CONTEXT_V2', 'MOTION_GRAPHICS_ENABLED'];
const WORDS = Array.from({length: 40}, (_, i) => ({word: `word${i}.`, start: i * 0.5, end: i * 0.5 + 0.45}));
const ok = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}}), {status: 200});
// Phase 36G: since the Phase 36C early abort, a STRICT run that asks for an opening stops before the paid motion stage unless the Director returned an opening plan and
// supplied every part itself. DIRECTOR therefore models a Director that did both (so tests aimed at later stages really reach them); DIRECTOR_NO_OPENING models one that
// returned no opening plan. The opening plan follows the resolver's rules: evidence spread over the video, wording spoken in the transcript, a title block clear of
// the caption band and of the face. These fixtures have NOT been run against the resolver in this phase; a rejection would surface as details.stage "opening_resolution".
const ROLES = {primary_text: '#FFFFFF', secondary_text: '#CFE8F3', accent: '#FACC15', graphic_background: '#0B1B2B', panel: '#12283D', highlight: '#FACC15', data: '#38BDF8'};
const OPENING_PLAN = {
  central_promise: 'a counted list', audience: 'viewers', angle: 'a list',
  evidence: [{time_sec: 1, what: 'starts'}, {time_sec: 10, what: 'middle'}, {time_sec: 19, what: 'ends'}],
  concept: 'plain title', hook_wording: 'word3 word4 word5', wording_source: 'spoken', source_frame_time_sec: 0.5, treatment: 'plain',
  text_masking_reason: '', placement: {center_y: 0.5, width_frac: 0.88, align: 'center'}, contrast_treatment: 'none', frame0: 'title visible', animation: 'fade', why_this_design: 'matches tone',
};
const DIRECTOR_NO_OPENING = {topic: 't', hook_title: 'Silence Speaks', hook_style: 'minimal', moments: [{timestamp: 5, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], zooms: [{timestamp: 8, scale: 1.2}], caption: {}};
const DIRECTOR = {...DIRECTOR_NO_OPENING, video_observations: [{time_sec: 2, observation: 'x'}], opening_plan: OPENING_PLAN, color_direction: {identity: 'cool studio', roles: ROLES}};
const EARLY_STAGES = ['director_deliverables', 'opening_resolution'];

// ------------------------------------------------------------------------------------------------------------------------------------------------
describe('spend guard', () => {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent';
  const make = (respond: (url: string, body: string) => Response, extra: Partial<Parameters<typeof createSpendGuard>[0]> = {}) => {
    const sent: string[] = [];
    const guard = createSpendGuard({
      fetchImpl: (async (url: string, init?: {body?: string}) => {
        sent.push(String(url));
        return respond(String(url), init?.body ?? '');
      }) as never,
      geminiCapUsd: 0.05,
      maxRequestsPerHost: {'generativelanguage.googleapis.com': 3, 'api.anthropic.com': 1},
      ...extra,
    });
    return {guard, sent};
  };
  const post = (guard: {fetch: typeof fetch}, url: string, body: string) => guard.fetch(url, {method: 'POST', body});

  it('forwards a first request and refuses an identical body (HTTP retry or model fallback at another URL); nothing is sent for the refused one', async () => {
    const {guard, sent} = make(() => ok('{}'));
    await post(guard, GEMINI, '{"a":1}');
    await expect(post(guard, GEMINI, '{"a":1}')).rejects.toMatchObject({code: 'repeat_refused'});
    await expect(post(guard, GEMINI.replace('/m:', '/other-model:'), '{"a":1}')).rejects.toBeInstanceOf(SpendGuardError);
    expect(sent).toHaveLength(1);
    expect(guard.report().refused.map(item => item.reason)).toEqual(['repeat_refused', 'repeat_refused']);
  });

  it('refuses hosts that are not allowed, enforces per-host caps, and lets the local source server through', async () => {
    const {guard, sent} = make(() => ok('{}'));
    await expect(post(guard, 'https://api.pexels.com/v1/search', 'x')).rejects.toMatchObject({code: 'host_not_allowed'});
    await post(guard, 'https://api.anthropic.com/v1/messages', '{"n":1}');
    await expect(post(guard, 'https://api.anthropic.com/v1/messages', '{"n":2}')).rejects.toMatchObject({code: 'host_cap'});
    await guard.fetch('http://127.0.0.1:9/source.mp4');
    expect(sent).toEqual(['https://api.anthropic.com/v1/messages', 'http://127.0.0.1:9/source.mp4']);
  });

  it('stops Gemini once the reported usage reaches the cap, and records the cost and tokens', async () => {
    const big = () => new Response(JSON.stringify({usageMetadata: {promptTokenCount: 600_000, candidatesTokenCount: 10_000, thoughtsTokenCount: 5_000}}), {status: 200});
    const {guard} = make(big, {geminiCapUsd: 0.04});
    await post(guard, GEMINI, '{"n":1}'); // 0.045 + 0.0045 = ~0.0495 > cap
    // A cap hit is now a terminal stop for every host (Phase 36 safety correction), so the refusal is the shared billing_stop.
    await expect(post(guard, GEMINI, '{"n":2}')).rejects.toMatchObject({code: 'billing_stop'});
    const report = guard.report();
    expect(report.billingStop).toMatch(/spend cap reached/);
    expect(report.geminiUsd).toBeCloseTo(0.0495, 4);
    expect(report.geminiTokens).toEqual({promptTokens: 600_000, outputTokens: 15_000});
  });

  it('after a billing failure (402, or credit wording) NOTHING further is sent, to any host', async () => {
    const {guard, sent} = make(url => (url.includes('generativelanguage') ? new Response('{"error":{"message":"Your prepayment credits are depleted."}}', {status: 402}) : ok('{}')));
    const first = await post(guard, GEMINI, '{"n":1}');
    expect(first.status).toBe(402);
    await expect(post(guard, 'https://api.anthropic.com/v1/messages', '{"n":9}')).rejects.toMatchObject({code: 'billing_stop'});
    await expect(post(guard, GEMINI, '{"n":2}')).rejects.toMatchObject({code: 'billing_stop'});
    expect(sent).toHaveLength(1);
    expect(guard.report().billingStop).toMatch(/generativelanguage.googleapis.com HTTP 402/);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------------------
describe('experiment verdict: only a fully verified run is a success', () => {
  const good = (): VerdictInput => ({
    blueprint: {width: 1080, height: 1920, outputDurationSec: 40, stats: {warnings: ['director_video_input:900000b', 'opening_treatment:plain']}, zoomTriggers: [{}], motionGraphics: [], semanticEmphasis: [], frameInsets: [], insetReveals: [], generatedGraphics: [], visualOverlays: []},
    ledger: {edits: [{type: 'zoom', final: {start: 1, end: 2}}, {type: 'inset_reveal', final: null}], summary: {outcomes: {accepted_not_rendered: 0}}},
    outcomes: {fallbackSubstitutions: [], directorFallbackReason: null},
    output: {path: '/x.mp4', exists: true, bytes: 5_000_000, probe: {width: 1080, height: 1920, durationSec: 40.02, fps: 30, hasAudio: true}, decode: {ok: true, videoFrames: 1200, decodedSec: 40, errors: []}},
    spend: {geminiUsd: 0.02, geminiCapUsd: 0.05, billingStop: null, refused: []},
    claudeSpentUsd: 0.1,
    claudeCapUsd: 0.25,
    expectAudio: true,
  });
  const codes = (input: VerdictInput) => judgeExperiment(input).failures.map(item => item.code);

  it('ledger type "lockup" counts every text-overlay layout: a lockup plus a chip reconcile with 2 ledger entries (dry-run s01c false alarm), but a really missing one still fails', () => {
    const base = good();
    const twoLockups = {...base.ledger!, edits: [...base.ledger!.edits, {type: 'lockup', final: {start: 9.9, end: 13.5}}, {type: 'lockup', final: {start: 29.4, end: 32.2}}]};
    const overlay = (layout: string) => ({layout} as never);
    const ok = {...base, ledger: twoLockups, blueprint: {...base.blueprint!, visualOverlays: [overlay('lockup'), overlay('chip')]}};
    expect(codes(ok)).not.toContain('ledger_unreconciled');
    const missing = {...ok, blueprint: {...base.blueprint!, visualOverlays: [overlay('chip')]}};
    expect(codes(missing)).toContain('ledger_unreconciled'); // the real inconsistency is still caught
    const cutawayIsNotALockup = {...ok, blueprint: {...base.blueprint!, visualOverlays: [overlay('lockup'), overlay('cutaway')]}};
    expect(codes(cutawayIsNotALockup)).toContain('ledger_unreconciled');
  });

  it('every one of the four layouts the ledger files under "lockup" (lockup, chip, banner, stat) reconciles; layouts the ledger types differently do not count', () => {
    const base = good();
    const entries = ['lockup', 'chip', 'banner', 'stat'].map((layout, i) => ({type: 'lockup', final: {start: i * 5, end: i * 5 + 3}, layout}));
    const ledger = {...base.ledger!, edits: [...base.ledger!.edits, ...entries]};
    const overlays = (layouts: string[]) => layouts.map(layout => ({layout} as never));
    expect(codes({...base, ledger, blueprint: {...base.blueprint!, visualOverlays: overlays(['lockup', 'chip', 'banner', 'stat'])}})).not.toContain('ledger_unreconciled');
    for (const extra of ['cutaway', 'split', 'cutout', 'composite', 'pip', 'bubble', 'card']) {
      expect(codes({...base, ledger, blueprint: {...base.blueprint!, visualOverlays: overlays(['lockup', 'chip', 'banner', extra])}}), extra).toContain('ledger_unreconciled');
    }
  });

  it('the verified baseline is a success (including a Director that asked for zero graphics: nothing is required)', () => {
    expect(judgeExperiment(good())).toEqual({status: 'success', failures: []});
  });

  it.each<[string, (input: VerdictInput) => void, string]>([
    ['pipeline threw (provider failure, strict stop)', input => { input.pipelineError = {code: 'ai_direction_failed', message: 'Claude 500'}; }, 'pipeline_error'],
    ['render produced no file', input => { input.output = {path: '/x.mp4', exists: false, bytes: 0}; }, 'output_missing'],
    ['render produced an empty file', input => { input.output = {path: '/x.mp4', exists: true, bytes: 0}; }, 'output_empty'],
    ['render is unreadable', input => { input.output = {path: '/x.mp4', exists: true, bytes: 80_000, probeError: 'moov atom not found'}; }, 'output_unreadable'],
    ['wrong dimensions', input => { input.output!.probe!.width = 720; }, 'dimensions_mismatch'],
    ['wrong duration', input => { input.output!.probe!.durationSec = 35; }, 'duration_mismatch'],
    ['audio lost', input => { input.output!.probe!.hasAudio = false; }, 'audio_missing'],
    ['no opening delivered (Director gave none)', input => { input.blueprint!.stats!.warnings = ['director_video_input:1b']; }, 'opening_missing'],
    ['opening rejected by the validators', input => { input.blueprint!.stats!.warnings = ['director_video_input:1b', 'opening_rejected:evidence_not_spread']; }, 'opening_missing'],
    ['whole video was not sent', input => { input.blueprint!.stats!.warnings = ['opening_treatment:plain']; }, 'video_input_missing'],
    ['a required graphic was dropped', input => { input.blueprint!.stats!.warnings!.push('motion_dropped:g1'); }, 'motion_graphic_dropped'],
    ['motion Director failed', input => { input.blueprint!.stats!.warnings!.push('motion_director_failed'); }, 'motion_director_failed'],
    ['Director fell back', input => { input.outcomes = {directorFallbackReason: 'all_director_models_failed:broll_failed:500'}; }, 'director_fallback'],
    ['deterministic substitution inside a Director plan', input => { input.outcomes = {fallbackSubstitutions: ['zooms']}; }, 'deterministic_substitution'],
    ['ledger accepted-not-rendered', input => { input.ledger!.summary.outcomes.accepted_not_rendered = 1; }, 'ledger_unreconciled'],
    ['ledger and blueprint disagree on a count', input => { input.blueprint!.zoomTriggers = []; }, 'ledger_unreconciled'],
    ['billing stop', input => { input.spend!.billingStop = 'generativelanguage.googleapis.com HTTP 402'; }, 'billing_stop'],
    ['the guard refused a repeat paid request', input => { input.spend!.refused = [{host: 'generativelanguage.googleapis.com', reason: 'repeat_refused'}]; }, 'spend_guard_refused'],
    ['Gemini cap exceeded', input => { input.spend!.geminiUsd = 0.06; }, 'gemini_cap_exceeded'],
    ['Claude cap exceeded', input => { input.claudeSpentUsd = 0.3; }, 'claude_cap_exceeded'],
  ])('%s -> failed (%s)', (_name, mutate, code) => {
    const input = good();
    mutate(input);
    const verdict = judgeExperiment(input);
    expect(verdict.status).toBe('failed');
    expect(codes(input)).toContain(code);
  });

  it('a thrown run with no blueprint and no output is a failed report, not a success', () => {
    const verdict = judgeExperiment({pipelineError: {message: 'boom'}});
    expect(verdict.status).toBe('failed');
    expect(verdict.failures.map(item => item.code)).toEqual(expect.arrayContaining(['pipeline_error', 'output_missing']));
  });
});

describe('inspectOutput (real files, real ffprobe)', () => {
  it('reports missing, empty, truncated and valid MP4s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p36-out-'));
    try {
      const valid = join(dir, 'ok.mp4');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', valid]);
      const facts = await inspectOutput(valid);
      expect(facts.probe).toMatchObject({width: 360, height: 640, hasAudio: true});
      expect(facts.probe!.durationSec).toBeCloseTo(2, 0);
      expect((await inspectOutput(join(dir, 'nope.mp4'))).exists).toBe(false);
      writeFileSync(join(dir, 'empty.mp4'), '');
      expect((await inspectOutput(join(dir, 'empty.mp4'))).bytes).toBe(0);
      const cut = join(dir, 'cut.mp4');
      execFileSync('cp', [valid, cut]);
      truncateSync(cut, 3000);
      const truncated = await inspectOutput(cut);
      expect(judgeExperiment({blueprint: {width: 360, height: 640, outputDurationSec: 2}, output: truncated}).failures.map(item => item.code)).toEqual(expect.arrayContaining(['output_empty']));
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------------------------------------------------------
describe('output decode validation (real ffmpeg, scenario-17 regression)', () => {
  const make = (dir: string, name: string, seconds = 8) => {
    const file = join(dir, name);
    // Same shape as a real render: faststart (moov first) so a truncated file still PROBES as full length.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=360x640:rate=30:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-b:v', '800k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file]);
    return file;
  };
  const bp = (seconds: number) => ({width: 360, height: 640, outputDurationSec: seconds});

  it('a valid MP4 decodes completely and the verdict has no output failure (control)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p36-dec-'));
    try {
      const facts = await inspectOutput(make(dir, 'ok.mp4'));
      expect(facts.decode).toMatchObject({ok: true, errors: []});
      expect(facts.decode!.videoFrames).toBeGreaterThanOrEqual(235);
      expect(judgeExperiment({blueprint: bp(8), output: facts, expectAudio: true}).failures.filter(item => item.code.startsWith('output_'))).toEqual([]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }, 60_000);

  it('a truncated MP4 with an intact header (scenario 17) still probes as full length but FAILS as output_corrupt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p36-dec-'));
    try {
      const valid = make(dir, 'ok.mp4');
      const cut = join(dir, 'cut.mp4');
      writeFileSync(cut, readFileSync(valid).subarray(0, Math.floor(readFileSync(valid).length / 3)));
      const facts = await inspectOutput(cut);
      expect(facts.probe!.durationSec).toBeCloseTo(8, 0); // metadata alone says it is fine: exactly the old false success
      expect(facts.probe).toMatchObject({width: 360, height: 640, hasAudio: true});
      expect(facts.decode!.ok).toBe(false);
      const verdict = judgeExperiment({blueprint: bp(8), output: facts, expectAudio: true});
      expect(verdict.status).toBe('failed');
      expect(verdict.failures.map(item => item.code)).toContain('output_corrupt');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }, 60_000);

  it('data that vanishes WITHOUT a decoder message (too few frames) is still corrupt, and a missing decode result is never a success', async () => {
    const short = await decodeFully(join(tmpdir(), 'does-not-exist.mp4'), {durationSec: 8, fps: 30});
    expect(short.ok).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'p36-dec-'));
    try {
      const file = make(dir, 'two.mp4', 2);
      // Claim a much longer duration than the file holds: the frame-count floor must reject it even though ffmpeg is silent.
      expect((await decodeFully(file, {durationSec: 60, fps: 30})).ok).toBe(false);
      const facts = await inspectOutput(file);
      const withoutDecode = {...facts, decode: undefined};
      expect(judgeExperiment({blueprint: bp(2), output: withoutDecode, expectAudio: true}).failures.map(item => item.code)).toContain('output_not_decoded');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }, 60_000);

  it('validation leaves no file behind: the directory holds only the inputs afterwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p36-dec-'));
    try {
      const file = make(dir, 'ok.mp4', 2);
      await inspectOutput(file);
      expect(readdirSync(dir)).toEqual(['ok.mp4']);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }, 60_000);
});

describe('the experiment runner', () => {
  const runner = join(import.meta.dirname, '../../../remotion/out/phase36-readiness/run_experiment.ts');
  const source = readFileSync(runner, 'utf8');

  it('refuses to run (exit 2, nothing sent, no output directory) without P36_APPROVED=yes', () => {
    const dir = join(tmpdir(), `p36-should-not-exist-${process.pid}`);
    const result = spawnSync('node', ['--experimental-strip-types', runner, dir], {env: {...process.env, P36_APPROVED: ''}, encoding: 'utf8'});
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/"status": "not_run"/);
    expect(existsSync(dir)).toBe(false);
  }, 60_000);

  it('only the exact value P36_APPROVED=yes starts it: empty, unset, YES, true, 1, "yes " and "no" all stop at exit 2 with nothing created', () => {
    for (const value of [undefined, '', 'YES', 'true', '1', 'yes ', 'no']) {
      const dir = join(tmpdir(), `p36-gate-${process.pid}-${String(value).length}`);
      const env: Record<string, string | undefined> = {...process.env};
      if (value === undefined) delete env.P36_APPROVED;
      else env.P36_APPROVED = value;
      const result = spawnSync('node', ['--experimental-strip-types', runner, dir], {env: env as NodeJS.ProcessEnv, encoding: 'utf8'});
      expect(result.status, String(value)).toBe(2);
      expect(existsSync(dir), String(value)).toBe(false);
    }
  }, 120_000);

  it('uses strict mode, whole-video input, opening direction, no Claude repair, the spend guard, and decides success only through judgeExperiment', () => {
    expect(source).toMatch(/strictAiDirection: true/);
    expect(source).toMatch(/directorVideoInput: true/);
    expect(source).toMatch(/openingDirection: true/);
    expect(source).toMatch(/maxRepairAttempts: 0/);
    expect(source).toMatch(/globalThis\.fetch = guard\.fetch/);
    expect(source).toMatch(/judgeExperiment\(/);
    expect(source).toMatch(/process\.exit\(verdict\.status === 'success' \? 0 : 1\)/);
    expect(source).not.toMatch(/status = 'ok'/); // the old driver's unconditional success label
    expect(source).toMatch(/captionTemplate: null/); // no caption template is forced
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------------------
type Hit = {host: string; body: any};
let hits: Hit[] = [];
let mode: {main?: 'ok' | '500' | 'garbage'; motion?: 'zero' | '500' | 'garbage' | '402'; opening?: 'none'} = {};

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'phase36-'));
  process.env.TMPDIR = join(work, 'tmp');
  execFileSync('mkdir', ['-p', process.env.TMPDIR]);
  video = join(work, 'source.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  for (const key of KEYS) saved[key] = e[key];
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const host = new URL(String(url)).hostname;
    if (host === 'api.groq.com') {
      return new Response(JSON.stringify({text: WORDS.map(word => word.word).join(' '), language: 'en', duration: 20, words: WORDS}), {status: 200});
    }
    if (host !== 'generativelanguage.googleapis.com') throw new Error(`blocked outbound request to ${host}`);
    const text = typeof init?.body === 'string' ? init.body : '';
    const body = text ? JSON.parse(text) : {};
    hits.push({host, body});
    if (text.includes('contentJson')) {
      if (mode.motion === '402') return new Response(JSON.stringify({error: {code: 402, message: 'Your prepayment credits are depleted.'}}), {status: 402});
      if (mode.motion === '500') return new Response(JSON.stringify({error: {code: 500, message: 'upstream error'}}), {status: 500});
      if (mode.motion === 'garbage') return ok('this is not json {{{');
      return ok(JSON.stringify({graphics: [], notes: 'no graphic helps here'}));
    }
    if (text.includes('Vertical talking-head video frame')) return ok(JSON.stringify({x: 0.2, y: 0.1, w: 0.6, h: 0.7}));
    if (text.includes('planned overlay layout')) return ok('{"notes":""}');
    if (mode.main === '500') return new Response(JSON.stringify({error: {code: 500, message: 'upstream error'}}), {status: 500});
    if (mode.main === 'garbage') return ok('definitely not json');
    return ok(JSON.stringify(mode.opening === 'none' ? DIRECTOR_NO_OPENING : DIRECTOR));
  });
}, 120_000);
afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(work, {recursive: true, force: true});
});
afterEach(() => {
  Object.assign(e, saved);
  hits = [];
  mode = {};
});

const run = async (strict = true, envOverride: Record<string, unknown> = {}) => {
  Object.assign(e, {GEMINI_API_KEY: 'offline', GROQ_API_KEY: 'offline', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false, MOTION_GRAPHICS_ENABLED: false, ...envOverride});
  const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
  return analyzeVideo({videoUrl: video, languageCode: 'en', userId: 'synthetic', requestedEdits: ['hook_title', 'zoom'], directorV2: false, generatedGraphicsEnabled: true, directorVideoInput: true, openingDirection: true, motionWorkerOptions: {upload: async () => 'staticFile:x.js', maxRepairAttempts: 0}, ...(strict ? {strictAiDirection: true} : {})});
};
const motionRequests = () => hits.filter(hit => JSON.stringify(hit.body).includes('contentJson'));
/** The failure must come from the motion stage itself: the Phase 36C early aborts did not fire and the paid motion Director request was really dispatched. */
const expectReachedMotionStage = (error: {code: string; details?: any} | null, label: string) => {
  expect(error, label).not.toBeNull();
  expect(EARLY_STAGES, `${label}: stopped by an early strict check, not by the stage under test`).not.toContain(error!.details?.stage);
  expect(motionRequests().length, `${label}: the motion Director request was never sent`).toBeGreaterThan(0);
};
const thrown = (promise: Promise<unknown>) => promise.then(() => null, error => error as {code: string; message: string; details?: any});

describe('real analyzeVideo request path (mocked Gemini)', () => {
  it('sends the COMPLETE video as the first part of the Director and the motion Director requests, before the text, and the opening schema rides with it', async () => {
    const blueprint = await run();
    const director = hits.find(hit => hit.body.generationConfig?.responseSchema?.properties?.hook_title);
    const motion = hits.find(hit => JSON.stringify(hit.body).includes('contentJson'));
    for (const [name, hit] of [['director', director], ['motion', motion]] as const) {
      expect(hit, name).toBeDefined();
      const parts = hit!.body.contents[0].parts;
      const videoIndex = parts.findIndex((part: any) => part.inlineData?.mimeType === 'video/mp4');
      const firstText = parts.findIndex((part: any) => part.text);
      expect(videoIndex, name).toBeGreaterThanOrEqual(0);
      expect(videoIndex, name).toBeLessThan(firstText); // the video precedes every text part
      expect(parts.filter((part: any) => part.inlineData?.mimeType === 'video/mp4'), name).toHaveLength(1);
      // The v1 Director has the video as its very first part; the motion Director also carries the occupancy still (an existing extra reference image, never instead of the video).
      if (name === 'director') expect(videoIndex).toBe(0);
      const clip = join(work, `${name}-sent.mp4`);
      writeFileSync(clip, Buffer.from(parts[videoIndex].inlineData.data, 'base64'));
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', clip]).toString());
      expect(Number(probe.format.duration), name).toBeGreaterThan(19.5); // the whole 20 s clip, not a few frames
      expect(probe.streams.map((s: {codec_type: string}) => s.codec_type).sort(), name).toEqual(['audio', 'video']);
    }
    const schema = director!.body.generationConfig.responseSchema.properties;
    expect(Object.keys(schema)).toEqual(expect.arrayContaining(['video_observations', 'opening_plan', 'color_direction']));
    // No frame-only substitute: the Director request carries exactly one inline part, the video.
    expect(director!.body.contents[0].parts.filter((part: any) => part.inlineData).length).toBe(1);
    expect(blueprint.stats.warnings.some((warning: string) => warning.startsWith('director_video_input:'))).toBe(true);
  }, 120_000);

  it('a Director that returns ZERO graphics is a strict success, recorded as such: the motion Director ran and no failure is on record', async () => {
    mode = {motion: 'zero'};
    const blueprint = await run();
    expect(blueprint.generatedGraphics ?? []).toHaveLength(0);
    const warnings: string[] = blueprint.stats.warnings;
    expect(warnings).not.toContain('motion_director_failed');
    expect(warnings.some(warning => /motion_dropped|strict_degraded|director_fallback/.test(warning))).toBe(false);
    expect(hits.some(hit => JSON.stringify(hit.body).includes('contentJson'))).toBe(true); // it really was asked
  }, 120_000);

  it('...but zero graphics from a FAILED call is not that outcome: Gemini 500, garbage text and 402 in the motion Director each stop the run, AT the motion stage', async () => {
    mode = {motion: '500'};
    const failed = await thrown(run());
    expectReachedMotionStage(failed, 'motion 500');
    expect(failed?.code).toBe('ai_direction_failed');
    hits = [];
    mode = {motion: 'garbage'};
    const garbage = await thrown(run());
    expectReachedMotionStage(garbage, 'motion garbage');
    expect(garbage?.code).toBe('ai_direction_failed');
    expect(garbage?.details.failures[0]).toMatchObject({kind: 'director_failed', provider: 'gemini'});
    hits = [];
    mode = {motion: '402'};
    const billing = await thrown(run());
    expectReachedMotionStage(billing, 'motion 402'); // billing_blocked is the 402 of the motion request itself, not a leftover from an earlier stage
    expect(billing?.code).toBe('billing_blocked');
  }, 180_000);

  it('a malformed or failed MAIN Director response (deterministic fallback) stops a strict run; non-strict still completes on the fallback', async () => {
    mode = {main: 'garbage'};
    expect((await thrown(run()))?.message).toMatch(/visual Director did not run/);
    mode = {main: '500'};
    expect((await thrown(run()))?.message).toMatch(/visual Director did not run/);
    mode = {main: '500'};
    const lenient = await run(false);
    expect(lenient.stats.warnings).toContain('director_fallback');
  }, 180_000);

  it('a strict run whose Director returned NO opening plan stops BEFORE the paid motion stage (Phase 36C early abort): opening_missing, and no motion/graphic request was sent', async () => {
    mode = {opening: 'none', motion: 'zero'};
    const error = await thrown(run());
    expect(error?.code).toBe('ai_direction_failed');
    expect(error?.details).toMatchObject({stage: 'director_deliverables', reason: 'opening_missing'});
    expect(motionRequests()).toHaveLength(0); // nothing paid happened after the Director answered
  }, 120_000);

  it('a pipeline that completes WITHOUT an opening plan (non-strict) is not an experiment success: the verdict says opening_missing', async () => {
    mode = {opening: 'none', motion: 'zero'};
    const blueprint = await run(false);
    const verdict = judgeExperiment({blueprint: blueprint as never, output: {path: '/x', exists: true, bytes: 1_000_000, probe: {width: blueprint.width, height: blueprint.height, durationSec: blueprint.outputDurationSec, fps: 30, hasAudio: true}}});
    expect(verdict.failures.map(item => item.code)).toContain('opening_missing');
    expect(verdict.status).toBe('failed');
  }, 120_000);

  it('with the spend guard installed, a failing Director call is sent ONCE (no HTTP retry, no model fallback) and the run stops', async () => {
    const stub = globalThis.fetch;
    const guard = createSpendGuard({fetchImpl: stub, geminiCapUsd: 0.05, maxRequestsPerHost: {'generativelanguage.googleapis.com': 10, 'api.groq.com': 2}});
    vi.stubGlobal('fetch', guard.fetch);
    try {
      mode = {main: '500'};
      const error = await thrown(run());
      expect(error?.message).toMatch(/visual Director did not run/);
      const directorRequests = hits.filter(hit => hit.body.generationConfig?.responseSchema?.properties?.hook_title);
      expect(directorRequests).toHaveLength(1);
      expect(guard.report().refused.map(item => item.reason)).toContain('repeat_refused');
    } finally {
      vi.stubGlobal('fetch', stub);
    }
  }, 120_000);

  it('the content-profile Gemini request is counted by the guard and bound by its cap (cap of 1: it takes the only slot, the next request is refused, nothing is raised)', async () => {
    const stub = globalThis.fetch;
    const guard = createSpendGuard({fetchImpl: stub, geminiCapUsd: 0.05, maxRequestsPerHost: {'generativelanguage.googleapis.com': 1, 'api.groq.com': 2}});
    vi.stubGlobal('fetch', guard.fetch);
    try {
      const error = await thrown(run(true, {CONTENT_PROFILE_ENABLED: true}));
      expect(error).not.toBeNull(); // the starved run fails; it never completes on fewer calls
      const report = guard.report();
      expect(report.requestsPerHost['generativelanguage.googleapis.com']).toBe(1);
      expect(hits).toHaveLength(1);
      expect(JSON.stringify(hits[0]!.body)).toMatch(/density|mood|structure/); // the one request that got through is the content profile
      expect(report.geminiTokens.promptTokens).toBe(10); // its usage is in the cost record
      expect(report.refused.map(item => item.reason)).toContain('host_cap');
    } finally {
      vi.stubGlobal('fetch', stub);
    }
  }, 120_000);
});
