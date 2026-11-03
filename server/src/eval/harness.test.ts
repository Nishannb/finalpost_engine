/**
 * Offline evaluation harness. Replays every saved v1 Director response through the real planner stages (no network,
 * no credentials) and checks the machine invariants M1–M9. Run:  npx vitest run src/eval
 *
 * Coverage level of this file: SAVED-RESPONSE REPLAY (parse → planBRoll → resolveDirectedZooms → finalizeEdits →
 * renderer-schema parse). It is not a full pipeline run (no analyzeVideo assembly) and renders nothing.
 */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {afterAll, describe, expect, it, vi} from 'vitest';

import {
  brollClipSchema,
  depthOverlayClipSchema,
  frameInsetSchema,
  insetRevealClipSchema,
  mediaContainerSchema,
  motionGraphicSchema,
  semanticEmphasisSchema,
  transitionClipSchema,
  visualOverlaySchema,
  zoomTriggerSchema,
} from '../../../remotion/src/blueprintSchema.ts';
import type {VisualDirection} from '../stages/broll/geminiDirector.ts';
import {env} from '../config/env.ts';
import {EditLedger} from '../lib/editLedger.ts';
import {classifyReason} from '../lib/reasonRegistry.ts';
import {validate} from '../lib/assembler/legality.ts';
import {legacyOccupancySliceTimes, legacyStoryboardTimes} from '../stages/directorV2/storyboardPlan.ts';
import {canonicalJson} from './canonical.ts';
import {checkNoSilentNoop, checkPermutation, checkPreservation, checkRefusalPrecision, checkSurvival, densityReport, runAll, type BlueprintSchemas} from './invariants.ts';
import {GOLDEN_DIR, loadV1Fixtures} from './fixtures.ts';
import {sha256File} from './baseline.ts';
import {lintPrompts} from './promptLint.ts';
import {replayV1, V1_REPLAY_COVERAGE, type ReplayDeps} from './replayCore.ts';

const hoisted = vi.hoisted(() => ({direction: null as unknown}));

vi.mock('../stages/broll/geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/geminiDirector.ts')>();
  return {...actual, directorConfigured: () => true, planVisualDirection: async () => hoisted.direction as VisualDirection};
});

/** Deterministic stock: the asset depends only on the query text (and how often it was asked), never on call order across queries. */
const asked = vi.hoisted(() => new Map<string, number>());
vi.mock('../stages/broll/stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/stockSearch.ts')>();
  const asset = (query: unknown) => {
    const key = String(query ?? '');
    const n = (asked.get(key) ?? 0) + 1;
    asked.set(key, n);
    const id = parseInt(createHash('sha1').update(`${key}#${n}`).digest('hex').slice(0, 7), 16);
    return {assetUrl: `https://stock.invalid/${id}.mp4`, provider: 'pexels' as const, providerId: id, width: 1080, height: 1920, durationSec: 12, credit: 'stub', creditUrl: ''};
  };
  return {
    ...actual,
    stockConfigured: () => true,
    findBRollAsset: async (query: unknown) => asset(query),
    findPhotoAsset: async (query: unknown) => asset(query),
    listBRollAssets: async (query: unknown) => [asset(query), asset(`${String(query)}/2`), asset(`${String(query)}/3`)],
  };
});

const {planBRoll} = await import('../stages/broll/brollPlanner.ts');

const deps: ReplayDeps = {
  setDirection: direction => {
    hoisted.direction = direction;
    asked.clear();
  },
  planBRoll: planBRoll as unknown as ReplayDeps['planBRoll'],
};

const schemas: BlueprintSchemas = {
  brollClip: brollClipSchema,
  visualOverlay: visualOverlaySchema,
  insetRevealClip: insetRevealClipSchema,
  frameInset: frameInsetSchema,
  mediaContainer: mediaContainerSchema,
  motionGraphic: motionGraphicSchema,
  semanticEmphasis: semanticEmphasisSchema,
  depthOverlayClip: depthOverlayClipSchema,
  transitionClip: transitionClipSchema,
  zoomTrigger: zoomTriggerSchema,
};

const fixtures = loadV1Fixtures();
const report: Array<Record<string, unknown>> = [];

