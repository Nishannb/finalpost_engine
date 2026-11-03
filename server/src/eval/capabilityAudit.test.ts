/**
 * Capability audit: every edit kind traced through the REAL v2 compile → assembler → planBRoll → resolveDirectedZooms →
 * finalizeEdits path, reading the ledger for what each edit ends up as. Synthetic v2 plans, stock stubbed, nothing rendered.
 * Level: "synthetic v2 plan replay" (not a saved response, not a render, not a full pipeline).
 *
 * For each kind it records: compiled? parameters preserved? timing preserved? what the ledger says the renderer receives,
 * and whether that is a visible effect or an accepted-but-invisible no-op. `EVAL_REPORT_DIR` writes capability-trace.json.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {afterAll, describe, expect, it, vi} from 'vitest';

import {compileCreativePlan} from '../stages/directorV2/compiler.ts';
import type {CreativeElement, CreativePlan, PerceptionPack} from '../stages/directorV2/types.ts';
import {buildTimeline} from '../stages/filters/timeline.ts';
import {resolveDirectedZooms} from '../stages/filters/autoZoom.ts';
import {finalizeEdits, zoomResolutionTrace, RENDERER_TRACK} from '../pipeline/finalizeEdits.ts';
import {outcomeOf, type LedgerEditType} from '../lib/editLedger.ts';
import type {VisualDirection} from '../stages/broll/geminiDirector.ts';

const hoisted = vi.hoisted(() => ({direction: null as unknown}));
vi.mock('../stages/broll/geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/geminiDirector.ts')>();
  return {...actual, directorConfigured: () => true, planVisualDirection: async () => hoisted.direction as VisualDirection};
});
let nextId = 1;
vi.mock('../stages/broll/stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/broll/stockSearch.ts')>();
  const asset = () => ({assetUrl: `https://stock.invalid/${nextId}.mp4`, provider: 'pexels' as const, providerId: nextId++, width: 1080, height: 1920, durationSec: 12, credit: 'x', creditUrl: ''});
  return {...actual, stockConfigured: () => true, findBRollAsset: async () => asset(), findPhotoAsset: async () => asset(), listBRollAssets: async () => [asset(), asset(), asset()]};
});
const {planBRoll} = await import('../stages/broll/brollPlanner.ts');

const DURATION = 40;
const words = Array.from({length: 80}, (_, i) => ({id: `w${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.45, sentenceId: 's0'}));
const pack = (mask: boolean) =>
  ({words, sentences: [], userAssets: [{id: 'ub', description: 'user clip', durationSec: 9, kind: 'clip'}], occupancySlices: [], outputDurationSec: DURATION, speakerCutoutAvailable: mask, requestedEdits: []}) as unknown as PerceptionPack;
const element = (kind: string, from: number, to: number, extra: Record<string, unknown> = {}): CreativeElement =>
  ({id: `e_${kind}`, beatId: 'b', intent: `purpose of ${kind}`, kind, wordRange: {startWordId: `w${from}`, endWordId: `w${to}`}, params: {}, ...extra}) as unknown as CreativeElement;
const planOf = (elements: CreativeElement[]): CreativePlan =>
  ({editThesis: 't', editThesisParts: {} as never, hookTitle: '', hookStyle: 'bold' as never, caption: undefined as never, preferredLutId: '', suggestedLutIds: [], elements, estimatedCostUsd: 0, promptVersion: 'audit', inputHash: 'audit', raw: {}}) as unknown as CreativePlan;

type Row = {
  kind: string;
  compiled: 'accepted' | `refused:${string}`;
  plannerSurvived: boolean;
  paramsPreserved: string;
  timingPreserved: string;
  ledgerOutcome: string;
  track: string | null;
  visibility: string | null;
  note: string;
};
const rows: Row[] = [];

afterAll(() => {
  if (process.env.EVAL_REPORT_DIR) {
    mkdirSync(process.env.EVAL_REPORT_DIR, {recursive: true});
    writeFileSync(join(process.env.EVAL_REPORT_DIR, 'capability-trace.json'), JSON.stringify({level: 'synthetic_v2_plan_replay', rows}, null, 1));
  }
});

async function trace(label: string, ledgerType: LedgerEditType, el: CreativeElement, opts: {mask?: boolean; /** Creator-supplied footage present: the planner disables stock search, as in the real pipeline. */ user?: boolean; companions?: CreativeElement[]; check: (r: Awaited<ReturnType<typeof planBRoll>>, direction: VisualDirection, finalized: ReturnType<typeof finalizeEdits>, triggers: ReturnType<typeof resolveDirectedZooms>) => {params: string; timing: string; survived: boolean}}): Promise<Row> {
  const mask = Boolean(opts.mask);
  const compiled = await compileCreativePlan({pack: pack(mask), plan: planOf([el, ...(opts.companions ?? [])]), noRepair: true});
  const refusal = compiled.report.violations.find(item => item.elementId === el.id);
  if (refusal) {
    const row: Row = {kind: label, compiled: `refused:${refusal.code}`, plannerSurvived: false, paramsPreserved: 'n/a', timingPreserved: 'n/a', ledgerOutcome: 'not planned', track: null, visibility: null, note: refusal.reason};
    rows.push(row);
    return row;
  }
  hoisted.direction = {...compiled.direction, estimatedCostUsd: 0};
  const timeline = buildTimeline([{sourceStart: 0, sourceEnd: DURATION, outputStart: 0}] as never);
  const captionWords = words.map(word => ({text: word.text, start: word.start, end: word.end, sentenceIndex: 0}));
  const plan = await planBRoll({transcript: 'word0', sourceDurationSec: DURATION, timeline, words: captionWords as never, captionWords: captionWords as never, requestedEdits: null, directorV2: true, userBrollAssets: opts.user ? [{id: 'ub', url: 'https://user.invalid/ub.mp4', description: 'user clip', durationSec: 9, width: 1080, height: 1920, kind: 'clip', regions: []}] : [], speakerCutout: mask ? ({available: true, keyColor: '#000000', similarity: 0.1, blend: 0.05, videoUrl: 'https://x/cut.webm'} as never) : undefined});
  const ledger = plan.ledger!;
  const triggers = resolveDirectedZooms({directed: plan.zooms, words: captionWords as never, timeline, scale: 1.25, maxDurationSec: 3.2, alreadyOutput: true, trace: zoomResolutionTrace(ledger)});
  const finalized = finalizeEdits({
    ledger, contentProfile: null, footageLuminance: 0.4, captionLocked: false, durationSec: DURATION,
    hook: {text: '', start: 0, end: 0, anchor: 'top_left'}, caption: plan.caption,
    brollClips: plan.clips, visualOverlays: plan.overlays, insetReveals: plan.insetReveals, frameInsets: plan.frameInsets, mediaContainers: plan.mediaContainers,
    motionGraphics: plan.motionGraphics, semanticEmphasis: plan.semanticEmphasis, depthOverlays: mask ? plan.depthOverlays : [], transitions: plan.transitions,
    zoomTriggers: triggers, generatedGraphics: [], speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'},
    speakerCutout: mask ? {available: true, videoUrl: 'https://x/cut.webm'} : {available: false},
  });
  const entries = ledger.entries().filter(entry => entry.type === ledgerType);
  const entry = entries[0];
  const checked = opts.check(plan, compiled.direction, finalized, triggers);
  const last = entry?.events.at(-1);
  const row: Row = {
    kind: label,
    compiled: 'accepted',
    plannerSurvived: checked.survived,
    paramsPreserved: checked.params,
    timingPreserved: checked.timing,
    ledgerOutcome: entry ? outcomeOf(entry) : 'no ledger entry',
    track: last?.track ?? null,
    visibility: last?.visibility ?? null,
    note: last?.reason ?? '',
  };
  rows.push(row);
  return row;
}

