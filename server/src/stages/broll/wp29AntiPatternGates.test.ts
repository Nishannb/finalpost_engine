/**
 * WP29: hard craft gates. Offline: no render, no network, no model. Pins the four anti-patterns WP28 shipped:
 *   1. solid / near-solid stills scheduled as full-frame `brollClips`
 *   2. literal KLIPY hearts for abstract verbs ("we loved it")
 *   3. ProcessSteps (numbered stepper) on the polish hero path
 *   4. labeled / user stills going to full-bleed broll instead of ImageRun / media cards
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {buildTimeline} from '../filters/timeline.ts';
import {isStepperContent, POLISH_DEMOTED_COMPOSITIONS, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {buildGeneratedGraphics} from '../motionDirector/buildGeneratedGraphics.ts';
import {plateShapeAt, POLISH_DEMOTED_SEEDS, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import fixture from './__fixtures__/morning-habits-planner.json' with {type: 'json'};
import type {VisualDirection} from './geminiDirector.ts';
import {isLiteralEmojiQuery, KLIPY_MAX_BEATS, contextualKlipyQuery, proposeKlipyBeats} from './klipyContextQuery.ts';
import type {LabeledAssetBrief, LabeledAssetSlot} from './labeledAssetBrief.ts';
import {labeledAssetWarnings, planLabeledAssetPlacements, type ResolvedLabeledAsset} from './labeledAssetPlacement.ts';
import {analyzeRgbSamples, fullFrameStillPolicy, isSolidFixtureUrl, isSolidStill, stripFullFrameStillClips} from './solidStill.ts';

const hoisted = vi.hoisted(() => ({lookups: 0}));

vi.mock('./geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./geminiDirector.ts')>();
  const data = (await import('./__fixtures__/morning-habits-planner.json', {with: {type: 'json'}})).default;
  return {
    ...actual,
    directorConfigured: () => true,
    planVisualDirection: async () => ({...actual.parseVisualDirectorJson(data.directorRaw, data.sourceDurationSec, data.transcript), estimatedCostUsd: 0, source: 'gemini'}) as unknown as VisualDirection,
  };
});
vi.mock('./stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./stockSearch.ts')>();
  return {
    ...actual,
    stockConfigured: () => false,
    findBRollAsset: async () => { hoisted.lookups += 1; return null; },
    findPhotoAsset: async () => { hoisted.lookups += 1; return null; },
    listBRollAssets: async () => { hoisted.lookups += 1; return []; },
  };
});

const {planBRoll} = await import('./brollPlanner.ts');
const timeline = buildTimeline(fixture.keepSegments as never);
const e = env as unknown as Record<string, unknown>;
const originalSched = e.CUTAWAY_SCHEDULING;

// A flat color RGB sample grid / a varied one (what `sampleStillGrid` returns).
const flat = (r: number, g: number, b: number, n = 256) => Uint8Array.from({length: n * 3}, (_, i) => [r, g, b][i % 3]!);
const varied = (n = 256) => Uint8Array.from({length: n * 3}, (_, i) => (i * 37 + Math.floor(i / 3) * 11) % 256);
const noisyFlat = (n = 256) => Uint8Array.from({length: n * 3}, (_, i) => 20 + (i % 5)); // JPEG-ish noise on a flat field

describe('WP29 1) solid-still detection', () => {
  it('flat green / blue / orange fills are solid; a varied image is not; mild noise on a flat field is still solid', () => {
    for (const rgb of [[0, 180, 60], [20, 60, 220], [255, 140, 0]] as const) expect(analyzeRgbSamples(flat(...rgb)).solid).toBe(true);
    expect(analyzeRgbSamples(noisyFlat()).solid).toBe(true);
    expect(analyzeRgbSamples(varied()).solid).toBe(false);
    expect(analyzeRgbSamples(new Uint8Array(0))).toMatchObject({solid: false, reason: 'no_samples'});
  });
  it('a tiny mark on a flat field is near-solid', () => {
    const pixels = flat(10, 90, 200);
    for (let i = 0; i < 4; i += 1) pixels[i * 3] = 255; // 4 of 256 samples differ
    expect(analyzeRgbSamples(pixels)).toMatchObject({solid: true});
  });
  it('the WP28 fixture bucket URLs and explicit flat-fill names are flagged; a creator upload name is not', () => {
    expect(isSolidFixtureUrl('https://media.kinmel.shop/wp28/labeled-1793198224147-1.png')).toBe(true);
    expect(isSolidFixtureUrl('https://cdn.example.com/solid-green.png')).toBe(true);
    expect(isSolidFixtureUrl('https://cdn.example.com/uploads/IMG_4021.jpg')).toBe(false);
    expect(isSolidFixtureUrl('https://cdn.example.com/shopify-logo.png')).toBe(false);
  });
  it('pixel evidence beats the URL heuristic; videos are never solid stills', () => {
    expect(isSolidStill({url: 'https://media.kinmel.shop/wp28/labeled-1-1.png', kind: 'photo', solidLike: false})).toBe(false);
    expect(isSolidStill({url: 'https://cdn.example.com/a.png', kind: 'photo', solidLike: true})).toBe(true);
    expect(isSolidStill({url: 'https://cdn.example.com/a.mp4', kind: 'clip', solidLike: true})).toBe(false);
  });
  it('policy: solid still -> refuse, real still -> media card, video -> clip', () => {
    expect(fullFrameStillPolicy({url: 'a.png', kind: 'photo', solidLike: true})).toBe('refuse_solid');
    expect(fullFrameStillPolicy({url: 'a.jpg', kind: 'photo', solidLike: false})).toBe('media_card');
    expect(fullFrameStillPolicy({url: 'a.jpg', kind: 'document'})).toBe('media_card');
    expect(fullFrameStillPolicy({url: 'a.mp4', kind: 'clip'})).toBe('clip_ok');
  });
});

describe('WP29 2) a solid still is never scheduled as a brollClip (the real planBRoll)', () => {
  beforeEach(() => {
    hoisted.lookups = 0;
    e.CUTAWAY_SCHEDULING = 'beat_preserving';
  });
  afterEach(() => {
    e.CUTAWAY_SCHEDULING = originalSched;
  });
  // The Director's three tagged cutaway moments (ub_1..ub_3) now point at STILLS instead of the fixture clips.
  const stills = (solid: boolean) =>
    fixture.userAssets.map(item => ({...item, url: `https://cdn.example.com/${solid ? 'wp28-solid' : 'photo'}-${item.id}.png`, kind: 'photo', durationSec: 0, ...(solid ? {solidLike: true} : {})}));
  const plan = (userBrollAssets: unknown[]) =>
    planBRoll({
      transcript: fixture.transcript,
      sourceDurationSec: fixture.sourceDurationSec,
      timeline,
      words: fixture.words as never,
      captionWords: fixture.captionWords as never,
      userBrollAssets: userBrollAssets as never,
      requestedEdits: ['cutaway', 'hook_title', 'zoom'],
    });

  it('solid fixture stills: no brollClips entry, no overlay of those URLs, refusal is recorded as a warning', async () => {
    const assets = stills(true);
    const result = await plan(assets);
    const urls = new Set(assets.map(asset => asset.url));
    expect(result.clips.filter(clip => urls.has(clip.assetUrl))).toEqual([]);
    expect(result.overlays.filter(overlay => urls.has(overlay.assetUrl))).toEqual([]);
    expect(result.warnings.some(warning => warning.includes('placement_solid_still_refused'))).toBe(true);
  });
  it('a solid still is refused even when only the URL says so (pixels unavailable)', async () => {
    const assets = stills(false).map(asset => ({...asset, url: `https://media.kinmel.shop/wp28/labeled-17931982-${asset.id}.png`}));
    const result = await plan(assets);
    const urls = new Set(assets.map(asset => asset.url));
    expect(result.clips.filter(clip => urls.has(clip.assetUrl))).toEqual([]);
  });
  it('a REAL still tagged as a cutaway becomes a framed media card, never a full-bleed brollClip', async () => {
    const assets = stills(false);
    const result = await plan(assets);
    const urls = new Set(assets.map(asset => asset.url));
    expect(result.clips.filter(clip => urls.has(clip.assetUrl))).toEqual([]);
    const cards = result.overlays.filter(overlay => urls.has(overlay.assetUrl));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.layout).toBe('card');
      expect(card.mediaKind).toBe('image');
    }
  });
  it('videos still become cutaway clips (the gate only targets stills)', async () => {
    const result = await plan(fixture.userAssets);
    expect(result.clips.length).toBeGreaterThan(0);
  });
});

describe('WP29 2b) backstop on the clip list', () => {
  const clip = (assetUrl: string, provider = 'user') => ({assetUrl, start: 1, end: 3, provider});
  it('drops solid and still user clips, keeps videos and stock', () => {
    const solid = 'https://cdn.example.com/a.png';
    const out = stripFullFrameStillClips([clip(solid), clip('https://cdn.example.com/b.jpg'), clip('https://cdn.example.com/c.mp4'), clip('https://images.pexels.com/x.jpg', 'pexels'), clip('https://media.kinmel.shop/wp28/labeled-1-1.png')], new Set([solid]));
    expect(out.clips.map(item => item.assetUrl)).toEqual(['https://cdn.example.com/c.mp4', 'https://images.pexels.com/x.jpg']);
    expect(out.dropped.map(item => item.reason)).toEqual(['solid_still', 'still_clip', 'solid_still']);
  });
});

describe('WP29 3) labeled stills go through ImageRun / cards / pips, never full-bleed broll', () => {
  const slot = (id: string, kind: LabeledAssetSlot['kind'], startSec: number, endSec: number, extra: Partial<LabeledAssetSlot> = {}): LabeledAssetSlot => ({
    id, label: `${kind} ${id}`, kind, reason: '', startSec, endSec, accept: ['image'], spokenHint: '', status: 'needed', ...extra,
  });
  const brief = (slots: LabeledAssetSlot[]): LabeledAssetBrief => ({version: 1, outputDurationSec: 40, slots});
  const assets = new Map<string, ResolvedLabeledAsset>([
    ['ub_1', {url: 'https://cdn.example.com/a.jpg', mediaKind: 'image'}],
    ['ub_2', {url: 'https://cdn.example.com/b.jpg', mediaKind: 'image'}],
    ['ub_3', {url: 'https://cdn.example.com/c.jpg', mediaKind: 'image', solidLike: true}],
    ['ub_4', {url: 'https://cdn.example.com/d.png', mediaKind: 'image', solidLike: true}],
  ]);
  const plan = (slots: LabeledAssetSlot[]) => planLabeledAssetPlacements({brief: brief(slots), assets, outputDurationSec: 40});

  it('nearby real stills form an ImageRun (runs) and no overlay is a cutaway / split / composite cover', () => {
    const out = plan([slot('a', 'person', 5, 7, {status: 'uploaded', userAssetId: 'ub_1'}), slot('b', 'screenshot', 8, 10, {status: 'uploaded', userAssetId: 'ub_2'})]);
    expect(out.runs).toHaveLength(1);
    for (const overlay of out.overlays) expect(['cutaway', 'split', 'composite']).not.toContain(overlay.layout);
  });
  it('a solid still bound to a non-logo slot places nothing and is counted + warned', () => {
    const out = plan([slot('c', 'person', 5, 8, {status: 'uploaded', userAssetId: 'ub_3'}), slot('d', 'screenshot', 15, 18, {status: 'uploaded', userAssetId: 'ub_4'})]);
    expect(out.overlays).toEqual([]);
    expect(out.runs).toEqual([]);
    expect(out.solidRefused).toBe(2);
    expect(labeledAssetWarnings(out)).toContain('polish_assets:solid_refused:2');
  });
  it('a solid logo may only be a small pip (never a cover layout)', () => {
    const out = plan([slot('c', 'logo', 5, 8, {status: 'uploaded', userAssetId: 'ub_3'})]);
    expect(out.overlays).toHaveLength(1);
    expect(out.overlays[0]!.layout).toBe('pip');
  });
});

describe('WP29 4) KLIPY gate: abstract verbs never become a literal emoji', () => {
  it('"we love" / "loved" never produce a heart / love query', () => {
    for (const spoken of ['we love it so much', 'everybody loved the launch event', 'we love', 'I loved that product honestly', 'my heart loves this', 'they really love working here']) {
      const hit = contextualKlipyQuery(spoken);
      if (hit) expect(isLiteralEmojiQuery(hit.query), `${spoken} -> ${hit.query}`).toBe(false);
      if (hit) expect(hit.query).not.toMatch(/heart|love|kiss|hug|emoji/i);
    }
    expect(contextualKlipyQuery('we loved it')).toBeNull();
    expect(contextualKlipyQuery('everybody loved the launch event')).toBeNull(); // an affect span is a miss, not a sticker built from the leftovers
  });
  it('"love" is no longer a reaction cue for anything', () => {
    expect(contextualKlipyQuery('honestly we really love this feature')?.reason).not.toBe('reaction:mind blown');
  });
  it('a lone leftover token is NOT searched as "<token> reaction"', () => {
    expect(contextualKlipyQuery('quarterly it is')).toBeNull();
  });
  it('literal-emoji detector', () => {
    for (const query of ['red heart', 'love', 'hearts', 'kiss', 'thumbs up', 'loved product']) expect(isLiteralEmojiQuery(query), query).toBe(true);
    for (const query of ['money raining', 'rocket launch', 'thinking face']) expect(isLiteralEmojiQuery(query), query).toBe(false);
  });
  it('proposeKlipyBeats never proposes a heart for a speech full of love', () => {
    const text = 'we loved it and honestly everybody loved the product and we love our customers'.split(' ');
    const words = text.map((word, i) => ({text: word, start: 12 + i * 0.3, end: 12 + i * 0.3 + 0.27}));
    const beats = proposeKlipyBeats({words, outputDurationSec: 30});
    for (const beat of beats) expect(isLiteralEmojiQuery(beat.query), beat.query).toBe(false);
  });
  it('existing explicit reactions still work and the density is capped', () => {
    expect(contextualKlipyQuery('everything is completely free for you today')?.query).toBe('free celebration');
    const words = Array.from({length: 60}, (_, i) => ({text: ['totally', 'free', 'money', 'today', 'winning', 'growth'][i % 6]!, start: i * 1.2, end: i * 1.2 + 0.4}));
    expect(proposeKlipyBeats({words, outputDurationSec: 72, maxBeats: 12}).length).toBeLessThanOrEqual(KLIPY_MAX_BEATS);
    expect(KLIPY_MAX_BEATS).toBeLessThanOrEqual(3);
  });
});

describe('WP29 5) ProcessSteps is off the polish hero path', () => {
  const lines = ['First write the plan down.', 'Second ship the work.', 'Finally review the results together.', 'Then repeat the whole loop every single week without fail.'];
  const words = lines.flatMap((line, index) => line.split(' ').map((text, i) => ({text, start: 3 + index * 3.5 + i * 0.4, end: 3 + index * 3.5 + i * 0.4 + 0.35})));
  const DURATION = 24;

  it('the demoted sets name ProcessSteps', () => {
    expect(POLISH_DEMOTED_COMPOSITIONS.has('ProcessSteps')).toBe(true);
    expect(POLISH_DEMOTED_SEEDS.has('ProcessSteps')).toBe(true);
  });
  it('the polish (explainPlates) seeder never seeds a ProcessSteps plate for ordered cues', () => {
    const seed = seedLibraryGraphics({words, outputDurationSec: DURATION, explainPlates: true});
    expect(Object.values(seed.compositions)).not.toContain('ProcessSteps');
  });
  it('plateShapeAt (the polish Claude gap-brief shape) never answers ProcessSteps', () => {
    for (const at of [3.2, 6.7, 10.2]) expect(plateShapeAt(words, at)?.composition).not.toBe('ProcessSteps');
  });
  it('the registry still resolves steps for the non-polish path, but not for a polish brief', () => {
    const base = {goal: 'steps', visualDescription: 'a process', placement: 'full_screen', content: {steps: ['Plan', 'Shoot', 'Cut']}};
    expect(resolveLibraryGraphic(base)?.compositionId).toBe('ProcessSteps');
    expect(resolveLibraryGraphic({...base, polish: true})?.compositionId).not.toBe('ProcessSteps');
    expect(isStepperContent({steps: ['Plan', 'Shoot', 'Cut']})).toBe(true);
    expect(isStepperContent({stages: ['Plan', 'Shoot']})).toBe(true); // alias normalised
    expect(isStepperContent({quote: 'x'})).toBe(false);
  });
  it('a polish (preferLibrary) steps brief is refused before any library publish or Claude call', async () => {
    const brief = {
      id: 'g1', goal: 'steps', visualDescription: 'a process', placement: 'full_screen', content: {steps: ['Plan', 'Shoot', 'Cut']},
    } as never;
    const out = await buildGeneratedGraphics([{brief, start: 2, end: 5, reason: 'x'}], {preferLibrary: true});
    expect(out.generatedGraphics).toEqual([]);
    expect(out.failures[0]?.reason).toMatch(/polish:process_steps_refused:g1/);
    expect(out.claudeCostUsd).toBe(0);
  });
});
