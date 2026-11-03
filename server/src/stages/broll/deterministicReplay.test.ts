/**
 * Deterministic REPLAY of synthetic Director-v2 plans (no model, stock stubbed, nothing rendered):
 *   CreativePlan → compileCreativePlan (assembler legality + compiler) → planBRoll → blueprint-schema parse.
 *
 * What this is NOT: it does not assemble a full blueprint (analyzeVideo) and does not render. Pixels are covered
 * separately by the hand-built blueprint stills in remotion/out/phase10b-validation and phase11-validation.
 */
import {describe, expect, it, vi} from 'vitest';

import {compileCreativePlan} from '../directorV2/compiler.ts';
import type {CreativeElement, CreativePlan, PerceptionPack} from '../directorV2/types.ts';
import {buildTimeline} from '../filters/timeline.ts';
import {
  frameInsetSchema,
  mediaContainerSchema,
  motionGraphicSchema,
  semanticEmphasisSchema,
  transitionClipSchema,
  visualOverlaySchema,
  zoomTriggerSchema,
} from '../../../../remotion/src/blueprintSchema.ts';
import type {VisualDirection} from './geminiDirector.ts';

const hoisted = vi.hoisted(() => ({direction: null as unknown}));

vi.mock('./geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./geminiDirector.ts')>();
  return {...actual, directorConfigured: () => true, planVisualDirection: async () => hoisted.direction as VisualDirection};
});

let nextId = 1;
vi.mock('./stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./stockSearch.ts')>();
  const asset = () => ({assetUrl: `https://stock.invalid/${nextId}.mp4`, provider: 'pexels' as const, providerId: nextId++, width: 1080, height: 1920, durationSec: 12, credit: 'x', creditUrl: ''});
  return {...actual, stockConfigured: () => true, findBRollAsset: async () => asset(), findPhotoAsset: async () => asset(), listBRollAssets: async () => [asset(), asset(), asset()]};
});

const {planBRoll} = await import('./brollPlanner.ts');

