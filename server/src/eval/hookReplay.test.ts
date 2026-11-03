/**
 * Hook-title policy as an ISOLATED replay experiment (offline; no model; saved responses are only read).
 *
 * One saved Director response per fixture is held constant, together with the source identity, the downstream configuration and
 * the render settings. The ONLY thing that varies is HOOK_TITLE_POLICY. The same chain the pipeline runs is executed under each
 * policy and compared at every boundary:
 *   parsed title -> parsed direction -> planned hook window and the rest of the plan -> edit ledger -> conflict validator ->
 *   blueprint hook fields -> rendered frame
 * Every difference between the two policies is then classified as an INTENDED title-policy difference or UNRELATED; the test
 * fails on any unrelated difference.
 *
 * The rendered-frame section is OPT-IN (RENDER_TESTS=1: Chrome renders beside the rest of the suite starve unrelated tests); the
 * other boundaries always run.
 *
 * HTTP is mocked at `requestJson`, so planVisualDirection is the real code and its request is inspectable; the Director's reply is
 * the saved response. Stock search is replaced by a deterministic stub. Nothing is sent anywhere.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {outcomeOf} from '../lib/editLedger.ts';
import {finalizeEdits} from '../pipeline/finalizeEdits.ts';
import {HOOK_STYLES} from '../types/blueprint.ts';
import {shortVideoPropsSchema, timelineBlueprintSchema} from '../../../remotion/src/blueprintSchema.ts';
import {buildTimeline} from '../stages/filters/timeline.ts';
import {parseVisualDirectorJson} from '../stages/broll/geminiDirector.ts';
import {canonicalize} from './canonical.ts';
import {loadV1Fixtures} from './fixtures.ts';
import {sha256} from './baseline.ts';

const captured = vi.hoisted(() => ({bodies: [] as Array<Record<string, any>>, responseText: ''}));
vi.mock('../lib/http.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/http.ts')>()),
  requestJson: async (_url: string, options: {body?: string}) => {
    captured.bodies.push(JSON.parse(options.body ?? '{}'));
    return {candidates: [{content: {parts: [{text: captured.responseText}]}}], usageMetadata: {promptTokenCount: 1, candidatesTokenCount: 1}};
  },
}));
vi.mock('../stages/broll/stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/stockSearch.ts')>();
  const asset = (query: unknown) => {
    const id = parseInt(createHash('sha1').update(String(query)).digest('hex').slice(0, 7), 16);
    return {assetUrl: `https://stock.invalid/${id}.mp4`, provider: 'pexels' as const, providerId: id, width: 1080, height: 1920, durationSec: 12, credit: 's', creditUrl: ''};
  };
  return {...actual, stockConfigured: () => true, findBRollAsset: async (q: unknown) => asset(q), findPhotoAsset: async (q: unknown) => asset(q), listBRollAssets: async (q: unknown) => [asset(q), asset(`${String(q)}/2`)]};
});
const {planBRoll} = await import('../stages/broll/brollPlanner.ts');

const e = env as unknown as {HOOK_TITLE_POLICY: string; GEMINI_API_KEY: string};
const original = {policy: e.HOOK_TITLE_POLICY, key: e.GEMINI_API_KEY};
afterEach(() => {
  e.HOOK_TITLE_POLICY = original.policy;
  e.GEMINI_API_KEY = original.key;
  captured.bodies.length = 0;
});

type Policy = 'placeholder' | 'optional';
const POLICIES: Policy[] = ['placeholder', 'optional'];

/** The saved response, unchanged ("as saved"), or with the title removed in one of the ways a model can omit it. */
const VARIANTS: Array<[string, (raw: Record<string, any>) => void]> = [
  ['as saved', () => undefined],
  ['title key removed', raw => { delete raw.hook_title; delete raw.hookTitle; }],
  ['title null', raw => { raw.hook_title = null; delete raw.hookTitle; }],
  ['title empty', raw => { raw.hook_title = ''; delete raw.hookTitle; }],
  ['title whitespace', raw => { raw.hook_title = ' \n\t '; delete raw.hookTitle; }],
];