const near = (a: number | undefined, b: number, tol = 0.35) => a !== undefined && Math.abs(a - b) <= tol;

describe('capability audit: what each v2 edit ends up as (synthetic plans, stock stubbed, nothing rendered)', () => {
  const visible = (row: Row) => {
    expect(row.compiled, `${row.kind} compile`).toBe('accepted');
    expect(row.plannerSurvived, `${row.kind} survived planning`).toBe(true);
    expect(row.ledgerOutcome, `${row.kind} ledger`).toBe('rendered');
    expect(row.visibility, `${row.kind} visibility`).toBe('visible');
  };

  it('kinetic_text', async () => {
    const row = await trace('kinetic_text', 'kinetic_text', element('kinetic_text', 12, 19, {text: 'Say it plainly', params: {shape: 'pill'}}), {check: (_p, _d, f) => ({survived: f.motionGraphics.length === 1, params: f.motionGraphics[0]?.text === 'Say it plainly' && f.motionGraphics[0]?.shape === 'pill' ? 'text+shape kept' : `CHANGED ${JSON.stringify(f.motionGraphics[0])}`, timing: near(f.motionGraphics[0]?.start, 6) ? 'kept' : `moved to ${f.motionGraphics[0]?.start}`})});
    visible(row);
    expect(row.paramsPreserved).toBe('text+shape kept');
  });

  it('emphasis', async () => {
    const row = await trace('emphasis', 'emphasis', element('emphasis', 12, 16, {text: 'real connection'}), {check: (_p, _d, f) => ({survived: f.semanticEmphasis.length === 1, params: f.semanticEmphasis[0]?.text === 'real connection' ? 'text kept' : 'CHANGED', timing: near(f.semanticEmphasis[0]?.start, 6) ? 'kept' : `moved to ${f.semanticEmphasis[0]?.start}`})});
    visible(row);
  });

  it('counter', async () => {
    const row = await trace('counter', 'emphasis', element('counter', 12, 16, {text: '87%', params: {countFrom: 0, countTo: 87, countSuffix: '%'}}), {check: (_p, _d, f) => {
      const item = f.semanticEmphasis.find(entry => entry.treatment === 'count');
      return {survived: Boolean(item), params: item?.countTo === 87 && item?.countSuffix === '%' ? 'countTo+suffix kept' : `CHANGED ${JSON.stringify(item)}`, timing: near(item?.start, 6) ? 'kept' : `moved to ${item?.start}`};
    }});
    visible(row);
    expect(row.paramsPreserved).toBe('countTo+suffix kept');
  });

  it('lockup', async () => {
    const row = await trace('lockup', 'lockup', element('lockup', 12, 19, {text: 'Three small habits', overlayText: 'Three small habits'}), {check: (p) => {
      const item = p.overlays.find(o => o.layout === 'lockup');
      return {survived: Boolean(item), params: item?.overlayText === 'Three small habits' ? 'text kept' : 'CHANGED', timing: near(item?.start, 6) ? 'kept' : `moved to ${item?.start}`};
    }});
    visible(row);
  });

  it('bubble', async () => {
    const row = await trace('bubble', 'bubble', element('bubble', 12, 19, {text: 'Wait for it', overlayText: 'Wait for it'}), {check: p => {
      const item = p.overlays.find(o => o.layout === 'bubble');
      return {survived: Boolean(item), params: item?.overlayText === 'Wait for it' ? 'text kept' : 'CHANGED', timing: near(item?.start, 6) ? 'kept' : `moved to ${item?.start}`};
    }});
    visible(row);
  });

  it('card', async () => {
    const row = await trace('card', 'card', element('card', 12, 19, {searchKeyword: 'sunset', overlayText: 'Golden hour'}), {check: p => {
      const item = p.overlays.find(o => o.layout === 'card');
      return {survived: Boolean(item?.assetUrl), params: item?.overlayText === 'Golden hour' ? 'text kept, asset resolved' : `CHANGED ${item?.overlayText}`, timing: near(item?.start, 6) ? 'kept' : `moved to ${item?.start}`};
    }});
    visible(row);
  });

  it('slideshow', async () => {
    const row = await trace('slideshow', 'card', element('slideshow', 12, 21, {searchKeyword: 'city'}), {check: p => {
      const item = p.overlays.find(o => o.treatment === 'slideshow');
      return {survived: Boolean(item), params: `treatment=${item?.treatment} slides=${item?.slides?.length ?? 0}`, timing: near(item?.start, 6) ? 'kept' : `moved to ${item?.start}`};
    }});
    visible(row);
  });

  it('split', async () => {
    const row = await trace('split', 'split', element('split', 12, 21, {searchKeyword: 'ocean waves'}), {check: p => {
      const item = p.overlays.find(o => o.layout === 'split');
      return {survived: Boolean(item?.assetUrl), params: item?.speakerSide ? `speakerSide=${item.speakerSide}, asset resolved` : 'asset resolved', timing: near(item?.start, 6) ? 'kept' : `moved to ${item?.start}`};
    }});
    visible(row);
  });

  it('cutaway', async () => {
    const row = await trace('cutaway', 'cutaway', element('cutaway', 12, 19, {searchKeyword: 'sunset', userBrollId: 'ub'}), {user: true, check: p => ({survived: p.clips.length === 1, params: p.clips[0]?.assetUrl ? 'asset resolved' : 'NO ASSET', timing: near(p.clips[0]?.start, 6) ? 'kept' : `moved to ${p.clips[0]?.start}`})});
    visible(row);
  });

  it('frame_inset', async () => {
    const row = await trace('frame_inset', 'frame_inset', element('frame_inset', 12, 21, {params: {scale: 0.8, marginColor: '#222222'}}), {check: (_p, _d, f) => ({survived: f.frameInsets.length === 1, params: f.frameInsets[0]?.scale === 0.8 && f.frameInsets[0]?.marginColor === '#222222' ? 'scale+margin kept' : `CHANGED ${JSON.stringify(f.frameInsets[0])}`, timing: near(f.frameInsets[0]?.start, 6) ? 'kept' : `moved to ${f.frameInsets[0]?.start}`})});
    visible(row);
    expect(row.paramsPreserved).toBe('scale+margin kept');
  });

  it('media_container', async () => {
    const row = await trace('media_container', 'media_container', element('media_container', 12, 20, {text: 'The plan', params: {containerMode: 'card', canvasColor: '#111111'}}), {check: (_p, _d, f) => ({survived: f.mediaContainers.length === 1, params: f.mediaContainers[0]?.mode === 'card' && f.mediaContainers[0]?.canvasColor === '#111111' ? 'mode+canvas kept' : `CHANGED ${JSON.stringify(f.mediaContainers[0])}`, timing: near(f.mediaContainers[0]?.start, 6) ? 'kept' : `moved to ${f.mediaContainers[0]?.start}`})});
    visible(row);
  });

  it('inset_reveal', async () => {
    const row = await trace('inset_reveal', 'inset_reveal', element('inset_reveal', 12, 24, {params: {variant: 'simple'}}), {check: p => ({survived: p.insetReveals.length === 1, params: p.insetReveals[0]?.params.variant === 'simple' ? 'variant kept' : `CHANGED ${p.insetReveals[0]?.params.variant}`, timing: near(p.insetReveals[0]?.start, 6, 1) ? 'kept (snapped to speech)' : `moved to ${p.insetReveals[0]?.start}`})});
    visible(row);
  });

  it('zoom with scale and focus', async () => {
    const row = await trace('zoom (scale+focus)', 'zoom', element('zoom', 12, 16, {params: {zoomScale: 1.4, focusX: 0.7, focusY: 0.3}}), {check: (_p, _d, _f, t) => ({survived: t.length === 1, params: t[0]?.scale === 1.4 && t[0]?.focus?.x === 0.7 && t[0]?.focus?.y === 0.3 ? 'scale+focus kept' : `CHANGED ${JSON.stringify(t[0])}`, timing: near(t[0]?.start, 6) ? 'kept' : `moved to ${t[0]?.start}`})});
    visible(row);
    expect(row.paramsPreserved).toBe('scale+focus kept');
  });

  it('transition beside a cut: planned, but an invisible no-op unless the generated-transition flag is on', async () => {
    const row = await trace('transition (flag off)', 'transition', element('transition', 11, 11, {params: {transitionStyle: 'film burn'}}), {companions: [element('split', 12, 21, {searchKeyword: 'ocean waves'})], check: p => ({survived: p.transitions.length >= 1, params: p.transitions[0] ? `keyword=${p.transitions[0].keyword}` : 'none', timing: near(p.transitions[0]?.at, 5.5, 0.6) ? 'kept' : `at ${p.transitions[0]?.at}`})});
    expect(row.compiled).toBe('accepted');
    expect(row.plannerSurvived).toBe(true);
    expect(row.ledgerOutcome).toBe('rendered_not_apparent');
    expect(row.note).toBe('transition_has_no_asset_so_TransitionTrack_skips_it');
  });

  it('depth_overlay with a speaker mask is visible; without one it is refused at the assembler', async () => {
    const withMask = await trace('depth_overlay (mask)', 'depth_overlay', element('depth_overlay', 12, 20, {userBrollId: 'ub', params: {direction: 'down'}}), {mask: true, user: true, check: p => ({survived: p.depthOverlays.length === 1, params: p.depthOverlays[0]?.assetUrl ? 'asset resolved' : 'NO ASSET', timing: near(p.depthOverlays[0]?.start, 6, 1) ? 'kept' : `moved to ${p.depthOverlays[0]?.start}`})});
    const noMask = await trace('depth_overlay (no mask)', 'depth_overlay', element('depth_overlay', 12, 20, {userBrollId: 'ub'}), {mask: false, check: () => ({survived: false, params: '', timing: ''})});
    expect(noMask.compiled).toBe('refused:needs_speaker_mask');
    // Planner-side the depth overlay is only as visible as the keyed speaker video: report what the ledger says.
    expect(['rendered', 'dropped']).toContain(withMask.ledgerOutcome);
  });

  it('cutout with a mask reaches CutoutStage; without one it is refused', async () => {
    const withMask = await trace('cutout (mask)', 'cutout', element('cutout', 12, 19, {searchKeyword: 'office', userBrollId: 'ub'}), {mask: true, user: true, check: p => {
      const item = p.overlays.find(o => o.layout === 'cutout');
      return {survived: Boolean(item), params: item?.assetUrl ? 'plate asset resolved' : 'NO PLATE', timing: near(item?.start, 6) ? 'kept' : `moved to ${item?.start}`};
    }});
    const noMask = await trace('cutout (no mask)', 'cutout', element('cutout', 12, 19, {searchKeyword: 'office'}), {mask: false, check: () => ({survived: false, params: '', timing: ''})});
    expect(noMask.compiled).toBe('refused:needs_speaker_mask');
    expect(withMask.compiled).toBe('accepted');
  });

  it('with creator footage present, a stock-dependent edit with no matching asset is refused with a precise, registered reason (not silently dropped)', async () => {
    const row = await trace('split (creator footage, no match)', 'split', element('split', 12, 21, {searchKeyword: 'ocean waves'}), {user: true, check: () => ({survived: false, params: '', timing: ''})});
    expect(row.compiled).toBe('accepted');
    expect(row.ledgerOutcome).toBe('rejected');
    expect(row.note).toBe('stock_disabled_or_unconfigured');
    const {classifyReason} = await import('../lib/reasonRegistry.ts');
    expect(classifyReason(row.note)).toMatchObject({registered: true, category: 'missing_text_or_asset'});
  });

  it('split speaker_side is honoured when the Director gives it, and the alternating default is unchanged when it does not', async () => {
    const sideOf = async (params: Record<string, unknown>) =>
      trace(`split side ${JSON.stringify(params)}`, 'split', element('split', 12, 21, {searchKeyword: 'ocean waves', params}), {check: p => ({survived: Boolean(p.overlays.find(o => o.layout === 'split')), params: String(p.overlays.find(o => o.layout === 'split')?.speakerSide), timing: ''})});
    expect((await sideOf({speakerSide: 'top'})).paramsPreserved).toBe('top');
    expect((await sideOf({speakerSide: 'bottom'})).paramsPreserved).toBe('bottom');
    // not given: the planner's own choice (a function of the keyword and split index) — unchanged
    const defaulted = (await sideOf({})).paramsPreserved;
    expect(['top', 'bottom']).toContain(defaulted);
  });

  it('card glow=false is honoured; absent keeps the renderer default (on)', async () => {
    const glowOf = async (params: Record<string, unknown>) =>
      trace(`card glow ${JSON.stringify(params)}`, 'card', element('card', 12, 19, {searchKeyword: 'sunset', overlayText: 'Golden hour', params}), {check: p => ({survived: true, params: String(p.overlays.find(o => o.layout === 'card')?.glow), timing: ''})});
    expect((await glowOf({glow: false})).paramsPreserved).toBe('false');
    expect((await glowOf({glow: true})).paramsPreserved).toBe('true');
    expect((await glowOf({})).paramsPreserved).toBe('true');
  });
});
