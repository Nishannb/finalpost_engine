/**
 * WP18: place the creator's bound labeled assets + the ImageRun composition. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {LEAVE_THE_FACE_COMPOSITIONS} from './engagementCadence.ts';
import {applyLabeledAssetBindings, type LabeledAssetBrief, type LabeledAssetSlot} from './labeledAssetBrief.ts';
import {labeledAssetWarnings, mediaKindOfUrl, planLabeledAssetPlacements, type ResolvedLabeledAsset} from './labeledAssetPlacement.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const comp = strip(read('../../../../remotion/src/motion/compositions/ImageRun.tsx'));
const motionIndex = read('../../../../remotion/src/motion/index.ts');
const analyze = strip(read('../../pipeline/analyzeVideo.ts'));

const slot = (id: string, kind: LabeledAssetSlot['kind'], startSec: number, endSec: number, extra: Partial<LabeledAssetSlot> = {}): LabeledAssetSlot => ({
  id, label: `${kind} ${id}`, kind, reason: '', startSec, endSec, accept: ['image'], spokenHint: '', status: 'needed', ...extra,
});
const brief = (slots: LabeledAssetSlot[]): LabeledAssetBrief => ({version: 1, outputDurationSec: 40, slots});
const assets = new Map<string, ResolvedLabeledAsset>([
  ['ub_1', {url: 'https://cdn.example.com/logo.png', mediaKind: 'image'}],
  ['ub_2', {url: 'https://cdn.example.com/person.jpg', mediaKind: 'image'}],
  ['ub_3', {url: 'https://cdn.example.com/shot.png', mediaKind: 'image'}],
  ['ub_4', {url: 'https://cdn.example.com/clip.mp4', mediaKind: 'video'}],
  ['ub_5', {url: 'https://cdn.example.com/logo2.png', mediaKind: 'image'}],
]);
const plan = (slots: LabeledAssetSlot[], blockedRanges: Array<{start: number; end: number}> = []) => planLabeledAssetPlacements({brief: brief(slots), assets, outputDurationSec: 40, blockedRanges});

describe('WP18 1) placement of bound slots', () => {
  it('a bound logo + person far apart each place a user-provider overlay with the upload URL', () => {
    const out = plan([slot('a', 'logo', 5, 8, {status: 'uploaded', userAssetId: 'ub_1'}), slot('b', 'person', 20, 23, {status: 'uploaded', userAssetId: 'ub_2'})]);
    expect(out.overlays).toHaveLength(2);
    expect(out.placed).toBe(2);
    expect(out.runs).toHaveLength(0);
    for (const overlay of out.overlays) {
      expect(overlay.provider).toBe('user');
      expect(overlay.mediaKind).toBe('image');
      expect(overlay.userBrollId).toMatch(/^ub_/);
    }
    expect(out.overlays[0]!.assetUrl).toBe('https://cdn.example.com/logo.png');
    expect(out.overlays[0]!.layout).toBe('pip');
    expect(out.overlays[1]!.layout).toBe('card');
  });
  it('a logo never mutes captions (no overlay text)', () => {
    const out = plan([slot('a', 'logo', 5, 8, {status: 'uploaded', userAssetId: 'ub_1'})]);
    expect(out.overlays[0]!.overlayText).toBe('');
  });
  it('windows follow the slot and stay inside the clip', () => {
    const out = plan([slot('a', 'screenshot', 38, 45, {status: 'uploaded', userAssetId: 'ub_3'})]);
    expect(out.overlays[0]!.start).toBe(38);
    expect(out.overlays[0]!.end).toBeLessThanOrEqual(40);
  });
  it('a video broll_clip slot is a short cutaway', () => {
    const out = plan([slot('a', 'broll_clip', 8, 14, {status: 'uploaded', userAssetId: 'ub_4', accept: ['video']})]);
    expect(out.overlays[0]!.layout).toBe('cutaway');
    expect(out.overlays[0]!.mediaKind).toBe('video');
    expect(out.overlays[0]!.end - out.overlays[0]!.start).toBeLessThanOrEqual(4);
  });
  it('needed, skipped and unresolved slots place nothing', () => {
    const out = plan([
      slot('a', 'logo', 5, 8),
      slot('b', 'person', 12, 15, {status: 'skipped'}),
      slot('c', 'product', 20, 23, {status: 'uploaded', userAssetId: 'ub_99'}),
    ]);
    expect(out.overlays).toHaveLength(0);
    expect(out.placed).toBe(0);
    expect(out.unresolved).toBe(1);
    expect(labeledAssetWarnings(out)).toEqual(['polish_assets:unresolved:1']);
  });
  it('a slot on a full-screen beat is not placed', () => {
    const out = plan([slot('a', 'logo', 5, 8, {status: 'uploaded', userAssetId: 'ub_1'})], [{start: 4, end: 9}]);
    expect(out.overlays).toHaveLength(0);
    expect(out.blocked).toBe(1);
  });
  it('bindings from the HTTP route flow through applyLabeledAssetBindings into a placement', () => {
    const bound = applyLabeledAssetBindings(brief([slot('a', 'logo', 5, 8)]), [{slotId: 'a', status: 'uploaded', assetUrl: 'https://cdn.example.com/logo.png'}], new Map([['https://cdn.example.com/logo.png', 'ub_1']]));
    const out = planLabeledAssetPlacements({brief: bound, assets, outputDurationSec: 40});
    expect(out.placed).toBe(1);
    expect(labeledAssetWarnings(out)).toEqual(['polish_assets:placed:1']);
  });
  it('mediaKindOfUrl tells video from stills', () => {
    expect(mediaKindOfUrl('https://x.com/a.MP4?sig=1')).toBe('video');
    expect(mediaKindOfUrl('https://x.com/a.png')).toBe('image');
  });
});

describe('WP18 2) clustering into an image run', () => {
  it('two nearby uploaded stills become ONE run (and one slideshow overlay), not two pips', () => {
    const out = plan([slot('a', 'logo', 5, 7, {status: 'uploaded', userAssetId: 'ub_1'}), slot('b', 'person', 8, 10.5, {status: 'uploaded', userAssetId: 'ub_2'})]);
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0]!.items.map(item => item.src)).toEqual(['https://cdn.example.com/logo.png', 'https://cdn.example.com/person.jpg']);
    expect(out.runs[0]!.mode).toBe('sequence');
    expect(out.overlays).toHaveLength(1);
    expect(out.overlays[0]!.treatment).toBe('slideshow');
    expect(out.overlays[0]!.slides).toHaveLength(2);
    expect(out.placed).toBe(2);
  });
  it('two or more logos make a logo_cloud run', () => {
    const out = plan([slot('a', 'logo', 5, 7, {status: 'uploaded', userAssetId: 'ub_1'}), slot('b', 'logo', 7.5, 9.5, {status: 'uploaded', userAssetId: 'ub_5'})]);
    expect(out.runs[0]!.mode).toBe('logo_cloud');
  });
  it('one upload is placed alone and never forced into a run', () => {
    const out = plan([slot('a', 'screenshot', 5, 9, {status: 'uploaded', userAssetId: 'ub_3'})]);
    expect(out.runs).toHaveLength(0);
    expect(out.overlays).toHaveLength(1);
  });
  it('the run plan resolves in the library registry and passes worker validation', async () => {
    const out = plan([slot('a', 'logo', 5, 7, {status: 'uploaded', userAssetId: 'ub_1'}), slot('b', 'logo', 7.5, 9.5, {status: 'uploaded', userAssetId: 'ub_5'})]);
    const run = out.runs[0]!;
    const hit = resolveLibraryGraphic({goal: 'logos', visualDescription: 'logo run', placement: 'full_screen', content: {imageRun: run.items, mode: run.mode}})!;
    expect(hit.compositionId).toBe('ImageRun');
    expect(hit.props.mode).toBe('logo_cloud');
    expect(hit.assets).toEqual({run_0: {src: 'https://cdn.example.com/logo.png'}, run_1: {src: 'https://cdn.example.com/logo2.png'}});
    expect(libraryGraphicSource(hit)).not.toMatch(/https?:\/\//);
    const {report, compiled} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
  it('the registry rejects non-https sources, one item, and overlay placements', () => {
    const one = {imageRun: [{src: 'https://cdn.example.com/a.png'}]};
    const bad = {imageRun: [{src: 'file:///etc/passwd'}, {src: 'https://cdn.example.com/a.png'}]};
    const ok = {imageRun: [{src: 'https://cdn.example.com/a.png'}, {src: 'https://cdn.example.com/b.png'}]};
    expect(resolveLibraryGraphic({goal: 'x', visualDescription: 'y', placement: 'full_screen', content: one})).toBeNull();
    expect(resolveLibraryGraphic({goal: 'x', visualDescription: 'y', placement: 'full_screen', content: bad})).toBeNull();
    expect(resolveLibraryGraphic({goal: 'x', visualDescription: 'y', placement: 'overlay', content: ok})).toBeNull();
  });
});

describe('WP18 3) ImageRun source pins', () => {
  it('is registered and leaves the face', () => {
    expect(motionIndex).toMatch(/ImageRun, IMAGE_RUN_MAX_ITEMS/);
    expect(motionIndex).toMatch(/NewspaperCallout, FlashCard, ImageRun, TextualMgPlate\b/);
    expect(LEAVE_THE_FACE_COMPOSITIONS.has('ImageRun')).toBe(true);
  });
  it('props: items (2-6), mode sequence | logo_cloud, hold frames, recipe', () => {
    expect(comp).toMatch(/items: ImageRunItem\[\]/);
    expect(comp).toMatch(/mode\?: 'sequence' \| 'logo_cloud'/);
    expect(comp).toMatch(/holdFrames\?: number/);
    expect(comp).toMatch(/recipeId\?: MotionRecipeId/);
    expect(comp).toMatch(/IMAGE_RUN_MAX_ITEMS = 6/);
  });
  it('is video collage craft: recipe entrance + cut pop, no web chrome, no card grid, no text', () => {
    expect(comp).toMatch(/<MotionRecipe/);
    expect(comp).toMatch(/<Sequence/);
    expect(comp).not.toMatch(/gridTemplate|display: 'grid'|backdropFilter|<button|<a |cursor:|hover|border: '1px/i);
    expect(comp).not.toMatch(/<FitText|<span|<p[ >]/);
  });
});

describe('WP18 4) analyze wiring', () => {
  it('the hook sits after the bindings and before the WP16 density block, and records the warnings', () => {
    const bind = analyze.indexOf('applyLabeledAssetBindings(');
    const hook = analyze.indexOf('planLabeledAssetPlacements(');
    const density = analyze.indexOf('ensurePolishTransitionDensity(');
    expect(bind).toBeGreaterThan(0);
    expect(hook).toBeGreaterThan(bind);
    expect(density).toBeGreaterThan(hook);
    expect(analyze).toMatch(/labeledAssetWarnings\(placement\)/);
  });
  it('the bind route and applyLabeledAssetBindings stay intact', () => {
    expect(read('../../http/routes/analyzeRoutes.ts')).toMatch(/labeled-assets/);
    expect(read('./labeledAssetBrief.ts')).toMatch(/export function applyLabeledAssetBindings/);
  });
});