type Boundaries = {
  parsed: {hookTitle: string};
  direction: Record<string, unknown>;
  plan: {hook: Record<string, unknown>; rest: Record<string, unknown>};
  ledger: {hook: unknown[]; rest: unknown[]};
  conflicts: {hook: unknown[]; rest: unknown[]};
  blueprintHook: Record<string, unknown>;
  request: Record<string, unknown>;
};

const isHookDecision = (decision: {id: string}) => decision.id.startsWith('hook_title');

async function replay(fixtureIndex: number, variant: (raw: Record<string, any>) => void, policy: Policy): Promise<Boundaries> {
  const fixture = loadV1Fixtures()[fixtureIndex]!;
  const raw = JSON.parse(fixture.rawResponse) as Record<string, any>;
  variant(raw);
  const responseText = JSON.stringify(raw);
  e.HOOK_TITLE_POLICY = policy;
  e.GEMINI_API_KEY = 'test-key-offline';
  captured.responseText = responseText;
  captured.bodies.length = 0;

  const parsedDirection = parseVisualDirectorJson(responseText, fixture.sourceDurationSec, fixture.transcript);
  const timeline = buildTimeline(fixture.keepSegments as never);
  const plan = await planBRoll({transcript: fixture.transcript, sourceDurationSec: fixture.sourceDurationSec, timeline, words: fixture.words as never, captionWords: fixture.captionWords as never, requestedEdits: fixture.requestedEdits} as never);
  const ledger = plan.ledger!;
  const finalized = finalizeEdits({
    ledger, contentProfile: null, footageLuminance: 0.4, captionLocked: false, durationSec: timeline.outputDurationSec,
    hook: {text: plan.hookTitle, start: plan.hookStartSec ?? 0, end: (plan.hookStartSec ?? 0) + Math.max(1.2, plan.hookDurationSec || 0), anchor: 'top_left'},
    caption: plan.caption, brollClips: plan.clips, visualOverlays: plan.overlays, insetReveals: plan.insetReveals, frameInsets: plan.frameInsets, mediaContainers: plan.mediaContainers,
    motionGraphics: plan.motionGraphics, semanticEmphasis: plan.semanticEmphasis, depthOverlays: plan.depthOverlays, transitions: plan.transitions, zoomTriggers: [], generatedGraphics: [],
    speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'}, speakerCutout: {available: false},
  });

  const {hookTitle, hookSubtitle, hookStyle, hookDurationSec, hookStartSec, ledger: _ledger, assembler: _assembler, ...restOfPlan} = plan as unknown as Record<string, any>;
  const { hookTitle: parsedTitle, ...restOfDirection } = parsedDirection as Record<string, any>;
  const entries = ledger.entries().map(entry => ({type: entry.type, label: entry.label, start: entry.start, end: entry.end, outcome: outcomeOf(entry), reason: entry.reason ?? null, tracks: entry.events.map(event => event.track ?? null)}));
  const request = captured.bodies[0] ?? {};
  return {
    parsed: {hookTitle: parsedTitle as string},
    direction: restOfDirection,
    plan: {hook: {hookTitle, hookSubtitle, hookStyle, hookDurationSec, hookStartSec}, rest: restOfPlan},
    ledger: {hook: entries.filter(entry => entry.type === 'hook_title'), rest: entries.filter(entry => entry.type !== 'hook_title')},
    conflicts: {hook: finalized.decisions.filter(isHookDecision), rest: finalized.decisions.filter(decision => !isHookDecision(decision))},
    // what analyzeVideo copies into the blueprint
    blueprintHook: {hookTitle, hookSubtitle: '', hookDurationSec, hookStartSec: hookStartSec ?? 0, hookStyle},
    request: {systemInstruction: request.systemInstruction, userPrompt: request.contents?.[0]?.parts?.[0]?.text, generationConfig: request.generationConfig},
  };
}

