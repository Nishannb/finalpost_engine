/**
 * Phase 2, Checkpoint 1 parity: the EffectiveFlags refactor must not change any unstyled analysis.
 *
 * For each profile x env-flag combination the suite covers, the REAL analyzeVideo runs on an ffmpeg test clip with every model call stubbed
 * (only the Groq and Gemini hosts answer, with canned replies; anything else is blocked and fails the test). The blueprint identity hash
 * (canonical JSON; ids, createdAt and wall-clock timings / latencies removed) is compared with a golden recorded on the code BEFORE the refactor
 * (fixtures/effectiveFlagsParity.golden.json). Re-record only deliberately: UPDATE_PARITY_GOLDEN=1.
 *
 * No paid call is possible: fetch is stubbed globally, keys are fake, ANTHROPIC_API_KEY is blank, the music specialist is off, and no combo
 * enables generated graphics on the legacy profile (the only profile that would call Claude without a budget).
 */
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {analyzeOverridesFor, type ProductEditProfile} from '../lib/productEditProfile.ts';
import {createHash} from 'node:crypto';

import {canonicalJson} from './canonical.ts';

vi.mock('../storage/r2.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../storage/r2.ts')>()),
  uploadSourceVideo: async () => ({publicUrl: 'staticFile:source.mp4', key: 'synthetic'}),
  uploadRenderedVideo: async () => ({publicUrl: 'staticFile:rendered.mp4', key: 'synthetic'}),
}));

const GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'effectiveFlagsParity.golden.json');
const UPDATE = process.env.UPDATE_PARITY_GOLDEN === '1';
const ALLOWED_HOSTS = ['generativelanguage.googleapis.com', 'api.groq.com'];

const WORDS = Array.from({length: 40}, (_, i) => ({word: i % 9 === 8 ? `point${i}.` : `word${i}`, start: i * 0.3, end: i * 0.3 + 0.26}));
const gemini = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}}), {status: 200});
const DIRECTOR_REPLY = {topic: 't', hook_title: 'Silence Speaks', hook_style: 'minimal', moments: [{timestamp: 5, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}};
const blocked: string[] = [];

function reply(body: string, host: string): Response {
  if (host === 'api.groq.com') {
    return new Response(JSON.stringify({text: WORDS.map(word => word.word).join(' '), language: 'en', duration: 12, words: WORDS}), {status: 200});
  }
  if (body.includes('Vertical talking-head video frame')) return gemini(JSON.stringify({x: 0.2, y: 0.1, w: 0.6, h: 0.7}));
  if (body.includes('planned overlay layout')) return gemini('{"notes":""}');
  if (body.includes('"beats"') || body.includes('"elements"')) return gemini('{}');
  if (/keep[ _-]?plan|keepRanges|keep_ranges/i.test(body)) return gemini('{}');
  return gemini(JSON.stringify(DIRECTOR_REPLY));
}

type Combo = {id: string; profile: ProductEditProfile; flags?: Record<string, unknown>; requestedEdits?: string[] | null; basicCaptions?: boolean};

const POLISH_GFX = {MOTION_GRAPHICS_ENABLED: true};
/** Every profile, and every env flag the suite's wiring tests exercise, alone or with the gates it needs. */
const COMBOS: Combo[] = [
  {id: 'legacy', profile: 'legacy', requestedEdits: ['hook_title', 'zoom', 'cutaway']},
  {id: 'legacy-basic-captions', profile: 'legacy', requestedEdits: ['captions'], basicCaptions: true},
  {id: 'mvp', profile: 'mvp', requestedEdits: ['hook_title', 'zoom', 'cutaway']},
  {id: 'mvp-graphics', profile: 'mvp', requestedEdits: ['hook_title', 'zoom', 'cutaway'], flags: POLISH_GFX},
  {id: 'cuts', profile: 'cuts', requestedEdits: null},
  {id: 'cuts-graphics-forced-off', profile: 'cuts', requestedEdits: null, flags: POLISH_GFX},
  {id: 'polish', profile: 'polish', requestedEdits: null},
  {id: 'polish-captions-only', profile: 'polish', requestedEdits: ['captions']},
  {id: 'polish-edits-all', profile: 'polish', requestedEdits: null, flags: {POLISH_DEFAULT_EDITS: 'all'}},
  {id: 'polish-graphics', profile: 'polish', requestedEdits: null, flags: POLISH_GFX},
  {id: 'polish-faceless', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_FACELESS_DOC: true}},
  {id: 'polish-explainer', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_EXPLAINER_SKILL: true}},
  {id: 'polish-newsroom', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_NEWSROOM_MG: true}},
  {id: 'polish-faceless-newsroom-explainer', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_FACELESS_DOC: true, POLISH_NEWSROOM_MG: true, POLISH_EXPLAINER_SKILL: true}},
  {id: 'polish-newsroom-explainer', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_NEWSROOM_MG: true, POLISH_EXPLAINER_SKILL: true}},
  {id: 'polish-textual-mg', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_TEXTUAL_MG: true}},
  {id: 'polish-motion-templates', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_MOTION_TEMPLATES: true}},
  {id: 'polish-kinetic-led', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_MOTION_TEMPLATES: true, POLISH_KINETIC_LED: true}},
  {id: 'polish-explainer-templates', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_MOTION_TEMPLATES: true, POLISH_EXPLAINER_SKILL: true}},
  {id: 'polish-subject-stage', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_MOTION_TEMPLATES: true, POLISH_SUBJECT_STAGE: true}},
  {id: 'polish-visual-backends', profile: 'polish', requestedEdits: null, flags: {...POLISH_GFX, POLISH_RISO_TEMPLATES: true, POLISH_COLLAGE_BROLL: true, POLISH_ANIDOODLE: true}},
  {id: 'polish-skill-a-tools-off', profile: 'polish', requestedEdits: null, flags: {POLISH_VO_CUT_GRAMMAR: false, POLISH_ACCUMULATE_CAPTIONS: false, POLISH_IMPACT_FX: false, POLISH_TH_SKILL_A_TOOLS: false}},
  {id: 'polish-captions-off', profile: 'polish', requestedEdits: null, flags: {POLISH_BARE_CAPTIONS: false, POLISH_EDITORIAL_STILLS_ENABLED: false}},
];