afterAll(() => {
  // Always state what this run covers, so a green result is never read as an end-to-end or visual check.
  console.log(
    `\n[eval:replay] coverage level: ${V1_REPLAY_COVERAGE.level} — exercised: ${V1_REPLAY_COVERAGE.exercised.join('; ')}.\n` +
      `[eval:replay] NOT exercised: ${V1_REPLAY_COVERAGE.notExercised.join('; ')}. Stubbed: ${V1_REPLAY_COVERAGE.stubbed.join('; ')}.\n` +
      `[eval:replay] corpus: ${fixtures.length} saved responses over ${new Set(fixtures.map(item => item.id.split('-').slice(1, -1).join('-'))).size} source clips — a regression set, not a benchmark.\n`,
  );
  const dir = process.env.EVAL_REPORT_DIR;
  if (dir) {
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, 'replay-report.json'), JSON.stringify({coverage: V1_REPLAY_COVERAGE, cases: report}, null, 1));
  }
});

describe('saved-response replay: invariants M1–M9 (flags off)', () => {
  it('has a corpus', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixtures.map(fixture => [fixture.id, fixture] as const))('%s', async (_id, fixture) => {
    const base = await replayV1(fixture, deps, 'identity');
    const permuted = [
      {label: 'reverse', result: await replayV1(fixture, deps, 'reverse')},
      {label: 'shuffle#1', result: await replayV1(fixture, deps, 1)},
      {label: 'shuffle#7', result: await replayV1(fixture, deps, 7)},
    ];
    const results = runAll(base, permuted, schemas);
    report.push({case: fixture.id, coverage: V1_REPLAY_COVERAGE.level, invariants: results, density: densityReport(base)});
    const failed = results.filter(item => !item.pass);
    expect(failed.map(item => `${fixture.id} ${item.id} ${item.title}\n  - ${item.failures.join('\n  - ')}`), 'replay: `npx vitest run src/eval -t ' + fixture.id + '`').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Negative controls: each invariant must FAIL when its fault is injected (otherwise a green run means nothing).
// ---------------------------------------------------------------------------------------------------------------------
describe('negative controls: the invariants detect injected faults', () => {
  const fixture = fixtures.find(item => item.id.startsWith('v1-hi-relationship'))!;
  const fresh = () => replayV1(fixture, deps, 'identity');

  it('M1 fails when a surviving edit disappears from its renderer array', async () => {
    const r = await fresh();
    r.plan.clips.length = 0;
    expect(checkSurvival(r, schemas).failures.join('\n')).toMatch(/no cutaway in the plan array/);
  });

  it('M1 fails when an item violates the blueprint schema', async () => {
    const r = await fresh();
    (r.plan.clips[0] as unknown as {start: unknown}).start = 'soon';
    expect(checkSurvival(r, schemas).pass).toBe(false);
  });

  it('M2 fails on an unregistered reason and on a reason from the wrong stage', async () => {
    const r = await fresh();
    const ledger = r.plan.ledger!;
    const id = ledger.propose({type: 'zoom', stage: 'visual_director', start: 5, end: 6, label: 'zoom'});
    ledger.drop(id, 'editorial_gate', 'because_reasons');
    const wrong = ledger.propose({type: 'zoom', stage: 'visual_director', start: 9, end: 10, label: 'zoom'});
    ledger.drop(wrong, 'plan_assembly', 'zoom_blocked_by_cutaway_or_overlay');
    const failures = checkRefusalPrecision(r).failures.join('\n');
    expect(failures).toMatch(/unregistered reason "because_reasons"/);
    expect(failures).toMatch(/zoom_blocked_by_cutaway_or_overlay reported by plan_assembly, expected editorial_gate/);
  });

  it('M3 fails when the result depends on order', async () => {
    const base = await fresh();
    const other = await fresh();
    (other.canonical as {clips: Array<{start: number}>}).clips[0]!.start += 1;
    expect(checkPermutation(base, [{label: 'tampered', result: other}]).pass).toBe(false);
  });

  it('M4/M5 fails when a zoom focus is invented or lost, or an edit leaves the timeline', async () => {
    const r = await fresh();
    if (r.zoomTriggers[0]) {
      r.zoomTriggers[0] = {...r.zoomTriggers[0], focus: {x: 0.5, y: 0.5}};
    }
    const entry = r.plan.ledger!.entries().find(item => item.final)!;
    entry.final = {start: 0, end: r.timeline.outputDurationSec + 10};
    const failures = checkPreservation(r).failures.join('\n');
    expect(failures).toMatch(/outside the output timeline/);
    if (r.plan.zooms.length > 0) {
      expect(failures).toMatch(/a focus appeared that the Director did not give/);
    }
  });

  it('M6 fails for an accepted edit that never reaches a renderer track', async () => {
    const r = await fresh();
    const ledger = r.plan.ledger!;
    const id = ledger.propose({type: 'frame_inset', stage: 'visual_director', start: 10, end: 14, label: 'frame'});
    ledger.accept(id, 'plan_assembly', {to: {start: 10, end: 14}});
    expect(checkNoSilentNoop(r).failures.join('\n')).toContain(`${id}: accepted but never handed to a renderer track`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// M8: prerequisite refusals — table-driven through the real v2 assembler legality.
// ---------------------------------------------------------------------------------------------------------------------
describe('M8 prerequisite refusals carry a registered, precise reason', () => {
  const words = Array.from({length: 60}, (_, i) => ({id: `w${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.4}));
  const ctx = (mask: boolean) => ({durationSec: 30, words, capabilities: {speakerMask: mask ? 'available' : 'unavailable', occupancySource: 'detected', safeRegions: [], captionBand: {x: 0, y: 0.76, w: 1, h: 0.24}}, candidates: [{assetId: 'ub', source: 'user', description: 'x', durationSec: 8, suitability: 0.9}]}) as never;
  const plan = (elements: Array<{id: string; kind: string; from: string; to: string; params?: Record<string, unknown>}>) =>
    ({thesis: 't', captions: {} as never, hookTitle: '', hookStyle: 'x' as never, discardedAssets: [], requestedEdits: [], elements: elements.map(e => ({id: e.id, kind: e.kind, anchor: {startWord: e.from, endWord: e.to}, reason: 'r', params: e.params ?? {}}))}) as never;

  const table: Array<[string, Parameters<typeof plan>[0], boolean, string, string]> = [
    ['cutout without a speaker mask', [{id: 'a', kind: 'cutout', from: 'w14', to: 'w18'}], false, 'needs_speaker_mask', 'missing_prerequisite'],
    ['depth_overlay without a speaker mask', [{id: 'a', kind: 'depth_overlay', from: 'w14', to: 'w22', params: {assetId: 'ub'}}], false, 'needs_speaker_mask', 'missing_prerequisite'],
    ['kinetic_text with no text', [{id: 'a', kind: 'kinetic_text', from: 'w14', to: 'w18', params: {text: ' '}}], true, 'text_missing', 'missing_text_or_asset'],
    ['cutaway with no asset', [{id: 'a', kind: 'cutaway', from: 'w14', to: 'w20'}], true, 'asset_missing', 'missing_text_or_asset'],
    ['cutaway with an unknown asset id', [{id: 'a', kind: 'cutaway', from: 'w14', to: 'w20', params: {assetId: 'nope'}}], true, 'asset_missing', 'missing_text_or_asset'],
    ['an unknown kind', [{id: 'a', kind: 'custom_scene', from: 'w14', to: 'w18'}], true, 'unknown_kind', 'unsupported_kind'],
    ['a transition far longer than allowed', [{id: 'a', kind: 'transition', from: 'w14', to: 'w24'}], true, 'duration_out_of_range', 'invalid_parameter'],
    ['a frame inset overlapping a media container', [{id: 'a', kind: 'frame_inset', from: 'w14', to: 'w24'}, {id: 'b', kind: 'media_container', from: 'w16', to: 'w26'}], true, 'overlap_conflict', 'timeline_conflict'],
  ];

  it.each(table)('%s', (_name, elements, mask, code, category) => {
    const refusals = validate(plan(elements), ctx(mask)).refusals;
    expect(refusals.map(item => item.code)).toContain(code);
    expect(classifyReason(code)).toMatchObject({registered: true, category});
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// M10: prompt lint pinned (prompts are NOT edited in Phase 13).
// ---------------------------------------------------------------------------------------------------------------------
describe('M10 prompt lint (known open findings, pinned)', () => {
  const pinned = join(GOLDEN_DIR, 'prompt-lint.json');
  it('matches the pinned findings; a new banned phrase fails, a removed one requires re-approval', () => {
    const findings = lintPrompts();
    if (process.env.EVAL_UPDATE_GOLDEN === '1') {
      mkdirSync(GOLDEN_DIR, {recursive: true});
      writeFileSync(pinned, JSON.stringify({note: 'Open findings from Phase 12 (prompts unchanged in Phase 13). Regenerate with EVAL_UPDATE_GOLDEN=1 only after a reviewed prompt change.', findings}, null, 1));
    }
    expect(existsSync(pinned), 'golden/prompt-lint.json missing: run with EVAL_UPDATE_GOLDEN=1').toBe(true);
    // Line numbers move with unrelated edits; the finding is identified by file, pattern id and text.
    const key = (list: Array<{file: string; id: string; text: string}>) => list.map(item => `${item.file}|${item.id}|${item.text}`);
    expect(key(findings)).toEqual(key(JSON.parse(readFileSync(pinned, 'utf8')).findings));
    expect(findings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Legacy compatibility baseline A: flags off. Goldens are SELF-GENERATED from the approved working state (see
// baselines/legacy.manifest.json); they pin behaviour, they are not an independent ground truth.
// ---------------------------------------------------------------------------------------------------------------------
describe('legacy compatibility (experimental flags off)', () => {
  it('experimental flags default to off', () => {
    expect(env.GENERATED_TRANSITIONS_ENABLED).toBe(false);
    expect(env.DIRECTOR_V2).toBe(false);
    expect(env.NORTH_STAR).toBe(false);
    expect(env.MOTION_GRAPHICS_ENABLED).toBe(false);
    expect((env as unknown as {VISUAL_CONTEXT_V2?: boolean}).VISUAL_CONTEXT_V2 ?? false).toBe(false);
  });

  it.each(fixtures.map(fixture => [fixture.id, fixture] as const))('%s matches its golden planner result', async (id, fixture) => {
    const golden = join(GOLDEN_DIR, `${id}.planner.json`);
    const actual = canonicalJson((await replayV1(fixture, deps, 'identity')).canonical);
    if (process.env.EVAL_UPDATE_GOLDEN === '1') {
      mkdirSync(GOLDEN_DIR, {recursive: true});
      writeFileSync(golden, actual);
    }
    expect(existsSync(golden), `${golden} missing: run with EVAL_UPDATE_GOLDEN=1 once, from the approved state`).toBe(true);
    expect(actual).toBe(readFileSync(golden, 'utf8'));
  });

  it('pins the legacy frame-selection times (storyboard + occupancy slices) before any visual-context change', () => {
    const golden = join(GOLDEN_DIR, 'legacy-frame-times.json');
    const durations = [15, 30, 41.708, 47.82, 60, 90];
    const actual = canonicalJson(Object.fromEntries(durations.map(d => [String(d), {storyboardOutputSec: legacyStoryboardTimes(d), sentToDirector: legacyStoryboardTimes(d).slice(0, 8), occupancySliceOutputSec: legacyOccupancySliceTimes(d)}])));
    if (process.env.EVAL_UPDATE_GOLDEN === '1') {
      mkdirSync(GOLDEN_DIR, {recursive: true});
      writeFileSync(golden, actual);
    }
    expect(existsSync(golden)).toBe(true);
    expect(actual).toBe(readFileSync(golden, 'utf8'));
  });
});

describe('ledger sanity helpers', () => {
  it('EditLedger is constructible without side effects', () => {
    expect(new EditLedger().entries()).toEqual([]);
  });
});

describe('baseline integrity', () => {
  const root = join(GOLDEN_DIR, '..', '..', '..', '..');
  it('the frozen legacy manifest still matches the fixtures and goldens on disk (re-approval is explicit, never silent)', () => {
    const manifest = JSON.parse(readFileSync(join(GOLDEN_DIR, '..', 'baselines', 'legacy.manifest.json'), 'utf8'));
    expect(manifest.kind).toBe('legacy_compatibility_baseline');
    expect(manifest.flags).toMatchObject({GENERATED_TRANSITIONS_ENABLED: false, DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false});
    expect(manifest.limitations.length).toBeGreaterThan(0);
    for (const file of [...manifest.fixtures, ...manifest.goldens] as Array<{path: string; sha256: string}>) {
      expect(sha256File(join(root, file.path)), file.path).toBe(file.sha256);
    }
  });

  it('the experimental manifest classifies what it indexes and leaves nothing uncounted', () => {
    const manifest = JSON.parse(readFileSync(join(GOLDEN_DIR, '..', 'baselines', 'experimental.manifest.json'), 'utf8'));
    expect(manifest.kind).toBe('experimental_capability_baseline');
    const total = Object.values(manifest.countsByClass as Record<string, number>).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(manifest.artifacts.length);
    for (const artifact of manifest.artifacts as Array<{cls: string; stages: string[]; sha256: string}>) {
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.stages.length).toBeGreaterThan(0);
    }
  });
});