const eq = (a: unknown, b: unknown) => JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
/** Paths at which two values differ (after canonicalisation), so a failure names what changed. */
function diffPaths(a: unknown, b: unknown, path = ''): string[] {
  const [x, y] = [canonicalize(a), canonicalize(b)];
  if (JSON.stringify(x) === JSON.stringify(y)) {
    return [];
  }
  if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
    const keys = new Set([...Object.keys(x as object), ...Object.keys(y as object)]);
    return [...keys].flatMap(key => diffPaths((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key], `${path}${Array.isArray(x) ? `[${key}]` : `.${key}`}`));
  }
  return [path || '(root)'];
}
const fixtures = loadV1Fixtures();

describe('the corpus', () => {
  it('uses the 8 saved Director responses; they are only read (hashes before and after are the same)', () => {
    const before = fixtures.map(item => sha256(item.rawResponse));
    expect(fixtures).toHaveLength(8);
    expect(loadV1Fixtures().map(item => sha256(item.rawResponse))).toEqual(before);
    for (const fixture of fixtures) {
      expect(typeof JSON.parse(fixture.rawResponse)).toBe('object');
    }
  });
});

describe('response as saved (a title IS present): the two policies are indistinguishable at every boundary after the request', () => {
  it.each(fixtures.map((fixture, index) => [fixture.id, index] as const))('%s', async (_id, index) => {
    const a = await replay(index, VARIANTS[0]![1], 'placeholder');
    const b = await replay(index, VARIANTS[0]![1], 'optional');
    expect(a.parsed.hookTitle).not.toBe('');
    expect(b.parsed).toEqual(a.parsed);
    expect(diffPaths(b.direction, a.direction)).toEqual([]);
    expect(diffPaths(b.plan, a.plan)).toEqual([]);
    expect(diffPaths(b.ledger, a.ledger)).toEqual([]);
    expect(diffPaths(b.conflicts, a.conflicts)).toEqual([]);
    expect(diffPaths(b.blueprintHook, a.blueprintHook)).toEqual([]);
    // the model REQUEST differs only in the response schema's required list (verified separately)
    expect(b.request.systemInstruction).toEqual(a.request.systemInstruction);
    expect(b.request.userPrompt).toBe(a.request.userPrompt);
  });
});