const e = env as unknown as Record<string, unknown>;
const FLAG_KEYS = [...new Set(COMBOS.flatMap(combo => Object.keys(combo.flags ?? {})))];
const BASE: Record<string, unknown> = {
  GEMINI_API_KEY: 'test-gemini-offline', GROQ_API_KEY: 'test-groq-offline', ANTHROPIC_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', KLIPY_API_KEY: '',
  CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false,
  CLAUDE_EDIT_BUDGET_USD: 0, GEMINI_EDIT_MAX_REQUESTS: 0, POLISH_MUSIC_BED_URL: '', RVM_PYTHON: '',
};
const original: Record<string, unknown> = {};
const originalProcess: Record<string, string | undefined> = {};
let work: string;
let video: string;

beforeAll(() => {
  for (const key of [...Object.keys(BASE), ...FLAG_KEYS]) original[key] = e[key];
  for (const key of ['TMPDIR', 'MUSIC_SPECIALIST', 'MUSIC_SPECIALIST_LIVE', 'RUNWARE_API_KEY', 'POLISH_MUSIC_BED_URL']) originalProcess[key] = process.env[key];
  process.env.MUSIC_SPECIALIST = 'off';
  process.env.MUSIC_SPECIALIST_LIVE = '';
  process.env.RUNWARE_API_KEY = '';
  process.env.POLISH_MUSIC_BED_URL = '';
  work = mkdtempSync(join(tmpdir(), 'flags-parity-'));
  process.env.TMPDIR = join(work, 'tmp');
  mkdirSync(process.env.TMPDIR);
  video = join(work, 'source.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const parsed = new URL(String(url));
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      blocked.push(parsed.hostname);
      throw new Error(`blocked outbound request to ${parsed.hostname}`);
    }
    return reply(typeof init?.body === 'string' ? init.body : '', parsed.hostname);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  Object.assign(e, original);
  for (const [key, value] of Object.entries(originalProcess)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, {recursive: true, force: true});
});

async function runCombo(combo: Combo, extraInput: Record<string, unknown> = {}): Promise<string> {
  Object.assign(e, original, BASE, combo.flags ?? {});
  const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
  const {withNoGemini} = await import('../lib/geminiEditBudget.ts');
  const run = () =>
    analyzeVideo({
      videoUrl: video,
      languageCode: 'en',
      userId: 'parity',
      ...(combo.requestedEdits === null ? {} : {requestedEdits: combo.requestedEdits}),
      ...(combo.basicCaptions ? {basicCaptions: true} : {}),
      ...analyzeOverridesFor(combo.profile),
      editProfile: combo.profile,
      ...extraInput,
    } as never);
  const blueprint = withoutWallClock(combo.basicCaptions ? await withNoGemini(run) : await run());
  const dumpDir = process.env.PARITY_DUMP_DIR;
  if (dumpDir) {
    mkdirSync(dumpDir, {recursive: true});
    const n = (dumpCount[combo.id] = (dumpCount[combo.id] ?? 0) + 1);
    writeFileSync(join(dumpDir, `${combo.id}-${n}.json`), canonicalJson(blueprint));
  }
  return createHash('sha256').update(canonicalJson(blueprint)).digest('hex');
}

const dumpCount: Record<string, number> = {};
/** Wall-clock measurements are the only run-to-run noise (verified by diffing two runs): drop them at any depth. canonicalJson drops ids / createdAt. */
const WALL_CLOCK_KEYS = new Set(['timings', 'latencyMs', 'perStageLatencyMs']);
function withoutWallClock(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutWallClock);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !WALL_CLOCK_KEYS.has(key)).map(([key, item]) => [key, withoutWallClock(item)]));
  }
  return value;
}
const readGolden = (): Record<string, string> => (existsSync(GOLDEN) ? (JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>) : {});

describe('EffectiveFlags parity: unstyled analyses are identical to the pre-refactor golden', () => {
  const recorded: Record<string, string> = {};

  it.each(COMBOS.map(combo => [combo.id, combo] as const))('%s', async (_id, combo) => {
    const hash = await runCombo(combo);
    // The same combo twice gives the same blueprint: the harness itself is deterministic.
    expect(await runCombo(combo)).toBe(hash);
    recorded[combo.id] = hash;
    if (!UPDATE) {
      expect(readGolden()[combo.id], `no golden for ${combo.id}: record it on the pre-refactor code with UPDATE_PARITY_GOLDEN=1`).toBe(hash);
    }
  }, 240_000);

  it('nothing escaped the stubbed network', () => {
    expect(blocked).toEqual([]);
    if (UPDATE) {
      mkdirSync(dirname(GOLDEN), {recursive: true});
      writeFileSync(GOLDEN, `${JSON.stringify(recorded, Object.keys(recorded).sort(), 1)}\n`);
    }
  });
});