const DURATION = 30;
const words = Array.from({length: 60}, (_, i) => ({id: `w${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.45, sentenceId: 's0'}));
const pack = {
  words,
  sentences: [],
  userAssets: [],
  occupancySlices: [],
  outputDurationSec: DURATION,
  speakerCutoutAvailable: false,
  requestedEdits: [],
} as unknown as PerceptionPack;

const element = (kind: string, from: number, to: number, extra: Record<string, unknown> = {}): CreativeElement =>
  ({id: `e_${kind}`, beatId: 'b', intent: `serve the story with a ${kind}`, kind, wordRange: {startWordId: `w${from}`, endWordId: `w${to}`}, params: {}, ...extra}) as unknown as CreativeElement;

const planFor = (elements: CreativeElement[]): CreativePlan =>
  ({
    editThesis: 't',
    editThesisParts: {} as never,
    hookTitle: '',
    hookStyle: 'bold' as never,
    caption: undefined as never,
    preferredLutId: '',
    suggestedLutIds: [],
    elements,
    estimatedCostUsd: 0,
    promptVersion: 'test',
    inputHash: 'test',
    raw: {},
  }) as unknown as CreativePlan;

type Case = {
  kind: string;
  el: CreativeElement;
  /** Other elements the case needs next to it (a transition only survives beside a cut). */
  companions?: CreativeElement[];
  /** Reads the planner output for this kind and returns the objects the renderer will receive. */
  out: (result: Awaited<ReturnType<typeof planBRoll>>) => unknown[];
  parse: (value: unknown) => unknown;
};

const cases: Case[] = [
  {kind: 'kinetic_text', el: element('kinetic_text', 10, 17, {text: 'Say it plainly', params: {shape: 'pill'}}), out: r => r.motionGraphics, parse: v => motionGraphicSchema.parse(v)},
  {kind: 'emphasis', el: element('emphasis', 10, 15, {text: 'real connection'}), out: r => r.semanticEmphasis, parse: v => semanticEmphasisSchema.parse(v)},
  {kind: 'counter', el: element('counter', 10, 15, {text: '87%', params: {countFrom: 0, countTo: 87, countSuffix: '%'}}), out: r => r.semanticEmphasis.filter(item => item.treatment === 'count'), parse: v => semanticEmphasisSchema.parse(v)},
  {kind: 'lockup', el: element('lockup', 10, 17, {text: 'Three small habits', overlayText: 'Three small habits'}), out: r => r.overlays.filter(o => o.layout === 'lockup'), parse: v => visualOverlaySchema.parse(v)},
  {kind: 'bubble', el: element('bubble', 10, 17, {text: 'Wait for it', overlayText: 'Wait for it'}), out: r => r.overlays.filter(o => o.layout === 'bubble'), parse: v => visualOverlaySchema.parse(v)},
  {kind: 'card', el: element('card', 10, 17, {searchKeyword: 'sunset', overlayText: 'Golden hour'}), out: r => r.overlays.filter(o => o.layout === 'card'), parse: v => visualOverlaySchema.parse(v)},
  {kind: 'slideshow', el: element('slideshow', 10, 19, {searchKeyword: 'city', overlayText: ''}), out: r => r.overlays.filter(o => o.treatment === 'slideshow'), parse: v => visualOverlaySchema.parse(v)},
  {kind: 'split', el: element('split', 10, 19, {searchKeyword: 'ocean waves', overlayText: ''}), out: r => r.overlays.filter(o => o.layout === 'split'), parse: v => visualOverlaySchema.parse(v)},
  {kind: 'frame_inset', el: element('frame_inset', 10, 19, {params: {scale: 0.8, marginColor: '#222222'}}), out: r => r.frameInsets, parse: v => frameInsetSchema.parse(v)},
  {kind: 'media_container', el: element('media_container', 10, 18, {text: 'The plan', params: {containerMode: 'card', canvasColor: '#111111'}}), out: r => r.mediaContainers, parse: v => mediaContainerSchema.parse(v)},
  {kind: 'zoom (scale + focus)', el: element('zoom', 10, 13, {params: {zoomScale: 1.4, focusX: 0.7, focusY: 0.3}}), out: r => r.zooms, parse: v => {
    const zoom = v as {timestamp: number; durationSec: number; scale?: number; focus?: {x: number; y: number}};
    // Zooms become triggers in analyzeVideo (resolveDirectedZooms); check that step's schema with the same fields.
    return zoomTriggerSchema.parse({start: zoom.timestamp, end: zoom.timestamp + zoom.durationSec, scale: zoom.scale ?? 1.25, focus: zoom.focus, sentenceIndex: 0});
  }},
  // One word (4.5–4.95 s) ending just before the split at 5.0 s: the gate keeps transitions within 0.6 s of a cut,
  // and the v2 assembler refuses a transition that overlaps the cut itself.
  {kind: 'transition', el: element('transition', 9, 9, {params: {transitionStyle: 'film burn'}}), companions: [element('split', 10, 19, {searchKeyword: 'ocean waves'})], out: r => r.transitions, parse: v => transitionClipSchema.parse(v)},
];

describe('Director-v2 plan replay: compile → assemble → plan → blueprint schema (stubbed stock, no render)', () => {
  it.each(cases)('$kind survives to the renderer input with valid properties', async ({kind, el, companions = [], out, parse}) => {
    const compiled = await compileCreativePlan({pack, plan: planFor([el, ...companions]), noRepair: true});
    // 4. The assembler retained it (nothing refused, nothing replaced).
    expect(compiled.report.violations, `${kind} refusals`).toEqual([]);
    expect(compiled.assembler.scheduled.map(item => item.kind).sort()).toEqual([el.kind, ...companions.map(c => c.kind)].sort());

    // 2/3. Planning keeps it, with the Director's time (v2 times are output time).
    hoisted.direction = {...compiled.direction, estimatedCostUsd: 0};
    const timeline = buildTimeline([{sourceStart: 0, sourceEnd: DURATION, outputStart: 0}] as never);
    const captionWords = words.map(word => ({text: word.text, start: word.start, end: word.end, sentenceIndex: 0}));
    const result = await planBRoll({transcript: 'word0', sourceDurationSec: DURATION, timeline, words: captionWords as never, captionWords: captionWords as never, requestedEdits: null, directorV2: true});
    const produced = out(result);
    expect(produced.length, `${kind} reached the plan`).toBeGreaterThan(0);

    // 5. The renderer's schema accepts what the planner produced.
    for (const item of produced) {
      expect(() => parse(item), `${kind} blueprint schema`).not.toThrow();
    }

    // 6. Every edit has a ledger disposition (nothing silently lost).
    const entries = result.ledger!.entries().filter(entry => !['hook_title'].includes(entry.type));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.events.at(-1)!.decision, `${kind} ${entry.id}`).not.toBe('proposed');
    }
  });

  it('drops a Director transition that has no cut beside it, with the gate\'s reason (not silently)', async () => {
    const compiled = await compileCreativePlan({pack, plan: planFor([element('transition', 9, 9)]), noRepair: true});
    hoisted.direction = {...compiled.direction, estimatedCostUsd: 0};
    const timeline = buildTimeline([{sourceStart: 0, sourceEnd: DURATION, outputStart: 0}] as never);
    const captionWords = words.map(word => ({text: word.text, start: word.start, end: word.end, sentenceIndex: 0}));
    const result = await planBRoll({transcript: 'word0', sourceDurationSec: DURATION, timeline, words: captionWords as never, captionWords: captionWords as never, requestedEdits: null, directorV2: true});
    expect(result.transitions).toEqual([]);
    const entry = result.ledger!.entries().find(item => item.type === 'transition')!;
    expect(entry.events.at(-1)).toMatchObject({decision: 'dropped', stage: 'editorial_gate', reason: 'transition_not_near_a_visual'});
  });

  it('keeps the zoom scale and focus on the way to the trigger', async () => {
    const compiled = await compileCreativePlan({pack, plan: planFor([element('zoom', 10, 13, {params: {zoomScale: 1.4, focusX: 0.7, focusY: 0.3}})]), noRepair: true});
    expect(compiled.direction.zooms).toEqual([{timestamp: 5, durationSec: expect.any(Number), scale: 1.4, focus: {x: 0.7, y: 0.3}}]);
  });

  it('refuses a text kind with no text, at the assembler, with the reason (never compiles to nothing)', async () => {
    const compiled = await compileCreativePlan({pack, plan: planFor([element('kinetic_text', 10, 17, {text: ''})]), noRepair: true});
    expect(compiled.direction.motionGraphics).toEqual([]);
    expect(compiled.report.violations[0]).toMatchObject({code: 'text_missing'});
  });

  it('refuses a cutout with no speaker mask, at the assembler, with the reason', async () => {
    const compiled = await compileCreativePlan({pack, plan: planFor([element('cutout', 10, 17, {searchKeyword: 'x'})]), noRepair: true});
    expect(compiled.direction.moments).toEqual([]);
    expect(compiled.report.violations[0]).toMatchObject({code: 'needs_speaker_mask'});
  });
});