describe('response with the title omitted: ONLY title-policy differences appear, boundary by boundary', () => {
  const omitted = VARIANTS.slice(1);
  const cases = fixtures.flatMap((fixture, index) => omitted.map(([name, edit]) => [fixture.id, name, index, edit] as const));

  it.each(cases)('%s / %s', async (_id, _name, index, edit) => {
    const _index = index;
    const a = await replay(index, edit, 'placeholder');
    const b = await replay(index, edit, 'optional');

    // 1. parsed title
    expect(a.parsed.hookTitle).toBe('WATCH THIS');
    expect(b.parsed.hookTitle).toBe('');

    // 2. parsed direction: nothing differs, except `hookStyle` when the model did not choose one. In that case the parser picks a style by
    //    hashing the title text (coerceHookStyle), so an absent title can pick a different (unused, because no hook is drawn) style.
    const savedRaw = JSON.parse(loadV1Fixtures()[_index]!.rawResponse) as Record<string, any>;
    const styleChosenByModel = (HOOK_STYLES as readonly string[]).includes(String(savedRaw.hook_style ?? savedRaw.hookStyle ?? '').trim().toLowerCase());
    const { hookStyle: styleA, ...directionA } = a.direction as Record<string, any>;
    const { hookStyle: styleB, ...directionB } = b.direction as Record<string, any>;
    expect(diffPaths(directionB, directionA)).toEqual([]);
    if (styleChosenByModel) {
      expect(styleB).toBe(styleA);
    }

    // 3. planned hook window: placeholder keeps a real window; optional has none
    expect(a.plan.hook.hookTitle).toBe('WATCH THIS');
    expect(Number(a.plan.hook.hookDurationSec)).toBeGreaterThan(0);
    expect(b.plan.hook).toMatchObject({hookTitle: '', hookSubtitle: '', hookStartSec: 0, hookDurationSec: 0});
    if (styleChosenByModel) {
      expect(b.plan.hook.hookStyle).toBe(a.plan.hook.hookStyle);
    }
    expect(HOOK_STYLES as readonly string[]).toContain(b.plan.hook.hookStyle);

    // 3b. the rest of the plan (clips, overlays, zooms, transitions, inset reveals, caption, audio, ...) is identical
    // The one intended consequence outside the hook fields: when the request asked for a hook_title and none was placed, the plan
    // says so (`requested_not_placed:hook_title`) instead of the placeholder silently satisfying the request. Nothing else changes.
    const { warnings: warningsA, ...restA } = a.plan.rest as Record<string, any>;
    const { warnings: warningsB, ...restB } = b.plan.rest as Record<string, any>;
    expect(diffPaths(restB, restA)).toEqual([]);
    const requestedHook = (loadV1Fixtures()[_index]!.requestedEdits ?? []).includes('hook_title');
    const added = (warningsB as string[]).filter(warning => !(warningsA as string[]).includes(warning));
    const removed = (warningsA as string[]).filter(warning => !(warningsB as string[]).includes(warning));
    expect(removed).toEqual([]);
    expect(added).toEqual(requestedHook ? ['requested_not_placed:hook_title'] : []);

    // 4. ledger: the hook entry exists and is rendered under placeholder, and does not exist under optional; nothing else changes
    expect(a.ledger.hook).toHaveLength(1);
    expect(a.ledger.hook[0]).toMatchObject({type: 'hook_title', label: 'WATCH THIS', outcome: 'rendered'});
    expect(b.ledger.hook).toEqual([]);
    expect(diffPaths(b.ledger.rest, a.ledger.rest)).toEqual([]);

    // 5. conflict validator: the hook edit is validated under placeholder only; every other decision is identical
    expect(a.conflicts.hook.length).toBeGreaterThan(0);
    expect(b.conflicts.hook).toEqual([]);
    expect(diffPaths(b.conflicts.rest, a.conflicts.rest)).toEqual([]);

    // 6. blueprint hook fields: valid under the schema in both arms; optional has no title and no window
    for (const arm of [a, b]) {
      expect(timelineBlueprintSchema.shape.hookTitle.safeParse(arm.blueprintHook.hookTitle).success).toBe(true);
      expect(timelineBlueprintSchema.shape.hookDurationSec.safeParse(arm.blueprintHook.hookDurationSec).success).toBe(true);
      expect(timelineBlueprintSchema.shape.hookStartSec.safeParse(arm.blueprintHook.hookStartSec).success).toBe(true);
    }
    expect(b.blueprintHook).toMatchObject({hookTitle: '', hookDurationSec: 0, hookStartSec: 0});

    // the optional arm never contains the placeholder anywhere it produced
    expect(JSON.stringify([b.parsed, b.direction, b.plan, b.ledger, b.conflicts, b.blueprintHook])).not.toContain('WATCH THIS');
    // the placeholder arm still contains it (existing behaviour preserved)
    expect(JSON.stringify([a.parsed, a.plan.hook, a.ledger.hook])).toContain('WATCH THIS');
  }, 60_000);

  it('the two requests are identical except for the response schema "required" list, which is the one request-level difference', async () => {
    const a = await replay(0, omitted[0]![1], 'placeholder');
    const bodyA = JSON.parse(JSON.stringify(captured.bodies[0]));
    const b = await replay(0, omitted[0]![1], 'optional');
    const bodyB = JSON.parse(JSON.stringify(captured.bodies[0]));
    expect(a.request.systemInstruction).toEqual(b.request.systemInstruction);
    expect(a.request.userPrompt).toBe(b.request.userPrompt);
    const find = (body: any): string[] | undefined => {
      const walk = (node: any): string[] | undefined => {
        if (node && typeof node === 'object') {
          if (Array.isArray(node.required) && node.required.includes('moments')) {
            return node.required;
          }
          for (const value of Object.values(node)) {
            const found = walk(value);
            if (found) {
              return found;
            }
          }
        }
        return undefined;
      };
      return walk(body.generationConfig);
    };
    expect(find(bodyA)).toEqual(['hook_title', 'moments', 'topic', 'caption']);
    expect(find(bodyB)).toEqual(['moments', 'topic', 'caption']);
    const normalise = (body: any) => JSON.parse(JSON.stringify(body, (key, value) => (key === 'required' && Array.isArray(value) ? undefined : value)));
    expect(normalise(bodyB)).toEqual(normalise(bodyA));
  });
});

describe('rendered frames: the plan\'s hook fields drawn by the real Remotion renderer', () => {
  const REMOTION = resolve(dirname(fileURLToPath(import.meta.url)), '../../../remotion');
  const enabled = process.env.RENDER_TESTS === '1';
  let dir: string;
  const stills = new Map<string, string>();
  const propsFor = (hook: Record<string, unknown>) =>
    shortVideoPropsSchema.parse({
      blueprint: {
        blueprintId: 'bp_hook_replay', languageCode: 'en', videoUrl: 'staticFile:testsrc.mp4', fps: 30, width: 1080, height: 1920,
        sourceDurationSec: 8, outputDurationSec: 8, captionWords: [], keepSegments: [{sourceStart: 0, sourceEnd: 8, outputStart: 0}], zoomTriggers: [], brollClips: [],
        hookTitle: hook.hookTitle, hookSubtitle: '', hookDurationSec: hook.hookDurationSec, hookStartSec: hook.hookStartSec, hookStyle: hook.hookStyle,
      },
      style: {captionTemplate: 'karaoke', layoutStyle: 'fullscreen', captionBottomFrac: 0.2, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''},
    });
  const render = (name: string, hook: Record<string, unknown>) => {
    const propsPath = join(dir, `${name}.props.json`);
    const outPath = join(dir, `${name}.png`);
    writeFileSync(propsPath, JSON.stringify(propsFor(hook)));
    const frame = Math.round((Number(hook.hookStartSec ?? 0) + 0.6) * 30);
    execFileSync('npx', ['remotion', 'still', 'src/index.ts', 'ShortVideo', outPath, `--props=${propsPath}`, `--frame=${frame}`, `--public-dir=${join(dir, 'public')}`], {cwd: REMOTION, stdio: 'pipe', timeout: 120_000});
    stills.set(name, createHash('sha256').update(readFileSync(outPath)).digest('hex'));
  };

  beforeAll(async () => {
    if (!enabled) {
      return;
    }
    dir = mkdtempSync(join(tmpdir(), 'hook-replay-'));
    mkdirSync(join(dir, 'public'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30:duration=8', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', join(dir, 'public', 'testsrc.mp4')], {stdio: 'pipe'});
    // hi-relationship fixture, response with the title removed, both policies; and the response as saved, both policies
    const index = fixtures.findIndex(item => item.id.startsWith('v1-hi-relationship'));
    const stripped = VARIANTS[1]![1];
    const placeholderArm = await replay(index, stripped, 'placeholder');
    const optionalArm = await replay(index, stripped, 'optional');
    const savedPlaceholder = await replay(index, VARIANTS[0]![1], 'placeholder');
    const savedOptional = await replay(index, VARIANTS[0]![1], 'optional');
    render('stripped_placeholder', placeholderArm.blueprintHook);
    render('stripped_optional', optionalArm.blueprintHook);
    render('no_hook_reference', {hookTitle: '', hookDurationSec: 0, hookStartSec: 0, hookStyle: placeholderArm.blueprintHook.hookStyle});
    render('saved_placeholder', savedPlaceholder.blueprintHook);
    render('saved_optional', savedOptional.blueprintHook);
  }, 240_000);

  afterAll(() => {
    if (dir) {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it.skipIf(!enabled)('title omitted: the optional arm renders exactly like a video with no hook; the placeholder arm draws "WATCH THIS" and differs', () => {
    expect(stills.get('stripped_optional')).toBe(stills.get('no_hook_reference'));
    expect(stills.get('stripped_placeholder')).not.toBe(stills.get('no_hook_reference'));
    expect(stills.get('stripped_placeholder')).not.toBe(stills.get('stripped_optional'));
  });

  it.skipIf(!enabled)('title present (response as saved): both policies render byte-identical frames, and the title is visible', () => {
    expect(stills.get('saved_optional')).toBe(stills.get('saved_placeholder'));
    expect(stills.get('saved_placeholder')).not.toBe(stills.get('no_hook_reference'));
  });
});
